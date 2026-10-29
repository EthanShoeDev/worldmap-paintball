import '@tanstack/react-start/client-only';
import { BrowserKeyValueStore } from '@effect/platform-browser';
import { Location, MapSettings } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr, Schema } from 'effect';
import { Atom } from 'effect/reactivity';

import type { Coordinates } from './coordinates.ts';

// Storage failures (private mode, blocked site data) keep these in memory
// only, like the player name.
const storage = Atom.runtime(BrowserKeyValueStore.layerLocalStorage);

const maxRecentPlaces = 8;
const maxSavedMaps = 20;

const samePlace = (a: Coordinates, b: Coordinates) =>
  a.lat === b.lat && a.lon === b.lon;

// Places this browser hosted lobbies at, most recent first.
export const recentPlacesAtom = Atom.kvs({
  runtime: storage,
  key: 'worldmap-paintball/recent-places',
  schema: Schema.Array(Location),
  defaultValue: () => [],
});

export const rememberPlace = (
  places: ReadonlyArray<Location>,
  place: Location,
) =>
  Arr.take(
    [place, ...Arr.filter(places, (other) => !samePlace(other, place))],
    maxRecentPlaces,
  );

const SavedMap = Schema.Struct({
  lat: Schema.Finite,
  lon: Schema.Finite,
  map: MapSettings,
});
type SavedMap = typeof SavedMap.Type;

// The last map settings this browser applied at each place, most recent
// first, so hosting there again brings them back.
export const savedMapsAtom = Atom.kvs({
  runtime: storage,
  key: 'worldmap-paintball/saved-maps',
  schema: Schema.Array(SavedMap),
  defaultValue: () => [],
});

export const rememberMap = (saved: ReadonlyArray<SavedMap>, entry: SavedMap) =>
  Arr.take(
    [entry, ...Arr.filter(saved, (other) => !samePlace(other, entry))],
    maxSavedMaps,
  );

export const savedMapAt = (
  saved: ReadonlyArray<SavedMap>,
  place: Coordinates,
) => Arr.findFirst(saved, (entry) => samePlace(entry, place));
