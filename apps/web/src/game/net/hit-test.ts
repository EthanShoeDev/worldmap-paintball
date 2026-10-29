import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';

import { bodyHalfHeight, bodyRadius } from '../tuning.ts';
import type { Vec3 } from './protocol.ts';

const sub = (a: Vec3, b: Vec3) =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as const;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const distance = (a: Vec3, b: Vec3) => Math.hypot(...sub(a, b));

export const along = (origin: Vec3, dir: Vec3, t: number) =>
  [
    origin[0] + dir[0] * t,
    origin[1] + dir[1] * t,
    origin[2] + dir[2] * t,
  ] as const;

const raySphere = (origin: Vec3, dir: Vec3, centre: Vec3, radius: number) => {
  const oc = sub(origin, centre);
  const b = dot(dir, oc);
  const h = b * b - (dot(oc, oc) - radius * radius);
  return h < 0 ? undefined : -b - Math.sqrt(h);
};

// Distance along a unit-length ray to where it enters the capsule around the
// segment a-b, or undefined on a miss. A ray that starts inside never "hits".
// After Inigo Quilez's capsule intersection.
export const rayCapsule = (
  origin: Vec3,
  dir: Vec3,
  a: Vec3,
  b: Vec3,
  radius: number,
) => {
  const ba = sub(b, a);
  const oa = sub(origin, a);
  const baba = dot(ba, ba);
  const bard = dot(ba, dir);
  const baoa = dot(ba, oa);
  const k2 = baba - bard * bard;
  if (k2 > 1e-9) {
    const k1 = baba * dot(dir, oa) - baoa * bard;
    const k0 = baba * dot(oa, oa) - baoa * baoa - radius * radius * baba;
    const h = k1 * k1 - k2 * k0;
    if (h < 0) return undefined;
    const t = (-k1 - Math.sqrt(h)) / k2;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : undefined;
  }
  // Past the body (or parallel to the axis): the ray can only enter a cap.
  const caps = [
    raySphere(origin, dir, a, radius),
    raySphere(origin, dir, b, radius),
  ];
  const hits = Arr.filter(caps, (t): t is number => t !== undefined && t >= 0);
  return hits.length > 0 ? Math.min(...hits) : undefined;
};

// The rendered avatar is a capsule plus a head; the hitbox covers both.
const headroom = 0.15;

export const playerHitbox = (centre: Vec3) =>
  [
    [centre[0], centre[1] - bodyHalfHeight, centre[2]],
    [centre[0], centre[1] + bodyHalfHeight + headroom, centre[2]],
  ] as const;

export interface PlayerHit {
  readonly target: PlayerId;
  readonly point: Vec3;
  readonly distance: number;
}

export const nearestPlayerHit = (
  origin: Vec3,
  dir: Vec3,
  players: Iterable<readonly [PlayerId, Vec3]>,
  maxDistance: number,
) => {
  let nearest: PlayerHit | undefined;
  for (const [target, centre] of players) {
    const [a, b] = playerHitbox(centre);
    const t = rayCapsule(origin, dir, a, b, bodyRadius);
    if (
      t !== undefined &&
      t <= maxDistance &&
      t < (nearest?.distance ?? Infinity)
    ) {
      nearest = { target, point: along(origin, dir, t), distance: t };
    }
  }
  return nearest;
};
