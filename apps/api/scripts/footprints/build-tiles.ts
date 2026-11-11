#!/usr/bin/env bun
// Buckets Microsoft's ML building footprints for coverage regions into the
// pack files BuildingFootprints reads (src/footprints.ts), under
// `<out>/footprints/v1/<region>/`, one region after another.
//
//   bun run footprints:build us-nc us-va
//   bun run footprints:build all
//   unzip -p NorthCarolina.geojson.zip | bun run footprints:build us-nc --input -
//
// Without --input it downloads the GlobalMLBuildingFootprints files whose z9
// quadkeys touch each region (cached under --downloads, so neighbours share
// them). --input reads one GeoJSON file for a single region instead, one
// Feature per line, gzipped if it ends in .gz.
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  inRegion,
  type Region,
  regions,
} from '@worldmap-paintball/api-contract/coverage';
import {
  Array as Arr,
  Clock,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Schema,
  Stdio,
  Stream,
  String as Str,
} from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { Hex } from 'effect/encoding';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';

import { type Bounds, bounds } from '../../src/bake.ts';
import {
  defaultFootprintsDir,
  encodeFootprint,
  encodePack,
  FootprintManifestJson,
  footprintTiles,
  gzip,
  manifestKey,
  microRing,
  packKey,
  packOf,
  slotOf,
} from '../../src/footprints.ts';
import { HALF_SIZE } from '../../src/map-data.ts';
import { type TileId, tileLatLon } from '../../src/tiles.ts';
import { USER_AGENT } from '../../src/user-agent.ts';

// GlobalMLBuildingFootprints (ODbL): GeoJSON lines per z9 quadkey, newer than
// the 2021 US state files, with more buildings and most with a height.
const DATASET_LINKS =
  'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';

// A trace wider than 3 × 3 z14 tiles (about 6 km) is not a building.
const MAX_TILES = 9;

class BuildError extends Schema.TaggedError<
  BuildError,
  { readonly brand: unique symbol }
>()('FootprintBuildError', { message: Schema.String }) {}

const Position = Schema.Array(Schema.Finite);
const Feature = Schema.Struct({
  geometry: Schema.Union([
    Schema.Struct({
      type: Schema.Literal('Polygon'),
      coordinates: Schema.Array(Schema.Array(Position)),
    }),
    Schema.Struct({
      type: Schema.Literal('MultiPolygon'),
      coordinates: Schema.Array(Schema.Array(Schema.Array(Position))),
    }),
  ]),
  // -1 when Microsoft has no estimate; the older US files have none at all.
  properties: Schema.optional(
    Schema.NullOr(Schema.Struct({ height: Schema.optional(Schema.Finite) })),
  ),
});
const decodeFeature = Schema.decodeUnknownOption(
  Schema.fromJsonString(Feature),
);

const tileBounds = (tile: TileId) => {
  const northWest = tileLatLon(tile, [0, 0]);
  const southEast = tileLatLon(tile, [1, 1]);
  return [southEast.lat, northWest.lon, northWest.lat, southEast.lon] as const;
};

// Grown by an arena's half size: an arena centred just inside the region
// reads that far out of it.
const reach = ([south, west, north, east]: Bounds) => {
  const [grownSouth, grownWest] = bounds({ lat: south, lon: west }, HALF_SIZE);
  const northEast = bounds({ lat: north, lon: east }, HALF_SIZE);
  return [grownSouth, grownWest, northEast[2], northEast[3]] as const;
};

// Liang–Barsky: whether the segment from `a` to `b` ([lon, lat]) enters the
// rectangle.
const segmentTouches = (
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
  [south, west, north, east]: Bounds,
) => {
  let enter = 0;
  let exit = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [
    [-dx, ax - west],
    [dx, east - ax],
    [-dy, ay - south],
    [dy, north - ay],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return false;
  }
  return true;
};

const touchesRegion = (region: Region, rect: Bounds) => {
  const [south, west, north, east] = rect;
  const [regionWest, regionSouth, regionEast, regionNorth] = region.bbox;
  if (
    east < regionWest ||
    west > regionEast ||
    north < regionSouth ||
    south > regionNorth
  ) {
    return false;
  }
  return (
    inRegion(region, (south + north) / 2, (west + east) / 2) ||
    Arr.some(region.rings, (ring) =>
      Arr.some(ring, (point, index) =>
        segmentTouches(point, ring[(index + 1) % ring.length] ?? point, rect),
      ),
    )
  );
};

const quadkeyTile = (quadkey: string) => {
  let x = 0;
  let y = 0;
  for (const digit of quadkey) {
    x = x * 2 + (Number(digit) % 2);
    y = y * 2 + Math.floor(Number(digit) / 2);
  }
  return { z: quadkey.length, x, y };
};

const lines = <E>(bytes: Stream.Stream<Uint8Array, E>, gzipped: boolean) =>
  (gzipped
    ? Stream.fromReadableStream({
        evaluate: () =>
          // The copies give the stream ArrayBuffer-backed chunks, which
          // DecompressionStream's types require.
          Stream.toReadableStream(
            Stream.map(bytes, (chunk) => new Uint8Array(chunk)),
          ).pipeThrough(new DecompressionStream('gzip')),
        onError: (cause) => BuildError.make({ message: String(cause) }),
      })
    : bytes
  ).pipe(Stream.decodeText, Stream.splitLines);

const sha256 = (bytes: Uint8Array<ArrayBuffer>) =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', bytes)).pipe(
    Effect.map((digest) => Hex.encode(new Uint8Array(digest))),
  );

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
const kilobytes = (bytes: number) => `${(bytes / 1e3).toFixed(0)} KB`;

// Footprints by z14 tile, as encoded JSON arrays, for the tiles some arena in
// `region` can read.
const makeBuckets = (region: Region) => {
  const tiles = new Map<string, { tile: TileId; footprints: Array<string> }>();
  const needed = new Map<string, boolean>();
  const counts = { footprints: 0, skipped: 0 };

  const isNeeded = (tile: TileId) => {
    const key = `${tile.x}/${tile.y}`;
    let value = needed.get(key);
    if (value === undefined) {
      value = touchesRegion(region, reach(tileBounds(tile)));
      needed.set(key, value);
    }
    return value;
  };

  const addPolygon = (
    outer: ReadonlyArray<ReadonlyArray<number>>,
    height: number | undefined,
  ) => {
    const ring = microRing(outer);
    const covering = ring === undefined ? [] : footprintTiles(ring);
    if (ring === undefined || covering.length > MAX_TILES) {
      counts.skipped++;
      return;
    }
    const encoded = JSON.stringify(encodeFootprint(ring, height));
    let kept = false;
    for (const tile of covering) {
      if (!isNeeded(tile)) continue;
      const key = `${tile.x}/${tile.y}`;
      const entry = tiles.get(key) ?? { tile, footprints: [] };
      entry.footprints.push(encoded);
      tiles.set(key, entry);
      kept = true;
    }
    if (kept) counts.footprints++;
  };

  // Lines that are not a Feature (the older files wrap theirs in a
  // FeatureCollection, one per line with trailing commas) are skipped.
  const addLine = (line: string) => {
    const text = Str.replace(/,$/, '')(Str.trim(line));
    if (!Str.startsWith('{')(text)) return;
    const feature = decodeFeature(text);
    if (Option.isNone(feature)) {
      counts.skipped++;
      return;
    }
    const { geometry, properties } = feature.value;
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.coordinates;
    for (const [outer] of polygons) {
      if (outer === undefined) counts.skipped++;
      else addPolygon(outer, properties?.height);
    }
  };

  return { tiles, counts, addLine };
};

const get = Effect.fn('get')(function* (url: string) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient({ times: 3 }),
  );
  return yield* HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader('User-Agent', USER_AGENT),
    client.execute,
  );
});

const buildRegion = Effect.fn('buildFootprintTiles')(function* (
  region: Region,
  options: {
    readonly out: string;
    readonly input: Option.Option<string>;
    readonly downloads: string;
    readonly location: string;
    // The text of DATASET_LINKS, empty with --input.
    readonly datasetLinks: string;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const started = yield* Clock.currentTimeMillis;
  const { out, downloads } = options;
  const buckets = makeBuckets(region);

  const consume = <E>(stream: Stream.Stream<string, E>) =>
    Stream.runForEachArray(stream, (chunk) =>
      Effect.sync(() => Arr.forEach(chunk, buckets.addLine)),
    );

  // Untrusted rows: only files on Microsoft's host, for quadkeys some arena
  // in the region reads.
  const sourceFiles = () => {
    const host = new URL(DATASET_LINKS).host;
    const rows = Arr.flatMap(
      Arr.drop(Str.split('\n')(options.datasetLinks), 1),
      (row) => {
        const [location, quadkey = '', url = ''] = Str.split(',')(
          Str.trim(row),
        );
        const parsed = URL.parse(url);
        return location === options.location &&
          /^[0-3]{1,20}$/.test(quadkey) &&
          parsed?.protocol === 'https:' &&
          parsed.host === host &&
          touchesRegion(region, reach(tileBounds(quadkeyTile(quadkey))))
          ? [
              {
                quadkey,
                url,
                file: path.join(
                  downloads,
                  `${options.location}-${quadkey}-${path.basename(parsed.pathname)}`,
                ),
              },
            ]
          : [];
      },
    );
    return Arr.sort(
      rows,
      Order.mapInput(Str.Order, ({ quadkey }: { quadkey: string }) => quadkey),
    );
  };

  const download = Effect.fn('download')(function* (url: string, file: string) {
    if (yield* fs.exists(file)) return;
    const partial = `${file}.partial`;
    yield* get(url).pipe(
      Effect.flatMap((response) =>
        Stream.run(response.stream, fs.sink(partial)),
      ),
    );
    yield* fs.rename(partial, file);
  });

  let source: string;
  if (Option.isSome(options.input)) {
    const input = options.input.value;
    source = input === '-' ? 'stdin' : path.basename(input);
    yield* Effect.log(`Reading ${source}`);
    yield* consume(
      input === '-'
        ? lines((yield* Stdio.Stdio).stdin, false)
        : lines(fs.stream(input), Str.endsWith('.gz')(input)),
    );
  } else {
    const files = sourceFiles();
    if (files.length === 0) {
      return yield* BuildError.make({
        message: `No ${options.location} files touch ${region.id}`,
      });
    }
    source = `GlobalMLBuildingFootprints (${options.location}, ${files.length} quadkeys)`;
    yield* fs.makeDirectory(downloads, { recursive: true });
    yield* Effect.log(`Downloading ${files.length} quadkeys to ${downloads}`);
    yield* Effect.forEach(files, ({ url, file }) => download(url, file), {
      concurrency: 6,
      discard: true,
    });
    yield* Effect.forEach(
      files,
      ({ quadkey, file }, index) =>
        Effect.log(`Bucketing ${index + 1}/${files.length}: ${quadkey}`).pipe(
          Effect.andThen(consume(lines(fs.stream(file), true))),
        ),
      { discard: true },
    );
  }

  const packs = new Map<
    string,
    {
      pack: TileId;
      tiles: Array<{ slot: number; key: string; footprints: Array<string> }>;
    }
  >();
  for (const [key, { tile, footprints }] of buckets.tiles) {
    const pack = packOf(tile);
    const id = packKey(region.id, pack);
    const entry = packs.get(id) ?? { pack, tiles: [] };
    entry.tiles.push({ slot: slotOf(tile), key, footprints });
    packs.set(id, entry);
  }

  const regionDir = path.dirname(path.join(out, manifestKey(region.id)));
  yield* fs.remove(regionDir, { recursive: true, force: true });
  let largestTile = { key: '', bytes: 0, footprints: 0 };
  const written = yield* Effect.forEach(
    Arr.sort(packs.keys(), Str.Order),
    (key) =>
      Effect.gen(function* () {
        const tiles = new Map<number, Uint8Array>();
        for (const tile of packs.get(key)?.tiles ?? []) {
          const bytes = yield* gzip(`[${Arr.join(tile.footprints, ',')}]`);
          tiles.set(tile.slot, bytes);
          if (bytes.length > largestTile.bytes) {
            largestTile = {
              key: tile.key,
              bytes: bytes.length,
              footprints: tile.footprints.length,
            };
          }
        }
        const bytes = encodePack(tiles);
        const file = path.join(out, key);
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFile(file, bytes);
        return { key, bytes: bytes.length, sha256: yield* sha256(bytes) };
      }),
    { concurrency: 8 },
  );

  const manifest = {
    region: region.id,
    source,
    footprints: buckets.counts.footprints,
    tiles: buckets.tiles.size,
    packs: written,
  };
  yield* fs.writeFileString(
    path.join(out, manifestKey(region.id)),
    yield* Schema.encodeEffect(FootprintManifestJson)(manifest),
  );

  const total = Arr.reduce(written, 0, (sum, { bytes }) => sum + bytes);
  const largestPack = Arr.reduce(written, written[0], (largest, pack) =>
    largest === undefined || pack.bytes > largest.bytes ? pack : largest,
  );
  const elapsed = ((yield* Clock.currentTimeMillis) - started) / 1000;
  yield* Effect.log(
    Arr.join(
      [
        `Built ${region.id} from ${source} in ${elapsed.toFixed(0)} s, into ${regionDir}`,
        `footprints: ${buckets.counts.footprints} kept, ${buckets.counts.skipped} skipped (unreadable or not buildings)`,
        `z14 tiles: ${buckets.tiles.size} in ${written.length} z10 packs, ${megabytes(total)} in all`,
        `largest tile: z14/${largestTile.key}, ${kilobytes(largestTile.bytes)} gzipped, ${largestTile.footprints} footprints`,
        `largest pack: ${largestPack?.key ?? 'none'}, ${megabytes(largestPack?.bytes ?? 0)}`,
      ],
      '\n',
    ),
  );
});

const build = Effect.fn('buildFootprints')(function* (options: {
  readonly regions: ReadonlyArray<string>;
  readonly out: Option.Option<string>;
  readonly input: Option.Option<string>;
  readonly downloads: Option.Option<string>;
  readonly location: string;
}) {
  const path = yield* Path.Path;
  const ids = Arr.contains(options.regions, 'all')
    ? Arr.map(regions, ({ id }) => id)
    : options.regions;
  const selected = Arr.filter(regions, ({ id }) => Arr.contains(ids, id));
  const unknown = Arr.filter(
    ids,
    (id) => !Arr.some(regions, (region) => region.id === id),
  );
  if (unknown.length > 0) {
    return yield* BuildError.make({
      message: `Unknown region ${Arr.join(unknown, ', ')}; coverage has all, ${Arr.join(
        Arr.map(regions, ({ id }) => id),
        ', ',
      )}`,
    });
  }
  if (Option.isSome(options.input) && selected.length !== 1) {
    return yield* BuildError.make({
      message: '--input holds one region; name exactly one',
    });
  }
  const out = Option.isSome(options.out)
    ? options.out.value
    : yield* defaultFootprintsDir;
  const downloads = Option.isSome(options.downloads)
    ? options.downloads.value
    : path.join(path.dirname(out), 'footprints-source');
  const datasetLinks = Option.isSome(options.input)
    ? ''
    : yield* get(DATASET_LINKS).pipe(
        Effect.flatMap((response) => response.text),
      );
  for (const region of selected) {
    yield* buildRegion(region, {
      out,
      input: options.input,
      downloads,
      location: options.location,
      datasetLinks,
    });
  }
});

const command = Command.make(
  'build-tiles',
  {
    regions: Argument.String('region').pipe(
      Argument.withDescription('Coverage region ids, such as us-nc, or all'),
      Argument.variadic({ min: 1 }),
    ),
    out: Flag.String('out').pipe(
      Flag.withDescription('Output directory (default <repo>/tmp/footprints)'),
      Flag.optional,
    ),
    input: Flag.String('input').pipe(
      Flag.withDescription(
        'A GeoJSON-lines file (.gz allowed) or - for stdin, instead of downloading',
      ),
      Flag.optional,
    ),
    downloads: Flag.String('downloads').pipe(
      Flag.withDescription(
        'Download cache (default <repo>/tmp/footprints-source)',
      ),
      Flag.optional,
    ),
    location: Flag.String('location').pipe(
      Flag.withDescription('GlobalMLBuildingFootprints location name'),
      Flag.withDefault('UnitedStates'),
    ),
  },
  build,
);

Command.run(command, { version: '1.0.0' }).pipe(
  Effect.provide([BunServices.layer, FetchHttpClient.layer]),
  BunRuntime.runMain,
);
