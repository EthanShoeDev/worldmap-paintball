import type * as Cloudflare from '@alchemy.run/cloudflare';
import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Schedule,
  Schema,
} from 'effect';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';

import { type Arena, MapDataError } from './api.ts';
import type { ArenaBaker } from './arena-baker.ts';
import { ArenaStore } from './arena-store.ts';
import { BAKE_VERSION, bakeArena, type LatLon } from './bake.ts';
import {
  OVERPASS_URL,
  OverpassResponse,
  overpassQuery,
  overpassWays,
} from './overpass.ts';

export const HALF_SIZE = 150;

// Durable bakes are served for 30 days. A game arena does not need the
// latest OSM edits, but a month bounds how long a bad or outdated bake lives
// and keeps the load on Overpass at one query per arena per month.
export const ARENA_MAX_AGE = Duration.days(30);

// The in-memory tier only absorbs bursts (a lobby starting a match), so it is
// small and short-lived; the durable store holds everything else.
const MEMORY_CAPACITY = 32;
const MEMORY_TTL = Duration.hours(1);

const isMapDataError = Schema.is(MapDataError);

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

// Six decimals (~11 cm) is what lobby clients send, so every member's request
// lands on one key and every member gets the same bake.
export const normalizeCenter = (center: LatLon): LatLon => ({
  lat: round6(center.lat),
  lon: round6(center.lon),
});

// Durable cache key for a normalised centre. The bake version and half size
// are part of it, so changing either makes old entries unreachable (they then
// age out of the bucket via its lifecycle rule).
export const arenaKey = (
  center: LatLon,
  halfSize = HALF_SIZE,
  version = BAKE_VERSION,
) =>
  `arenas/v${version}/${halfSize}/${center.lat.toFixed(6)},${center.lon.toFixed(6)}.json`;

// Any source of real-world map data (Overpass, Overture, PMTiles, a cache)
// provides this, so handlers never depend on a specific provider.
export class MapData extends Context.Service<
  MapData,
  {
    readonly arena: (center: LatLon) => Effect.Effect<Arena, MapDataError>;
  }
>()('@worldmap-paintball/api/map-data/MapData') {
  static readonly layerOverpass = Layer.effect(
    MapData,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({
          schedule: Schedule.exponential(500),
          times: 2,
        }),
      );

      const arena = Effect.fn('MapData.arena')(
        function* (center: LatLon) {
          yield* Effect.annotateCurrentSpan({ ...center });
          yield* Effect.log('Querying Overpass', center);
          const response = yield* HttpClientRequest.post(OVERPASS_URL).pipe(
            HttpClientRequest.bodyUrlParams({
              data: overpassQuery(center, HALF_SIZE),
            }),
            client.execute,
            Effect.flatMap(HttpClientResponse.schemaBodyJson(OverpassResponse)),
          );
          return bakeArena(center, HALF_SIZE, overpassWays(response));
        },
        Effect.mapError((cause) =>
          MapDataError.make({ message: `Overpass: ${cause.message}` }),
        ),
      );

      return MapData.of({ arena });
    }),
  );

  // Decorates an upstream MapData: concurrent requests for one centre share
  // a single bake, and successful bakes are kept in memory and in the
  // ArenaStore. Failures are never cached, so the next request retries.
  static readonly layerCached = Layer.effect(
    MapData,
    Effect.gen(function* () {
      const upstream = yield* MapData;
      const store = yield* ArenaStore;
      const maxAge = Duration.toMillis(ARENA_MAX_AGE);

      const bake = Effect.fn('MapData.bake')(
        function* (center: LatLon) {
          const key = arenaKey(center);
          const stored = yield* store.get(key);
          const now = yield* Clock.currentTimeMillis;
          if (Option.isSome(stored) && now - stored.value.bakedAt < maxAge) {
            return stored.value.arena;
          }
          const arena = yield* upstream.arena(center);
          const bakedAt = yield* Clock.currentTimeMillis;
          yield* store.put(key, { bakedAt, arena });
          return arena;
        },
        Effect.catchTag('ArenaStoreError', (error) =>
          Effect.fail(
            MapDataError.make({ message: `Arena store: ${error.message}` }),
          ),
        ),
      );

      const cache = yield* Cache.makeWith(bake, {
        capacity: MEMORY_CAPACITY,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) ? MEMORY_TTL : Duration.zero,
      });

      return MapData.of({
        arena: (center) => Cache.get(cache, normalizeCenter(center)),
      });
    }),
  );

  // Routes every request for an arena to the one ArenaBaker object named by
  // its cache key, which dedupes and stores bakes for every Worker isolate.
  static readonly layerDurableObject = (
    bakers: Cloudflare.DurableObject<ArenaBaker>,
  ) =>
    Layer.succeed(
      MapData,
      MapData.of({
        arena: (center) => {
          const normalized = normalizeCenter(center);
          return bakers
            .getByName(arenaKey(normalized))
            .arena(normalized)
            .pipe(
              // The stub's type omits transport failures (RpcCallError).
              Effect.mapError((error: unknown) =>
                isMapDataError(error)
                  ? error
                  : MapDataError.make({
                      message: `ArenaBaker: ${String(error)}`,
                    }),
              ),
            );
        },
      }),
    );

  // Bakes once per centre over Overpass, cached in memory and durably in
  // `store` (memory under Bun, R2 inside the ArenaBaker Durable Object).
  static readonly layerBaker = <R>(store: Layer.Layer<ArenaStore, never, R>) =>
    MapData.layerCached.pipe(
      Layer.provide([MapData.layerOverpass, store]),
      Layer.provide(FetchHttpClient.layer),
    );

  // The Bun dev server: a single process, so memory is the durable tier.
  static readonly layer = MapData.layerBaker(ArenaStore.layerMemory);
}
