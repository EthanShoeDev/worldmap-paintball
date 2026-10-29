import { Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';

export const Health = Schema.Struct({ status: Schema.Literal('ok') });

export const Greeting = Schema.Struct({ message: Schema.String });

// Local metres around the arena centre: x points east, z points south.
const Point = Schema.Tuple([Schema.Finite, Schema.Finite]);

export const Building = Schema.Struct({
  footprint: Schema.Array(Point),
  height: Schema.Finite,
});

export const Road = Schema.Struct({
  path: Schema.Array(Point),
  width: Schema.Finite,
});

export const Area = Schema.Struct({
  kind: Schema.Literals(['park', 'water', 'wood', 'grass']),
  outline: Schema.Array(Point),
});

// Ground heights in metres relative to the arena centre, on a `size` × `size`
// grid spanning the arena from its north-west corner (-halfSize, -halfSize)
// to its south-east corner, row by row from north to south.
export const Terrain = Schema.Struct({
  size: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 257 })),
  heights: Schema.Array(Schema.Finite),
});

// Arena sizes a lobby can pick, as half sizes in metres: 200, 300 and 450 m
// across. Presets rather than any size, so bakes share cache entries.
export const ArenaSize = Schema.Literals(['small', 'medium', 'large']);
export type ArenaSize = typeof ArenaSize.Type;

export const arenaHalfSizes: Record<ArenaSize, number> = {
  small: 100,
  medium: 150,
  large: 225,
};

// Names one bake of an arena. A lobby pins the bake its host sees, and every
// member asks for exactly that one, so all play the same ground even while a
// partial bake is being retried.
export const BakeId = Schema.String.check(Schema.isPattern(/^[0-9a-z]{1,16}$/));

export const ArenaLayer = Schema.Literals(['terrain', 'footprints']);
export type ArenaLayer = typeof ArenaLayer.Type;

export const Arena = Schema.Struct({
  lat: Schema.Finite,
  lon: Schema.Finite,
  halfSize: Schema.Finite,
  buildings: Schema.Array(Building),
  roads: Schema.Array(Road),
  areas: Schema.Array(Area),
  // Absent when elevation data could not be fetched: the ground is flat.
  terrain: Schema.optionalKey(Terrain),
  // Optional layers that failed to load for this bake. The server never
  // stores such a bake, so asking again a minute later bakes afresh.
  missing: Schema.optionalKey(Schema.Array(ArenaLayer)),
  bake: Schema.optionalKey(BakeId),
  // Set by the client from a lobby's map settings, never baked: the arena is
  // the circle of radius `halfSize` rather than the whole square.
  round: Schema.optionalKey(Schema.Literal(true)),
});

export type Terrain = typeof Terrain.Type;

export type Arena = typeof Arena.Type;

export class MapDataError extends Schema.TaggedError<
  MapDataError,
  { readonly brand: unique symbol }
>()('MapDataError', { message: Schema.String }, { httpApiStatus: 502 }) {}

// `covered`: whether arenas and lobbies can use the place (see ./coverage).
// The location is valid but outside every region in ./coverage.
export class OutsideCoverage extends Schema.TaggedError<
  OutsideCoverage,
  { readonly brand: unique symbol }
>()('OutsideCoverage', { message: Schema.String }, { httpApiStatus: 422 }) {}

export class RateLimited extends Schema.TaggedError<
  RateLimited,
  { readonly brand: unique symbol }
>()('RateLimited', { message: Schema.String }, { httpApiStatus: 429 }) {}

export const Place = Schema.Struct({
  label: Schema.String,
  lat: Schema.Finite,
  lon: Schema.Finite,
  covered: Schema.Boolean,
});

export class GeocoderError extends Schema.TaggedError<
  GeocoderError,
  { readonly brand: unique symbol }
>()('GeocoderError', { message: Schema.String }, { httpApiStatus: 502 }) {}

export class HealthGroup extends HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('check', '/health', { success: Health }),
) {}

export class GreetingsGroup extends HttpApiGroup.make('greetings').add(
  HttpApiEndpoint.get('greet', '/greetings/:name', {
    params: { name: Schema.String },
    success: Greeting,
  }),
) {}

export class ArenasGroup extends HttpApiGroup.make('arenas').add(
  HttpApiEndpoint.get('get', '/arenas', {
    query: {
      lat: Schema.FiniteFromString.check(
        Schema.isBetween({ minimum: -85, maximum: 85 }),
      ),
      lon: Schema.FiniteFromString.check(
        Schema.isBetween({ minimum: -180, maximum: 180 }),
      ),
      size: Schema.optionalKey(ArenaSize),
      bake: Schema.optionalKey(BakeId),
    },
    success: Arena,
    error: [MapDataError, OutsideCoverage, RateLimited],
  }),
) {}

export class PlacesGroup extends HttpApiGroup.make('places').add(
  HttpApiEndpoint.get('search', '/places', {
    query: { q: Schema.String.check(Schema.isMinLength(3)) },
    success: Schema.Array(Place),
    error: GeocoderError,
  }),
) {}

export class Api extends HttpApi.make('api')
  .add(HealthGroup)
  .add(GreetingsGroup)
  .add(ArenasGroup)
  .add(PlacesGroup)
  .prefix('/api') {}
