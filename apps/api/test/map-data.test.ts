import { assert, describe, it } from '@effect/vitest';
import { type Arena, MapDataError } from '@worldmap-paintball/api-contract';
import { Array as Arr, Effect, Layer } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';

import type { Footprint } from '../src/bake.ts';
import { Elevation, ElevationError } from '../src/elevation.ts';
import {
  BuildingFootprints,
  BuildingFootprintsError,
} from '../src/footprints.ts';
import { HALF_SIZE, MapData } from '../src/map-data.ts';

const overpassJson = {
  elements: [
    { type: 'node', lat: 0, lon: 0 },
    {
      type: 'way',
      tags: { building: 'yes', 'building:levels': '2' },
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.0001 },
        { lat: 0.0001, lon: 0.0001 },
        { lat: 0, lon: 0 },
      ],
    },
    {
      type: 'way',
      tags: { highway: 'service' },
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0.0001, lon: 0 },
      ],
    },
  ],
};

const fakeClient = (respond: (request: Request) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          respond(new Request(url.href, { method: request.method })),
        ),
      ),
    ),
  );

const arena = (respond: (request: Request) => Response) =>
  MapData.use((mapData) => mapData.arena({ lat: 0, lon: 0 })).pipe(
    Effect.provide(
      MapData.layerOverpass.pipe(Layer.provide(fakeClient(respond))),
    ),
  );

describe('MapData.layerOverpass', () => {
  it.effect('bakes the Overpass ways into an arena', () =>
    Effect.gen(function* () {
      let method = '';
      const result = yield* arena((request) => {
        method = request.method;
        return Response.json(overpassJson);
      });
      assert.strictEqual(method, 'POST');
      assert.deepStrictEqual(
        Arr.map(result.buildings, (building) => [
          building.height,
          building.footprint.length,
        ]),
        [[6, 3]],
      );
      assert.deepStrictEqual(
        Arr.map(result.roads, (road) => road.width),
        [4],
      );
    }),
  );

  it.effect('fails with MapDataError on a malformed response', () =>
    Effect.gen(function* () {
      const error = yield* arena(() => Response.json({ nope: true })).pipe(
        Effect.flip,
      );
      assert.strictEqual(error._tag, 'MapDataError');
      assert.match(error.message, /^Overpass: /);
    }),
  );

  it.effect('fails with MapDataError on a client error status', () =>
    Effect.gen(function* () {
      const error = yield* arena(
        () => new Response('bad query', { status: 400 }),
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'MapDataError');
    }),
  );
});

const arenaOf = (buildings: number): Arena => ({
  lat: 0,
  lon: 0,
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

const source = (result: Effect.Effect<Arena, MapDataError>) => {
  const calls: Array<unknown> = [];
  const layer = Layer.succeed(
    MapData,
    MapData.of({
      arena: (center) =>
        Effect.suspend(() => {
          calls.push(center);
          return result;
        }),
    }),
  );
  return { calls, layer };
};

const serving = (buildings: number) =>
  source(Effect.succeed(arenaOf(buildings)));

const failing = (message: string) =>
  source(Effect.fail(MapDataError.make({ message })));

const arenaFrom = (layer: Layer.Layer<MapData>) =>
  MapData.use((mapData) => mapData.arena({ lat: 0, lon: 0 })).pipe(
    Effect.provide(layer),
  );

describe('MapData.layerFallback', () => {
  it.effect('serves the primary source without asking the fallback', () =>
    Effect.gen(function* () {
      const fallback = serving(2);
      const result = yield* arenaFrom(
        MapData.layerFallback(serving(1).layer, fallback.layer),
      );
      assert.strictEqual(result.buildings.length, 1);
      assert.strictEqual(fallback.calls.length, 0);
    }),
  );

  it.effect('uses the fallback when the primary fails', () =>
    Effect.gen(function* () {
      const result = yield* arenaFrom(
        MapData.layerFallback(
          failing('OpenFreeMap: 502').layer,
          serving(2).layer,
        ),
      );
      assert.strictEqual(result.buildings.length, 2);
    }),
  );

  it.effect('reports both failures', () =>
    Effect.gen(function* () {
      const error = yield* arenaFrom(
        MapData.layerFallback(
          failing('OpenFreeMap: 502').layer,
          failing('Overpass: 521').layer,
        ),
      ).pipe(Effect.flip);
      assert.strictEqual(error.message, 'OpenFreeMap: 502; Overpass: 521');
    }),
  );

  it.effect('falls back from OpenFreeMap to Overpass over HTTP', () =>
    Effect.gen(function* () {
      const hosts: Array<string> = [];
      const result = yield* arenaFrom(
        MapData.layerFallback(
          MapData.layerOpenFreeMap,
          MapData.layerOverpass,
        ).pipe(
          Layer.provide(
            fakeClient((request) => {
              const { host } = new URL(request.url);
              hosts.push(host);
              return host === 'tiles.openfreemap.org'
                ? new Response('gone', { status: 404 })
                : Response.json(overpassJson);
            }),
          ),
        ),
      );
      assert.deepStrictEqual(hosts, [
        'tiles.openfreemap.org',
        'overpass-api.de',
      ]);
      assert.strictEqual(result.buildings.length, 1);
    }),
  );
});

const elevation = (terrain: Arena['terrain'] | undefined) =>
  Layer.succeed(
    Elevation,
    Elevation.of({
      terrain: () =>
        terrain === undefined
          ? Effect.fail(ElevationError.make({ message: 'Terrarium: 403' }))
          : Effect.succeed(terrain),
    }),
  );

const withTerrain = (
  upstream: Layer.Layer<MapData>,
  terrain: Arena['terrain'] | undefined,
) =>
  arenaFrom(
    MapData.layerTerrain.pipe(Layer.provide([upstream, elevation(terrain)])),
  );

describe('MapData.layerTerrain', () => {
  const flat = { size: 2, heights: [0, 0, 0, 0] };

  it.effect('adds the terrain to the arena', () =>
    Effect.gen(function* () {
      const result = yield* withTerrain(serving(1).layer, flat);
      assert.deepStrictEqual(result, { ...arenaOf(1), terrain: flat });
    }),
  );

  it.effect('bakes a flat arena when terrain fails, and says so', () =>
    Effect.gen(function* () {
      const result = yield* withTerrain(serving(1).layer, undefined);
      assert.deepStrictEqual(result, { ...arenaOf(1), missing: ['terrain'] });
      assert.isFalse('terrain' in result);
    }),
  );

  it.effect('still fails when the geometry fails', () =>
    Effect.gen(function* () {
      const error = yield* withTerrain(
        failing('OpenFreeMap: 502').layer,
        flat,
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'MapDataError');
    }),
  );
});

const footprintSource = (
  result: Effect.Effect<ReadonlyArray<Footprint>, BuildingFootprintsError>,
) =>
  Layer.succeed(
    BuildingFootprints,
    BuildingFootprints.of({ footprints: () => result }),
  );

const withFootprints = (
  upstream: Layer.Layer<MapData>,
  footprints: Effect.Effect<ReadonlyArray<Footprint>, BuildingFootprintsError>,
) =>
  arenaFrom(
    MapData.layerFootprints.pipe(
      Layer.provide([upstream, footprintSource(footprints)]),
    ),
  );

describe('MapData.layerFootprints', () => {
  // About 11 m square, 100 m north-east of the centre: clear of arenaOf's
  // buildings.
  const footprint = {
    outline: [
      { lat: 0.0009, lon: 0.0009 },
      { lat: 0.0009, lon: 0.001 },
      { lat: 0.001, lon: 0.001 },
      { lat: 0.001, lon: 0.0009 },
    ],
    height: undefined,
  };

  it.effect('adds the footprints to the arena', () =>
    Effect.gen(function* () {
      const result = yield* withFootprints(
        serving(1).layer,
        Effect.succeed([footprint]),
      );
      assert.strictEqual(result.buildings.length, 2);
      assert.strictEqual(result.buildings[1]?.height, 6);
    }),
  );

  it.effect('bakes OSM buildings alone when footprints fail, and says so', () =>
    Effect.gen(function* () {
      const result = yield* withFootprints(
        serving(1).layer,
        Effect.fail(BuildingFootprintsError.make({ message: 'R2: 500' })),
      );
      assert.deepStrictEqual(result, {
        ...arenaOf(1),
        missing: ['footprints'],
      });
    }),
  );

  it.effect('still fails when the geometry fails', () =>
    Effect.gen(function* () {
      const error = yield* withFootprints(
        failing('OpenFreeMap: 502').layer,
        Effect.succeed([footprint]),
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, 'MapDataError');
    }),
  );
});
