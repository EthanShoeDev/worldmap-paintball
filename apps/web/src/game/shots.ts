import '@tanstack/react-start/client-only';
import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { type Object3D, Raycaster, Vector3 } from 'three';

import { distance, nearestPlayerHit } from './net/hit-test.ts';
import type { Vec3 } from './net/protocol.ts';
import type { Hit } from './splats.ts';
import { fireRange } from './tuning.ts';

const raycaster = new Raycaster();
raycaster.far = fireRange;
// Uses the bounds tree <Bvh> builds; a paintball only needs the nearest hit.
raycaster.firstHitOnly = true;

const raycastArena = (arena: Object3D, origin: Vec3, dir: Vec3) => {
  raycaster.set(new Vector3(...origin), new Vector3(...dir));
  const [hit] = raycaster.intersectObject(arena, true);
  if (!hit?.face) return undefined;
  const normal = hit.face.normal
    .clone()
    .transformDirection(hit.object.matrixWorld);
  return {
    hit: { point: hit.point, normal } satisfies Hit,
    distance: hit.distance,
  };
};

// Whichever the paintball reaches first: a player capsule or the arena.
export const traceShot = (
  arena: Object3D | null,
  origin: Vec3,
  dir: Vec3,
  players: Iterable<readonly [PlayerId, Vec3]>,
) => {
  const surface = arena ? raycastArena(arena, origin, dir) : undefined;
  const player = nearestPlayerHit(
    origin,
    dir,
    players,
    surface?.distance ?? fireRange,
  );
  return player
    ? { player, surface: undefined }
    : { player: undefined, surface: surface?.hit };
};

// Whether the arena leaves the straight line between two points open.
export const clearLine = (arena: Object3D | null, from: Vec3, to: Vec3) => {
  const length = distance(from, to);
  if (!arena || length === 0) return true;
  const dir = [
    (to[0] - from[0]) / length,
    (to[1] - from[1]) / length,
    (to[2] - from[2]) / length,
  ] as const;
  const blocker = raycastArena(arena, from, dir);
  return blocker === undefined || blocker.distance >= length;
};
