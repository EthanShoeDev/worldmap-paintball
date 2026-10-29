import { assert, describe, it } from '@effect/vitest';
import { Array, Effect, Fiber, Predicate, Queue, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { Socket } from 'effect/socket';

import {
  ClientMessage,
  ClientMessageJson,
  type Lobby,
  type PlayerId,
  type ServerMessage,
  ServerMessageJson,
} from '../src/lobby/protocol.ts';
import { LobbyRooms } from '../src/lobby/rooms.ts';

const Client = ClientMessage.cases;
const CODE = 'ABCDEF';
const paris = { lat: 48.8584, lon: 2.2945, label: 'Paris' };
const offer = { _tag: 'Offer', sdp: 'v=0' } as const;

const encode = Schema.encodeEffect(ClientMessageJson);
const decode = Schema.decodeUnknownEffect(ServerMessageJson);
const closed = Socket.SocketError.make({
  reason: Socket.SocketCloseError.make({ code: 1000 }),
});

const requestFor = (code: string) =>
  HttpServerRequest.fromWeb(
    new Request(`http://localhost/api/lobbies/${code}/ws`, {
      headers: { upgrade: 'websocket' },
    }),
  );

// An in-memory socket stands in for Bun's upgrade; Vitest runs on Node, which
// has no `Bun.serve`.
const connect = Effect.fn(function* (code: string = CODE) {
  const rooms = yield* LobbyRooms;
  const inbound = yield* Queue.unbounded<string | undefined>();
  const outbound = yield* Queue.unbounded<ServerMessage>();
  const deliver = (chunk: Uint8Array | string | Socket.CloseEvent) =>
    Predicate.isString(chunk)
      ? decode(chunk).pipe(
          Effect.orDie,
          Effect.flatMap((message) => Queue.offer(outbound, message)),
          Effect.asVoid,
        )
      : Effect.void;
  const socket = Socket.make({
    reader: Effect.succeed({
      pull: Queue.take(inbound).pipe(
        Effect.flatMap((text) =>
          text === undefined
            ? Effect.fail(closed)
            : Effect.succeed([text] as const),
        ),
      ),
      upgrade: () => Effect.void,
    }),
    writer: Effect.succeed({
      write: deliver,
      writeAll: (chunks) => Effect.forEach(chunks, deliver, { discard: true }),
    }),
  });
  // `upgrade` is a prototype getter, so an own property shadows it.
  const request = Object.create(requestFor(code), {
    upgrade: { value: Effect.succeed(socket) },
  }) as HttpServerRequest.HttpServerRequest;
  const fiber = yield* rooms.connect(code, request).pipe(Effect.forkScoped);
  const sendText = (text: string) => Queue.offer(inbound, text);
  return {
    sendText,
    send: (message: ClientMessage) =>
      encode(message).pipe(Effect.orDie, Effect.flatMap(sendText)),
    receive: Queue.take(outbound),
    close: Queue.offer(inbound, undefined).pipe(
      Effect.andThen(Fiber.join(fiber)),
    ),
  };
});

type Connection = Effect.Success<ReturnType<typeof connect>>;

const expectLobby = Effect.fn(function* (connection: Connection) {
  const message = yield* connection.receive;
  assert.include(['Welcome', 'LobbyUpdated', 'MatchStarted'], message._tag);
  return 'lobby' in message ? message.lobby : assert.fail(message._tag);
});

const join = Effect.fn(function* (
  connection: Connection,
  message: ClientMessage,
) {
  yield* connection.send(message);
  const welcome = yield* connection.receive;
  return Predicate.isTagged(welcome, 'Welcome')
    ? welcome.you
    : assert.fail(welcome._tag);
});

const names = (lobby: Lobby) =>
  Array.map(lobby.players, (player) => player.name);

// Host plus two guests; everyone's queue is drained of join updates.
const lobbyOfThree = Effect.gen(function* () {
  const host = yield* connect();
  const p0 = yield* connect();
  const p1 = yield* connect();
  const hostId = yield* join(
    host,
    Client.CreateLobby.make({ name: 'Host', location: paris }),
  );
  const p0Id = yield* join(p0, Client.JoinLobby.make({ name: 'P0' }));
  yield* expectLobby(host);
  const p1Id = yield* join(p1, Client.JoinLobby.make({ name: 'P1' }));
  yield* expectLobby(host);
  yield* expectLobby(p0);
  return { host, p0, p1, ids: { host: hostId, p0: p0Id, p1: p1Id } };
});

describe('LobbyRooms.layerMemory', () => {
  it.effect('creates, joins and broadcasts updates', () =>
    Effect.gen(function* () {
      const { host, p0, p1, ids } = yield* lobbyOfThree;

      yield* p0.send(Client.SetReady.make({ ready: true }));
      yield* p1.send(Client.SetReady.make({ ready: true }));
      for (const connection of [host, p0, p1]) {
        yield* expectLobby(connection);
        const lobby = yield* expectLobby(connection);
        assert.deepStrictEqual(names(lobby), ['Host', 'P0', 'P1']);
        assert.strictEqual(lobby.hostId, ids.host);
      }

      yield* host.send(Client.StartMatch.make({}));
      for (const connection of [host, p0, p1]) {
        const message = yield* connection.receive;
        assert.strictEqual(message._tag, 'MatchStarted');
      }
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );

  it.effect('relays signals between the host and a client', () =>
    Effect.gen(function* () {
      const { host, p0, ids } = yield* lobbyOfThree;

      yield* host.send(Client.Signal.make({ to: ids.p0, signal: offer }));
      assert.deepStrictEqual(yield* p0.receive, {
        _tag: 'Signal',
        from: ids.host,
        signal: offer,
      });

      yield* p0.send(Client.Signal.make({ to: ids.p1, signal: offer }));
      assert.deepStrictEqual(yield* p0.receive, {
        _tag: 'Rejected',
        reason: 'PeerNotHost',
      });
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );

  it.effect('removes a guest who disconnects', () =>
    Effect.gen(function* () {
      const { host, p0, p1 } = yield* lobbyOfThree;
      yield* p1.close;
      for (const connection of [host, p0]) {
        assert.deepStrictEqual(names(yield* expectLobby(connection)), [
          'Host',
          'P0',
        ]);
      }
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );

  it.effect('migrates the host when the host disconnects while waiting', () =>
    Effect.gen(function* () {
      const { host, p0, p1, ids } = yield* lobbyOfThree;
      yield* host.close;
      for (const connection of [p0, p1]) {
        const lobby = yield* expectLobby(connection);
        assert.strictEqual(lobby.hostId, ids.p0);
        assert.deepStrictEqual(names(lobby), ['P0', 'P1']);
      }
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );

  it.effect('frees the code once everyone has left', () =>
    Effect.gen(function* () {
      const first = yield* connect();
      yield* join(
        first,
        Client.CreateLobby.make({ name: 'A', location: paris }),
      );
      yield* first.close;

      const second = yield* connect();
      const you: PlayerId = yield* join(
        second,
        Client.CreateLobby.make({ name: 'B', location: paris }),
      );
      assert.isString(you);
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );

  it.effect('keeps lobbies with different codes apart', () =>
    Effect.gen(function* () {
      const a = yield* connect('AAAAAA');
      const b = yield* connect('BBBBBB');
      yield* join(a, Client.CreateLobby.make({ name: 'A', location: paris }));
      yield* b.send(Client.JoinLobby.make({ name: 'B' }));
      assert.deepStrictEqual(yield* b.receive, {
        _tag: 'Rejected',
        reason: 'LobbyNotFound',
      });
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );

  it.effect('rejects malformed messages and outsiders', () =>
    Effect.gen(function* () {
      const stranger = yield* connect();
      yield* stranger.sendText('{"_tag":"Nope"}');
      assert.deepStrictEqual(yield* stranger.receive, {
        _tag: 'Rejected',
        reason: 'InvalidMessage',
      });
      yield* stranger.send(Client.LeaveLobby.make({}));
      assert.deepStrictEqual(yield* stranger.receive, {
        _tag: 'Rejected',
        reason: 'NotInLobby',
      });
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );

  it.effect('answers 426 to a plain HTTP request', () =>
    Effect.gen(function* () {
      const rooms = yield* LobbyRooms;
      const response = yield* rooms.connect(CODE, requestFor(CODE));
      assert.strictEqual(response.status, 426);
    }).pipe(Effect.provide(LobbyRooms.layerMemory)),
  );
});
