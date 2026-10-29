import { GeocoderError, type Place } from '@worldmap-paintball/api-contract';
import { Array as Arr, Context, Effect, Layer, Schema } from 'effect';
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';

import { USER_AGENT } from './user-agent.ts';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

const NominatimResponse = Schema.Array(
  Schema.Struct({
    display_name: Schema.String,
    lat: Schema.FiniteFromString,
    lon: Schema.FiniteFromString,
  }),
);

// Coverage is the API's concern, so geocoders leave `covered` out.
export type GeocodedPlace = Omit<typeof Place.Type, 'covered'>;

export class Geocoder extends Context.Service<
  Geocoder,
  {
    readonly search: (
      query: string,
    ) => Effect.Effect<ReadonlyArray<GeocodedPlace>, GeocoderError>;
  }
>()('@worldmap-paintball/api/geocoder') {
  // Nominatim's usage policy requires an identifying User-Agent and at most
  // one request per second, so this suits hosts typing a location but not
  // autocomplete.
  static readonly layerNominatim = Layer.effect(
    Geocoder,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.filterStatusOk,
      );

      const search = Effect.fn('Geocoder.search')(
        function* (query: string) {
          yield* Effect.annotateCurrentSpan({ query });
          const results = yield* HttpClientRequest.get(NOMINATIM_URL).pipe(
            HttpClientRequest.setUrlParams({
              q: query,
              format: 'jsonv2',
              limit: 5,
            }),
            HttpClientRequest.setHeader('User-Agent', USER_AGENT),
            HttpClientRequest.acceptJson,
            client.execute,
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(NominatimResponse),
            ),
          );
          return Arr.map(results, (result) => ({
            label: result.display_name,
            lat: result.lat,
            lon: result.lon,
          }));
        },
        Effect.mapError((cause) =>
          GeocoderError.make({ message: `Nominatim: ${cause.message}` }),
        ),
      );

      return Geocoder.of({ search });
    }),
  );

  static readonly layer = this.layerNominatim.pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}
