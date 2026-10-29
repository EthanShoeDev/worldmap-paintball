import * as Cloudflare from '@alchemy.run/cloudflare';
import { CloudflareBackends } from '@worldmap-paintball/api/cloudflare';
import { Effect, Path } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';

// The site's one Worker: Start's pages and its /api/$ route, plus the API's
// Durable Objects. `vite` builds it the way Cloudflare.Website.Vite does, from
// the entry in worker-entry.server.ts. alchemy.run.ts deploys this class and
// the entry runs it, so it must not import Start's server bundle itself.
export default class Web extends Cloudflare.Worker<Web>()(
  'Web',
  Effect.map(Effect.service(Path.Path), (path) => ({
    vite: {
      rootDir: path.resolve(import.meta.dirname, '..'),
      main: 'src/worker-entry.server.ts',
    },
  })),
  Effect.gen(function* () {
    const backends = yield* CloudflareBackends;
    return {
      fetch: Effect.gen(function* () {
        // dynamic-import -- Start's server entry only resolves inside the Vite build, and alchemy.run.ts imports this module outside it
        const site = yield* Effect.promise(() => import('./site.server.ts'));
        // On workerd the request wraps a native Request, so this cannot fail.
        const request = yield* HttpServerRequest.toWeb(
          yield* HttpServerRequest.HttpServerRequest,
        ).pipe(Effect.orDie);
        const response = yield* Effect.promise(() =>
          site.serve(request, backends),
        );
        // Passed through untouched, so a lobby's 101 keeps its WebSocket.
        return HttpServerResponse.raw(response, { status: response.status });
      }),
    };
  }),
) {}
