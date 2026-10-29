import type { Location } from '@worldmap-paintball/api/lobby/protocol';
import { ClientMessage } from '@worldmap-paintball/api/lobby/protocol';
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';

import { idleSession, LobbyClient } from './lobby-client.ts';
import { PeerNetwork } from './peer-network.ts';

const Client = ClientMessage.cases;

// Same `/api` prefix as `ApiClient`; the socket route is `/lobbies/:code/ws`.
export const lobbyRuntime = Atom.runtime(
  LobbyClient.layerWebSocket('/api'),
).pipe(Atom.keepAlive);

const sessionResultAtom = lobbyRuntime.atom(
  Stream.unwrap(
    Effect.map(Effect.service(LobbyClient), (client) =>
      SubscriptionRef.changes(client.session),
    ),
  ),
  { initialValue: idleSession },
);

export const lobbySessionAtom = Atom.map(sessionResultAtom, (result) =>
  AsyncResult.getOrElse(result, () => idleSession),
);

export const createLobbyAtom = lobbyRuntime.fn(
  Effect.fn('createLobby')(function* (input: {
    readonly name: string;
    readonly location: Location;
  }) {
    const client = yield* LobbyClient;
    return yield* client.create(input.name, input.location);
  }),
);

export const joinLobbyAtom = lobbyRuntime.fn(
  Effect.fn('joinLobby')(function* (input: {
    readonly code: string;
    readonly name: string;
  }) {
    const client = yield* LobbyClient;
    return yield* client.join(input.code, input.name);
  }),
);

export const leaveLobbyAtom = lobbyRuntime.fn(
  Effect.fn('leaveLobby')(function* () {
    const client = yield* LobbyClient;
    yield* client.leave;
  }),
);

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

// Changes only when a match starts or ends, so lobby chatter (ready flags,
// a client leaving) does not tear down the peer network.
const matchKeyAtom = Atom.map(lobbySessionAtom, ({ code, lobby }) =>
  lobby?.phase === 'playing' ? `${code}:${lobby.hostId}` : undefined,
);

// Built per match and torn down (closing every RTCPeerConnection) when the
// last subscriber unmounts or the match ends.
export const peerNetworkAtom = lobbyRuntime.atom((get) =>
  Effect.gen(function* () {
    get(matchKeyAtom);
    const context = yield* Layer.build(PeerNetwork.layer);
    return Context.get(context, PeerNetwork);
  }),
);
