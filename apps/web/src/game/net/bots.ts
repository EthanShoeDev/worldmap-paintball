import type { Lobby, Player } from '@worldmap-paintball/api-contract/lobby';
import { String as Str } from 'effect';

// Phase 2 moves this onto the lobby's Player as a `bot` flag.
const botPrefix = 'bot-';

export const isBot = (player: Player) => Str.startsWith(botPrefix)(player.id);

export const botPlayer = (n: number): Player => ({
  id: `${botPrefix}${n}`,
  name: `Bot ${n}`,
  ready: true,
});

export const botPlayers = (count: number) =>
  Array.from({ length: count }, (_, index) => botPlayer(index + 1));

// Everyone in a lobby's match: its players, then the bots the host runs.
// Every member builds the same roster from the same lobby.
export const matchRoster = ({
  players,
  bots,
}: Pick<Lobby, 'players' | 'bots'>) => [...players, ...botPlayers(bots)];
