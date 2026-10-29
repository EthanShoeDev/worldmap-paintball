import { BrowserSocket } from '@effect/platform-browser';
import {
  ClientMessage,
  ClientMessageJson,
  type Location,
  type Lobby,
  lobbySocketPath,
  makeLobbyCode,
  normalizeLobbyCode,
  type PlayerId,
  RejectReason,
  ServerMessage,
  ServerMessageJson,
  type SignalPayload,
} from '@worldmap-paintball/api/lobby/protocol';
import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  PubSub,
  Queue,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect';
import { Socket } from 'effect/socket';

export class LobbyConnectionError extends Schema.TaggedError<
  LobbyConnectionError,
  { readonly brand: unique symbol }
>()('LobbyConnectionError', { cause: Schema.Defect() }) {}

export class LobbyRejectedError extends Schema.TaggedError<
  LobbyRejectedError,
  { readonly brand: unique symbol }
>()('LobbyRejectedError', { reason: RejectReason }) {}

export class LobbyNotConnectedError extends Schema.TaggedError<
  LobbyNotConnectedError,
  { readonly brand: unique symbol }
>()('LobbyNotConnectedError', {}) {}

export interface LobbySession {
  readonly status: 'idle' | 'connecting' | 'connected' | 'disconnected';
  readonly code: string | undefined;
  readonly you: PlayerId | undefined;
  readonly lobby: Lobby | undefined;
  readonly closed: 'HostLeft' | undefined;
  readonly rejection: RejectReason | undefined;
}

export const idleSession: LobbySession = {
  status: 'idle',
  code: undefined,
  you: undefined,
  lobby: undefined,
  closed: undefined,
  rejection: undefined,
};

export interface Joined {
  readonly code: string;
  readonly you: PlayerId;
  readonly lobby: Lobby;
}

export interface IncomingSignal {
  readonly from: PlayerId;
  readonly signal: SignalPayload;
}

const Client = ClientMessage.cases;
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

const applyToSession = (
  session: LobbySession,
  message: ServerMessage,
): LobbySession =>
  ServerMessage.match(message, {
    Welcome: ({ you, lobby }) => ({
      ...session,
      you,
      lobby,
      rejection: undefined,
    }),
    // A fresh lobby state supersedes whatever the last rejection was about.
    LobbyUpdated: ({ lobby }) => ({ ...session, lobby, rejection: undefined }),
    MatchStarted: ({ lobby }) => ({ ...session, lobby, rejection: undefined }),
    LobbyClosed: ({ reason }) => ({
      ...session,
      lobby: undefined,
      closed: reason,
    }),
    Signal: () => session,
    Rejected: ({ reason }) => ({ ...session, rejection: reason }),
  });

interface Connection {
  readonly scope: Scope.Closeable;
  readonly writer: Socket.Writer;
}

// One lobby connection at a time; each `create`/`join` dials a fresh socket
// because the server assigns the player id per socket.
export class LobbyClient extends Context.Service<
  LobbyClient,
  {
    readonly session: SubscriptionRef.SubscriptionRef<LobbySession>;
    // WebRTC signals, buffered from the moment the match starts so a peer
    // network built after `MatchStarted` still sees the host's offer.
    readonly signals: Stream.Stream<IncomingSignal>;
    readonly create: (
      name: string,
      location: Location,
    ) => Effect.Effect<Joined, LobbyConnectionError | LobbyRejectedError>;
    readonly join: (
      code: string,
      name: string,
    ) => Effect.Effect<Joined, LobbyConnectionError | LobbyRejectedError>;
    readonly leave: Effect.Effect<void>;
    readonly send: (
      message: ClientMessage,
    ) => Effect.Effect<
      void,
      LobbyNotConnectedError | LobbyConnectionError | LobbyRejectedError
    >;
  }
>()('@worldmap-paintball/web/lobby/lobby-client/LobbyClient') {
  static readonly layerSocket = (baseUrl: string) =>
    Layer.effect(
      LobbyClient,
      Effect.gen(function* () {
        const webSocket = yield* Socket.WebSocketConstructor;
        const session = yield* SubscriptionRef.make(idleSession);
        const inbox = yield* PubSub.unbounded<ServerMessage>();
        const signalQueue = yield* Queue.unbounded<IncomingSignal>();
        const connection = yield* Ref.make(Option.none<Connection>());

        const disconnect = Effect.gen(function* () {
          const current = yield* Ref.getAndSet(connection, Option.none());
          if (Option.isSome(current)) {
            yield* Scope.close(current.value.scope, Exit.void);
          }
          yield* Queue.clear(signalQueue);
        });
        yield* Effect.addFinalizer(() => disconnect);

        const receive = Effect.fn('LobbyClient.receive')(function* (
          frame: string,
        ) {
          const decoded = yield* Effect.option(decodeServerMessage(frame));
          if (Option.isNone(decoded)) {
            yield* Effect.logWarning('Ignored malformed lobby message');
            return;
          }
          const message = decoded.value;
          if (ServerMessage.guards.MatchStarted(message)) {
            yield* Queue.clear(signalQueue);
          }
          if (ServerMessage.guards.Signal(message)) {
            yield* Queue.offer(signalQueue, message);
          }
          yield* SubscriptionRef.update(session, (current) =>
            applyToSession(current, message),
          );
          yield* PubSub.publish(inbox, message);
        });

        const connect = Effect.fn('LobbyClient.connect')(
          function* (code: string) {
            yield* disconnect;
            yield* SubscriptionRef.set(session, {
              ...idleSession,
              status: 'connecting',
              code,
            });
            const scope = yield* Scope.make();
            const socket = yield* Socket.makeWebSocket(
              lobbySocketUrl(baseUrl, code),
            ).pipe(
              Effect.provideService(Socket.WebSocketConstructor, webSocket),
            );
            const pull = yield* Socket.readerString(socket).pipe(
              Scope.provide(scope),
              Effect.tapError(() => Scope.close(scope, Exit.void)),
            );
            const writer = yield* socket.writer.pipe(Scope.provide(scope));
            yield* pull.pipe(
              Effect.flatMap(Effect.forEach(receive, { discard: true })),
              Effect.forever,
              Effect.catch(() =>
                SubscriptionRef.update(session, (current): LobbySession => ({
                  ...current,
                  status: 'disconnected',
                })),
              ),
              Effect.forkIn(scope),
            );
            yield* Ref.set(connection, Option.some({ scope, writer }));
            yield* SubscriptionRef.update(session, (current): LobbySession => ({
              ...current,
              status: 'connected',
            }));
          },
          Effect.mapError((cause) => LobbyConnectionError.make({ cause })),
        );

        const send = Effect.fn('LobbyClient.send')(function* (
          message: ClientMessage,
        ) {
          const current = yield* Ref.get(connection);
          const { status } = yield* SubscriptionRef.get(session);
          if (Option.isNone(current) || status !== 'connected') {
            return yield* LobbyNotConnectedError.make();
          }
          const text = yield* encodeClientMessage(message).pipe(
            Effect.mapError(() =>
              LobbyRejectedError.make({ reason: 'InvalidMessage' }),
            ),
          );
          yield* current.value.writer
            .write(text)
            .pipe(
              Effect.mapError((cause) => LobbyConnectionError.make({ cause })),
            );
        });

        // Subscribes before sending so the reply cannot slip past.
        const request = Effect.fn('LobbyClient.request')(
          function* (message: ClientMessage) {
            const replies = yield* PubSub.subscribe(inbox);
            yield* send(message);
            for (;;) {
              const reply = yield* PubSub.take(replies);
              if (ServerMessage.guards.Rejected(reply)) {
                return yield* LobbyRejectedError.make({ reason: reply.reason });
              }
              if (ServerMessage.guards.Welcome(reply)) return reply;
            }
          },
          Effect.scoped,
          Effect.timeout('10 seconds'),
          Effect.catchTags({
            LobbyNotConnectedError: (cause) =>
              Effect.fail(LobbyConnectionError.make({ cause })),
            TimeoutError: (cause) =>
              Effect.fail(LobbyConnectionError.make({ cause })),
          }),
        );

        const enter = Effect.fn('LobbyClient.enter')(
          function* (code: string, message: ClientMessage) {
            yield* connect(code);
            const { you, lobby } = yield* request(message);
            return { code, you, lobby };
          },
          Effect.tapError(() => disconnect),
        );

        const create = Effect.fn('LobbyClient.create')(
          function* (name: string, location: Location) {
            const code = yield* makeLobbyCode;
            return yield* enter(
              code,
              Client.CreateLobby.make(
                { name, location },
                { disableChecks: true },
              ),
            );
          },
          // Codes are random, so a collision just means roll again.
          Effect.retry({
            while: (error) =>
              Predicate.isTagged(error, 'LobbyRejectedError') &&
              error.reason === 'LobbyExists',
            times: 3,
          }),
        );

        const join = Effect.fn('LobbyClient.join')(function* (
          code: string,
          name: string,
        ) {
          return yield* enter(
            normalizeLobbyCode(code),
            Client.JoinLobby.make({ name }, { disableChecks: true }),
          );
        });

        const leave = Effect.gen(function* () {
          yield* send(Client.LeaveLobby.make({})).pipe(Effect.ignore);
          yield* disconnect;
          yield* SubscriptionRef.set(session, idleSession);
        });

        return LobbyClient.of({
          session,
          signals: Stream.fromQueue(signalQueue),
          create,
          join,
          leave,
          send,
        });
      }),
    );

  static readonly layerWebSocket = (baseUrl: string) =>
    LobbyClient.layerSocket(baseUrl).pipe(
      Layer.provide(BrowserSocket.layerWebSocketConstructor),
    );
}
