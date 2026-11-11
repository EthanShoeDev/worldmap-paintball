# @worldmap-paintball/api-contract

The HttpApi contract for `@worldmap-paintball/api`: its endpoints and schemas. Clients depend on this package, never on the server, so any app can call the API with `HttpApiClient.make(Api)`.

## Coverage

`src/coverage.ts` says where arenas can be built: the 50 states and DC, each a region whose id (`us-nc`) also names its footprint packs. The outlines in `src/us-states.ts` are generated from the US Census Bureau's TIGER/Line state boundaries (public domain), which run 3 nautical miles out to sea, so coasts, sounds and barrier islands stay inside:

```sh
curl -o tmp/tl_2023_us_state.zip https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip
unzip -o -d tmp/tl_2023_us_state tmp/tl_2023_us_state.zip
bun run coverage:build
```

`scripts/build-coverage.ts` simplifies each border to within 500 m with Douglas–Peucker. Two states share a border as one arc, simplified once, so no gap opens between them. It also drops Alaska's Aleutians west of 180° (the Near and Rat Islands) so that no bounding box crosses the antimeridian. The rings are stored as encoded polylines at 1e-4°, 77 KB for the lot.
