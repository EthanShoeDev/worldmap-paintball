import { Api } from '@worldmap-paintball/api/api';
import { Context, Effect, Layer } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Atom } from 'effect/reactivity';

import type { Coordinates } from './location/coordinates.ts';

export class ApiClient extends Context.Service<
  ApiClient,
  HttpApiClient.ForApi<typeof Api>
>()('@worldmap-paintball/web/api-client/ApiClient') {
  static readonly layer = Layer.effect(
    ApiClient,
    HttpApiClient.make(Api, {
      transformClient: HttpClient.mapRequest(
        HttpClientRequest.prependUrl('/api'),
      ),
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

export const apiRuntime = Atom.runtime(ApiClient.layer);

const fetchArena = Effect.fn('fetchArena')(function* (query: Coordinates) {
  const client = yield* ApiClient;
  return yield* client.arenas.get({ query });
});

export const arenaAtom = Atom.family((coordinates: Coordinates) =>
  apiRuntime.atom(fetchArena(coordinates)),
);
