import { assert, describe, it, layer } from '@effect/vitest';
import { Effect, Layer, Schema } from 'effect';
import {
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { HttpApiTest } from 'effect/http-api';

import { Api, Arena } from '../src/api.ts';
import { Geocoder } from '../src/geocoder.ts';
import { ApiLive, ArenasLive, PlacesLive } from '../src/handlers.ts';
import { MapData } from '../src/map-data.ts';

const MapDataEcho = Layer.succeed(
  MapData,
  MapData.of({
    arena: (center) =>
      Effect.succeed({
        ...center,
        halfSize: 150,
        buildings: [],
        roads: [],
        areas: [],
      }),
  }),
);

const GeocoderEcho = Layer.succeed(
  Geocoder,
  Geocoder.of({
    search: (query) => Effect.succeed([{ label: query, lat: 1, lon: 2 }]),
  }),
);

const makeClient = HttpApiTest.groups(Api, ['arenas', 'places']);

layer(
  Layer.mergeAll(
    ArenasLive.pipe(Layer.provide(MapDataEcho)),
    PlacesLive.pipe(Layer.provide(GeocoderEcho)),
    HttpServer.layerServices,
  ),
)('Map endpoints', (it) => {
  it.effect('passes the decoded centre to MapData', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const arena = yield* client.arenas.get({
        query: { lat: 51.5074, lon: -0.1278 },
      });
      assert.strictEqual(arena.lat, 51.5074);
      assert.strictEqual(arena.lon, -0.1278);
    }),
  );

  it.effect('passes the query to Geocoder', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const places = yield* client.places.search({ query: { q: 'London' } });
      assert.deepStrictEqual(places, [{ label: 'London', lat: 1, lon: 2 }]);
    }),
  );
});

// The typed client validates before sending, so raw requests are needed to
// exercise the server's own query decoding.
const get = Effect.fn(function* (path: string) {
  const handler = yield* HttpRouter.toHttpEffect(
    ApiLive.pipe(
      Layer.provide([MapDataEcho, GeocoderEcho, HttpServer.layerServices]),
    ),
  );
  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`),
  );
  return yield* handler.pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    Effect.catchCause((cause) =>
      Effect.map(
        HttpServerError.causeResponse(cause),
        ([response]) => response,
      ),
    ),
  );
});

describe('Arena query decoding', () => {
  it.effect('decodes lat and lon strings', () =>
    Effect.gen(function* () {
      const response = yield* get('/arenas?lat=40.7128&lon=-74.006');
      assert.strictEqual(response.status, 200);
      const json = yield* Effect.promise(() =>
        HttpServerResponse.toWeb(response).json(),
      );
      const body = yield* Schema.decodeUnknownEffect(Arena)(json);
      assert.strictEqual(body.lat, 40.7128);
      assert.strictEqual(body.lon, -74.006);
    }),
  );

  it.effect('rejects an out-of-range latitude', () =>
    Effect.gen(function* () {
      const response = yield* get('/arenas?lat=90&lon=0');
      assert.strictEqual(response.status, 400);
    }),
  );

  it.effect('rejects a non-numeric longitude', () =>
    Effect.gen(function* () {
      const response = yield* get('/arenas?lat=0&lon=east');
      assert.strictEqual(response.status, 400);
    }),
  );

  it.effect('rejects a short place query', () =>
    Effect.gen(function* () {
      const response = yield* get('/places?q=ab');
      assert.strictEqual(response.status, 400);
    }),
  );
});
