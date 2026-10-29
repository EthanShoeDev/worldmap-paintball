import { assert, describe, it } from '@effect/vitest';
import { Duration, Effect, Fiber, Layer, Option } from 'effect';
import { TestClock } from 'effect/testing';

import { type Arena, MapDataError } from '../src/api.ts';
import { ArenaStore, ArenaStoreError } from '../src/arena-store.ts';
import { BAKE_VERSION, type LatLon } from '../src/bake.ts';
import { arenaKey, HALF_SIZE, MapData } from '../src/map-data.ts';

const london = { lat: 51.5074, lon: -0.1278 };
const paris = { lat: 48.8584, lon: 2.2945 };

const arenaAt = (center: LatLon, buildings = 0): Arena => ({
  ...center,
  halfSize: HALF_SIZE,
  buildings: Array.from({ length: buildings }, () => ({
    footprint: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    height: 8,
  })),
  roads: [],
  areas: [],
});

// Counts upstream bakes. `delay` holds each bake open (on the TestClock) so
// concurrent callers overlap; `failures` makes the first N bakes fail.
const fakeUpstream = (
  options: { delay?: Duration.Input; failures?: number } = {},
) => {
  const calls: Array<LatLon> = [];
  const layer = Layer.succeed(
    MapData,
    MapData.of({
      arena: (center) =>
        Effect.gen(function* () {
          calls.push(center);
          if (options.delay !== undefined) yield* Effect.sleep(options.delay);
          if (calls.length <= (options.failures ?? 0)) {
            return yield* MapDataError.make({ message: 'Overpass: 429' });
          }
          return arenaAt(center, 1);
        }),
    }),
  );
  return { calls, layer };
};

const textStore = (texts: Map<string, string>) =>
  ArenaStore.fromText({
    read: (key) => Effect.sync(() => texts.get(key)),
    write: (key, text) => Effect.sync(() => void texts.set(key, text)),
  });

const memoryStore = (texts: Map<string, string>) =>
  Layer.succeed(ArenaStore, textStore(texts));

// Each provide builds a fresh layer: a new, empty in-memory tier over `texts`.
const cached = (upstream: Layer.Layer<MapData>, texts: Map<string, string>) =>
  MapData.layerCached.pipe(Layer.provide([upstream, memoryStore(texts)]));

const arenaOnce = (
  upstream: Layer.Layer<MapData>,
  texts: Map<string, string>,
  center: LatLon,
) =>
  MapData.use((mapData) => mapData.arena(center)).pipe(
    Effect.provide(cached(upstream, texts)),
  );

describe('MapData.layerCached', () => {
  it.effect('shares one upstream bake between concurrent requests', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream({ delay: '1 second' });
      const texts = new Map<string, string>();
      const fiber = yield* MapData.use((mapData) =>
        Effect.all(
          Array.from({ length: 8 }, (_, index) =>
            // Sub-micro-degree noise normalises to the same key.
            mapData.arena({ lat: london.lat + index * 1e-8, lon: london.lon }),
          ),
          { concurrency: 'unbounded' },
        ),
      ).pipe(Effect.provide(cached(upstream.layer, texts)), Effect.forkChild);
      yield* TestClock.adjust('1 second');
      const results = yield* Fiber.join(fiber);

      assert.strictEqual(upstream.calls.length, 1);
      assert.deepStrictEqual(upstream.calls[0], london);
      for (const result of results) assert.strictEqual(result, results[0]);
      assert.deepStrictEqual(results[0], arenaAt(london, 1));
      assert.deepStrictEqual([...texts.keys()], [arenaKey(london)]);
    }),
  );

  it.effect('bakes different centres separately', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream();
      const [first, second] = yield* MapData.use((mapData) =>
        Effect.all([mapData.arena(london), mapData.arena(paris)]),
      ).pipe(Effect.provide(cached(upstream.layer, new Map())));
      assert.deepStrictEqual(upstream.calls, [london, paris]);
      assert.strictEqual(first.lat, london.lat);
      assert.strictEqual(second.lat, paris.lat);
    }),
  );

  it.effect('serves a durable hit after the in-memory tier is gone', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream();
      const texts = new Map<string, string>();
      const first = yield* arenaOnce(upstream.layer, texts, london);
      const second = yield* arenaOnce(upstream.layer, texts, london);
      assert.strictEqual(upstream.calls.length, 1);
      assert.deepStrictEqual(second, first);
    }),
  );

  it.effect('rebakes over a corrupt stored entry', () =>
    Effect.gen(function* () {
      for (const corrupt of ['{not json', '{"bakedAt":"yesterday"}']) {
        const upstream = fakeUpstream();
        const texts = new Map([[arenaKey(london), corrupt]]);
        const arena = yield* arenaOnce(upstream.layer, texts, london);
        assert.strictEqual(upstream.calls.length, 1);
        assert.deepStrictEqual(arena, arenaAt(london, 1));
        // The rebake replaced the corrupt entry.
        yield* arenaOnce(upstream.layer, texts, london);
        assert.strictEqual(upstream.calls.length, 1);
      }
    }),
  );

  it.effect('does not cache an upstream failure', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream({ failures: 1 });
      const texts = new Map<string, string>();
      const [failure, success] = yield* MapData.use((mapData) =>
        Effect.all([Effect.flip(mapData.arena(london)), mapData.arena(london)]),
      ).pipe(Effect.provide(cached(upstream.layer, texts)));
      assert.strictEqual(failure.message, 'Overpass: 429');
      assert.deepStrictEqual(success, arenaAt(london, 1));
      assert.strictEqual(upstream.calls.length, 2);
      assert.strictEqual(texts.size, 1);
    }),
  );

  it.effect('misses entries stored under another bake version or key', () =>
    Effect.gen(function* () {
      assert.strictEqual(
        arenaKey(london),
        arenaKey({ lat: 51.507_400_04, lon: -0.127_8 }),
      );
      const keys = [
        arenaKey(london, HALF_SIZE, BAKE_VERSION + 1),
        arenaKey(london, HALF_SIZE * 2),
        arenaKey({ lat: london.lat + 1e-6, lon: london.lon }),
      ];
      assert.strictEqual(new Set([arenaKey(london), ...keys]).size, 4);

      const stale = new Map<string, string>();
      const store = textStore(stale);
      for (const key of keys) {
        yield* store.put(key, { bakedAt: 0, arena: arenaAt(london, 5) });
      }
      const upstream = fakeUpstream();
      const arena = yield* arenaOnce(upstream.layer, stale, london);
      assert.strictEqual(upstream.calls.length, 1);
      assert.strictEqual(arena.buildings.length, 1);
    }),
  );

  it.effect('expires durable entries after 30 days', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream();
      const texts = new Map<string, string>();
      yield* arenaOnce(upstream.layer, texts, london);

      yield* TestClock.adjust('29 days');
      yield* arenaOnce(upstream.layer, texts, london);
      assert.strictEqual(upstream.calls.length, 1);

      yield* TestClock.adjust('1 day');
      yield* arenaOnce(upstream.layer, texts, london);
      assert.strictEqual(upstream.calls.length, 2);

      // The rebake restarted the clock on the stored entry.
      yield* TestClock.adjust('1 day');
      yield* arenaOnce(upstream.layer, texts, london);
      assert.strictEqual(upstream.calls.length, 2);
    }),
  );

  it.effect('expires the in-memory tier after an hour', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream();
      const texts = new Map<string, string>();
      yield* MapData.use((mapData) =>
        Effect.gen(function* () {
          yield* mapData.arena(london);
          texts.clear();
          yield* TestClock.adjust('59 minutes');
          yield* mapData.arena(london);
          assert.strictEqual(upstream.calls.length, 1);
          yield* TestClock.adjust('1 minute');
          yield* mapData.arena(london);
          assert.strictEqual(upstream.calls.length, 2);
        }),
      ).pipe(Effect.provide(cached(upstream.layer, texts)));
    }),
  );

  it.effect('fails on a store error without baking', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream();
      const broken = Layer.succeed(
        ArenaStore,
        ArenaStore.fromText({
          read: () =>
            Effect.fail(ArenaStoreError.make({ message: 'R2: timeout' })),
          write: () => Effect.void,
        }),
      );
      const error = yield* MapData.use((mapData) => mapData.arena(london)).pipe(
        Effect.provide(
          MapData.layerCached.pipe(Layer.provide([upstream.layer, broken])),
        ),
        Effect.flip,
      );
      assert.strictEqual(error.message, 'Arena store: R2: timeout');
      assert.strictEqual(upstream.calls.length, 0);
    }),
  );
});

describe('ArenaStore.layerMemory', () => {
  it.effect('round-trips a stored arena', () =>
    Effect.gen(function* () {
      const store = yield* ArenaStore;
      assert.isTrue(Option.isNone(yield* store.get('missing')));
      const entry = { bakedAt: 42, arena: arenaAt(paris, 2) };
      yield* store.put('paris', entry);
      assert.deepStrictEqual(yield* store.get('paris'), Option.some(entry));
    }).pipe(Effect.provide(ArenaStore.layerMemory)),
  );
});
