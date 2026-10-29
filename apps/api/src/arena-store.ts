import type * as Cloudflare from '@alchemy.run/cloudflare';
import { Arena } from '@worldmap-paintball/api-contract';
import type { RuntimeContext } from 'alchemy/RuntimeContext';
import { Context, Effect, Layer, Option, Schema } from 'effect';

// `bakedAt` is epoch milliseconds from `Clock`, so expiry is testable.
export const StoredArena = Schema.Struct({
  bakedAt: Schema.Finite,
  arena: Arena,
});

export type StoredArena = typeof StoredArena.Type;

const StoredArenaJson = Schema.fromJsonString(StoredArena);
const encodeStoredArena = Schema.encodeEffect(StoredArenaJson);
const decodeStoredArena = Schema.decodeUnknownEffect(StoredArenaJson);

export class ArenaStoreError extends Schema.TaggedError<
  ArenaStoreError,
  { readonly brand: unique symbol }
>()('ArenaStoreError', { message: Schema.String }) {}

export interface TextStore {
  readonly read: (
    key: string,
  ) => Effect.Effect<string | undefined, ArenaStoreError>;
  readonly write: (
    key: string,
    text: string,
  ) => Effect.Effect<void, ArenaStoreError>;
}

// Durable tier behind `MapData.layerCached`: process memory under Bun and in
// tests, R2 on Cloudflare. Entries cross the boundary as encoded JSON text.
export class ArenaStore extends Context.Service<
  ArenaStore,
  {
    readonly get: (
      key: string,
    ) => Effect.Effect<Option.Option<StoredArena>, ArenaStoreError>;
    readonly put: (
      key: string,
      entry: StoredArena,
    ) => Effect.Effect<void, ArenaStoreError>;
  }
>()('@worldmap-paintball/api/arena-store/ArenaStore') {
  // An entry that no longer decodes (corrupt, or written under an older
  // schema) is a miss and gets rebaked; storage failures still propagate.
  static readonly fromText = (store: TextStore) =>
    ArenaStore.of({
      get: Effect.fn('ArenaStore.get')(function* (key: string) {
        const text = yield* store.read(key);
        if (text === undefined) return Option.none();
        return yield* decodeStoredArena(text).pipe(
          Effect.asSome,
          Effect.catchTag('SchemaError', (error) =>
            Effect.logWarning(
              'Discarding unreadable stored arena',
              key,
              error,
            ).pipe(Effect.as(Option.none())),
          ),
        );
      }),
      put: Effect.fn('ArenaStore.put')(function* (
        key: string,
        entry: StoredArena,
      ) {
        // The entry is already typed as StoredArena, so failing to encode it
        // is a bug, not a storage condition.
        const text = yield* encodeStoredArena(entry).pipe(Effect.orDie);
        yield* store.write(key, text);
      }),
    });

  // Single process only: lost on restart, not shared between instances.
  static readonly layerMemory = Layer.sync(ArenaStore, () => {
    const texts = new Map<string, string>();
    return ArenaStore.fromText({
      read: (key) => Effect.sync(() => texts.get(key)),
      write: (key, text) => Effect.sync(() => void texts.set(key, text)),
    });
  });

  // The bucket's client methods are RuntimeContext-colored, so this layer is
  // built inside a Durable Object's runtime phase, whose context it reuses.
  static readonly layerR2 = (bucket: Cloudflare.R2.ReadWriteBucketClient) =>
    Layer.effect(
      ArenaStore,
      Effect.gen(function* () {
        const runtime = yield* Effect.context<RuntimeContext>();
        const r2Error = (error: Cloudflare.R2.R2Error) =>
          ArenaStoreError.make({ message: `R2: ${error.message}` });
        return ArenaStore.fromText({
          read: (key) =>
            bucket.get(key).pipe(
              Effect.flatMap((object) =>
                object === null ? Effect.undefined : object.text(),
              ),
              Effect.mapError(r2Error),
              Effect.provide(runtime),
            ),
          write: (key, text) =>
            bucket
              .put(key, text, {
                httpMetadata: { contentType: 'application/json' },
              })
              .pipe(
                Effect.asVoid,
                Effect.mapError(r2Error),
                Effect.provide(runtime),
              ),
        });
      }),
    );
}
