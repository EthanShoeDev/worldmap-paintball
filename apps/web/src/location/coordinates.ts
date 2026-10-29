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

export const arenaSquare = ({ lat, lon }: Coordinates, halfSize: number) => {
  const dLat = halfSize / metresPerDegreeLat;
  const dLon =
    halfSize / (metresPerDegreeLon * Math.cos((lat * Math.PI) / 180));
  const ring = [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  };
};
