import { Schema } from 'effect';

// The API serves arenas between ±85° latitude (Web Mercator's usable range).
export const Coordinates = Schema.Struct({
  lat: Schema.Finite.check(Schema.isBetween({ minimum: -85, maximum: 85 })),
  lon: Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
});

export type Coordinates = typeof Coordinates.Type;

const pattern =
  /^\s*([-+]?\d+(?:\.\d+)?)\s*(?:,|\s)\s*([-+]?\d+(?:\.\d+)?)\s*$/;

export const isCoordinates = Schema.is(Coordinates);

export const parseCoordinates = (input: string) => {
  const match = pattern.exec(input);
  if (!match) return undefined;
  const candidate = { lat: Number(match[1]), lon: Number(match[2]) };
  return isCoordinates(candidate) ? candidate : undefined;
};

// Same approximation as the API's bounds() in apps/api/src/bake.ts.
const metresPerDegreeLat = 110_540;
const metresPerDegreeLon = 111_320;

// The arena's edges in degrees.
export const arenaBounds = ({ lat, lon }: Coordinates, halfSize: number) => {
  const dLat = halfSize / metresPerDegreeLat;
  const dLon =
    halfSize / (metresPerDegreeLon * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - dLat,
    west: lon - dLon,
    north: lat + dLat,
    east: lon + dLon,
  };
};

export const arenaSquare = (center: Coordinates, halfSize: number) => {
  const { south, west, north, east } = arenaBounds(center, halfSize);
  const ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  };
};
