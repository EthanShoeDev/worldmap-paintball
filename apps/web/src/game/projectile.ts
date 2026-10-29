import { nextRandom } from './bot-brain.ts';
import { along, distance, sub } from './net/hit-test.ts';
import type { Vec3 } from './net/protocol.ts';
import { paintballTuning, type WeaponSpec } from './tuning.ts';

// A paintball without drag: a pure parabola, so every peer that replays a
// shot from the same origin and direction sees the same flight.
const { gravity, subStep, minAim } = paintballTuning;

const gravityOf = (weapon: WeaponSpec) => gravity * weapon.gravityScale;

const normalize = (v: Vec3) => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length] as const;
};

const cross = (a: Vec3, b: Vec3) =>
  [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ] as const;

// Where a ball launched from `origin` along the unit `dir` is `t` seconds on.
export const ballAt = (
  weapon: WeaponSpec,
  origin: Vec3,
  dir: Vec3,
  t: number,
) => {
  const [x, y, z] = along(origin, dir, weapon.muzzleSpeed * t);
  return [x, y - 0.5 * gravityOf(weapon) * t * t, z] as const;
};

export const ballVelocity = (weapon: WeaponSpec, dir: Vec3, t: number) =>
  [
    dir[0] * weapon.muzzleSpeed,
    dir[1] * weapon.muzzleSpeed - gravityOf(weapon) * t,
    dir[2] * weapon.muzzleSpeed,
  ] as const;

// Flies a ball from age `from` to `to` in short straight steps, asking
// `collide` about each, and stops at the first impact. `done` once it hit
// something or outlived the weapon's lifetime.
export const flyBall = <I>(
  weapon: WeaponSpec,
  origin: Vec3,
  dir: Vec3,
  from: number,
  to: number,
  collide: (start: Vec3, end: Vec3) => I | undefined,
) => {
  const until = Math.min(to, weapon.lifetime);
  const steps = Math.ceil((until - from) / subStep);
  let start = ballAt(weapon, origin, dir, from);
  for (let step = 1; step <= steps; step++) {
    const end = ballAt(
      weapon,
      origin,
      dir,
      from + ((until - from) * step) / steps,
    );
    const impact = collide(start, end);
    if (impact !== undefined) return { impact, done: true };
    start = end;
  }
  return { impact: undefined, done: until >= weapon.lifetime };
};

export const aimRange = (weapon: WeaponSpec) =>
  weapon.muzzleSpeed * weapon.lifetime;

// The crosshair's point: `hitDistance` along the eye ray, where it first meets
// something, or as far as a ball flies when it meets nothing.
export const aimPoint = (
  weapon: WeaponSpec,
  eye: Vec3,
  dir: Vec3,
  hitDistance: number | undefined,
) => {
  const range = aimRange(weapon);
  return along(
    eye,
    dir,
    Math.max(minAim, Math.min(hitDistance ?? range, range)),
  );
};

// From the muzzle straight at the crosshair's point, so the ball converges on
// what the eye sees; gravity still drops it below that point with range.
export const aimFrom = (muzzle: Vec3, point: Vec3) =>
  normalize(sub(point, muzzle));

const seedOf = (seed: number) =>
  (Math.abs(Math.trunc(seed)) % 2_147_483_646) + 1;

// Each pellet's direction, uniform over the weapon's cone around `dir`. The
// seed travels with the shot, so every peer draws the same pattern.
export const pelletDirections = (
  weapon: WeaponSpec,
  dir: Vec3,
  seed: number,
) => {
  if (weapon.spread === 0)
    return Array.from({ length: weapon.pellets }, () => dir);
  const side = normalize(
    cross(dir, Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]),
  );
  const up = cross(dir, side);
  let state = seedOf(seed);
  const roll = () => {
    const [value, next] = nextRandom(state);
    state = next;
    return value;
  };
  return Array.from({ length: weapon.pellets }, () => {
    const cos = 1 - roll() * (1 - Math.cos(weapon.spread));
    const sin = Math.sqrt(1 - cos * cos);
    const turn = roll() * 2 * Math.PI;
    const [a, b] = [Math.cos(turn) * sin, Math.sin(turn) * sin];
    return normalize([
      dir[0] * cos + side[0] * a + up[0] * b,
      dir[1] * cos + side[1] * a + up[1] * b,
      dir[2] * cos + side[2] * a + up[2] * b,
    ]);
  });
};

// Whether some launch direction from `from` puts a ball within `slack` of
// `point` during its life. At time t a ball lies on a sphere of radius v·t
// around `from`, dropped by ½gt². While g·t < v the gap to that sphere only
// shrinks, so checking the latest such time is enough.
export const reachable = (
  weapon: WeaponSpec,
  from: Vec3,
  point: Vec3,
  slack: number,
) => {
  const g = gravityOf(weapon);
  const t =
    g > 0 ? Math.min(weapon.lifetime, weapon.muzzleSpeed / g) : weapon.lifetime;
  const lifted = [point[0], point[1] + 0.5 * g * t * t, point[2]] as const;
  return distance(from, lifted) <= weapon.muzzleSpeed * t + slack;
};
