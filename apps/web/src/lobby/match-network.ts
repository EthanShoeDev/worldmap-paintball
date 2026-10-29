import type { Lobby, PlayerId } from '@worldmap-paintball/api/lobby/protocol';
import {
  Context,
  type Effect,
  type Option,
  type SubscriptionRef,
} from 'effect';

import type { PeerNetwork } from './peer-network.ts';

export interface MatchStart {
  readonly you: PlayerId;
  readonly lobby: Lobby;
}

// The session machine runs `play` while it is in a match, so the peer network
// exists exactly as long as that state; `current` lets the game reach it.
export class MatchNetwork extends Context.Service<
  MatchNetwork,
  {
    readonly play: (match: MatchStart) => Effect.Effect<never>;
    readonly current: SubscriptionRef.SubscriptionRef<
      Option.Option<PeerNetwork['Service']>
    >;
  }
>()('@worldmap-paintball/web/lobby/match-network/MatchNetwork') {}
