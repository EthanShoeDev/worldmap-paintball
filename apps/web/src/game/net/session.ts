import type { Location } from '@worldmap-paintball/api/lobby/protocol';

import type { LobbySession } from '../../lobby/lobby-client.ts';
import type { Coordinates } from '../../location/coordinates.ts';

const sameLocation = (location: Location, coordinates: Coordinates) =>
  location.lat === coordinates.lat && location.lon === coordinates.lon;

// /play joins the lobby's match only when it is running at these coordinates;
// any other visit is solo practice.
export const lobbyMatchCode = (
  session: LobbySession,
  coordinates: Coordinates,
) =>
  session.lobby?.phase === 'playing' &&
  sameLocation(session.lobby.location, coordinates)
    ? session.code
    : undefined;

export const matchStatus = (session: LobbySession, code: string) => {
  if (
    session.code !== code ||
    session.lobby === undefined ||
    session.closed !== undefined ||
    session.status === 'disconnected'
  ) {
    return 'closed';
  }
  return session.lobby.phase === 'waiting' ? 'ended' : 'playing';
};
