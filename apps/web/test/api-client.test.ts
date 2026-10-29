import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import { callApi } from '../src/api-client.ts';

describe('callApi', () => {
  it.effect('reaches the API in-process outside the browser', () =>
    Effect.gen(function* () {
      const greeting = yield* Effect.promise(() =>
        callApi((api) => api.greetings.greet({ params: { name: 'Ada' } })),
      );
      assert.strictEqual(greeting.message, 'Hello, Ada!');
    }),
  );
});
