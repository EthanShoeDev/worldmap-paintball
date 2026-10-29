import '@tanstack/react-start/client-only';
import { AtomMachine } from '@typeonce/effect-machine/reactivity';
import {
  ClientMessage,
  type Location,
  makeLobbyCode,
} from '@worldmap-paintball/api-contract/lobby';
import { Effect, Layer, Option, Stream, SubscriptionRef } from 'effect';
import { AsyncResult, Atom, AtomRegistry } from 'effect/reactivity';

import { LobbyClient } from './lobby-client.ts';
import {
  type LobbyEvent,
  LobbyEvents,
  LobbyMachine,
  type LobbySnapshot,
} from './lobby-machine.ts';
import { MatchNetwork } from './match-network.ts';
import { matchNetworkLayer } from './peer-network.ts';

const Client = ClientMessage.cases;

// Same `/api` prefix as `ApiClient`; the socket route is `/lobbies/:code/ws`.
export const lobbyRuntime = Atom.runtime(
  matchNetworkLayer.pipe(
    Layer.provideMerge(LobbyClient.layerWebSocket('/api')),
  ),
).pipe(Atom.keepAlive);

const lobbyMachineAtom = AtomMachine.bind(lobbyRuntime).make(LobbyMachine);

const settled = <A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<Option.Option<A>, E>>,
) =>
  Atom.map(atom, (result) =>
    AsyncResult.getOrElse(result, Option.none<A>),
  ).pipe(
    // The session outlives the page that started it.
    Atom.keepAlive,
  );

// The whole session, for code that tells several states apart. Annotated
// because declaration emit cannot name the machine's internal snapshot types.
export const lobbyStateAtom: Atom.Atom<Option.Option<LobbySnapshot>> = settled(
  Atom.map(lobbyMachineAtom.result, AsyncResult.map(Option.some)),
);

export const sendLobbyEventAtom: Atom.Writable<unknown, LobbyEvent> =
  lobbyMachineAtom.send;

export const createLobbyAtom = lobbyRuntime.fn(
  Effect.fn('createLobby')(function* (input: {
    readonly name: string;
    readonly location: Location;
  }) {
    const registry = yield* AtomRegistry.AtomRegistry;
    const code = yield* makeLobbyCode;
    registry.set(sendLobbyEventAtom, LobbyEvents.Create({ code, ...input }));
    return code;
  }),
);

// Lobby actions go straight to the socket; the server's answer comes back
// through the session machine.
export const sendLobbyAtom = lobbyRuntime.fn(
  Effect.fn('sendLobby')(function* (message: ClientMessage) {
    const client = yield* LobbyClient;
    yield* client.send(message);
  }),
);

export const lobbyMessages = {
  setReady: (ready: boolean) => Client.SetReady.make({ ready }),
  setLocation: (location: Location) =>
    Client.SetLocation.make({ location }, { disableChecks: true }),
  startMatch: () => Client.StartMatch.make({}),
  endMatch: () => Client.EndMatch.make({}),
};

const noticeMs = 5000;

// The last refused lobby action, cleared after a few seconds.
export const lobbyNoticeAtom = lobbyRuntime.atom(
  AtomMachine.emissions(lobbyMachineAtom).pipe(
    Stream.switchMap(({ reason }) =>
      Stream.concat(
        Stream.make(Option.some(reason)),
        Stream.fromEffect(Effect.as(Effect.sleep(noticeMs), Option.none())),
      ),
    ),
    // The machine only fails on a bug; the session view reports that.
    Stream.catchCause(() => Stream.empty),
  ),
  { initialValue: Option.none() },
);

const currentNetworkAtom = lobbyRuntime.atom(
  Stream.unwrap(
    Effect.gen(function* () {
      const network = yield* MatchNetwork;
      return SubscriptionRef.changes(network.current);
    }),
  ),
);

// The running match's peer network, owned by the session machine's Playing
// state; waits while no match runs.
export const peerNetworkAtom = lobbyRuntime.atom((get) =>
  Effect.gen(function* () {
    const current = yield* get.result(currentNetworkAtom);
    return yield* Option.match(current, {
      onNone: () => Effect.never,
      onSome: Effect.succeed,
    });
  }),
);
