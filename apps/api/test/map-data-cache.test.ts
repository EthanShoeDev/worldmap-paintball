import { assert, describe, it } from '@effect/vitest';
import { type Arena, MapDataError } from '@worldmap-paintball/api-contract';
import { Duration, Effect, Fiber, Layer, Option, Struct } from 'effect';
import { TestClock } from 'effect/testing';

import { ArenaStore, ArenaStoreError } from '../src/arena-store.ts';
import { BAKE_VERSION, type LatLon } from '../src/bake.ts';
import {
  type ArenaRequest,
  arenaKey,
  HALF_SIZE,
  MapData,
  pinnedKey,
} from '../src/map-data.ts';

const london = { lat: 51.5074, lon: -0.1278 };
const paris = { lat: 48.8584, lon: 2.2945 };

const terrain = { size: 2, heights: [0, 1, 2, 3] };

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
  terrain,
});

// The cache stamps each bake with an id; comparisons leave it out.
const unbaked = (arena: Arena) => Struct.omit(arena, ['bake']);

// Counts upstream bakes. `delay` holds each bake open (on the TestClock) so
// concurrent callers overlap; `failures` makes the first N bakes fail, and
// `flat` the first N lose their terrain.
const fakeUpstream = (
  options: { delay?: Duration.Input; failures?: number; flat?: number } = {},
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
          const { terrain: _, ...flat } = arenaAt(center, 1);
          return calls.length <= (options.flat ?? 0)
            ? flat
            : arenaAt(center, 1);
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
  center: ArenaRequest,
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
      const [first] = results;
      assert.isDefined(first);
      assert.deepStrictEqual(unbaked(first), arenaAt(london, 1));
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

  it.effect('keeps a bake without terrain only under its own id', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream({ flat: 1 });
      const texts = new Map<string, string>();
      const first = yield* arenaOnce(upstream.layer, texts, london);
      assert.isUndefined(first.terrain);
      const pinned = pinnedKey(arenaKey(london), first.bake ?? '');
      assert.deepStrictEqual([...texts.keys()], [pinned]);
      yield* TestClock.adjust('1 second');
      const second = yield* arenaOnce(upstream.layer, texts, london);
      assert.deepStrictEqual(second.terrain, terrain);
      assert.notStrictEqual(second.bake, first.bake);
      assert.deepStrictEqual([...texts.keys()], [pinned, arenaKey(london)]);
    }),
  );

  it.effect('serves a pinned bake again after a newer one', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream({ flat: 1 });
      const texts = new Map<string, string>();
      const flat = yield* arenaOnce(upstream.layer, texts, london);
      yield* TestClock.adjust('1 second');
      const whole = yield* arenaOnce(upstream.layer, texts, london);
      const again = yield* arenaOnce(upstream.layer, texts, {
        ...london,
        bake: flat.bake ?? '',
      });
      const latest = yield* arenaOnce(upstream.layer, texts, {
        ...london,
        bake: whole.bake ?? '',
      });
      assert.deepStrictEqual(again, flat);
      assert.deepStrictEqual(latest, whole);
      assert.strictEqual(upstream.calls.length, 2);
    }),
  );

  it.effect('keeps a bake missing its footprints only under its id', () =>
    Effect.gen(function* () {
      const texts = new Map<string, string>();
      const upstream = Layer.succeed(
        MapData,
        MapData.of({
          arena: (center) =>
            Effect.succeed({
              ...arenaAt(center, 1),
              missing: ['footprints'] as const,
            }),
        }),
      );
      const arena = yield* arenaOnce(upstream, texts, london);
      assert.deepStrictEqual(arena.missing, ['footprints']);
      assert.deepStrictEqual(
        [...texts.keys()],
        [pinnedKey(arenaKey(london), arena.bake ?? '')],
      );
    }),
  );

  it.effect('rebakes a stored bake without terrain', () =>
    Effect.gen(function* () {
      const texts = new Map<string, string>();
      const { terrain: _, ...flat } = arenaAt(london, 1);
      yield* textStore(texts).put(arenaKey(london), {
        bakedAt: 0,
        arena: flat,
      });
      const upstream = fakeUpstream();
      const arena = yield* arenaOnce(upstream.layer, texts, london);
      assert.strictEqual(upstream.calls.length, 1);
      assert.deepStrictEqual(arena.terrain, terrain);
    }),
  );

  it.effect('bakes and stores each arena size separately', () =>
    Effect.gen(function* () {
      const upstream = fakeUpstream();
      const texts = new Map<string, string>();
      yield* MapData.use((mapData) =>
        Effect.all([
          mapData.arena(london),
          mapData.arena({ ...london, halfSize: HALF_SIZE }),
          mapData.arena({ ...london, halfSize: 225 }),
        ]),
      ).pipe(Effect.provide(cached(upstream.layer, texts)));
      assert.deepStrictEqual(upstream.calls, [
        london,
        { ...london, halfSize: 225 },
      ]);
      assert.deepStrictEqual(
        [...texts.keys()],
        [arenaKey(london), arenaKey(london, 225)],
      );
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
        assert.deepStrictEqual(unbaked(arena), arenaAt(london, 1));
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
      assert.deepStrictEqual(unbaked(success), arenaAt(london, 1));
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
      const missing = yield* store.get('missing');
      assert.isTrue(Option.isNone(missing));
      const entry = { bakedAt: 42, arena: arenaAt(paris, 2) };
      yield* store.put('paris', entry);
      const stored = yield* store.get('paris');
      assert.deepStrictEqual(stored, Option.some(entry));
    }).pipe(Effect.provide(ArenaStore.layerMemory)),
  );
});
