import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import {
  InstancedMesh,
  Matrix4,
  type Object3D,
  Raycaster,
  Vector3,
} from 'three';

import { distance, nearestPlayerHit, sub } from './net/hit-test.ts';
import type { Vec3 } from './net/protocol.ts';
import { aimFrom, aimPoint, aimRange } from './projectile.ts';
import type { Hit } from './splats.ts';
import type { WeaponSpec } from './tuning.ts';

type Players = Iterable<readonly [PlayerId, Vec3]>;

const raycaster = new Raycaster();
// Uses the bounds tree <Bvh> builds; a paintball only needs the nearest hit.
raycaster.firstHitOnly = true;
const instanceMatrix = new Matrix4();

const raycastArena = (
  arena: Object3D,
  origin: Vec3,
  dir: Vec3,
  far: number,
) => {
  raycaster.set(new Vector3(...origin), new Vector3(...dir));
  raycaster.far = far;
  const [hit] = raycaster.intersectObject(arena, true);
  if (!hit?.face) return undefined;
  const normal = hit.face.normal.clone();
  // A tree trunk's face normal is in its instance's frame.
  if (hit.object instanceof InstancedMesh && hit.instanceId !== undefined) {
    hit.object.getMatrixAt(hit.instanceId, instanceMatrix);
    normal.transformDirection(instanceMatrix);
  }
  normal.transformDirection(hit.object.matrixWorld);
  return {
    hit: { point: hit.point, normal } satisfies Hit,
    distance: hit.distance,
  };
};

// Whichever a straight path meets first within `far`: a player capsule or
// the arena.
const trace = (
  arena: Object3D | null,
  origin: Vec3,
  dir: Vec3,
  players: Players,
  far: number,
) => {
  const surface = arena ? raycastArena(arena, origin, dir, far) : undefined;
  const player = nearestPlayerHit(
    origin,
    dir,
    players,
    surface?.distance ?? far,
  );
  if (player) return { player, surface: undefined, distance: player.distance };
  return (
    surface && {
      player: undefined,
      surface: surface.hit,
      distance: surface.distance,
    }
  );
};

// What a ball's step from `start` to `end` runs into first, if anything.
export const segmentImpact = (
  arena: Object3D | null,
  players: Players,
  start: Vec3,
  end: Vec3,
) => {
  const length = distance(start, end);
  if (length === 0) return undefined;
  const [x, y, z] = sub(end, start);
  return trace(
    arena,
    start,
    [x / length, y / length, z / length],
    players,
    length,
  );
};

// Whether the arena leaves the straight line between two points open.
export const clearLine = (arena: Object3D | null, from: Vec3, to: Vec3) =>
  segmentImpact(arena, [], from, to) === undefined;

// A shot leaves the muzzle but heads for the crosshair's point, so aiming
// stays honest. A muzzle poked through a wall fires from the eye instead, so
// a ball never starts inside one.
export const aimShot = (
  arena: Object3D | null,
  weapon: WeaponSpec,
  eye: Vec3,
  dir: Vec3,
  muzzle: Vec3,
  players: Players,
) => {
  const origin = clearLine(arena, eye, muzzle) ? muzzle : eye;
  const seen = trace(arena, eye, dir, players, aimRange(weapon));
  return {
    origin,
    dir: aimFrom(origin, aimPoint(weapon, eye, dir, seen?.distance)),
  };
};
