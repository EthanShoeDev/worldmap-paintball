import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import { Effect, Path } from 'effect';

import Api from './apps/api/src/worker.ts';

// The repo's one Stack. `infra:dev` runs it locally, `infra:deploy` deploys
// it; the stage defaults to dev_$USER / live_$USER. Paths are anchored to this
// file because alchemy resolves relative paths from where it runs.
export default Alchemy.Stack(
  'worldmap-paintball',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const web = yield* Cloudflare.Website.Vite('Web', {
      rootDir: path.resolve(import.meta.dirname, 'apps/web'),
    });
    const api = yield* Api;
    return {
      web: web.url,
      api: api.url,
    };
  }),
);
