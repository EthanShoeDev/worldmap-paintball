import { Array as Arr, Option, String as Str } from 'effect';

import { usStates } from './us-states.ts';

// [lon, lat] in degrees, GeoJSON order.
export type LonLat = readonly [lon: number, lat: number];

export interface Region {
  readonly id: string;
  readonly name: string;
  // [west, south, east, north], the order MapLibre's `maxBounds` takes.
  readonly bbox: readonly [number, number, number, number];
  // Implicitly closed rings: islands, and holes if a region had any, alike.
  readonly rings: ReadonlyArray<ReadonlyArray<LonLat>>;
}

// Google's encoded polyline algorithm, over [lon, lat] pairs in 1e-4 degrees,
// as scripts/build-coverage.ts writes it: zigzag-signed deltas in 5-bit
// chunks, low first, each with 32 added while more follow.
const decodeRing = (encoded: string) => {
  const values: Array<number> = [];
  let value = 0;
  let scale = 1;
  for (const character of encoded) {
    const chunk =
      Option.getOrElse(Str.codePointAt(character, 0), () => 63) - 63;
    value += (chunk % 32) * scale;
    scale *= 32;
    if (chunk < 32) {
      values.push(value % 2 === 1 ? -(value + 1) / 2 : value / 2);
      value = 0;
      scale = 1;
    }
  }
  const ring: Array<LonLat> = [];
  for (let index = 0, lon = 0, lat = 0; index + 1 < values.length; index += 2) {
    lon += values[index] ?? 0;
    lat += values[index + 1] ?? 0;
    ring.push([lon / 1e4, lat / 1e4]);
  }
  return ring;
};

const region = ({
  id,
  name,
  rings: encoded,
}: {
  readonly id: string;
  readonly name: string;
  readonly rings: ReadonlyArray<string>;
}): Region => {
  const rings = Arr.map(encoded, decodeRing);
  const points = Arr.flatten(rings);
  const lons = Arr.map(points, ([lon]) => lon);
  const lats = Arr.map(points, ([, lat]) => lat);
  return {
    id,
    name,
    bbox: [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ],
    rings,
  };
};

// The 50 states and DC, each with the sea 3 nautical miles out.
export const regions: ReadonlyArray<Region> = Arr.map(usStates, region);

export const coverageName = 'the United States';

export const outsideCoverageMessage = `Only ${coverageName} for now`;

const inBbox = (
  { bbox: [west, south, east, north] }: Region,
  lon: number,
  lat: number,
) => lon >= west && lon <= east && lat >= south && lat <= north;

// Even-odd ray casting on raw lon/lat, which the rings were simplified for.
const inRings = ({ rings }: Region, lon: number, lat: number) => {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] ?? [0, 0];
      const [xj, yj] = ring[j] ?? [0, 0];
      if (
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
};

export const inRegion = (region: Region, lat: number, lon: number) =>
  inBbox(region, lon, lat) && inRings(region, lon, lat);

export const regionAt = (lat: number, lon: number) =>
  Arr.findFirst(regions, (candidate) => inRegion(candidate, lat, lon));

export const isCovered = (lat: number, lon: number) =>
  Option.isSome(regionAt(lat, lon));
