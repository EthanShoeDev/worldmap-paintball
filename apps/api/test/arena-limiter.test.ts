import { assert, describe, it } from '@effect/vitest';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';

import { ArenaLimiter } from '../src/arena-limiter.ts';

const take = (key: string) =>
  Effect.exit(ArenaLimiter.use((limiter) => limiter.take(key)));

describe('ArenaLimiter.layerMemory', () => {
  it.effect('refuses requests over the limit until the window ends', () =>
    Effect.gen(function* () {
      const first = yield* take('a');
      assert.isTrue(Exit.isSuccess(first));
      const second = yield* take('a');
      assert.isTrue(Exit.isSuccess(second));
      const over = yield* take('a');
      assert.isTrue(Exit.isFailure(over));
      // Another client has its own count.
      const other = yield* take('b');
      assert.isTrue(Exit.isSuccess(other));

      yield* TestClock.adjust('59 seconds');
      const stillOver = yield* take('a');
      assert.isTrue(Exit.isFailure(stillOver));
      yield* TestClock.adjust('1 second');
      const afterWindow = yield* take('a');
      assert.isTrue(Exit.isSuccess(afterWindow));
    }).pipe(Effect.provide(ArenaLimiter.makeMemory({ limit: 2, period: 60 }))),
  );

  it.effect('fails with RateLimited', () =>
    Effect.gen(function* () {
      const limiter = yield* ArenaLimiter;
      yield* limiter.take('a');
      const error = yield* Effect.flip(limiter.take('a'));
      assert.strictEqual(error._tag, 'RateLimited');
    }).pipe(Effect.provide(ArenaLimiter.makeMemory({ limit: 1, period: 10 }))),
  );
});
