import { Effect, Layer } from 'effect';

import { ArenaBaker, ArenaBakerLive } from './arena-baker.ts';
import { Geocoder } from './geocoder.ts';
import { LobbyRoom } from './lobby/room.ts';
import { LobbyRooms } from './lobby/rooms.ts';
import { MapData } from './map-data.ts';

// The services ApiRoutes runs on in a Cloudflare Worker, backed by the
// API's Durable Objects. Yield it inside the init of the Worker that serves
// the API: yielding the object classes registers their exports and bindings
// on that Worker.
export const CloudflareBackends = Effect.gen(function* () {
  const rooms = yield* LobbyRoom;
  const bakers = yield* ArenaBaker;
  return Layer.mergeAll(
    MapData.layerDurableObject(bakers),
    Geocoder.layer,
    LobbyRooms.layerDurableObject(rooms),
  );
}).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker init that yields this hosts the ArenaBaker Durable Object
  Effect.provide(ArenaBakerLive),
);
