#!/usr/bin/env bun
import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Config, Layer } from 'effect';
import { HttpRouter } from 'effect/http';

import { ApiRoutes, LocalBackends } from './handlers.ts';

const ServerLive = HttpRouter.serve(ApiRoutes).pipe(
  Layer.provide(LocalBackends),
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
