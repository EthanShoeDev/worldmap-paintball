import * as Cloudflare from '@alchemy.run/cloudflare';
import { Context, Duration, Effect, Layer } from 'effect';

import { type Arena, MapDataError } from './api.ts';
import { ArenaStore } from './arena-store.ts';
import type { LatLon } from './bake.ts';
import { ARENA_MAX_AGE, MapData } from './map-data.ts';

interface ArenaBakerShape {
  readonly arena: (center: LatLon) => Effect.Effect<Arena, MapDataError>;
}

// One object per arena cache key (`MapData.layerDurableObject` names it), so
// every Worker isolate in every colo funnels a given arena through a single
// instance: its in-memory Cache makes concurrent misses share one Overpass
// query, and R2 keeps the result for later instances.
export class ArenaBaker extends Cloudflare.DurableObject<
  ArenaBaker,
  ArenaBakerShape
>()('ArenaBaker', { errors: [MapDataError] }) {}

// The contents are a disposable cache, so teardown may empty the bucket. The
// lifecycle rule (expiry plus a day) only reclaims space: expired and
// old-BAKE_VERSION objects are already misses, and R2 deletes lazily.
export const ArenaCache = Cloudflare.R2.Bucket('ArenaCache', {
  forceDestroy: true,
  lifecycleRules: [
    {
      id: 'expire-baked-arenas',
      deleteObjectsTransition: {
        condition: {
          type: 'Age',
          maxAge: Duration.toSeconds(
            Duration.sum(ARENA_MAX_AGE, Duration.days(1)),
          ),
        },
      },
    },
  ],
});

// alchemy's PlatformServices imports `effect/Crypto`, which effect 4.1 does not
// ship, so DurableObjectServices is `any` and `make` would leak `any` into the
// Worker's requirements. The annotation states the real ones.
// oxlint-disable-next-line typescript/no-unsafe-assignment -- see above: the inferred requirement type is `any`
export const ArenaBakerLive: Layer.Layer<
  ArenaBaker,
  never,
  Cloudflare.Worker | Cloudflare.Providers
> = ArenaBaker.make(
  ArenaCache.pipe(
    Effect.flatMap(Cloudflare.R2.ReadWriteBucket),
    Effect.map((bucket) =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          MapData.layerBaker(ArenaStore.layerR2(bucket)),
        );
        const mapData = Context.get(context, MapData);
        return { arena: mapData.arena };
      }),
    ),
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Durable Object definition is an entry point; alchemy's examples provide bindings here
    Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
  ),
);
