import type * as Cloudflare from '@alchemy.run/cloudflare';
import {
  ClientMessageJson,
  type Lobby,
  type PlayerId,
  ServerMessage,
  ServerMessageJson,
} from '@worldmap-paintball/api-contract/lobby';
import { Context, Effect, Layer, Option, Schema, Semaphore } from 'effect';
import { SecureRandom } from 'effect/crypto';
import {
  type HttpServerError,
  type HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { Socket } from 'effect/socket';

import { disconnect, reduce, type Step } from './reducer.ts';
import type { LobbyRoom } from './room.ts';

const decodeClientMessage = Schema.decodeUnknownEffect(ClientMessageJson);
const encodeServerMessage = Schema.encodeEffect(ServerMessageJson);

const expectedUpgrade = HttpServerResponse.text(
  'Expected a WebSocket upgrade',
  {
    status: 426,
  },
);

interface MemoryRoom {
  lobby: Lobby | undefined;
  readonly sockets: Map<PlayerId, Socket.Writer>;
}

// Where lobby sockets live: Durable Objects on Cloudflare, process memory
// under the Bun dev server. Both drive the same `reduce` and `disconnect`.
export class LobbyRooms extends Context.Service<
  LobbyRooms,
  {
    readonly connect: (
      code: string,
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      HttpServerError.HttpServerError
    >;
  }
>()('@worldmap-paintball/api/lobby/rooms/LobbyRooms') {
  static readonly layerDurableObject = (
    rooms: Cloudflare.DurableObject<LobbyRoom>,
  ) =>
    Layer.succeed(
      LobbyRooms,
      LobbyRooms.of({
        connect: (code, request) => rooms.getByName(code).fetch(request),
      }),
    );

  // Single process only: state is lost on restart and not shared between
  // instances, which is fine for local development.
  static readonly layerMemory = Layer.effect(
    LobbyRooms,
    Effect.gen(function* () {
      const rooms = new Map<string, MemoryRoom>();
      const lock = yield* Semaphore.make(1);

      const send = Effect.fn('LobbyRooms.send')(function* (
        writer: Socket.Writer,
        message: ServerMessage,
      ) {
        const text = yield* encodeServerMessage(message).pipe(Effect.orDie);
        // A socket can be mid-close; its finalizer cleans up after it.
        yield* writer.write(text).pipe(Effect.ignore);
      });

      const commit = Effect.fn('LobbyRooms.commit')(function* (
        room: MemoryRoom,
        step: (lobby: Lobby | undefined) => Step,
      ) {
        const { lobby, outbox } = step(room.lobby);
        room.lobby = lobby;
        for (const { to, message } of outbox) {
          const writer = room.sockets.get(to);
          if (writer !== undefined) yield* send(writer, message);
        }
      }, lock.withPermits(1));

      const receive = Effect.fn('LobbyRooms.receive')(function* (
        room: MemoryRoom,
        from: PlayerId,
        writer: Socket.Writer,
        text: string,
      ) {
        const decoded = yield* Effect.option(decodeClientMessage(text));
        if (Option.isNone(decoded)) {
          yield* Effect.logWarning('Rejected malformed lobby message');
          yield* send(
            writer,
            ServerMessage.cases.Rejected.make({ reason: 'InvalidMessage' }),
          );
          return;
        }
        yield* commit(room, (lobby) => reduce(lobby, from, decoded.value));
      });

      const serve = Effect.fn('LobbyRooms.serve')(
        function* (code: string, socket: Socket.Socket) {
          const from = SecureRandom.uuidV4Unsafe();
          const writer = yield* socket.writer;
          const room = rooms.get(code) ?? {
            lobby: undefined,
            sockets: new Map(),
          };
          rooms.set(code, room);
          room.sockets.set(from, writer);
          yield* Effect.addFinalizer(() =>
            commit(room, (lobby) => disconnect(lobby, from)).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  room.sockets.delete(from);
                  if (room.sockets.size === 0) rooms.delete(code);
                }),
              ),
            ),
          );
          const pull = yield* Socket.readerString(socket);
          return yield* pull.pipe(
            Effect.flatMap(
              Effect.forEach((text) => receive(room, from, writer, text), {
                discard: true,
              }),
            ),
            Effect.forever,
          );
        },
        // A closed socket ends the read loop; the finalizer handles the rest.
        Effect.catchTag('SocketError', () => Effect.void),
        Effect.scoped,
      );

      return LobbyRooms.of({
        connect: (code, request) =>
          request.upgrade.pipe(
            Effect.flatMap((socket) => serve(code, socket)),
            Effect.as(HttpServerResponse.empty()),
            Effect.catchTag('HttpServerError', () =>
              Effect.succeed(expectedUpgrade),
            ),
          ),
      });
    }),
  );
}
