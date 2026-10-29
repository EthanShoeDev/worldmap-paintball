import {
  Api,
  arenaHalfSizes,
  OutsideCoverage,
} from '@worldmap-paintball/api-contract';
import {
  isCovered,
  outsideCoverageMessage,
} from '@worldmap-paintball/api-contract/coverage';
import { Array as Arr, Effect, Layer, Option } from 'effect';
import { Headers } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';

import { ArenaLimiter } from './arena-limiter.ts';
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
    const limiter = yield* ArenaLimiter;
    return handlers.handle(
      'get',
      Effect.fn(function* ({ query, request }) {
        // Checked first: an uncovered request costs nothing, so it should not
        // use up the client's allowance.
        if (!isCovered(query.lat, query.lon)) {
          return yield* OutsideCoverage.make({
            message: outsideCoverageMessage,
          });
        }
        // Cloudflare sets this header and clients cannot override it; local
        // servers have one client, so they share one key.
        yield* limiter.take(
          Option.getOrElse(
            Headers.get(request.headers, 'cf-connecting-ip'),
            () => 'local',
          ),
        );
        return yield* mapData.arena({
          lat: query.lat,
          lon: query.lon,
          halfSize: arenaHalfSizes[query.size ?? 'medium'],
          ...(query.bake !== undefined && { bake: query.bake }),
        });
      }),
    );
  }),
);

export const PlacesLive = HttpApiBuilder.group(
  Api,
  'places',
  Effect.fn(function* (handlers) {
    const geocoder = yield* Geocoder;
    return handlers.handle('search', ({ query }) =>
      geocoder.search(query.q).pipe(
        Effect.map(
          Arr.map((place) => ({
            ...place,
            covered: isCovered(place.lat, place.lon),
          })),
        ),
      ),
    );
  }),
);

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([HealthLive, GreetingsLive, ArenasLive, PlacesLive]),
);

// Everything the API serves under /api: the HttpApi and the lobby sockets.
export const ApiRoutes = Layer.mergeAll(ApiLive, LobbyRoutes);

// The services ApiRoutes runs on.
export type ApiBackends = MapData | Geocoder | LobbyRooms | ArenaLimiter;

// ApiBackends inside a single process (the Bun server, Vite's dev server,
// tests). Cloudflare's are in `./cloudflare.ts`.
export const LocalBackends = Layer.mergeAll(
  MapData.layer,
  Geocoder.layer,
  LobbyRooms.layerMemory,
  ArenaLimiter.layerMemory,
);
