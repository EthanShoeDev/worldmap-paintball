import type * as Cloudflare from '@alchemy.run/cloudflare';
import { regions } from '@worldmap-paintball/api-contract/coverage';
import type { RuntimeContext } from 'alchemy/RuntimeContext';
import {
  Array as Arr,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Schema,
} from 'effect';
import { ENV } from 'varlock/env';

import type { Bounds, Footprint } from './bake.ts';
import { type TileId, tilesCovering } from './tiles.ts';

// Declared beside its only reader rather than in a package env.d.ts, so it
// also typechecks in apps/web, which compiles this module through the
// workspace. varlock type generation isn't enabled in .env.schema yet.
declare module 'varlock/env' {
  interface TypedEnvSchema {
    readonly FOOTPRINTS_DIR?: string;
  }
}

// Footprints are bucketed into z14 tiles, like OpenFreeMap's, and the 256
// tiles of one z10 tile share a pack object: a state has tens of thousands of
// z14 tiles, and Cloudflare's REST API, which uploads go through, allows 1200
// requests per 5 minutes.
const FOOTPRINT_ZOOM = 14;
const PACK_ZOOM = 10;
const PACK_SPAN = 2 ** (FOOTPRINT_ZOOM - PACK_ZOOM);
const SLOT_BYTES = 8;
const PACK_HEADER_BYTES = PACK_SPAN * PACK_SPAN * SLOT_BYTES;
const MICRODEGREES = 1e6;

const regionPrefix = (region: string) => `footprints/v1/${region}`;

export const packKey = (region: string, { x, y }: TileId) =>
  `${regionPrefix(region)}/${PACK_ZOOM}/${x}/${y}.bin`;

export const manifestKey = (region: string) =>
  `${regionPrefix(region)}/manifest.json`;

export const packOf = (tile: TileId) => ({
  z: PACK_ZOOM,
  x: Math.floor(tile.x / PACK_SPAN),
  y: Math.floor(tile.y / PACK_SPAN),
});

export const slotOf = (tile: TileId) =>
  (tile.y % PACK_SPAN) * PACK_SPAN + (tile.x % PACK_SPAN);

// What `bun run footprints:build` wrote for a region, and what the upload
// Action sends to R2.
const FootprintManifest = Schema.Struct({
  region: Schema.String,
  source: Schema.String,
  footprints: Schema.Int,
  tiles: Schema.Int,
  packs: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      bytes: Schema.Int,
      sha256: Schema.String,
    }),
  ),
});

export const FootprintManifestJson = Schema.fromJsonString(FootprintManifest);

// [lon, lat] in whole microdegrees, implicitly closed.
type MicroRing = ReadonlyArray<readonly [number, number]>;

// Rounds a GeoJSON ring to microdegrees (about 10 cm, finer than the
// imagery), dropping the closing vertex and any repeated ones.
export const microRing = (ring: ReadonlyArray<ReadonlyArray<number>>) => {
  const points: Array<readonly [number, number]> = [];
  for (const [lon = Number.NaN, lat = Number.NaN] of ring) {
    const point = [
      Math.round(lon * MICRODEGREES),
      Math.round(lat * MICRODEGREES),
    ] as const;
    const previous = points.at(-1);
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
    if (previous?.[0] === point[0] && previous[1] === point[1]) continue;
    points.push(point);
  }
  const [first] = points;
  const last = points.at(-1);
  if (
    points.length > 1 &&
    first?.[0] === last?.[0] &&
    first?.[1] === last?.[1]
  ) {
    points.pop();
  }
  return points.length >= 3 ? points : undefined;
};

// A footprint goes in every tile its bounding box touches, so the tiles that
// cover an arena hold everything touching it, which is what baking keeps.
// Bucketing by centroid would need a guessed margin for the largest
// building; the duplicates at tile edges are dropped on read instead.
export const footprintTiles = (ring: MicroRing) => {
  const lons = Arr.map(ring, ([lon]) => lon / MICRODEGREES);
  const lats = Arr.map(ring, ([, lat]) => lat / MICRODEGREES);
  return tilesCovering(
    [
      Math.min(...lats),
      Math.min(...lons),
      Math.max(...lats),
      Math.max(...lons),
    ],
    FOOTPRINT_ZOOM,
  );
};

// Height in decimetres (0 when unknown), then the first vertex and each
// later vertex's delta from the one before, all in microdegrees: deltas of a
// few metres are short numbers, and they gzip well.
export const encodeFootprint = (
  ring: MicroRing,
  height: number | undefined,
) => {
  const values = [
    height !== undefined && height > 0 ? Math.round(height * 10) : 0,
  ];
  let previous: readonly [number, number] = [0, 0];
  for (const point of ring) {
    values.push(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return values;
};

const decodeFootprint = (values: ReadonlyArray<number>): Footprint => {
  const outline = [];
  let lon = 0;
  let lat = 0;
  for (let index = 1; index + 1 < values.length; index += 2) {
    lon += values[index] ?? 0;
    lat += values[index + 1] ?? 0;
    outline.push({ lat: lat / MICRODEGREES, lon: lon / MICRODEGREES });
  }
  const height = values[0] ?? 0;
  return { outline, height: height > 0 ? height / 10 : undefined };
};

const TileJson = Schema.fromJsonString(Schema.Array(Schema.Array(Schema.Int)));
const decodeTileJson = Schema.decodeUnknownEffect(TileJson);

// The copy gives Blob a buffer it accepts (not a SharedArrayBuffer view).
const piped = (
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
) =>
  new Response(new Blob([new Uint8Array(bytes)]).stream().pipeThrough(stream));

export const gzip = (text: string) =>
  Effect.promise(() =>
    piped(
      new TextEncoder().encode(text),
      new CompressionStream('gzip'),
    ).bytes(),
  );

// A pack is a header of one little-endian (offset, length) uint32 pair per
// slot, then the gzipped JSON tile of every slot that has footprints.
export const encodePack = (tiles: ReadonlyMap<number, Uint8Array>) => {
  let size = PACK_HEADER_BYTES;
  for (const tile of tiles.values()) size += tile.length;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = PACK_HEADER_BYTES;
  for (const [slot, tile] of tiles) {
    view.setUint32(slot * SLOT_BYTES, offset, true);
    view.setUint32(slot * SLOT_BYTES + 4, tile.length, true);
    bytes.set(tile, offset);
    offset += tile.length;
  }
  return bytes;
};

const slotRange = (header: Uint8Array, slot: number) => {
  const view = new DataView(header.buffer, header.byteOffset);
  return {
    offset: view.getUint32(slot * SLOT_BYTES, true),
    length: view.getUint32(slot * SLOT_BYTES + 4, true),
  };
};

const intersects = (
  [south, west, north, east]: Bounds,
  outline: ReadonlyArray<{ readonly lat: number; readonly lon: number }>,
) =>
  Arr.some(outline, ({ lon }) => lon >= west) &&
  Arr.some(outline, ({ lon }) => lon <= east) &&
  Arr.some(outline, ({ lat }) => lat >= south) &&
  Arr.some(outline, ({ lat }) => lat <= north);

export class BuildingFootprintsError extends Schema.TaggedError<
  BuildingFootprintsError,
  { readonly brand: unique symbol }
>()('BuildingFootprintsError', { message: Schema.String }) {}

// Reads `length` bytes from `offset` in the object at `key`; undefined when
// there is no such object (a region or pack that was never built).
type ReadRange = (
  key: string,
  offset: number,
  length: number,
) => Effect.Effect<Uint8Array | undefined, BuildingFootprintsError>;

// The default directory for footprint packs, `<repo>/tmp/footprints`, which
// `bun run footprints:build` writes and git ignores.
export const defaultFootprintsDir = Effect.gen(function* () {
  const path = yield* Path.Path;
  const here = yield* path.fromFileUrl(new URL(import.meta.url));
  return path.resolve(
    path.dirname(here),
    '..',
    '..',
    '..',
    'tmp',
    'footprints',
  );
}).pipe(Effect.orDie);

// FOOTPRINTS_DIR when it is set, else the default.
export const footprintsDir = (configured: string | undefined) =>
  configured === undefined || configured === ''
    ? defaultFootprintsDir
    : Effect.succeed(configured);

// Building outlines traced from imagery (Microsoft's ML footprints), for
// places OpenStreetMap has not mapped. Packs are per coverage region, built
// by `scripts/footprints/build-tiles.ts`.
export class BuildingFootprints extends Context.Service<
  BuildingFootprints,
  {
    // Every footprint touching `bounds` ([south, west, north, east]).
    readonly footprints: (
      bounds: Bounds,
    ) => Effect.Effect<ReadonlyArray<Footprint>, BuildingFootprintsError>;
  }
>()('@worldmap-paintball/api/footprints/BuildingFootprints') {
  static readonly fromRanges = (read: ReadRange) => {
    const readTile = Effect.fn('BuildingFootprints.readTile')(function* (
      key: string,
      header: Uint8Array,
      slot: number,
    ) {
      const { offset, length } = slotRange(header, slot);
      if (length === 0) return [];
      const bytes = yield* read(key, offset, length);
      if (bytes === undefined) return [];
      const text = yield* Effect.tryPromise({
        try: () => piped(bytes, new DecompressionStream('gzip')).text(),
        catch: (cause) =>
          BuildingFootprintsError.make({
            message: `${key}: ${String(cause)}`,
          }),
      });
      return yield* decodeTileJson(text).pipe(
        Effect.mapError((error) =>
          BuildingFootprintsError.make({ message: `${key}: ${error.message}` }),
        ),
      );
    });

    const readPack = Effect.fn('BuildingFootprints.readPack')(function* (
      key: string,
      slots: ReadonlyArray<number>,
    ) {
      const header = yield* read(key, 0, PACK_HEADER_BYTES);
      if (header === undefined) return [];
      if (header.length < PACK_HEADER_BYTES) {
        return yield* BuildingFootprintsError.make({
          message: `${key}: truncated header`,
        });
      }
      const tiles = yield* Effect.forEach(
        slots,
        (slot) => readTile(key, header, slot),
        { concurrency: 'unbounded' },
      );
      return tiles.flat();
    });

    return BuildingFootprints.of({
      footprints: Effect.fn('BuildingFootprints.footprints')(function* (
        bounds: Bounds,
      ) {
        const [south, west, north, east] = bounds;
        const packs = new Map<string, Array<number>>();
        for (const region of regions) {
          const [regionWest, regionSouth, regionEast, regionNorth] =
            region.bbox;
          if (
            east < regionWest ||
            west > regionEast ||
            north < regionSouth ||
            south > regionNorth
          ) {
            continue;
          }
          for (const tile of tilesCovering(bounds, FOOTPRINT_ZOOM)) {
            const key = packKey(region.id, packOf(tile));
            packs.set(key, [...(packs.get(key) ?? []), slotOf(tile)]);
          }
        }
        const encoded = yield* Effect.forEach(
          packs,
          ([key, slots]) => readPack(key, slots),
          { concurrency: 'unbounded' },
        );
        // A footprint across a tile edge is stored in each tile it touches.
        const seen = new Set<string>();
        const footprints: Array<Footprint> = [];
        for (const values of encoded.flat()) {
          const id = Arr.join(Arr.map(values, String), ',');
          if (seen.has(id)) continue;
          seen.add(id);
          const footprint = decodeFootprint(values);
          if (intersects(bounds, footprint.outline)) footprints.push(footprint);
        }
        return footprints;
      }),
    });
  };

  static readonly layerEmpty = Layer.succeed(
    BuildingFootprints,
    BuildingFootprints.of({ footprints: () => Effect.succeed([]) }),
  );

  // Packs under `dir`, laid out by object key as in the R2 bucket.
  static readonly layerDirectory = (dir: string) =>
    Layer.effect(
      BuildingFootprints,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        return BuildingFootprints.fromRanges((key, offset, length) =>
          fs.open(path.join(dir, key)).pipe(
            Effect.flatMap((file) =>
              file.readAlloc(length, { position: BigInt(offset) }),
            ),
            Effect.map(Option.getOrElse(() => new Uint8Array())),
            Effect.scoped,
            Effect.catchTag('PlatformError', (error) =>
              Predicate.isTagged(error.reason, 'NotFound')
                ? Effect.undefined
                : Effect.fail(
                    BuildingFootprintsError.make({ message: error.message }),
                  ),
            ),
          ),
        );
      }),
    );

  // `layerDirectory` on FOOTPRINTS_DIR, or `defaultFootprintsDir`. Reading
  // ENV throws in processes not started by varlock (Vite's dev server), which
  // get the default.
  static readonly layerLocal = Layer.unwrap(
    Effect.gen(function* () {
      const configured = yield* Effect.try(() => ENV.FOOTPRINTS_DIR).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      const dir = yield* footprintsDir(configured);
      // dynamic-import -- the Worker bundles LocalBackends but never builds it, so node:fs stays out of its startup
      const { layer } = yield* Effect.promise(
        () => import('@effect/platform-bun/BunFileSystem'),
      );
      return BuildingFootprints.layerDirectory(dir).pipe(Layer.provide(layer));
    }),
  ).pipe(Layer.provide(Path.layer));

  // The bucket's client methods are RuntimeContext-colored, so this layer is
  // built inside a Durable Object's runtime phase, whose context it reuses.
  static readonly layerR2 = (bucket: Cloudflare.R2.ReadBucketClient) =>
    Layer.effect(
      BuildingFootprints,
      Effect.gen(function* () {
        const runtime = yield* Effect.context<RuntimeContext>();
        return BuildingFootprints.fromRanges((key, offset, length) =>
          bucket.get(key, { range: { offset, length } }).pipe(
            Effect.flatMap((object) =>
              object === null ? Effect.undefined : object.bytes(),
            ),
            Effect.mapError((error) =>
              BuildingFootprintsError.make({ message: `R2: ${error.message}` }),
            ),
            Effect.provide(runtime),
          ),
        );
      }),
    );
}
