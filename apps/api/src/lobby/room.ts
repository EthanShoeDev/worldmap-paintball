import * as Cloudflare from '@alchemy.run/cloudflare';
import { Effect, Option, Predicate, Schema } from 'effect';
import { SecureRandom } from 'effect/crypto';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

import {
  ClientMessageJson,
  Lobby,
  type PlayerId,
  ServerMessage,
  ServerMessageJson,
} from './protocol.ts';
import { disconnect, reduce, type Step } from './reducer.ts';

const LOBBY_KEY = 'lobby';

const decodeClientMessage = Schema.decodeUnknownEffect(ClientMessageJson);
const encodeServerMessage = Schema.encodeEffect(ServerMessageJson);
const decodeStoredLobby = Schema.decodeUnknownEffect(Schema.UndefinedOr(Lobby));
const encodeLobby = Schema.encodeEffect(Lobby);

const newPlayerId = Effect.sync(() => SecureRandom.uuidV4Unsafe());

// One instance per lobby code. Each socket is tagged with its player id, so
// both membership (storage) and routing (tags) survive hibernation.
export class LobbyRoom extends Cloudflare.DurableObject<LobbyRoom>()(
  'LobbyRoom',
  Effect.map(Effect.service(Cloudflare.DurableObjectState), (state) =>
    Effect.gen(function* () {
      // A lobby stored under an older schema is dropped rather than migrated:
      // lobbies are short-lived. Storage failures still propagate.
      let lobby = yield* state.storage.get(LOBBY_KEY).pipe(
        Effect.flatMap(decodeStoredLobby),
        Effect.catchTag('SchemaError', (error) =>
          Effect.logWarning('Discarding unreadable stored lobby', error).pipe(
            Effect.as(undefined),
          ),
        ),
      );

      const playerIdOf = (socket: Cloudflare.WebSocket) =>
        state
          .getTags(socket.ws)
          .pipe(Effect.map((tags) => Option.fromNullishOr(tags[0])));

      const send = Effect.fn('LobbyRoom.send')(function* (
        socket: Cloudflare.WebSocket,
        message: ServerMessage,
      ) {
        const text = yield* encodeServerMessage(message).pipe(Effect.orDie);
        // A socket can be mid-close; its close handler cleans up after it.
        yield* socket.send(text).pipe(Effect.catchDefect(() => Effect.void));
      });

      const commit = Effect.fn('LobbyRoom.commit')(function* (step: Step) {
        if (step.lobby !== lobby) {
          lobby = step.lobby;
          yield* lobby === undefined
            ? state.storage.delete(LOBBY_KEY)
            : encodeLobby(lobby).pipe(
                Effect.orDie,
                Effect.flatMap((encoded) =>
                  state.storage.put(LOBBY_KEY, encoded),
                ),
              );
        }
        for (const { to, message } of step.outbox) {
          for (const socket of yield* state.getWebSockets(to)) {
            yield* send(socket, message);
          }
        }
      });

      const dropSocket = Effect.fn('LobbyRoom.dropSocket')(function* (
        socket: Cloudflare.WebSocket,
      ) {
        const from = yield* playerIdOf(socket);
        if (Option.isSome(from)) yield* commit(disconnect(lobby, from.value));
      });

      // Sockets dropped while the object was evicted never fire a close
      // event, so reconcile stored members against live sockets on wake.
      const live = new Set<PlayerId>();
      for (const socket of yield* state.getWebSockets()) {
        const id = yield* playerIdOf(socket);
        if (Option.isSome(id)) live.add(id.value);
      }
      for (const player of lobby?.players ?? []) {
        if (!live.has(player.id)) yield* commit(disconnect(lobby, player.id));
      }

      return {
        fetch: Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.headers.upgrade?.toLowerCase() !== 'websocket') {
            return HttpServerResponse.text('Expected a WebSocket upgrade', {
              status: 426,
            });
          }
          const [response] = yield* Cloudflare.upgrade({
            tags: [yield* newPlayerId],
          });
          return response;
        }),
        webSocketMessage: Effect.fn('LobbyRoom.webSocketMessage')(function* (
          socket: Cloudflare.WebSocket,
          message: string | ArrayBuffer,
        ) {
          const from = yield* playerIdOf(socket);
          if (Option.isNone(from)) return;
          const text = Predicate.isString(message)
            ? message
            : new TextDecoder().decode(message);
          const decoded = yield* Effect.option(decodeClientMessage(text));
          if (Option.isNone(decoded)) {
            yield* Effect.logWarning('Rejected malformed lobby message');
            yield* send(
              socket,
              ServerMessage.cases.Rejected.make({ reason: 'InvalidMessage' }),
            );
            return;
          }
          yield* commit(reduce(lobby, from.value, decoded.value));
        }),
        webSocketClose: Effect.fn('LobbyRoom.webSocketClose')(function* (
          socket: Cloudflare.WebSocket,
        ) {
          yield* dropSocket(socket);
          yield* socket
            .close(1000, 'Closed')
            .pipe(Effect.catchDefect(() => Effect.void));
        }),
        webSocketError: dropSocket,
      };
    }),
  ),
) {}
