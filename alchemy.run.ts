import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import { Effect } from 'effect';
import { ENV } from 'varlock/env';

import Web from './apps/web/src/worker.server.ts';

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
// it; the stage defaults to dev_$USER / live_$USER. The site's Worker also
// serves the API and hosts its Durable Objects (apps/web/src/worker.server.ts).
export default Alchemy.Stack(
  'worldmap-paintball',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const web = yield* Web;
    return { web: web.url };
  }),
);
