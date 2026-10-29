import { PlayerId } from '@worldmap-paintball/api/lobby/protocol';
import { Effect, flow, Option, Schema } from 'effect';

export const Vec3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);
export type Vec3 = typeof Vec3.Type;

// Client to host on the unreliable `state` channel, ~20 Hz. `position` is the
// capsule centre; `yaw` and `pitch` are the camera's, in radians.
export const PlayerState = Schema.Struct({
  position: Vec3,
  velocity: Vec3,
  yaw: Schema.Finite,
  pitch: Schema.Finite,
  firing: Schema.Boolean,
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
// host relays `Shot` and sends the rest. `respawnInMs` is relative because
// peers' clocks are not synchronised.
export const NetEvent = Schema.TaggedUnion({
  Shot: { shooter: PlayerId, origin: Vec3, dir: Vec3 },
  Hit: { shooter: PlayerId, target: PlayerId, point: Vec3 },
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
