# @worldmap-paintball/web

TanStack Start app. `bun run dev` to develop, `bun run build && bun run start` to preview the production build.

It serves `@worldmap-paintball/api` at `/api` (`src/routes/api.$.ts`) and deploys it. Loaders and components call it through `callApi`, and atoms through `ApiClient` and `apiRuntime` (`src/api-client.ts`): in-process while the server renders, over same-origin `fetch` in the browser.

## Development: two processes

```sh
bun run --cwd apps/api dev   # Bun, port 3000: lobby WebSockets
bun run --cwd apps/web dev   # Vite: pages and the rest of /api, in-process
```

`vite dev` serves `/api` itself through the `/api/$` route, on the API's in-memory backends (`LocalBackends`). Lobby sockets are the exception: Vite's Node server cannot hand a WebSocket upgrade to the API, so `vite.config.ts` proxies `/api/lobbies` (`ws: true`, path unchanged) to the Bun server, which serves the same `/api` routes. Without the Bun server everything but lobbies still works.

## Cloudflare: one Worker

`alchemy.run.ts` deploys `src/worker.server.ts`, the site's only Worker. Vite builds it like `Cloudflare.Website.Vite` does, from `src/worker-entry.server.ts`, and it also hosts the API's Durable Objects (`LobbyRoom`, `ArenaBaker`) and its R2 bucket (`ArenaCache`).

- `worker.server.ts` is an Effect Worker. Its init yields `CloudflareBackends` from the API package, which binds the Durable Objects and the bucket. Its `fetch` hands every request to Start (`src/site.server.ts`) after `serveApiOn(backends)`, so the `/api/$` route and server rendering's in-process calls both run on the Durable Objects.
- `worker-entry.server.ts` is what alchemy generates as the entry of Effect Workers it bundles itself: `makeWorkerBridge` as the default export and a `makeDurableObjectBridge` class per Durable Object. Add a Durable Object to `CloudflareBackends` and you must export its class here too.
- `src/cloudflare-workers.d.ts` types the bit of `cloudflare:workers` the entry uses.
