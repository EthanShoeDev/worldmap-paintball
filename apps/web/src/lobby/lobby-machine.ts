import { Machine } from '@typeonce/effect-machine';
import {
  ClientMessage,
  Lobby,
  LobbyCode,
  Location,
  PlayerId,
  PlayerName,
  RejectReason,
  ServerMessage,
} from '@worldmap-paintball/api-contract/lobby';
import { Effect, Schema, Stream } from 'effect';

import { LobbyClient } from './lobby-client.ts';
import { type MatchStart, MatchNetwork } from './match-network.ts';

const Client = ClientMessage.cases;

// What the session's socket was opened to do.
export const LobbyRequest = Schema.TaggedUnion({
  Create: { name: PlayerName, location: Location },
  Join: { name: PlayerName },
});
export type LobbyRequest = typeof LobbyRequest.Type;

export const FailureReason = Schema.Union([
  RejectReason,
  Schema.Literals(['Unreachable', 'TimedOut']),
]);
export type FailureReason = typeof FailureReason.Type;

const ClosedReason = Schema.Literals(['HostLeft']);

// Session owns the socket, so it exists exactly while a lobby code is being
// dialled or used; Ended keeps the code for the page that shows why.
export const LobbyStates = Machine.state({
  states: {
    Idle: {},
    Session: {
      fields: { code: LobbyCode, request: LobbyRequest },
      states: {
        Connecting: {},
        InLobby: {
          fields: { you: PlayerId, lobby: Lobby },
          states: { Waiting: {}, Playing: {} },
        },
      },
    },
    Ended: {
      fields: { code: LobbyCode },
      states: {
        Lost: {},
        Closed: { fields: { reason: ClosedReason } },
        Failed: {
          fields: {
            request: Schema.Literals(['Create', 'Join']),
            reason: FailureReason,
          },
        },
      },
    },
  },
});

export const LobbyEvents = Machine.events({
  Create: { code: LobbyCode, name: PlayerName, location: Location },
  Join: { code: LobbyCode, name: PlayerName },
  Leave: {},
  Welcomed: { you: PlayerId, lobby: Lobby },
  LobbyUpdated: { lobby: Lobby },
  MatchStarted: { lobby: Lobby },
  LobbyClosed: { reason: ClosedReason },
  Rejected: { reason: RejectReason },
  Disconnected: {},
});

// A refused lobby action (NotHost, PlayersNotReady, ...) is feedback for the
// moment, not part of the session.
export const LobbyNotices = Machine.emittedEvents({
  ActionRejected: { reason: RejectReason },
});

const hello = (request: LobbyRequest) =>
  LobbyRequest.match(request, {
    Create: ({ name, location }) =>
      Client.CreateLobby.make({ name, location }, { disableChecks: true }),
    Join: ({ name }) =>
      Client.JoinLobby.make({ name }, { disableChecks: true }),
  });

const toEvent = (message: ServerMessage) =>
  ServerMessage.match(message, {
    Welcome: ({ you, lobby }) => LobbyEvents.Welcomed({ you, lobby }),
    LobbyUpdated: ({ lobby }) => LobbyEvents.LobbyUpdated({ lobby }),
    MatchStarted: ({ lobby }) => LobbyEvents.MatchStarted({ lobby }),
    LobbyClosed: ({ reason }) => LobbyEvents.LobbyClosed({ reason }),
    Rejected: ({ reason }) => LobbyEvents.Rejected({ reason }),
    Signal: () => undefined,
  });

export const LobbyMachine = Machine.make({
  id: 'LobbySession',
  root: LobbyStates,
  events: LobbyEvents,
  emittedEvents: LobbyNotices,
  streams: {
    socket: (session: {
      readonly code: string;
      readonly request: LobbyRequest;
    }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* LobbyClient;
          return client.connect(session.code, hello(session.request));
        }),
      ),
  },
  effects: {
    play: (match: MatchStart) =>
      Effect.gen(function* () {
        const network = yield* MatchNetwork;
        return yield* network.play(match);
      }),
  },
  timers: { connectTimeout: '10 seconds' },
  branches: {
    end: { ended: { target: 'Ended' } },
    waiting: {
      stay: { update: 'Session.InLobby' },
      start: { target: 'Session.InLobby.Playing', update: 'Session.InLobby' },
    },
    playing: {
      stay: { update: 'Session.InLobby' },
      finish: { target: 'Session.InLobby.Waiting', update: 'Session.InLobby' },
    },
  },
}).handle({
  initial: { target: 'Idle' },
  // Reentry gives a new code a fresh Session, and with it a fresh socket.
  on: {
    Create: {
      target: 'Session',
      reenter: true,
      data: ({ event: { code, name, location } }) => ({
        code,
        request: { _tag: 'Create' as const, name, location },
      }),
    },
    Join: {
      target: 'Session',
      reenter: true,
      data: ({ event: { code, name } }) => ({
        code,
        request: { _tag: 'Join' as const, name },
      }),
    },
  },
  states: {
    Idle: {},
    Session: {
      initial: { target: 'Session.Connecting' },
      invoke: {
        src: 'socket',
        input: ({ state }) => state,
        onElement: {
          none: true,
          resolve: ({ element }, enqueue) => {
            const event = toEvent(element);
            if (event !== undefined) enqueue.raise(event);
          },
        },
        onDone: {
          none: true,
          resolve: (_, enqueue) => {
            enqueue.raise(LobbyEvents.Disconnected());
          },
        },
        onFailure: {
          none: true,
          resolve: (_, enqueue) => {
            enqueue.raise(LobbyEvents.Disconnected());
          },
        },
      },
      on: { Leave: { target: 'Idle' } },
      states: {
        Connecting: {
          invoke: {
            src: 'connectTimeout',
            onDone: {
              branches: 'end',
              resolve: ({ ancestors: { Session: session }, select }) =>
                select.ended({
                  data: { code: session.code },
                  states: {
                    Failed: {
                      data: {
                        request: session.request._tag,
                        reason: 'TimedOut',
                      },
                    },
                  },
                }),
            },
          },
          on: {
            Welcomed: {
              target: 'Session.InLobby',
              data: ({ event: { you, lobby } }) => ({ you, lobby }),
            },
            Rejected: {
              branches: 'end',
              resolve: ({ ancestors: { Session: session }, event, select }) =>
                select.ended({
                  data: { code: session.code },
                  states: {
                    Failed: {
                      data: {
                        request: session.request._tag,
                        reason: event.reason,
                      },
                    },
                  },
                }),
            },
            Disconnected: {
              branches: 'end',
              resolve: ({ ancestors: { Session: session }, select }) =>
                select.ended({
                  data: { code: session.code },
                  states: {
                    Failed: {
                      data: {
                        request: session.request._tag,
                        reason: 'Unreachable',
                      },
                    },
                  },
                }),
            },
          },
        },
        InLobby: {
          initial: { target: 'Session.InLobby.Waiting' },
          on: {
            Rejected: {
              none: true,
              resolve: ({ event: { reason } }, enqueue) => {
                enqueue.emit(LobbyNotices.ActionRejected({ reason }));
              },
            },
            LobbyClosed: {
              branches: 'end',
              resolve: ({ ancestors: { Session: session }, event, select }) =>
                select.ended({
                  data: { code: session.code },
                  states: { Closed: { data: { reason: event.reason } } },
                }),
            },
            Disconnected: {
              branches: 'end',
              resolve: ({ ancestors: { Session: session }, select }) =>
                select.ended({
                  data: { code: session.code },
                  states: { Lost: {} },
                }),
            },
          },
          states: {
            Waiting: {
              on: {
                LobbyUpdated: {
                  branches: 'waiting',
                  resolve: ({ ancestors, event: { lobby }, select }) => {
                    const update = { ...ancestors['Session.InLobby'], lobby };
                    return lobby.phase === 'playing'
                      ? select.start({ update: { data: update } })
                      : select.stay({ data: update });
                  },
                },
                MatchStarted: {
                  branches: 'waiting',
                  resolve: ({ ancestors, event: { lobby }, select }) => {
                    const update = { ...ancestors['Session.InLobby'], lobby };
                    return lobby.phase === 'playing'
                      ? select.start({ update: { data: update } })
                      : select.stay({ data: update });
                  },
                },
              },
            },
            Playing: {
              invoke: {
                src: 'play',
                input: ({ ancestors }) => ancestors['Session.InLobby'],
              },
              on: {
                LobbyUpdated: {
                  branches: 'playing',
                  resolve: ({ ancestors, event: { lobby }, select }) => {
                    const update = { ...ancestors['Session.InLobby'], lobby };
                    return lobby.phase === 'waiting'
                      ? select.finish({ update: { data: update } })
                      : select.stay({ data: update });
                  },
                },
              },
            },
          },
        },
      },
    },
    Ended: {
      initial: { target: 'Ended.Lost' },
      on: { Leave: { target: 'Idle' } },
      states: { Lost: {}, Closed: {}, Failed: {} },
    },
  },
});

export type LobbySnapshot = Machine.Machine.Snapshot<
  Machine.Machine.States<typeof LobbyMachine>
>;

export type LobbyEvent = Machine.Machine.EventInput<
  Machine.Machine.InputEvent<typeof LobbyMachine>
>;
