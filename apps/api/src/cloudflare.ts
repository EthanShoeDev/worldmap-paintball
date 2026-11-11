import * as Cloudflare from '@alchemy.run/cloudflare';
import { RuntimeContext } from 'alchemy/RuntimeContext';
import { Effect, Layer } from 'effect';

import { ArenaBaker, ArenaBakerLive } from './arena-baker.ts';
import { ARENA_RATE_LIMIT, ArenaLimiter } from './arena-limiter.ts';
import { Geocoder } from './geocoder.ts';
import { LobbyRoom } from './lobby/room.ts';
import { LobbyRooms } from './lobby/rooms.ts';
import { MapData } from './map-data.ts';

// The services ApiRoutes runs on in a Cloudflare Worker, backed by the
// API's Durable Objects and a rate limit binding. Yield it inside the init of
// the Worker that serves the API: yielding the object classes and the binding
// registers their exports and bindings on that Worker.
export const CloudflareBackends = Effect.gen(function* () {
  const rooms = yield* LobbyRoom;
  const bakers = yield* ArenaBaker;
  const arenaLimit = yield* Cloudflare.RateLimit('ARENA_RATE_LIMIT', {
    // Unique per account; counters are shared by every Worker using it.
    namespaceId: 1001,
    simple: ARENA_RATE_LIMIT,
  });
  const runtime = yield* Effect.context<RuntimeContext>();
  return Layer.mergeAll(
    MapData.layerDurableObject(bakers),
    Geocoder.layer,
    LobbyRooms.layerDurableObject(rooms),
    ArenaLimiter.layerCloudflare(arenaLimit).pipe(
      Layer.provide(Layer.succeedContext(runtime)),
    ),
  );
}).pipe(
  Effect.provide([
    ArenaBakerLive,
    Cloudflare.RateLimitBinding,
    // A Worker's init always runs with RuntimeContext, but alchemy's Worker
    // types do not admit it as an init requirement; phantom only erases it.
    RuntimeContext.phantom,
  ]),
);
