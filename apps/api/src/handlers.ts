import { Api } from '@worldmap-paintball/api-contract';
import { Effect, Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';

import { Geocoder } from './geocoder.ts';
import { LobbyRooms } from './lobby/rooms.ts';
import { LobbyRoutes } from './lobby/routes.ts';
import { MapData } from './map-data.ts';

export const HealthLive = HttpApiBuilder.group(Api, 'health', (handlers) =>
  handlers.handle('check', () => Effect.succeed({ status: 'ok' as const })),
);

export const GreetingsLive = HttpApiBuilder.group(
  Api,
  'greetings',
  (handlers) =>
    handlers.handle('greet', ({ params }) =>
      Effect.succeed({ message: `Hello, ${params.name}!` }),
    ),
);

export const ArenasLive = HttpApiBuilder.group(
  Api,
  'arenas',
  Effect.fn(function* (handlers) {
    const mapData = yield* MapData;
    return handlers.handle('get', ({ query }) => mapData.arena(query));
  }),
);

export const PlacesLive = HttpApiBuilder.group(
  Api,
  'places',
  Effect.fn(function* (handlers) {
    const geocoder = yield* Geocoder;
    return handlers.handle('search', ({ query }) => geocoder.search(query.q));
  }),
);

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([HealthLive, GreetingsLive, ArenasLive, PlacesLive]),
);

// Everything the API serves under /api: the HttpApi and the lobby sockets.
export const ApiRoutes = Layer.mergeAll(ApiLive, LobbyRoutes);

// The services ApiRoutes runs on.
export type ApiBackends = MapData | Geocoder | LobbyRooms;

// ApiBackends inside a single process (the Bun server, Vite's dev server,
// tests). Cloudflare's are in `./cloudflare.ts`.
export const LocalBackends = Layer.mergeAll(
  MapData.layer,
  Geocoder.layer,
  LobbyRooms.layerMemory,
);
