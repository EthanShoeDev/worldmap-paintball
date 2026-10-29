# @worldmap-paintball/api

Effect HttpApi. Every route is under `/api`: the HttpApi (`.prefix('/api')` in `src/api.ts`) and the lobby sockets at `/api/lobbies/:code/ws` (`src/lobby/routes.ts`). `ApiRoutes` (`src/handlers.ts`) is both, and needs three services, `ApiBackends`: `MapData`, `Geocoder` and `LobbyRooms`.

The web app serves and deploys this API; it has no Worker of its own (see `apps/web/README.md`). `bun run dev` also serves it standalone with Bun on `$PORT` (default 3000), which `vite dev` needs for lobby sockets; try `/api/health`, `/api/greetings/Ada`, `/api/arenas?lat=51.5074&lon=-0.1278` and `/api/places?q=London`.

| Backends | Where | Services |
| --- | --- | --- |
| `LocalBackends` (`src/handlers.ts`) | the Bun server (`src/bin.ts`), Vite's dev server, tests | `MapData.layer`, `Geocoder.layer`, `LobbyRooms.layerMemory` |
| `CloudflareBackends` (`src/cloudflare.ts`) | the site's Worker | `MapData.layerDurableObject`, `Geocoder.layer`, `LobbyRooms.layerDurableObject`, on the `ArenaBaker` and `LobbyRoom` Durable Objects |

`CloudflareBackends` is an Effect, not a Layer: it yields the Durable Object classes, so it must run inside the init of the Worker that hosts them.

## Map services

Handlers depend only on two services, so providers can be swapped without touching them:

- `MapData` (`src/map-data.ts`) returns an `Arena`: buildings, roads and park/water areas in local metres around a centre (x east, z south). `MapData.layerOverpass` queries the Overpass API and bakes OSM ways with the pure helpers in `src/bake.ts`; it needs an `HttpClient`. `MapData.layer` provides the fetch client.
- `MapData.layerCached` decorates an upstream `MapData` so each arena is baked once and every lobby member gets identical bytes. Concurrent requests for a centre share one upstream call (Effect `Cache`, 32 entries, 1 hour); successful bakes go to an `ArenaStore` (`src/arena-store.ts`) and are served from it for 30 days (`ARENA_MAX_AGE`, checked against the stored `bakedAt` from `Clock`). Failures are never cached. Entries that no longer decode count as misses and are rebaked; storage errors fail the request.
- The cache key is `arenas/v<BAKE_VERSION>/<halfSize>/<lat>,<lon>.json` with the centre rounded to 6 decimals, as lobby clients send it. **Bump `BAKE_VERSION` in `src/bake.ts` whenever baking output changes**, and old entries stop matching.
- Per runtime: `MapData.layer` (in `LocalBackends`) is the cache over Overpass with `ArenaStore.layerMemory`. The Worker uses `MapData.layerDurableObject`, which sends each arena to the `ArenaBaker` Durable Object named by its cache key (`src/arena-baker.ts`). That object runs the same cache over Overpass with `ArenaStore.layerR2` on the `ArenaCache` R2 bucket. One object per arena gives a single-flight bake across every isolate and colo. An in-Worker `Cache` would only dedupe within one isolate, and it would share a pending promise across requests, which workerd does not allow.
- `Geocoder` (`src/geocoder.ts`) turns a place query into coordinates. `Geocoder.layerNominatim` uses OSM Nominatim (max one request per second, so not for autocomplete); `Geocoder.layer` provides the fetch client. Both OSM services get the identifying `USER_AGENT` (`src/user-agent.ts`) their usage policies ask for; Overpass refuses Node's default one.

Tests replace them with in-memory layers (`test/endpoints.test.ts`), a fake `HttpClient` (`test/map-data.test.ts`) or a counting fake upstream (`test/map-data-cache.test.ts`).
