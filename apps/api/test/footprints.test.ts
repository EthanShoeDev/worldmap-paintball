import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, FileSystem, Layer, Path } from 'effect';

import { bounds } from '../src/bake.ts';
import {
  BuildingFootprints,
  encodeFootprint,
  encodePack,
  footprintTiles,
  gzip,
  microRing,
  packKey,
  packOf,
  slotOf,
} from '../src/footprints.ts';
import { type TileId, tileLatLon, tilePosition } from '../src/tiles.ts';

// The z14 tile around the home arena, inside North Carolina's coverage.
const home = { lat: 36.448163, lon: -80.792771 };
const [homeX, homeY] = tilePosition(home, 14);
const west: TileId = { z: 14, x: Math.floor(homeX), y: Math.floor(homeY) };
const east: TileId = { ...west, x: west.x + 1 };
const edge = tileLatLon(east, [0, 0.5]);

// A 10 m square at `lon` (in degrees), on the tile row's middle latitude.
const square = (lon: number, lat = edge.lat) => {
  const d = 0.0001;
  const corners = [
    [lon, lat],
    [lon + d, lat],
    [lon + d, lat + d],
    [lon, lat + d],
  ] as const;
  return Arr.map(
    corners,
    ([x, y]) => [Math.round(x * 1e6), Math.round(y * 1e6)] as const,
  );
};

describe('microRing', () => {
  it('rounds to microdegrees and drops the closing and repeated vertices', () => {
    assert.deepStrictEqual(
      microRing([
        [-80.1234564, 36.1],
        [-80.1234564, 36.1],
        [-80.12, 36.1],
        [-80.12, 36.2],
        [-80.1234564, 36.1],
      ]),
      [
        [-80_123_456, 36_100_000],
        [-80_120_000, 36_100_000],
        [-80_120_000, 36_200_000],
      ],
    );
  });

  it('rejects rings with fewer than three vertices', () => {
    assert.isUndefined(
      microRing([
        [-80, 36],
        [-80.1, 36],
        [-80, 36],
      ]),
    );
  });
});

describe('footprintTiles', () => {
  it('puts a footprint inside one tile in that tile', () => {
    assert.deepStrictEqual(footprintTiles(square(edge.lon - 0.001)), [west]);
  });

  it('puts a footprint across a tile edge in both tiles', () => {
    assert.deepStrictEqual(footprintTiles(square(edge.lon - 0.00005)), [
      west,
      east,
    ]);
  });

  it('puts a footprint on a tile corner in all four tiles', () => {
    const corner = tileLatLon(east, [0, 0]);
    assert.lengthOf(
      footprintTiles(square(corner.lon - 0.00005, corner.lat - 0.00005)),
      4,
    );
  });
});

// Writes the packs for `tiles` under a temporary directory, laid out by key.
const fixture = Effect.fn('fixture')(function* (
  tiles: ReadonlyArray<{
    readonly tile: TileId;
    readonly footprints: ReadonlyArray<ReadonlyArray<number>>;
  }>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();
  const packs = new Map<string, Map<number, Uint8Array>>();
  for (const { tile, footprints } of tiles) {
    const key = packKey('us-nc', packOf(tile));
    const slots = packs.get(key) ?? new Map<number, Uint8Array>();
    const json = `[${Arr.join(
      Arr.map(
        footprints,
        (values) => `[${Arr.join(Arr.map(values, String), ',')}]`,
      ),
      ',',
    )}]`;
    const gzipped = yield* gzip(json);
    slots.set(slotOf(tile), gzipped);
    packs.set(key, slots);
  }
  for (const [key, slots] of packs) {
    const file = path.join(dir, key);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFile(file, encodePack(slots));
  }
  return dir;
});

const footprintsIn = (dir: string, around = edge) =>
  BuildingFootprints.use((source) =>
    source.footprints(bounds(around, 150)),
  ).pipe(Effect.provide(BuildingFootprints.layerDirectory(dir)));

const TestFileSystem = Layer.mergeAll(BunFileSystem.layer, Path.layer);

describe('BuildingFootprints.layerDirectory', () => {
  const inWest = square(edge.lon - 0.0005);
  const across = square(edge.lon - 0.00005);
  const farAway = square(edge.lon - 0.01);

  it.effect('reads the footprints touching the bounds, once each', () =>
    Effect.gen(function* () {
      const dir = yield* fixture([
        {
          tile: west,
          footprints: [
            encodeFootprint(inWest, 4.3),
            encodeFootprint(across, undefined),
            encodeFootprint(farAway, undefined),
          ],
        },
        { tile: east, footprints: [encodeFootprint(across, undefined)] },
      ]);
      const footprints = yield* footprintsIn(dir);
      assert.lengthOf(footprints, 2);
      const [first, second] = footprints;
      assert.strictEqual(first?.height, 4.3);
      assert.isUndefined(second?.height);
      assert.deepStrictEqual(first?.outline[0], {
        lat: (inWest[0]?.[1] ?? 0) / 1e6,
        lon: (inWest[0]?.[0] ?? 0) / 1e6,
      });
      assert.lengthOf(first?.outline ?? [], 4);
    }).pipe(Effect.provide(TestFileSystem)),
  );

  it.effect('finds nothing where no pack was built', () =>
    Effect.gen(function* () {
      const dir = yield* fixture([]);
      const footprints = yield* footprintsIn(dir);
      assert.deepStrictEqual(footprints, []);
    }).pipe(Effect.provide(TestFileSystem)),
  );

  it.effect('finds nothing outside every coverage region', () =>
    Effect.gen(function* () {
      const dir = yield* fixture([
        { tile: west, footprints: [encodeFootprint(inWest, undefined)] },
      ]);
      const footprints = yield* footprintsIn(dir, { lat: 51.5, lon: -0.12 });
      assert.deepStrictEqual(footprints, []);
    }).pipe(Effect.provide(TestFileSystem)),
  );

  it.effect('fails on a corrupt tile', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped();
      const file = path.join(dir, packKey('us-nc', packOf(west)));
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      yield* fs.writeFile(
        file,
        encodePack(new Map([[slotOf(west), new TextEncoder().encode('nope')]])),
      );
      const error = yield* footprintsIn(dir).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'BuildingFootprintsError');
    }).pipe(Effect.provide(TestFileSystem)),
  );
});

describe('BuildingFootprints.layerEmpty', () => {
  it.effect('has no footprints', () =>
    Effect.gen(function* () {
      const footprints = yield* BuildingFootprints.use((source) =>
        source.footprints(bounds(home, 150)),
      ).pipe(Effect.provide(BuildingFootprints.layerEmpty));
      assert.deepStrictEqual(footprints, []);
    }),
  );
});
