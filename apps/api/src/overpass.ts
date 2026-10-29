import { Array as Arr, Schema } from 'effect';

import { bounds, type LatLon } from './bake.ts';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export const OverpassResponse = Schema.Struct({
  elements: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      tags: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      geometry: Schema.optional(
        Schema.Array(Schema.Struct({ lat: Schema.Finite, lon: Schema.Finite })),
      ),
    }),
  ),
});

export const overpassQuery = (center: LatLon, halfSize: number) => {
  const [south, west, north, east] = bounds(center, halfSize);
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:25];
(
  way["building"](${bbox});
  way["highway"](${bbox});
  way["leisure"="park"](${bbox});
  way["landuse"~"^(grass|recreation_ground)$"](${bbox});
  way["natural"="water"](${bbox});
);
out geom;`;
};

export const overpassWays = (response: typeof OverpassResponse.Type) =>
  Arr.flatMap(response.elements, (element) =>
    element.type === 'way' && element.tags && element.geometry
      ? [{ tags: element.tags, geometry: element.geometry }]
      : [],
  );
