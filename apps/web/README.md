# @worldmap-paintball/web

TanStack Start app. `bun run dev` to develop, `bun run build && bun run start` to preview the production build.

The web app calls the API at `/api`. In development, Vite proxies `/api/*` to the API dev server on `http://localhost:3000` (start it with `bun run --cwd apps/api dev`) and strips the prefix.

Follow-up: production has no `/api` route yet. The deployed Website and API Worker need a shared origin (a route or a Worker forwarding `/api`), or a configurable API base URL.
