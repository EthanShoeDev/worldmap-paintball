import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Layer, String as Str } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { encode } from 'fast-png';

import { type LatLon, project } from '../src/bake.ts';
import {
  bilinear,
  decodeTerrarium,
  Elevation,
  sampleTerrain,
  TERRAIN_SIZE,
  TERRAIN_ZOOM,
  terrariumHeight,
} from '../src/elevation.ts';
import { tilePosition } from '../src/tiles.ts';

const raleigh = { lat: 35.7796, lon: -78.6382 };

// A 256 × 256 Terrarium tile whose every pixel is `metres` high.
const flatTile = (metres: number, size = 256) => {
  const value = metres + 32_768;
  const pixel = [Math.floor(value / 256), Math.floor(value) % 256, 0];
  return encode({
    width: size,
    height: size,
    channels: 3,
    depth: 8,
    data: Uint8Array.from(
      { length: size * size * 3 },
      (_, index) => pixel[index % 3] ?? 0,
    ),
  });
};

describe('terrariumHeight', () => {
  it('decodes sea level and fractions of a metre', () => {
    assert.strictEqual(terrariumHeight(128, 0, 0), 0);
    assert.strictEqual(terrariumHeight(128, 108, 128), 108.5);
    assert.strictEqual(terrariumHeight(127, 255, 0), -1);
  });
});

describe('decodeTerrarium', () => {
  it('decodes every pixel of a PNG tile', () => {
    const heights = decodeTerrarium(flatTile(42));
    assert.strictEqual(heights.length, 256 * 256);
    assert.deepStrictEqual(new Set(heights), new Set([42]));
  });

  it('rejects tiles of another size', () => {
    assert.throws(() => decodeTerrarium(flatTile(42, 64)), /64×64/);
  });
});

describe('bilinear', () => {
  it('reproduces a plane between pixel centres', () => {
    const sample = bilinear((x, y) => x + 2 * y);
    const [x, y] = tilePosition(raleigh, TERRAIN_ZOOM);
    assert.approximately(
      sample(raleigh),
      x * 256 - 0.5 + 2 * (y * 256 - 0.5),
      1e-6,
    );
  });
});

describe('sampleTerrain', () => {
  // Rises 1 m per 100 m east and 2 m per 100 m north.
  const slope = (point: LatLon) => {
    const [x, z] = project(raleigh, point);
    return x / 100 - (2 * z) / 100;
  };

  it('samples a size × size grid relative to the centre', () => {
    const { size, heights } = sampleTerrain(raleigh, 150, 5, slope);
    assert.strictEqual(size, 5);
    assert.strictEqual(heights.length, 25);
    assert.strictEqual(heights[12], 0);
  });

  it('runs from the north-west corner, row by row southwards', () => {
    const { heights } = sampleTerrain(raleigh, 150, 3, slope);
    const northWest = heights[0] ?? 0;
    const northEast = heights[2] ?? 0;
    const southWest = heights[6] ?? 0;
    assert.isAbove(northEast, northWest);
    assert.isBelow(southWest, northWest);
    assert.approximately(northEast - northWest, 3, 0.02);
    assert.approximately(northWest - southWest, 6, 0.02);
  });
});

const fakeClient = (respond: (url: URL) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, respond(url))),
    ),
  );

const terrain = (respond: (url: URL) => Response) =>
  Elevation.use((elevation) => elevation.terrain(raleigh, 150)).pipe(
    Effect.provide(
      Elevation.layerTerrarium.pipe(Layer.provide(fakeClient(respond))),
    ),
  );

describe('Elevation.layerTerrarium', () => {
  it.effect('samples the covering tiles into a centre-relative grid', () =>
    Effect.gen(function* () {
      const urls: Array<string> = [];
      const result = yield* terrain((url) => {
        urls.push(url.pathname);
        return new Response(flatTile(120));
      });
      assert.isTrue(
        Arr.every(urls, Str.startsWith('/elevation-tiles-prod/terrarium/15/')),
      );
      assert.strictEqual(result.size, TERRAIN_SIZE);
      assert.strictEqual(result.heights.length, TERRAIN_SIZE ** 2);
      assert.isTrue(Arr.every(result.heights, (height) => height === 0));
    }),
  );

  it.effect('fails with ElevationError when a tile is missing', () =>
    Effect.gen(function* () {
      const error = yield* terrain(
        () => new Response('missing', { status: 404 }),
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'ElevationError');
      assert.match(error.message, /^Terrarium: /);
    }),
  );

  it.effect('fails with ElevationError when a tile does not decode', () =>
    Effect.gen(function* () {
      const error = yield* terrain(() => new Response('not a png')).pipe(
        Effect.flip,
      );
      assert.strictEqual(error._tag, 'ElevationError');
    }),
  );
});
