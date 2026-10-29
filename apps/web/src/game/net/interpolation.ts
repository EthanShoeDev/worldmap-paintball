import type {
  SnapshotInterpolation,
  Types,
} from '@geckos.io/snapshot-interpolation';
import { PlayerId } from '@worldmap-paintball/api/lobby/protocol';
import { Array as Arr, Schema } from 'effect';

import type { Vec3, WorldSnapshot } from './protocol.ts';

const turn = Math.PI * 2;

// The library's `rad` lerp takes the short way round only within [0, 2π).
export const wrapAngle = (angle: number) => ((angle % turn) + turn) % turn;

// Yaw travels as `r`: the library reads a method suffix like `yaw(rad)` back
// as the key `w`, so only single-letter keys can take one.
export const interpolationParameters = 'x y z r(rad) pitch';

// The library interpolates flat entities, so positions are split into x/y/z.
export const interpolationSnapshot = (
  id: string,
  time: number,
  world: WorldSnapshot,
) => ({
  id,
  time,
  state: Arr.map(world.players, (player) => ({
    id: player.id,
    x: player.position[0],
    y: player.position[1],
    z: player.position[2],
    r: wrapAngle(player.yaw),
    pitch: player.pitch,
  })),
});

export interface Pose {
  readonly position: Vec3;
  readonly yaw: number;
  readonly pitch: number;
}

// The library hands entities back loosely typed; keep the well-formed ones.
const isPoseEntity = Schema.is(
  Schema.Struct({
    id: PlayerId,
    x: Schema.Finite,
    y: Schema.Finite,
    z: Schema.Finite,
    r: Schema.Finite,
    pitch: Schema.Finite,
  }),
);

export const posesOf = (state: Types.State) =>
  new Map(
    Arr.map(
      Arr.filter(state, isPoseEntity),
      ({ id, x, y, z, r, pitch }) =>
        [id, { position: [x, y, z] as const, yaw: r, pitch }] as const,
    ),
  );

export const interpolatedPoses = (interpolation: SnapshotInterpolation) => {
  const result = interpolation.calcInterpolation(interpolationParameters);
  return result ? posesOf(result.state) : new Map<PlayerId, Pose>();
};
