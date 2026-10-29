import { assert, describe, it, layer } from '@effect/vitest';
import { Api, Arena } from '@worldmap-paintball/api-contract';
import { Effect, Layer, Predicate, Schema } from 'effect';
import {
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http';
import { HttpApiTest } from 'effect/http-api';

import { ArenaLimiter } from '../src/arena-limiter.ts';
import { Geocoder } from '../src/geocoder.ts';
import { ApiRoutes, ArenasLive, PlacesLive } from '../src/handlers.ts';
import { LobbyRooms } from '../src/lobby/rooms.ts';
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

const raleigh = { lat: 35.7796, lon: -78.6382 };

const makeClient = HttpApiTest.groups(Api, ['arenas', 'places']);

layer(
  Layer.mergeAll(
    ArenasLive.pipe(Layer.provide([MapDataEcho, ArenaLimiter.layerMemory])),
    PlacesLive.pipe(Layer.provide(GeocoderEcho)),
    HttpServer.layerServices,
  ),
)('Map endpoints', (it) => {
  it.effect('passes the decoded centre to MapData', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const arena = yield* client.arenas.get({ query: raleigh });
      assert.strictEqual(arena.lat, raleigh.lat);
      assert.strictEqual(arena.lon, raleigh.lon);
    }),
  );

  it.effect('passes the query to Geocoder and flags coverage', () =>
    Effect.gen(function* () {
      const client = yield* makeClient;
      const places = yield* client.places.search({ query: { q: 'London' } });
      assert.deepStrictEqual(places, [
        { label: 'London', lat: 1, lon: 2, covered: false },
      ]);
    }),
  );
});

// The typed client validates before sending, so raw requests are needed to
// exercise the server's own query decoding and the lobby route.
const send = Effect.fn(function* (
  path: string,
  options: {
    readonly mapData?: Layer.Layer<MapData>;
    readonly limiter?: Layer.Layer<ArenaLimiter>;
    readonly headers?: Record<string, string>;
  } = {},
) {
  const handler = yield* HttpRouter.toHttpEffect(
    ApiRoutes.pipe(
      Layer.provide([
        options.mapData ?? MapDataEcho,
        GeocoderEcho,
        LobbyRooms.layerMemory,
        options.limiter ?? ArenaLimiter.layerMemory,
        HttpServer.layerServices,
      ]),
    ),
  );
  const request = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      headers: options.headers ?? {},
    }),
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

const get = (path: string) => send(path);

const errorTag = Effect.fn(function* (
  response: HttpServerResponse.HttpServerResponse,
) {
  const body: unknown = yield* Effect.promise(() =>
    HttpServerResponse.toWeb(response).json(),
  );
  return Predicate.hasProperty(body, '_tag') ? body._tag : undefined;
});

const MapDataUnreachable = Layer.succeed(
  MapData,
  MapData.of({ arena: () => Effect.die('baked an uncovered arena') }),
);

describe('Arena coverage and rate limit', () => {
  it.effect('refuses uncovered places before baking', () =>
    Effect.gen(function* () {
      const response = yield* send('/api/arenas?lat=34.9249&lon=-81.0251', {
        mapData: MapDataUnreachable,
      });
      assert.strictEqual(response.status, 422);
      assert.strictEqual(yield* errorTag(response), 'OutsideCoverage');
    }),
  );

  it.effect('limits each client separately', () =>
    Effect.gen(function* () {
      // One limiter shared by every request below.
      const limiter = Layer.succeedContext(
        yield* Layer.build(ArenaLimiter.makeMemory({ limit: 2, period: 60 })),
      );
      const fetchAs = (ip: string) =>
        send(`/api/arenas?lat=${raleigh.lat}&lon=${raleigh.lon}`, {
          limiter,
          headers: { 'cf-connecting-ip': ip },
        });
      assert.strictEqual((yield* fetchAs('192.0.2.1')).status, 200);
      assert.strictEqual((yield* fetchAs('192.0.2.1')).status, 200);
      const limited = yield* fetchAs('192.0.2.1');
      assert.strictEqual(limited.status, 429);
      assert.strictEqual(yield* errorTag(limited), 'RateLimited');
      assert.strictEqual((yield* fetchAs('192.0.2.2')).status, 200);
    }),
  );
});

describe('Arena query decoding', () => {
  it.effect('decodes lat and lon strings', () =>
    Effect.gen(function* () {
      const response = yield* get('/api/arenas?lat=35.7796&lon=-78.6382');
      assert.strictEqual(response.status, 200);
      const json = yield* Effect.promise(() =>
        HttpServerResponse.toWeb(response).json(),
      );
      const body = yield* Schema.decodeUnknownEffect(Arena)(json);
      assert.strictEqual(body.lat, 35.7796);
      assert.strictEqual(body.lon, -78.6382);
    }),
  );

  it.effect('rejects an out-of-range latitude', () =>
    Effect.gen(function* () {
      const response = yield* get('/api/arenas?lat=90&lon=0');
      assert.strictEqual(response.status, 400);
    }),
  );

  it.effect('rejects a non-numeric longitude', () =>
    Effect.gen(function* () {
      const response = yield* get('/api/arenas?lat=0&lon=east');
      assert.strictEqual(response.status, 400);
    }),
  );

  it.effect('rejects a short place query', () =>
    Effect.gen(function* () {
      const response = yield* get('/api/places?q=ab');
      assert.strictEqual(response.status, 400);
    }),
  );
});

describe('Routes under /api', () => {
  it.effect('serves the HttpApi only under the prefix', () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* get('/api/health')).status, 200);
      assert.strictEqual((yield* get('/health')).status, 404);
    }),
  );

  it.effect('serves lobby sockets under the prefix', () =>
    Effect.gen(function* () {
      // A plain GET reaches the room, which wants a WebSocket upgrade.
      assert.strictEqual((yield* get('/api/lobbies/ABCDEF/ws')).status, 426);
      assert.strictEqual((yield* get('/api/lobbies/nope/ws')).status, 400);
      assert.strictEqual((yield* get('/lobbies/ABCDEF/ws')).status, 404);
    }),
  );
});
