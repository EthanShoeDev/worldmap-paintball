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

import { playerNameAtom } from '../../components/player-name-atom.ts';
import { PeerNetwork, PeerNetworkError } from '../../lobby/peer-network.ts';
import { customArenaAtom, type MatchKey } from '../map-settings.ts';
import { padsOf } from '../powerups.ts';
import { weaponsAt } from '../tuning.ts';
import { botPlayers } from './bots.ts';
import { arenaSpawns, NetGame } from './net-game.ts';

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

export interface PracticeKey extends MatchKey {
  readonly bots: number;
}

// One per arena and bot count, like netGameAtom; leaving /play ends it.
export const practiceGameAtom = Atom.family(
  ({ bots, rules, ...key }: PracticeKey) =>
    Atom.make((get) =>
      Effect.gen(function* () {
        const arena = yield* get.result(customArenaAtom(key));
        const name = Str.trim(get(playerNameAtom));
        const roster = [
          { id: practiceId, name: name.length > 0 ? name : 'You', ready: true },
          ...botPlayers(bots),
        ];
        const network = yield* localPeerNetwork(roster);
        const context = yield* Layer.build(
          NetGame.layerWith(
            arenaSpawns(arena),
            weaponsAt(rules.paintballSpeed),
            padsOf(arena),
          ),
        ).pipe(Effect.provideService(PeerNetwork, network));
        return Context.get(context, NetGame);
      }),
    ),
);
