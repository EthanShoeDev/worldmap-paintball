import * as Cloudflare from '@alchemy.run/cloudflare';
import { type Arena, MapDataError } from '@worldmap-paintball/api-contract';
import { Context, Duration, Effect, Layer } from 'effect';

import { ArenaStore } from './arena-store.ts';
import { BuildingFootprints } from './footprints.ts';
import { ARENA_MAX_AGE, type ArenaRequest, MapData } from './map-data.ts';

interface ArenaBakerShape {
  readonly arena: (request: ArenaRequest) => Effect.Effect<Arena, MapDataError>;
}

// One object per arena cache key (`MapData.layerDurableObject` names it), so
// every Worker isolate in every colo funnels a given arena through a single
// instance: its in-memory Cache makes concurrent misses share one bake, and
// R2 keeps the result for later instances.
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

// Footprint packs from `bun run footprints:build`, uploaded on deploy by the
// UploadFootprints Action (src/footprints-upload.ts). They are rebuilt from
// Microsoft's release rather than expired, and teardown may empty them.
export const FootprintsBucket = Cloudflare.R2.Bucket('BuildingFootprints', {
  forceDestroy: true,
});

export const ArenaBakerLive = ArenaBaker.make(
  Effect.all([
    Cloudflare.R2.ReadWriteBucket(ArenaCache),
    Cloudflare.R2.ReadBucket(FootprintsBucket),
  ]).pipe(
    Effect.map(([cache, footprints]) =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          MapData.layerBaker(
            ArenaStore.layerR2(cache),
            BuildingFootprints.layerR2(footprints),
          ),
        );
        const mapData = Context.get(context, MapData);
        return { arena: mapData.arena };
      }),
    ),
    Effect.provide([
      Cloudflare.R2.ReadWriteBucketBinding,
      Cloudflare.R2.ReadBucketBinding,
    ]),
  ),
);
