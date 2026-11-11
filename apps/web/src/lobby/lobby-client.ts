import {
  ClientMessageJson,
  type ClientMessage,
  type Lobby,
  lobbySocketPath,
  type PlayerId,
  ServerMessage,
  ServerMessageJson,
  type SignalPayload,
} from '@worldmap-paintball/api-contract/lobby';
import {
  Context,
  Effect,
  Layer,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  Stream,
} from 'effect';
import { Socket } from 'effect/socket';

export class LobbyConnectionError extends Schema.TaggedError<
  LobbyConnectionError,
  { readonly brand: unique symbol }
>()('LobbyConnectionError', { cause: Schema.Defect() }) {}

export class LobbyNotConnectedError extends Schema.TaggedError<
  LobbyNotConnectedError,
  { readonly brand: unique symbol }
>()('LobbyNotConnectedError', {}) {}

export interface IncomingSignal {
  readonly from: PlayerId;
  readonly signal: SignalPayload;
}

const encodeClientMessage = Schema.encodeEffect(ClientMessageJson);
const decodeServerMessage = Schema.decodeEffect(ServerMessageJson);

export const lobbySocketUrl = (baseUrl: string, code: string) => {
  const url = new URL(
    `${baseUrl}${lobbySocketPath(code)}`,
    globalThis.location.href,
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
};

// The lobby transport. It owns no session state: the session machine decides
// when a socket exists by running `connect` as a state-owned stream, so
// leaving that state closes the socket and `send` stops working.
export class LobbyClient extends Context.Service<
  LobbyClient,
  {
    // Opens the lobby socket, sends `hello` and streams every server message
    // except signals, which go to `signals`.
    readonly connect: (
      code: string,
      hello: ClientMessage,
    ) => Stream.Stream<ServerMessage, LobbyConnectionError>;
    readonly send: (
      message: ClientMessage,
    ) => Effect.Effect<void, LobbyNotConnectedError | LobbyConnectionError>;
    // WebRTC signals, buffered from the moment the match starts so a peer
    // network built after `MatchStarted` still sees the host's offer.
    readonly signals: Stream.Stream<IncomingSignal>;
    // Every lobby state the server sends, for the peer network's roster.
    readonly lobbies: Stream.Stream<Lobby>;
  }
>()('@worldmap-paintball/web/lobby/lobby-client/LobbyClient') {
  static readonly layerSocket = (baseUrl: string) =>
    Layer.effect(
      LobbyClient,
      Effect.gen(function* () {
        const webSocket = yield* Socket.WebSocketConstructor;
        const writer = yield* Ref.make(Option.none<Socket.Writer>());
        const signalQueue = yield* Queue.unbounded<IncomingSignal>();
        const lobbies = yield* PubSub.unbounded<Lobby>();

        const route = Effect.fn('LobbyClient.route')(function* (frame: string) {
          const decoded = yield* Effect.option(decodeServerMessage(frame));
          if (Option.isNone(decoded)) {
            yield* Effect.logWarning('Ignored malformed lobby message');
            return [];
          }
          const message = decoded.value;
          if (ServerMessage.guards.Signal(message)) {
            yield* Queue.offer(signalQueue, message);
            return [];
          }
          if (ServerMessage.guards.MatchStarted(message)) {
            yield* Queue.clear(signalQueue);
          }
          if (
            ServerMessage.guards.MatchStarted(message) ||
            ServerMessage.guards.LobbyUpdated(message)
          ) {
            yield* PubSub.publish(lobbies, message.lobby);
          }
          return [message];
        });

        const write = Effect.fn('LobbyClient.write')(function* (
          to: Socket.Writer,
          message: ClientMessage,
        ) {
          const encoded = yield* encodeClientMessage(message);
          yield* to.write(encoded);
        });

        const open = Effect.fn('LobbyClient.open')(function* (
          code: string,
          hello: ClientMessage,
        ) {
          const socket = yield* Socket.makeWebSocket(
            lobbySocketUrl(baseUrl, code),
          ).pipe(Effect.provideService(Socket.WebSocketConstructor, webSocket));
          // Resolves once the socket is open.
          const pull = yield* Socket.readerString(socket);
          const socketWriter = yield* socket.writer;
          yield* write(socketWriter, hello);
          yield* Ref.set(writer, Option.some(socketWriter));
          yield* Effect.addFinalizer(() =>
            Effect.andThen(
              Ref.set(writer, Option.none()),
              Queue.clear(signalQueue),
            ),
          );
          return Stream.fromEffectRepeat(pull).pipe(
            Stream.flattenIterable,
            Stream.mapEffect(route),
            Stream.flattenIterable,
          );
        });

        const connect = (code: string, hello: ClientMessage) =>
          Stream.unwrap(open(code, hello)).pipe(
            Stream.mapError((cause) => LobbyConnectionError.make({ cause })),
          );

        const send = Effect.fn('LobbyClient.send')(function* (
          message: ClientMessage,
        ) {
          const current = yield* Ref.get(writer);
          if (Option.isNone(current)) {
            return yield* LobbyNotConnectedError.make();
          }
          yield* write(current.value, message).pipe(
            Effect.mapError((cause) => LobbyConnectionError.make({ cause })),
          );
        });

        return LobbyClient.of({
          connect,
          send,
          signals: Stream.fromQueue(signalQueue),
          lobbies: Stream.fromPubSub(lobbies),
        });
      }),
    );

  static readonly layerWebSocket = (baseUrl: string) =>
    LobbyClient.layerSocket(baseUrl).pipe(
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
    );
}
