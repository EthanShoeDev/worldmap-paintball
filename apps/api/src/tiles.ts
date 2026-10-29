import { Effect, pipe, Schema, String as Str } from 'effect';
import { type HttpClient, HttpClientRequest } from 'effect/http';

import type { LatLon } from './bake.ts';
import { USER_AGENT } from './user-agent.ts';

// Web Mercator ("slippy map") tiles, as served by OpenFreeMap and Terrarium.
export interface TileId {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export class TileDecodeError extends Schema.TaggedError<
  TileDecodeError,
  { readonly brand: unique symbol }
>()('TileDecodeError', { message: Schema.String }) {}

// Position in tile units at `zoom`: the integer part is the tile index and
// the fraction is the position within that tile.
export const tilePosition = (point: LatLon, zoom: number) => {
  const scale = 2 ** zoom;
  const sinLat = Math.sin((point.lat * Math.PI) / 180);
  return [
    ((point.lon + 180) / 360) * scale,
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  ] as const;
};

export const tileLatLon = (tile: TileId, [x, y]: readonly [number, number]) => {
  const scale = 2 ** tile.z;
  const mercatorY = Math.PI * (1 - (2 * (tile.y + y)) / scale);
  return {
    lat: (Math.atan(Math.sinh(mercatorY)) * 180) / Math.PI,
    lon: ((tile.x + x) / scale) * 360 - 180,
  };
};

// Every tile intersecting `[south, west, north, east]`, grown by `margin`
// tile units on each side.
export const tilesCovering = (
  [south, west, north, east]: readonly [number, number, number, number],
  zoom: number,
  margin = 0,
) => {
  const [minX, minY] = tilePosition({ lat: north, lon: west }, zoom);
  const [maxX, maxY] = tilePosition({ lat: south, lon: east }, zoom);
  const tiles: Array<TileId> = [];
  for (let y = Math.floor(minY - margin); y <= Math.floor(maxY + margin); y++) {
    for (
      let x = Math.floor(minX - margin);
      x <= Math.floor(maxX + margin);
      x++
    ) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
};

export const tileUrl = (template: string, { z, x, y }: TileId) =>
  pipe(
    template,
    Str.replace('{z}', String(z)),
    Str.replace('{x}', String(x)),
    Str.replace('{y}', String(y)),
  );

export const fetchTile = Effect.fn('fetchTile')(function* <A>(
  client: HttpClient.HttpClient,
  url: string,
  decode: (data: Uint8Array) => A,
) {
  const response = yield* HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader('User-Agent', USER_AGENT),
    client.execute,
  );
  const buffer = yield* response.arrayBuffer;
  return yield* Effect.try({
    try: () => decode(new Uint8Array(buffer)),
    catch: (cause) =>
      TileDecodeError.make({ message: `${url}: ${String(cause)}` }),
  });
});
