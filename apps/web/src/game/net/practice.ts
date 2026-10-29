import '@tanstack/react-start/client-only';
import type { Player, PlayerId } from '@worldmap-paintball/api-contract/lobby';
import {
  Context,
  Effect,
  Layer,
  Stream,
  String as Str,
  SubscriptionRef,
} from 'effect';
import { Atom } from 'effect/reactivity';

import { arenaAtom } from '../../api-client.ts';
import { playerNameAtom } from '../../components/player-name-atom.ts';
import { PeerNetwork, PeerNetworkError } from '../../lobby/peer-network.ts';
import type { Coordinates } from '../../location/coordinates.ts';
import { arenaSpawns, botPlayer, NetGame } from './net-game.ts';

const practiceId = 'practice-you';

// A host with no links: NetGame runs the match, scores and respawns locally,
// and every other player is a bot it simulates.
export const localPeerNetwork = Effect.fn('localPeerNetwork')(function* (
  roster: ReadonlyArray<Player>,
) {
  const players = yield* SubscriptionRef.make(roster);
  const peers = yield* SubscriptionRef.make<
    ReadonlyMap<PlayerId, RTCPeerConnectionState>
  >(new Map());
  return PeerNetwork.of({
    you: practiceId,
    hostId: practiceId,
    isHost: true,
    roster,
    players,
    peers,
    messages: Stream.never,
    snapshots: Stream.never,
    send: () => Effect.fail(PeerNetworkError.make({ reason: 'UnknownPeer' })),
    broadcast: () => Effect.void,
    sendSnapshot: () => Effect.void,
  });
});

export interface PracticeKey extends Coordinates {
  readonly bots: number;
}

// One per arena and bot count, like netGameAtom; leaving /play ends it.
export const practiceGameAtom = Atom.family(
  ({ bots, ...coordinates }: PracticeKey) =>
    Atom.make((get) =>
      Effect.gen(function* () {
        const arena = yield* get.result(arenaAtom(coordinates));
        const name = Str.trim(get(playerNameAtom));
        const roster = [
          { id: practiceId, name: name.length > 0 ? name : 'You', ready: true },
          ...Array.from({ length: bots }, (_, index) => botPlayer(index + 1)),
        ];
        const network = yield* localPeerNetwork(roster);
        const context = yield* Layer.build(
          NetGame.layerWith(arenaSpawns(arena)),
        ).pipe(Effect.provideService(PeerNetwork, network));
        return Context.get(context, NetGame);
      }),
    ),
);
