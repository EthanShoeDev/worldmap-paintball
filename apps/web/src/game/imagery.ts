import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr, Effect, Schema } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { AsyncResult, Atom } from 'effect/reactivity';

import { arenaBounds, type Coordinates } from '../location/coordinates.ts';
import { groundTuning } from './tuning.ts';

// USGS The National Map: public-domain aerial photos (mostly NAIP), US only.
// z16 is the deepest level it serves, about 2 m per pixel.
export const imageryZoom = 16;
const tilePixels = 256;

export const imageryTileUrl = ({ x, y }: Tile) =>
  `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${imageryZoom}/${y}/${x}`;

export interface Tile {
  readonly x: number;
  readonly y: number;
}

// Web Mercator pixel coordinates at `imageryZoom`.
export const mercatorPixel = (lat: number, lon: number) => {
  const world = tilePixels * 2 ** imageryZoom;
  const phi = (lat * Math.PI) / 180;
  return [
    ((lon + 180) / 360) * world,
    ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * world,
  ] as const;
};

const range = (from: number, to: number) =>
  Arr.makeBy(to - from + 1, (index) => from + index);

// The tiles covering the arena, and where the arena sits in their mosaic,
// whose top-left is the top-left of the `origin` tile.
export const tileCover = (center: Coordinates, halfSize: number) => {
  const { south, west, north, east } = arenaBounds(center, halfSize);
  const [left, top] = mercatorPixel(north, west);
  const [right, bottom] = mercatorPixel(south, east);
  const first = (pixel: number) => Math.floor(pixel / tilePixels);
  // An edge exactly on a tile boundary needs nothing from the next tile.
  const last = (pixel: number) => Math.ceil(pixel / tilePixels) - 1;
  const origin: Tile = { x: first(left), y: first(top) };
  return {
    origin,
    tiles: Arr.flatMap(range(origin.y, last(bottom)), (y) =>
      Arr.map(range(origin.x, last(right)), (x) => ({ x, y })),
    ),
    crop: {
      x: left - origin.x * tilePixels,
      y: top - origin.y * tilePixels,
      width: right - left,
      height: bottom - top,
    },
  };
};

// Outside its coverage the service may answer with a flat colour rather than
// a 404; a photo always has some contrast.
export const isBlank = (rgba: ArrayLike<number>) => {
  let lowest = Infinity;
  let highest = -Infinity;
  for (let index = 0; index + 2 < rgba.length; index += 4) {
    const luma =
      0.299 * (rgba[index] ?? 0) +
      0.587 * (rgba[index + 1] ?? 0) +
      0.114 * (rgba[index + 2] ?? 0);
    lowest = Math.min(lowest, luma);
    highest = Math.max(highest, luma);
  }
  return !(highest - lowest > groundTuning.blankContrast);
};

export class ImageryError extends Schema.TaggedError<
  ImageryError,
  { readonly brand: unique symbol }
>()('ImageryError', { cause: Schema.Defect() }) {}

const fetchTile = Effect.fn('fetchTile')(function* (tile: Tile) {
  const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  const response = yield* client.get(imageryTileUrl(tile));
  const bytes = yield* response.arrayBuffer;
  return yield* Effect.tryPromise({
    try: () => createImageBitmap(new Blob([bytes])),
    catch: (cause) => ImageryError.make({ cause }),
  });
});

// The arena's aerial photo, cropped exactly to its square, or undefined when
// there is none: imagery is a nicety, so every failure falls back quietly.
const loadImagery = Effect.fn('loadImagery')(
  function* (center: Coordinates, halfSize: number) {
    const { origin, tiles, crop } = tileCover(center, halfSize);
    const bitmaps = yield* Effect.forEach(tiles, fetchTile, {
      concurrency: 'unbounded',
    });
    const photo = yield* Effect.try({
      try: () => {
        const size = Math.ceil(Math.max(crop.width, crop.height));
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No 2D canvas');
        context.scale(size / crop.width, size / crop.height);
        for (const [index, tile] of tiles.entries()) {
          const bitmap = bitmaps[index];
          if (!bitmap) continue;
          context.drawImage(
            bitmap,
            (tile.x - origin.x) * tilePixels - crop.x,
            (tile.y - origin.y) * tilePixels - crop.y,
          );
        }
        return isBlank(context.getImageData(0, 0, size, size).data)
          ? undefined
          : canvas;
      },
      catch: (cause) => ImageryError.make({ cause }),
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => Arr.forEach(bitmaps, (b) => b.close())),
      ),
    );
    if (!photo) yield* Effect.log('No aerial imagery here');
    return photo;
  },
  Effect.timeout(groundTuning.imageryTimeoutMs),
  // The tile server's CORS preflight doesn't allow the trace headers.
  Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  Effect.catchCause((cause) =>
    Effect.as(Effect.log('Aerial imagery unavailable', cause), undefined),
  ),
);

interface ImageryKey extends Coordinates {
  readonly halfSize: number;
}

const imageryRuntime = Atom.runtime(FetchHttpClient.layer);

const imageryFamily = Atom.family(({ halfSize, ...center }: ImageryKey) =>
  imageryRuntime.atom(loadImagery(center, halfSize)),
);

export const imageryAtom = ({
  lat,
  lon,
  halfSize,
}: Pick<Arena, 'lat' | 'lon' | 'halfSize'>) =>
  imageryFamily({ lat, lon, halfSize });

export const photoOf = (
  result: AsyncResult.AsyncResult<HTMLCanvasElement | undefined>,
) => (AsyncResult.isSuccess(result) ? result.value : undefined);
