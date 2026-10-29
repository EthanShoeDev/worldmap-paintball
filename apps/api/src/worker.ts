import * as Cloudflare from '@alchemy.run/cloudflare';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';

import { ArenaBaker, ArenaBakerLive } from './arena-baker.ts';
import { Geocoder } from './geocoder.ts';
import { ApiLive } from './handlers.ts';
import { LobbyRoom } from './lobby/room.ts';
import { LobbyRooms } from './lobby/rooms.ts';
import { LobbyRoutes } from './lobby/routes.ts';
import { MapData } from './map-data.ts';

export default class Api extends Cloudflare.Worker<Api>()(
  'Api',
  { main: import.meta.url },
  Effect.gen(function* () {
    // Yielding a class registers the Durable Object export and binding.
    const rooms = yield* LobbyRoom;
    const bakers = yield* ArenaBaker;
    return {
      fetch: Layer.mergeAll(ApiLive, LobbyRoutes).pipe(
        Layer.provide([
          MapData.layerDurableObject(bakers),
          Geocoder.layer,
          LobbyRooms.layerDurableObject(rooms),
          HttpServer.layerServices,
        ]),
        HttpRouter.toHttpEffect,
      ),
    };
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker definition is the entry point that hosts the ArenaBaker Durable Object
    Effect.provide(ArenaBakerLive),
  ),
) {}
