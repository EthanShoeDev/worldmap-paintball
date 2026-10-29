import type * as Cloudflare from '@alchemy.run/cloudflare';
import { RateLimited } from '@worldmap-paintball/api-contract';
import type { RuntimeContext } from 'alchemy/RuntimeContext';
import { Clock, Context, Effect, Layer } from 'effect';

// Requests for arenas per client per window. Cached arenas are cheap too, so
// every request counts: this only has to stop scripted floods of new bakes.
// Cloudflare's binding allows a period of 10 or 60 seconds only.
export const ARENA_RATE_LIMIT = { limit: 30, period: 60 } as const;

const rateLimited = () =>
  RateLimited.make({
    message: `More than ${ARENA_RATE_LIMIT.limit} arena requests in ${ARENA_RATE_LIMIT.period} seconds`,
  });

// Counts arena requests per client key (an IP address on Cloudflare).
export class ArenaLimiter extends Context.Service<
  ArenaLimiter,
  { readonly take: (key: string) => Effect.Effect<void, RateLimited> }
>()('@worldmap-paintball/api/arena-limiter/ArenaLimiter') {
  // Fixed windows aligned to the epoch, so every key's window rolls over at
  // once and the previous window's counts can all be dropped together.
  static readonly makeMemory = ({
    limit,
    period,
  }: {
    readonly limit: number;
    readonly period: number;
  }) =>
    Layer.sync(ArenaLimiter, () => {
      const windowMs = period * 1000;
      const counts = new Map<string, number>();
      let window = Number.NaN;
      return ArenaLimiter.of({
        take: Effect.fn('ArenaLimiter.take')(function* (key: string) {
          const current = Math.floor(
            (yield* Clock.currentTimeMillis) / windowMs,
          );
          if (current !== window) {
            window = current;
            counts.clear();
          }
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          if (count > limit) return yield* rateLimited();
        }),
      });
    });

  // Single process only: the Bun dev server, Vite's dev server and tests.
  static readonly layerMemory = ArenaLimiter.makeMemory(ARENA_RATE_LIMIT);

  // Cloudflare's counters are per colo and eventually consistent, which is
  // enough to stop a flood. The client's methods are RuntimeContext-colored,
  // so this layer is built inside the Worker's init, whose context it reuses.
  static readonly layerCloudflare = (binding: Cloudflare.RateLimitClient) =>
    Layer.effect(
      ArenaLimiter,
      Effect.gen(function* () {
        const runtime = yield* Effect.context<RuntimeContext>();
        return ArenaLimiter.of({
          take: Effect.fn('ArenaLimiter.take')(function* (key: string) {
            const { success } = yield* binding.limit({ key }).pipe(
              Effect.provide(runtime),
              // A broken limiter should not take arenas down with it.
              Effect.catchTag('RateLimitError', (error) =>
                Effect.logWarning(
                  'Arena rate limit unavailable',
                  error.message,
                ).pipe(Effect.as({ success: true })),
              ),
            );
            if (!success) return yield* rateLimited();
          }),
        });
      }),
    );
}
