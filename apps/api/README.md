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

- `MapData` (`src/map-data.ts`) returns an `Arena`: buildings, roads and park/water/wood/grass areas in local metres around a centre (x east, z south), plus optional `terrain` heights. Each source reduces its data to `MapFeature`s, which `bakeFeatures` in `src/bake.ts` projects and filters to the arena (anything touching it is kept whole). The sources need an `HttpClient`; `MapData.layer` provides the fetch client.
  - `MapData.layerOpenFreeMap` (primary) reads the z14 OpenMapTiles vector tiles covering the arena from OpenFreeMap's CDN (`src/openfreemap.ts`, tile math in `src/tiles.ts`). The tile URL template comes from the TileJSON at `https://tiles.openfreemap.org/planet` on every bake, since it names the weekly planet build. Each tile is clipped to its own square, because tiles repeat geometry in a buffer past their edges; a building across a tile edge becomes two pieces.
  - `MapData.layerOverpass` (fallback) queries the volunteer-run Overpass API and bakes OSM ways.
  - `MapData.layerFallback(primary, fallback)` serves the primary and tries the fallback whenever it fails (a 15 s timeout counts as a failure).
  - `MapData.layerTerrain` adds ground heights from the `Elevation` service (`src/elevation.ts`), fetched alongside the geometry. `Elevation.layerTerrarium` bilinearly samples AWS Terrain Tiles (Terrarium PNGs at z15, decoded with `fast-png`) onto a 65 × 65 grid relative to the centre. Terrain is best-effort: any failure, or 10 s without an answer, logs a warning and bakes a flat arena with no `terrain`.
- `MapData.layerCached` decorates an upstream `MapData` so each arena is baked once and every lobby member gets identical bytes. Concurrent requests for a centre share one upstream call (Effect `Cache`, 32 entries, 1 hour); successful bakes go to an `ArenaStore` (`src/arena-store.ts`) and are served from it for 30 days (`ARENA_MAX_AGE`, checked against the stored `bakedAt` from `Clock`). Failures are never cached. Entries that no longer decode count as misses and are rebaked; storage errors fail the request.
- The cache key is `arenas/v<BAKE_VERSION>/<halfSize>/<lat>,<lon>.json` with the centre rounded to 6 decimals, as lobby clients send it. **Bump `BAKE_VERSION` in `src/bake.ts` whenever baking output changes**, and old entries stop matching.
- Per runtime: `MapData.layerBaker(store)` is the cache over terrain over OpenFreeMap-then-Overpass. `MapData.layer` (in `LocalBackends`) uses it with `ArenaStore.layerMemory`. The Worker uses `MapData.layerDurableObject`, which sends each arena to the `ArenaBaker` Durable Object named by its cache key (`src/arena-baker.ts`). That object runs the same baker with `ArenaStore.layerR2` on the `ArenaCache` R2 bucket. One object per arena gives a single-flight bake across every isolate and colo. An in-Worker `Cache` would only dedupe within one isolate, and it would share a pending promise across requests, which workerd does not allow.
- `Geocoder` (`src/geocoder.ts`) turns a place query into coordinates. `Geocoder.layerNominatim` uses OSM Nominatim (max one request per second, so not for autocomplete); `Geocoder.layer` provides the fetch client. Every outside service gets the identifying `USER_AGENT` (`src/user-agent.ts`) the OSM usage policies ask for; Overpass refuses Node's default one.

## Attribution

Arenas are made from data whose licences require visible credit wherever the map or game shows it:

- Geometry: OpenStreetMap data (ODbL) in the OpenMapTiles schema, served by OpenFreeMap. Use the credit OpenFreeMap's TileJSON publishes: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap", linking to https://openfreemap.org, https://www.openmaptiles.org/ and https://www.openstreetmap.org/copyright. The Overpass fallback is OSM data too, so the OSM credit covers it.
- Terrain: AWS Terrain Tiles (https://registry.opendata.aws/terrain-tiles/) are compiled from several sources. Their attribution page (https://github.com/tilezen/joerd/blob/master/docs/attribution.md) asks for credit to the sources used, which in the US is USGS 3DEP (public domain) and elsewhere includes SRTM, GMTED2010, ETOPO1 and national models such as EU-DEM and Geoscience Australia's. A short form is "Terrain: Mapzen/Tilezen terrain tiles from USGS 3DEP, SRTM and others".

Tests replace them with in-memory layers (`test/endpoints.test.ts`), a fake `HttpClient` (`test/map-data.test.ts`) or a counting fake upstream (`test/map-data-cache.test.ts`).
