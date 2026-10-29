import { Effect, Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';

import { Api } from './api.ts';
import { Geocoder } from './geocoder.ts';
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
