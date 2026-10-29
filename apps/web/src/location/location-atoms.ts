import { Effect } from 'effect';
import { Atom } from 'effect/reactivity';

import { ApiClient, apiRuntime } from '../api-client.ts';
import type { Coordinates } from './coordinates.ts';

// Mirrors HALF_SIZE in apps/api/src/map-data.ts; only used to preview the area.
export const arenaHalfSize = 150;

const maxResults = 5;

export interface Selection extends Coordinates {
  readonly label: string;
  // Map clicks already show the spot; searched places need the map to move.
  readonly flyTo: boolean;
}

export const selectionAtom = Atom.make<Selection | undefined>(undefined);

export const placesAtom = apiRuntime.fn(
  Effect.fn('searchPlaces')(function* (q: string) {
    const client = yield* ApiClient;
    const places = yield* client.places.search({ query: { q } });
    return places.slice(0, maxResults);
  }),
);

// Fire-and-forget: asks the API to bake the arena while the lobby fills up,
// so the requests every member sends at Start are usually cache hits. Kept
// alive and concurrent so navigating away or picking again never aborts a
// bake already underway.
export const warmArenaAtom = apiRuntime
  .fn(
    Effect.fn('warmArena')(function* ({ lat, lon }: Coordinates) {
      const client = yield* ApiClient;
      yield* client.arenas.get({ query: { lat, lon } }).pipe(Effect.ignore);
    }),
    { concurrent: true },
  )
  .pipe(Atom.keepAlive);
