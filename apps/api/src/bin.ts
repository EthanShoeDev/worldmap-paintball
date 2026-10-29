#!/usr/bin/env bun
import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Config, Layer } from 'effect';
import { HttpRouter } from 'effect/http';

import { Geocoder } from './geocoder.ts';
import { ApiLive } from './handlers.ts';
import { LobbyRooms } from './lobby/rooms.ts';
import { LobbyRoutes } from './lobby/routes.ts';
import { MapData } from './map-data.ts';

const ServerLive = HttpRouter.serve(Layer.mergeAll(ApiLive, LobbyRoutes)).pipe(
  Layer.provide([MapData.layer, Geocoder.layer, LobbyRooms.layerMemory]),
  Layer.provide(
    BunHttpServer.layerConfig(
      Config.Port('PORT').pipe(
        Config.withDefault(3000),
        Config.map((port) => ({ port })),
      ),
    ),
  ),
);

Layer.launch(ServerLive).pipe(BunRuntime.runMain);
