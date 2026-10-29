import { assert, describe, it } from '@effect/vitest';
import {
  MapDataError,
  OutsideCoverage,
  RateLimited,
} from '@worldmap-paintball/api-contract';
import { Effect } from 'effect';

import { apiErrorMessage, callApi } from '../src/api-client.ts';

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

describe('apiErrorMessage', () => {
  it.effect('words a refused location the way the UI does', () =>
    Effect.gen(function* () {
      const message = yield* Effect.flip(
        Effect.tryPromise({
          try: () =>
            callApi((api) =>
              api.arenas.get({ query: { lat: 34.9249, lon: -81.0251 } }),
            ),
          catch: apiErrorMessage,
        }),
      );
      assert.strictEqual(message, 'Only North Carolina for now');
    }),
  );

  it('words rate limits and keeps other messages', () => {
    assert.strictEqual(
      apiErrorMessage(RateLimited.make({ message: 'over' })),
      'Too many requests, try again in a minute',
    );
    assert.strictEqual(
      apiErrorMessage(OutsideCoverage.make({ message: 'nope' })),
      'Only North Carolina for now',
    );
    assert.strictEqual(
      apiErrorMessage(MapDataError.make({ message: 'Overpass: down' })),
      'Overpass: down',
    );
  });
});
