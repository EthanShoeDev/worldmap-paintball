import { assert, it } from '@effect/vitest';
import { Record as Rec } from 'effect';
import { OpenApi } from 'effect/http-api';

import { Api } from '../src/index.ts';

it('documents every endpoint', () => {
  assert.sameMembers(Rec.keys(OpenApi.fromApi(Api).paths), [
    '/api/health',
    '/api/greetings/{name}',
    '/api/arenas',
    '/api/places',
  ]);
});
