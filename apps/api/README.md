# @worldmap-paintball/api

Effect HttpApi server. `bun run dev` serves it on `$PORT` (default 3000); try `/health`, `/greetings/Ada`, `/arenas?lat=51.5074&lon=-0.1278` and `/places?q=London`.

## Map services

Handlers depend only on two services, so providers can be swapped without touching them:

- `MapData` (`src/map-data.ts`) returns an `Arena`: buildings, roads and park/water areas in local metres around a centre (x east, z south). `MapData.layerOverpass` queries the Overpass API and bakes OSM ways with the pure helpers in `src/bake.ts`; it needs an `HttpClient`. `MapData.layer` provides the fetch client.
- `MapData.layerCached` decorates an upstream `MapData` so each arena is baked once and every lobby member gets identical bytes. Concurrent requests for a centre share one upstream call (Effect `Cache`, 32 entries, 1 hour); successful bakes go to an `ArenaStore` (`src/arena-store.ts`) and are served from it for 30 days (`ARENA_MAX_AGE`, checked against the stored `bakedAt` from `Clock`). Failures are never cached. Entries that no longer decode count as misses and are rebaked; storage errors fail the request.
- The cache key is `arenas/v<BAKE_VERSION>/<halfSize>/<lat>,<lon>.json` with the centre rounded to 6 decimals, as lobby clients send it. **Bump `BAKE_VERSION` in `src/bake.ts` whenever baking output changes**, and old entries stop matching.
- Per runtime: `MapData.layer` (Bun, `src/bin.ts`) is the cache over Overpass with `ArenaStore.layerMemory`. The Worker uses `MapData.layerDurableObject`, which sends each arena to the `ArenaBaker` Durable Object named by its cache key (`src/arena-baker.ts`). That object runs the same cache over Overpass with `ArenaStore.layerR2` on the `ArenaCache` R2 bucket. One object per arena gives a single-flight bake across every isolate and colo. An in-Worker `Cache` would only dedupe within one isolate, and it would share a pending promise across requests, which workerd does not allow.
- `Geocoder` (`src/geocoder.ts`) turns a place query into coordinates. `Geocoder.layerNominatim` uses OSM Nominatim (max one request per second, so not for autocomplete); `Geocoder.layer` provides the fetch client.

Tests replace them with in-memory layers (`test/endpoints.test.ts`), a fake `HttpClient` (`test/map-data.test.ts`) or a counting fake upstream (`test/map-data-cache.test.ts`).
