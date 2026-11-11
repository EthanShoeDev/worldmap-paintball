import type { Terrain } from '@worldmap-paintball/api-contract';
import { Array as Arr, Context, Effect, Layer, Schedule, Schema } from 'effect';
import { HttpClient } from 'effect/http';
import { decode } from 'fast-png';

import { bounds, type LatLon, unproject } from './bake.ts';
import {
  fetchTile,
  type TileId,
  tilePosition,
  tilesCovering,
  tileUrl,
} from './tiles.ts';

// AWS Terrain Tiles (Mapzen's Terrarium encoding): static S3 objects built
// from USGS 3DEP, SRTM and other public elevation models.
export const TERRARIUM_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// z15 pixels are about 4.8 m at the equator, finer than the 10 m US source
// and close to the grid spacing (300 m over 64 cells), so z16 would only
// quadruple the tiles fetched.
export const TERRAIN_ZOOM = 15;
export const TERRAIN_SIZE = 65;
const TILE_PIXELS = 256;

export class ElevationError extends Schema.TaggedError<
  ElevationError,
  { readonly brand: unique symbol }
>()('ElevationError', { message: Schema.String }) {}

export const terrariumHeight = (red: number, green: number, blue: number) =>
  red * 256 + green + blue / 256 - 32_768;

export const decodeTerrarium = (data: Uint8Array) => {
  const png = decode(data);
  if (
    png.width !== TILE_PIXELS ||
    png.height !== TILE_PIXELS ||
    png.depth !== 8 ||
    png.channels < 3
  ) {
    throw new Error(
      `unexpected ${png.width}×${png.height} PNG with ${png.channels} ${png.depth}-bit channels`,
    );
  }
  const heights = new Float64Array(png.width * png.height);
  for (let index = 0; index < heights.length; index++) {
    const offset = index * png.channels;
    heights[index] = terrariumHeight(
      png.data[offset] ?? 0,
      png.data[offset + 1] ?? 0,
      png.data[offset + 2] ?? 0,
    );
  }
  return heights;
};

// Bilinear interpolation between pixel centres; `pixel` reads one height by
// whole pixel coordinates at TERRAIN_ZOOM.
export const bilinear =
  (pixel: (x: number, y: number) => number) => (point: LatLon) => {
    const [tileX, tileY] = tilePosition(point, TERRAIN_ZOOM);
    const u = tileX * TILE_PIXELS - 0.5;
    const v = tileY * TILE_PIXELS - 0.5;
    const x = Math.floor(u);
    const y = Math.floor(v);
    const fx = u - x;
    const fy = v - y;
    const top = pixel(x, y) * (1 - fx) + pixel(x + 1, y) * fx;
    const bottom = pixel(x, y + 1) * (1 - fx) + pixel(x + 1, y + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };

// Samples the size × size grid from the north-west corner, row by row
// southwards, relative to the height at the centre. Centimetres are finer
// than the source data and keep the JSON small.
export const sampleTerrain = (
  center: LatLon,
  halfSize: number,
  size: number,
  heightAt: (point: LatLon) => number,
) => {
  const origin = heightAt(center);
  const step = (2 * halfSize) / (size - 1);
  const heights: Array<number> = [];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const point = unproject(center, [
        -halfSize + column * step,
        -halfSize + row * step,
      ]);
      heights.push(Math.round((heightAt(point) - origin) * 100) / 100);
    }
  }
  return { size, heights };
};

const tileKey = ({ x, y }: Pick<TileId, 'x' | 'y'>) => `${x}/${y}`;

export class Elevation extends Context.Service<
  Elevation,
  {
    readonly terrain: (
      center: LatLon,
      halfSize: number,
    ) => Effect.Effect<Terrain, ElevationError>;
  }
>()('@worldmap-paintball/api/elevation') {
  static readonly layerTerrarium = Layer.effect(
    Elevation,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({
          schedule: Schedule.exponential(500),
          times: 2,
        }),
      );

      const terrain = Effect.fn('Elevation.terrain')(function* (
        center: LatLon,
        halfSize: number,
      ) {
        // Bilinear sampling reads one pixel past the arena on every side.
        const ids = tilesCovering(
          bounds(center, halfSize),
          TERRAIN_ZOOM,
          1 / TILE_PIXELS,
        );
        const entries = yield* Effect.forEach(
          ids,
          (id) =>
            fetchTile(client, tileUrl(TERRARIUM_URL, id), decodeTerrarium).pipe(
              Effect.map((heights) => [tileKey(id), heights] as const),
            ),
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.mapError((cause) =>
            ElevationError.make({ message: `Terrarium: ${cause.message}` }),
          ),
        );
        const tiles = new Map(entries);
        const pixel = (x: number, y: number) =>
          tiles.get(
            tileKey({
              x: Math.floor(x / TILE_PIXELS),
              y: Math.floor(y / TILE_PIXELS),
            }),
          )?.[(y % TILE_PIXELS) * TILE_PIXELS + (x % TILE_PIXELS)] ??
          Number.NaN;
        const sampled = sampleTerrain(
          center,
          halfSize,
          TERRAIN_SIZE,
          bilinear(pixel),
        );
        if (!Arr.every(sampled.heights, Number.isFinite)) {
          return yield* ElevationError.make({
            message: 'Terrarium: tiles do not cover the arena',
          });
        }
        return sampled;
      });

      return Elevation.of({ terrain });
    }),
  );
}
