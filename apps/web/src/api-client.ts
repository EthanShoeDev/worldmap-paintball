import { createIsomorphicFn } from '@tanstack/react-start';
import { Api } from '@worldmap-paintball/api-contract';
import { outsideCoverageMessage } from '@worldmap-paintball/api-contract/coverage';
import { Context, Effect, Layer, ManagedRuntime, Predicate } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { Atom } from 'effect/reactivity';

import { inProcessFetch, inProcessOrigin } from './api.server.ts';
import type { Coordinates } from './location/coordinates.ts';

// createIsomorphicFn is the compiler's environment boundary: each build keeps
// one implementation and drops the other's imports, so the in-process
// transport never reaches the browser. In-process while the server renders;
// same-origin fetch to /api in the browser.
const transport = createIsomorphicFn()
  .server(() => ({
    baseUrl: inProcessOrigin,
    layer: FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, inProcessFetch)),
    ),
  }))
  .client(() => ({
    baseUrl: globalThis.location.origin,
    layer: FetchHttpClient.layer,
  }));

const { baseUrl, layer } = transport();

export class ApiClient extends Context.Service<
  ApiClient,
  HttpApiClient.ForApi<typeof Api>
>()('@worldmap-paintball/web/api-client/ApiClient') {
  static readonly layer = Layer.effect(
    ApiClient,
    HttpApiClient.make(Api, { baseUrl }),
  ).pipe(Layer.provide(layer));
}

// Atoms reach the API through this runtime.
export const apiRuntime = Atom.runtime(ApiClient.layer);

// Loaders and event handlers are where plain promises meet Effect, so this
// runtime is their entry point.
const promiseRuntime = ManagedRuntime.make(ApiClient.layer);

// What to tell a person about a failed API call. Rate limits and coverage
// are expected and worded for people; anything else keeps its own message.
export const apiErrorMessage = (error: unknown) => {
  if (Predicate.isTagged(error, 'RateLimited')) {
    return 'Too many requests, try again in a minute';
  }
  if (Predicate.isTagged(error, 'OutsideCoverage')) {
    return outsideCoverageMessage;
  }
  return error instanceof Error ? error.message : 'Unknown error';
};

// Runs one typed call, the same way on the server and in the browser. A
// failure rejects the promise with the call's error; `apiErrorMessage` words
// it.
export const callApi = <A, E>(
  call: (api: ApiClient['Service']) => Effect.Effect<A, E>,
  options?: { readonly signal?: AbortSignal },
) =>
  promiseRuntime.runPromise(
    Effect.flatMap(Effect.service(ApiClient), call),
    options,
  );

const fetchArena = Effect.fn('fetchArena')(function* (query: Coordinates) {
  const client = yield* ApiClient;
  return yield* client.arenas.get({ query });
});

export const arenaAtom = Atom.family((coordinates: Coordinates) =>
  apiRuntime.atom(fetchArena(coordinates)),
);
