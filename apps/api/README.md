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
  - `MapData.layerFootprints` adds building outlines from the `BuildingFootprints` service (`src/footprints.ts`) wherever OSM has none, fetched alongside the geometry (`addFootprints` in `src/bake.ts`). OSM stays authoritative: a footprint whose bounding box overlaps an OSM building's is the same building traced a few metres off, and is dropped. Microsoft's height estimates run low for houses, so a footprint is at least 6 m tall, growing with its area to 12 m, and taller only where the estimate is. Footprints are best-effort like terrain: a failure, or 10 s without an answer, logs a warning and bakes OSM buildings alone.
  - `MapData.layerTerrain` adds ground heights from the `Elevation` service (`src/elevation.ts`), fetched alongside the geometry. `Elevation.layerTerrarium` bilinearly samples AWS Terrain Tiles (Terrarium PNGs at z15, decoded with `fast-png`) onto a 65 × 65 grid relative to the centre. Terrain is best-effort: any failure, or 10 s without an answer, logs a warning and bakes a flat arena with no `terrain`.
- `MapData.layerCached` decorates an upstream `MapData` so each arena is baked once and every lobby member gets identical bytes. Concurrent requests for a centre share one upstream call (Effect `Cache`, 32 entries, 1 hour); successful bakes go to an `ArenaStore` (`src/arena-store.ts`) and are served from it for 30 days (`ARENA_MAX_AGE`, checked against the stored `bakedAt` from `Clock`). Failures are never cached. Entries that no longer decode count as misses and are rebaked; storage errors fail the request.
- The cache key is `arenas/v<BAKE_VERSION>/<halfSize>/<lat>,<lon>.json` with the centre rounded to 6 decimals, as lobby clients send it. **Bump `BAKE_VERSION` in `src/bake.ts` whenever baking output changes**, and old entries stop matching.
- Per runtime: `MapData.layerBaker(store, footprints)` is the cache over terrain over footprints over OpenFreeMap-then-Overpass. `MapData.layer` (in `LocalBackends`) uses it with `ArenaStore.layerMemory` and `BuildingFootprints.layerLocal`. The Worker uses `MapData.layerDurableObject`, which sends each arena to the `ArenaBaker` Durable Object named by its cache key (`src/arena-baker.ts`). That object runs the same baker with `ArenaStore.layerR2` on the `ArenaCache` R2 bucket and `BuildingFootprints.layerR2` on the `BuildingFootprints` bucket. One object per arena gives a single-flight bake across every isolate and colo. An in-Worker `Cache` would only dedupe within one isolate, and it would share a pending promise across requests, which workerd does not allow.
- `Geocoder` (`src/geocoder.ts`) turns a place query into coordinates. `Geocoder.layerNominatim` uses OSM Nominatim (max one request per second, so not for autocomplete); `Geocoder.layer` provides the fetch client. Every outside service gets the identifying `USER_AGENT` (`src/user-agent.ts`) the OSM usage policies ask for; Overpass refuses Node's default one.

## Building footprints

OpenStreetMap has few buildings in rural North Carolina, so arenas there come out empty. Microsoft's GlobalMLBuildingFootprints (ODbL), traced from imagery by machine learning, fills them in. Its 2026-02 release has about 8% more US buildings than the 2021 per-state files, and height estimates for most.

- `bun run footprints:build us-nc` (`scripts/footprints/build-tiles.ts`) downloads the release's files whose z9 quadkeys touch the coverage region (cached in `tmp/footprints-source/`) and writes packs to `tmp/footprints/`, both gitignored. `--out` and `--downloads` move them; `--input <file|->` reads one GeoJSON-lines file instead, such as `unzip -p NorthCarolina.geojson.zip | bun run footprints:build us-nc --input -`. For North Carolina it takes under a minute: 5.4 M footprints in 29,887 z14 tiles, 124 MB in 163 packs.
- Layout: each footprint goes in every z14 tile its bounding box touches (readers drop the copies), so the tiles covering an arena hold everything touching it. A tile is gzipped JSON, one array per footprint: height in decimetres (0 when unknown), then the first vertex and each later vertex's delta from the one before, in microdegrees. The 256 z14 tiles of a z10 tile share a pack, `footprints/v1/<region>/10/<x>/<y>.bin`: a 2 KB header of little-endian `(offset, length)` uint32 pairs, one per tile, then the tiles. Readers fetch the header and a tile with two range reads. One object per z14 tile would be 30,000 uploads, and Cloudflare's REST API allows 1,200 requests per 5 minutes.
- `BuildingFootprints.layerDirectory(dir)` reads packs laid out by key under `dir`; `layerLocal` is it on `FOOTPRINTS_DIR` (from varlock, which is why `bun run dev` runs under `varlock run`) or `tmp/footprints/`. A missing pack is no footprints. `layerR2` reads the `BuildingFootprints` bucket, and `layerEmpty` serves tests.
- Upload: `bun run infra:deploy` creates the `BuildingFootprints` bucket (no lifecycle rule) and runs the `UploadFootprints` Action (`src/footprints-upload.ts`). The Action's input is a digest of the built manifests, so it uploads only after a rebuild, one PUT (Class A operation) per pack: 163 for North Carolina, against a free tier of 1 M a month. With nothing built, it uploads nothing.

## Attribution

Arenas are made from data whose licences require visible credit wherever the map or game shows it:

- Geometry: OpenStreetMap data (ODbL) in the OpenMapTiles schema, served by OpenFreeMap. Use the credit OpenFreeMap's TileJSON publishes: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap", linking to https://openfreemap.org, https://www.openmaptiles.org/ and https://www.openstreetmap.org/copyright. The Overpass fallback is OSM data too, so the OSM credit covers it.
- Building footprints: "Building footprints © Microsoft (ODbL)", from Microsoft's GlobalMLBuildingFootprints (https://github.com/microsoft/GlobalMLBuildingFootprints), under the Open Data Commons Open Database License.
- Terrain: AWS Terrain Tiles (https://registry.opendata.aws/terrain-tiles/) are compiled from several sources. Their attribution page (https://github.com/tilezen/joerd/blob/master/docs/attribution.md) asks for credit to the sources used, which in the US is USGS 3DEP (public domain) and elsewhere includes SRTM, GMTED2010, ETOPO1 and national models such as EU-DEM and Geoscience Australia's. A short form is "Terrain: Mapzen/Tilezen terrain tiles from USGS 3DEP, SRTM and others".

Tests replace them with in-memory layers (`test/endpoints.test.ts`), a fake `HttpClient` (`test/map-data.test.ts`) or a counting fake upstream (`test/map-data-cache.test.ts`).
