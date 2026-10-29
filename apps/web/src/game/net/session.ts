import type { Location } from '@worldmap-paintball/api/lobby/protocol';
import { Option } from 'effect';

import { type LobbySnapshot, LobbyStates } from '../../lobby/lobby-machine.ts';
import type { Coordinates } from '../../location/coordinates.ts';

const sameLocation = (location: Location, coordinates: Coordinates) =>
  location.lat === coordinates.lat && location.lon === coordinates.lon;

const codeOf = (snapshot: LobbySnapshot) =>
  Option.map(LobbyStates.get(snapshot, 'Session'), ({ code }) => code);

// /play joins the lobby's match only when it is running at these coordinates;
// any other visit is solo practice.
export const lobbyMatchCode = (
  snapshot: LobbySnapshot,
  coordinates: Coordinates,
) =>
  LobbyStates.matches(snapshot, 'Session.InLobby.Playing') &&
  Option.exists(LobbyStates.get(snapshot, 'Session.InLobby'), ({ lobby }) =>
    sameLocation(lobby.location, coordinates),
  )
    ? Option.getOrUndefined(codeOf(snapshot))
    : undefined;

export const matchStatus = (snapshot: LobbySnapshot, code: string) => {
  if (!Option.contains(codeOf(snapshot), code)) return 'closed';
  if (LobbyStates.matches(snapshot, 'Session.InLobby.Playing')) {
    return 'playing';
  }
  return LobbyStates.matches(snapshot, 'Session.InLobby.Waiting')
    ? 'ended'
    : 'closed';
};
