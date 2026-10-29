import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Effect, Layer } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';

import { MapData } from '../src/map-data.ts';

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
