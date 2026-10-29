import { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Effect, flow, Option, Schema } from 'effect';

import { weaponIds } from '../tuning.ts';

export const Vec3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);
export type Vec3 = typeof Vec3.Type;

export const WeaponId = Schema.Literals(weaponIds);
export type WeaponId = typeof WeaponId.Type;

// Client to host on the unreliable `state` channel, ~20 Hz. `position` is the
// capsule centre; `yaw` and `pitch` are the camera's, in radians. `weapon` is
// the one in hand, so others draw it.
export const PlayerState = Schema.Struct({
  position: Vec3,
  velocity: Vec3,
  yaw: Schema.Finite,
  pitch: Schema.Finite,
  firing: Schema.Boolean,
  weapon: WeaponId,
});
export type PlayerState = typeof PlayerState.Type;

export const Score = Schema.Struct({
  id: PlayerId,
  score: Schema.Int,
  deaths: Schema.Int,
});
export type Score = typeof Score.Type;

export const SnapshotPlayer = Schema.Struct({
  id: PlayerId,
  ...PlayerState.fields,
  alive: Schema.Boolean,
});
export type SnapshotPlayer = typeof SnapshotPlayer.Type;

// Host to everyone as the `state` of a `PeerNetwork` snapshot, ~20 Hz.
export const WorldSnapshot = Schema.Struct({
  players: Schema.Array(SnapshotPlayer),
  scores: Schema.Array(Score),
});
export type WorldSnapshot = typeof WorldSnapshot.Type;

// Reliable `events` channel. Clients send `Shot` and `Hit` to the host; the
// host relays `Shot` and sends the rest. A `Shot` is everything a peer needs
// to replay its balls with its weapon's spec: `origin` is the muzzle, `dir`
// the aim before spread, and `seed` draws every pellet's spread. `respawnInMs` is relative because
// peers' clocks are not synchronised.
export const NetEvent = Schema.TaggedUnion({
  Shot: {
    shooter: PlayerId,
    origin: Vec3,
    dir: Vec3,
    weapon: WeaponId,
    seed: Schema.Int,
  },
  Hit: {
    shooter: PlayerId,
    target: PlayerId,
    point: Vec3,
    weapon: WeaponId,
  },
  Eliminated: {
    shooter: PlayerId,
    target: PlayerId,
    respawnInMs: Schema.Finite,
  },
  Scored: { scores: Schema.Array(Score) },
  Respawn: { player: PlayerId, position: Vec3 },
  MatchEnded: { scores: Schema.Array(Score) },
});
export type NetEvent = typeof NetEvent.Type;
export const Net = NetEvent.cases;

const dropInvalid =
  (label: string) =>
  <A>(decoded: Effect.Effect<A, Schema.SchemaError>) =>
    decoded.pipe(
      Effect.asSome,
      Effect.catch((error) =>
        Effect.as(
          Effect.logWarning(`Dropped malformed ${label}`, error.message),
          Option.none<A>(),
        ),
      ),
    );

export const decodePlayerState = flow(
  Schema.decodeUnknownEffect(PlayerState),
  dropInvalid('player state'),
);
export const decodeWorldSnapshot = flow(
  Schema.decodeUnknownEffect(WorldSnapshot),
  dropInvalid('world snapshot'),
);
export const decodeNetEvent = flow(
  Schema.decodeUnknownEffect(NetEvent),
  dropInvalid('peer event'),
);

export const encodePlayerState = Schema.encodeEffect(PlayerState);
export const encodeWorldSnapshot = Schema.encodeEffect(WorldSnapshot);
export const encodeNetEvent = Schema.encodeEffect(NetEvent);
