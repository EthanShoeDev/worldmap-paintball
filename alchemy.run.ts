import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import { Effect, Path } from 'effect';
import { ENV } from 'varlock/env';

import Api from './apps/api/src/worker.ts';

// Credentials come from the alchemy profile, and the state store is created
// before the Stack body runs, so the profile must be checked at import time to
// keep a work account from ever being touched.
const PERSONAL_PROFILE = 'personal';
if (ENV.ALCHEMY_PROFILE !== PERSONAL_PROFILE) {
  throw new Error(
    `Refusing to run: ALCHEMY_PROFILE is '${ENV.ALCHEMY_PROFILE ?? ''}', expected '${PERSONAL_PROFILE}' (your personal Cloudflare account). Set it in .env.local.`,
  );
}

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
