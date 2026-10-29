import { LobbyCode } from '@worldmap-paintball/api-contract/lobby';
import { Effect, Layer, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

import { LobbyRooms } from './rooms.ts';

const LobbyPath = Schema.Struct({ code: LobbyCode });

// Hands the WebSocket upgrade to the lobby's room, which owns the socket from
// then on.
export const LobbyRoutes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const rooms = yield* LobbyRooms;
    yield* router.add(
      'GET',
      '/api/lobbies/:code/ws',
      Effect.gen(function* () {
        const { code } = yield* HttpRouter.schemaPathParams(LobbyPath);
        const request = yield* HttpServerRequest.HttpServerRequest;
        return yield* rooms.connect(code, request);
      }).pipe(
        Effect.catchTag('SchemaError', () =>
          Effect.succeed(
            HttpServerResponse.text('Invalid lobby code', { status: 400 }),
          ),
        ),
      ),
    );
  }),
);
