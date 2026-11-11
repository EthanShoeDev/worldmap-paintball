import type * as Cloudflare from '@alchemy.run/cloudflare';
import {
  type Arena,
  type ArenaLayer,
  MapDataError,
} from '@worldmap-paintball/api-contract';
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
  String as Str,
} from 'effect';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';

import type { ArenaBaker } from './arena-baker.ts';
import { ArenaStore } from './arena-store.ts';
import {
  addFootprints,
  BAKE_VERSION,
  bakeArena,
  bakeFeatures,
  bounds,
  type LatLon,
} from './bake.ts';
import { Elevation } from './elevation.ts';
import { BuildingFootprints } from './footprints.ts';
import {
  decodeTileFeatures,
  OPENFREEMAP_URL,
  OPENFREEMAP_ZOOM,
  TileJson,
} from './openfreemap.ts';
import {
  OVERPASS_URL,
  OverpassResponse,
  overpassQuery,
  overpassWays,
} from './overpass.ts';
import { fetchTile, tilesCovering, tileUrl } from './tiles.ts';
import { USER_AGENT } from './user-agent.ts';

export const HALF_SIZE = 150;

// An arena centre and, when not the default, its half size in metres; and
// optionally one bake of it to serve again (see `layerCached`).
export interface ArenaRequest extends LatLon {
  readonly halfSize?: number;
  readonly bake?: string;
}

const halfSizeOf = (request: ArenaRequest) => request.halfSize ?? HALF_SIZE;

// Durable bakes are served for 30 days. A game arena does not need the
// latest OSM edits, but a month bounds how long a bad or outdated bake lives
// and keeps the load on the free map services at one bake per arena per month.
export const ARENA_MAX_AGE = Duration.days(30);

// The in-memory tier only absorbs bursts (a lobby starting a match), so it is
// small and short-lived; the durable store holds everything else.
const MEMORY_CAPACITY = 32;
const MEMORY_TTL = Duration.hours(1);

// A source that hangs must still leave time for the fallback, and terrain and
// footprints are optional, so none may hold the bake up for long.
const SOURCE_TIMEOUT = Duration.seconds(15);
const TERRAIN_TIMEOUT = Duration.seconds(10);
const FOOTPRINTS_TIMEOUT = Duration.seconds(10);

// A bake missing an optional layer (`missing`) is served without it but never
// stored, and the next request after a minute tries again: Terrarium covers
// the whole world and a region without footprints is an empty success, so a
// missing layer is always a transient failure, not the place.
const DEGRADED_TTL = Duration.minutes(1);

// Stored bakes from before `missing` existed lack terrain without saying so.
const isComplete = (arena: Arena) =>
  arena.terrain !== undefined && (arena.missing ?? []).length === 0;

const withMissing = <A extends Arena>(arena: A, layer: ArenaLayer): A => ({
  ...arena,
  missing: [...(arena.missing ?? []), layer],
});

const isMapDataError = Schema.is(MapDataError);

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

// Six decimals (~11 cm) is what lobby clients send, so every member's request
// lands on one key and every member gets the same bake. The default half size
// is left out, so either spelling of it shares one key.
export const normalizeCenter = (center: ArenaRequest): ArenaRequest => {
  const halfSize = halfSizeOf(center);
  return {
    lat: round6(center.lat),
    lon: round6(center.lon),
    ...(halfSize !== HALF_SIZE && { halfSize }),
    ...(center.bake !== undefined && { bake: center.bake }),
  };
};

// Where a partial bake is kept, so a lobby that pinned it can get it again.
// Complete bakes live at the arena's own key.
export const pinnedKey = (key: string, bake: string) =>
  Str.replace(/\.json$/, `@${bake}.json`)(key);

// Durable cache key for a normalised centre. The bake version and half size
// are part of it, so changing either makes old entries unreachable (they then
// age out of the bucket via its lifecycle rule).
export const arenaKey = (
  center: LatLon,
  halfSize = HALF_SIZE,
  version = BAKE_VERSION,
) =>
  `arenas/v${version}/${halfSize}/${center.lat.toFixed(6)},${center.lon.toFixed(6)}.json`;

// Any source of real-world map data (OpenFreeMap, Overpass, a cache)
// provides this, so handlers never depend on a specific provider.
export class MapData extends Context.Service<
  MapData,
  {
    readonly arena: (
      request: ArenaRequest,
    ) => Effect.Effect<Arena, MapDataError>;
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
        function* (center: ArenaRequest) {
          yield* Effect.annotateCurrentSpan({ ...center });
          yield* Effect.log('Querying Overpass', center);
          const response = yield* HttpClientRequest.post(OVERPASS_URL).pipe(
            HttpClientRequest.setHeader('User-Agent', USER_AGENT),
            HttpClientRequest.bodyUrlParams({
              data: overpassQuery(center, halfSizeOf(center)),
            }),
            client.execute,
            Effect.flatMap(HttpClientResponse.schemaBodyJson(OverpassResponse)),
          );
          return bakeArena(center, halfSizeOf(center), overpassWays(response));
        },
        Effect.mapError((cause) =>
          MapDataError.make({ message: `Overpass: ${cause.message}` }),
        ),
      );

      return MapData.of({ arena });
    }),
  );

  // OpenMapTiles vector tiles from OpenFreeMap's CDN: no query server, so no
  // rate limits or outages under load, and the data is a weekly OSM import.
  static readonly layerOpenFreeMap = Layer.effect(
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
        function* (center: ArenaRequest) {
          yield* Effect.annotateCurrentSpan({ ...center });
          yield* Effect.log('Fetching OpenFreeMap tiles', center);
          const {
            tiles: [template],
          } = yield* HttpClientRequest.get(OPENFREEMAP_URL).pipe(
            HttpClientRequest.setHeader('User-Agent', USER_AGENT),
            HttpClientRequest.acceptJson,
            client.execute,
            Effect.flatMap(HttpClientResponse.schemaBodyJson(TileJson)),
          );
          const features = yield* Effect.forEach(
            tilesCovering(bounds(center, halfSizeOf(center)), OPENFREEMAP_ZOOM),
            (tile) =>
              fetchTile(
                client,
                tileUrl(template, tile),
                decodeTileFeatures(tile),
              ),
            { concurrency: 'unbounded' },
          );
          return bakeFeatures(center, halfSizeOf(center), features.flat());
        },
        Effect.timeout(SOURCE_TIMEOUT),
        Effect.mapError((cause) =>
          MapDataError.make({ message: `OpenFreeMap: ${cause.message}` }),
        ),
      );

      return MapData.of({ arena });
    }),
  );

  // Serves `primary`, and `fallback` whenever primary fails.
  static readonly layerFallback = <E1, R1, E2, R2>(
    primary: Layer.Layer<MapData, E1, R1>,
    fallback: Layer.Layer<MapData, E2, R2>,
  ) =>
    Layer.effect(
      MapData,
      Effect.gen(function* () {
        const primaryContext = yield* Layer.build(primary);
        const first = Context.get(primaryContext, MapData);
        const fallbackContext = yield* Layer.build(fallback);
        const second = Context.get(fallbackContext, MapData);
        return MapData.of({
          arena: (center) =>
            first.arena(center).pipe(
              Effect.catch((error) =>
                Effect.logWarning('Falling back', error.message).pipe(
                  Effect.andThen(second.arena(center)),
                  Effect.mapError((fallbackError) =>
                    MapDataError.make({
                      message: `${error.message}; ${fallbackError.message}`,
                    }),
                  ),
                ),
              ),
            ),
        });
      }),
    );

  // Decorates an upstream MapData with ground heights from Elevation,
  // fetched alongside the geometry. Terrain is best-effort: without it the
  // arena is flat, which beats no arena.
  static readonly layerTerrain = Layer.effect(
    MapData,
    Effect.gen(function* () {
      const upstream = yield* MapData;
      const elevation = yield* Elevation;

      const arena = Effect.fn('MapData.arenaWithTerrain')(function* (
        center: ArenaRequest,
      ) {
        const [geometry, terrain] = yield* Effect.all(
          [
            upstream.arena(center),
            elevation.terrain(center, halfSizeOf(center)).pipe(
              Effect.timeout(TERRAIN_TIMEOUT),
              Effect.tapError((error) =>
                Effect.logWarning('Baking without terrain', error.message),
              ),
              Effect.option,
            ),
          ],
          { concurrency: 'unbounded' },
        );
        return Option.match(terrain, {
          onNone: () => withMissing(geometry, 'terrain'),
          onSome: (heights) => ({ ...geometry, terrain: heights }),
        });
      });

      return MapData.of({ arena });
    }),
  );

  // Decorates an upstream MapData with BuildingFootprints wherever its
  // buildings leave gaps (`addFootprints`), fetched alongside the geometry.
  // Best-effort like terrain: without them the arena has only OSM buildings.
  static readonly layerFootprints = Layer.effect(
    MapData,
    Effect.gen(function* () {
      const upstream = yield* MapData;
      const source = yield* BuildingFootprints;

      const arena = Effect.fn('MapData.arenaWithFootprints')(function* (
        center: ArenaRequest,
      ) {
        const [geometry, footprints] = yield* Effect.all(
          [
            upstream.arena(center),
            source.footprints(bounds(center, halfSizeOf(center))).pipe(
              Effect.timeout(FOOTPRINTS_TIMEOUT),
              Effect.tapError((error) =>
                Effect.logWarning(
                  'Baking without building footprints',
                  error.message,
                ),
              ),
              Effect.option,
            ),
          ],
          { concurrency: 'unbounded' },
        );
        return Option.match(footprints, {
          onNone: () => withMissing(geometry, 'footprints'),
          onSome: (found) => addFootprints(geometry, found),
        });
      });

      return MapData.of({ arena });
    }),
  );

  // Decorates an upstream MapData: concurrent requests for one centre share
  // a single bake, and successful bakes are kept in memory and in the
  // ArenaStore. Failures are never cached, so the next request retries.
  // Every bake gets an id (`bake`). A bake missing a layer is the latest one
  // for a minute only, so asking again then bakes afresh, but it is stored
  // under its id, so a lobby that pinned it keeps getting it.
  static readonly layerCached = Layer.effect(
    MapData,
    Effect.gen(function* () {
      const upstream = yield* MapData;
      const store = yield* ArenaStore;
      const maxAge = Duration.toMillis(ARENA_MAX_AGE);

      const bake = Effect.fn('MapData.bake')(
        function* ({ bake: pin, ...center }: ArenaRequest) {
          const key = arenaKey(center, halfSizeOf(center));
          const stored = yield* store.get(key);
          if (pin !== undefined) {
            if (Option.isSome(stored) && stored.value.arena.bake === pin) {
              return stored.value.arena;
            }
            const pinned = yield* store.get(pinnedKey(key, pin));
            if (Option.isSome(pinned)) return pinned.value.arena;
            // Gone (expired, or from an older bake version): the latest.
          }
          const now = yield* Clock.currentTimeMillis;
          if (
            Option.isSome(stored) &&
            now - stored.value.bakedAt < maxAge &&
            isComplete(stored.value.arena)
          ) {
            return stored.value.arena;
          }
          const baked = yield* upstream.arena(center);
          const bakedAt = yield* Clock.currentTimeMillis;
          const arena = { ...baked, bake: bakedAt.toString(36) };
          yield* store.put(
            isComplete(arena) ? key : pinnedKey(key, arena.bake),
            { bakedAt, arena },
          );
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
        timeToLive: (exit) => {
          if (Exit.isFailure(exit)) return Duration.zero;
          return isComplete(exit.value) ? MEMORY_TTL : DEGRADED_TTL;
        },
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
            .getByName(arenaKey(normalized, halfSizeOf(normalized)))
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

  // Bakes once per centre from OpenFreeMap (Overpass if that fails) plus
  // `footprints`, with Terrarium terrain, cached in memory and durably in
  // `store` (memory under Bun, R2 inside the ArenaBaker Durable Object).
  static readonly layerBaker = <R1, R2>(
    store: Layer.Layer<ArenaStore, never, R1>,
    footprints: Layer.Layer<BuildingFootprints, never, R2>,
  ) =>
    MapData.layerCached.pipe(
      Layer.provide([MapData.layerTerrain, store]),
      Layer.provide([MapData.layerFootprints, Elevation.layerTerrarium]),
      Layer.provide([
        MapData.layerFallback(MapData.layerOpenFreeMap, MapData.layerOverpass),
        footprints,
      ]),
      Layer.provide(FetchHttpClient.layer),
    );

  // The Bun and Vite dev servers: a single process, so memory is the durable
  // tier, and footprints come from a local directory.
  static readonly layer = MapData.layerBaker(
    ArenaStore.layerMemory,
    BuildingFootprints.layerLocal,
  );
}
