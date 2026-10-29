import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';

import { aimDirection } from '../src/game/bot-brain.ts';
import { idleViewmodel, viewMuzzle } from '../src/game/marker-motion.ts';
import { along, distance, sub } from '../src/game/net/hit-test.ts';
import type { Vec3 } from '../src/game/net/protocol.ts';
import {
  aimFrom,
  aimPoint,
  aimRange,
  ballAt,
  flyBall,
  pelletDirections,
  reachable,
} from '../src/game/projectile.ts';
import {
  paintballTuning,
  weapons,
  type WeaponSpec,
} from '../src/game/tuning.ts';

const weapon = weapons.assault;
const { gravity } = paintballTuning;
const speed = weapon.muzzleSpeed;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const assertNear = (
  actual: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
  tolerance = 1e-9,
) => {
  assert.strictEqual(actual.length, expected.length);
  for (const [index, value] of actual.entries()) {
    assert.closeTo(value, expected[index] ?? Number.NaN, tolerance);
  }
};

// A one-sided wall through `point`, facing back along `facing`: the point
// where a step crosses it from the front.
const wall =
  (point: Vec3, facing: Vec3) =>
  (start: Vec3, end: Vec3): Vec3 | undefined => {
    const before = dot(sub(start, point), facing);
    const after = dot(sub(end, point), facing);
    if (before < 0 || after >= 0) return undefined;
    return along(start, sub(end, start), before / (before - after));
  };

const level: Vec3 = [0, 0, -1];

describe('ballAt', () => {
  it('leaves at muzzle speed and falls under gravity', () => {
    assertNear(ballAt(weapon, [1, 2, 3], level, 0), [1, 2, 3]);
    const t = 0.4;
    assertNear(ballAt(weapon, [1, 2, 3], level, t), [
      1,
      2 - 0.5 * gravity * t * t,
      3 - speed * t,
    ]);
  });

  it('drops with the square of the distance', () => {
    const dropAt = (range: number) =>
      -ballAt(weapon, [0, 0, 0], level, range / speed)[1];
    assert.closeTo(dropAt(30), 0.5 * gravity * (30 / speed) ** 2, 1e-9);
    assert.closeTo(dropAt(60) / dropAt(30), 4, 1e-9);
    assert.isBelow(dropAt(10), 0.07);
  });

  it('scales the drop with the weapon', () => {
    const floaty: WeaponSpec = { ...weapon, gravityScale: 0.5 };
    assert.closeTo(
      ballAt(floaty, [0, 0, 0], level, 1)[1],
      ballAt(weapon, [0, 0, 0], level, 1)[1] / 2,
      1e-9,
    );
  });
});

describe('flyBall', () => {
  it('steps along the arc in short joined segments', () => {
    const steps: Array<readonly [Vec3, Vec3]> = [];
    const flight = flyBall(weapon, [0, 2, 0], level, 0.2, 0.3, (a, b) => {
      steps.push([a, b]);
      return undefined;
    });
    assert.deepStrictEqual(flight, { impact: undefined, done: false });
    assert.strictEqual(steps.length, Math.ceil(0.1 / paintballTuning.subStep));
    assertNear(steps[0]?.[0] ?? [], ballAt(weapon, [0, 2, 0], level, 0.2));
    assertNear(steps.at(-1)?.[1] ?? [], ballAt(weapon, [0, 2, 0], level, 0.3));
    for (const [index, [, end]] of steps.entries()) {
      const next = steps[index + 1];
      if (next) assert.deepStrictEqual(next[0], end);
      assert.isAtMost(
        distance(...(steps[index] ?? [end, end])),
        speed * paintballTuning.subStep + 0.1,
      );
    }
  });

  it('stops at the first thing it meets, on the arc', () => {
    const origin: Vec3 = [0, 2, 0];
    const near = wall([0, 0, -20], [0, 0, 1]);
    const far = wall([0, 0, -30], [0, 0, 1]);
    const flight = flyBall(
      weapon,
      origin,
      level,
      0,
      1,
      (a, b) => near(a, b) ?? far(a, b),
    );
    assert.isTrue(flight.done);
    const point = flight.impact ?? [0, 0, 0];
    assert.closeTo(point[2], -20, 1e-9);
    assert.closeTo(
      point[1],
      ballAt(weapon, origin, level, 20 / speed)[1],
      1e-3,
    );
  });

  it('only counts an impact within the frame it reaches it', () => {
    const ahead = wall([0, 0, -50], [0, 0, 1]);
    const early = flyBall(weapon, [0, 2, 0], level, 0, 0.5, ahead);
    assert.deepStrictEqual(early, { impact: undefined, done: false });
    const late = flyBall(weapon, [0, 2, 0], level, 0.5, 0.6, ahead);
    assert.isDefined(late.impact);
  });

  it('expires at the end of its lifetime', () => {
    const steps: Array<Vec3> = [];
    const flight = flyBall(
      weapon,
      [0, 2, 0],
      level,
      weapon.lifetime - 0.1,
      10,
      (_, b) => {
        steps.push(b);
        return undefined;
      },
    );
    assert.deepStrictEqual(flight, { impact: undefined, done: true });
    assertNear(
      steps.at(-1) ?? [],
      ballAt(weapon, [0, 2, 0], level, weapon.lifetime),
    );
    const after = flyBall(weapon, [0, 2, 0], level, weapon.lifetime, 10, () => {
      throw new Error('stepped past its lifetime');
    });
    assert.isTrue(after.done);
  });
});

describe('aiming from the muzzle', () => {
  const eye: Vec3 = [3, 1.6, -7];

  // Where a ball from the muzzle meets a wall that the eye ray hits square on
  // at `range`, for a player looking along `yaw` and `pitch`.
  const landing = (
    yaw: number,
    pitch: number,
    range: number,
    corrected = true,
  ) => {
    const look = aimDirection(yaw, pitch);
    const muzzle = viewMuzzle(eye, yaw, pitch, idleViewmodel);
    const point = aimPoint(weapon, eye, look, range);
    const dir = corrected ? aimFrom(muzzle, point) : look;
    const flight = flyBall(
      weapon,
      muzzle,
      dir,
      0,
      weapon.lifetime,
      wall(point, [-look[0], -look[1], -look[2]]),
    );
    return { point, impact: flight.impact };
  };

  const drop = (range: number) => 0.5 * gravity * (range / speed) ** 2;

  it('lands on the crosshair up close, give or take the drop', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1.2, -0.3],
      [-2.5, 0.4],
    ] as const) {
      for (const range of [3, 10, 40]) {
        const { point, impact } = landing(yaw, pitch, range);
        assert.isDefined(impact);
        assert.isAtMost(distance(impact ?? eye, point), drop(range) + 0.02);
      }
    }
  });

  it('beats firing parallel to the eye ray at short range', () => {
    const corrected = landing(0.4, 0, 5);
    const parallel = landing(0.4, 0, 5, false);
    assert.isAbove(
      distance(parallel.impact ?? eye, parallel.point),
      distance(corrected.impact ?? eye, corrected.point) + 0.1,
    );
  });

  it('aims at least a little way out and no further than a ball flies', () => {
    assertNear(
      aimPoint(weapon, eye, level, 0.2),
      along(eye, level, paintballTuning.minAim),
    );
    assertNear(
      aimPoint(weapon, eye, level, undefined),
      along(eye, level, aimRange(weapon)),
    );
  });
});

describe('pelletDirections', () => {
  it('fires a single pellet straight without spread', () => {
    assert.deepStrictEqual(pelletDirections(weapons.sniper, level, 7), [level]);
  });

  it('spreads pellets over the cone, the same for the same seed', () => {
    const scatter: WeaponSpec = { ...weapon, pellets: 8, spread: 0.08 };
    const dir: Vec3 = [0.6, 0, -0.8];
    const pellets = pelletDirections(scatter, dir, 1234);
    assert.strictEqual(pellets.length, 8);
    for (const pellet of pellets) {
      assert.closeTo(Math.hypot(...pellet), 1, 1e-9);
      assert.isAtMost(Math.acos(Math.min(1, dot(pellet, dir))), 0.08 + 1e-9);
    }
    assert.deepStrictEqual(pelletDirections(scatter, dir, 1234), pellets);
    assert.notDeepEqual(pelletDirections(scatter, dir, 1235), pellets);
    assert.isAbove(new Set(Arr.map(pellets, (pellet) => pellet[0])).size, 1);
  });

  it("spreads the shotgun's pellets within its cone, the same per seed", () => {
    const { shotgun } = weapons;
    const dir: Vec3 = [0, 0.2, -Math.sqrt(1 - 0.04)];
    for (const seed of [1, 99, 123_456]) {
      const pellets = pelletDirections(shotgun, dir, seed);
      assert.strictEqual(pellets.length, shotgun.pellets);
      for (const pellet of pellets) {
        assert.isAtMost(
          Math.acos(Math.min(1, dot(pellet, dir))),
          shotgun.spread + 1e-9,
        );
      }
      assert.deepStrictEqual(pelletDirections(shotgun, dir, seed), pellets);
    }
  });
});

describe('weapon specs', () => {
  it('fires one ball, except the shotgun, which fires several', () => {
    assert.strictEqual(weapons.assault.pellets, 1);
    assert.strictEqual(weapons.sniper.pellets, 1);
    assert.isAbove(weapons.shotgun.pellets, 1);
  });

  it('spreads the assault a little, the shotgun a lot, the sniper not at all', () => {
    assert.strictEqual(weapons.sniper.spread, 0);
    assert.isAbove(weapons.assault.spread, 0);
    assert.isAbove(weapons.shotgun.spread, weapons.assault.spread * 4);
  });

  it('gives each weapon its own reach', () => {
    assert.isAbove(aimRange(weapons.sniper), aimRange(weapons.assault));
    assert.isAtMost(aimRange(weapons.shotgun), 30);
    assert.isAtLeast(aimRange(weapons.shotgun), 20);
  });

  it('only scopes the sniper', () => {
    assert.isDefined(weapons.sniper.zoomFov);
    assert.isUndefined(weapons.assault.zoomFov);
    assert.isUndefined(weapons.shotgun.zoomFov);
  });
});

describe('reachable', () => {
  const from: Vec3 = [0, 0, 0];
  const t = weapon.lifetime;
  // The furthest level point: launched up just enough to fall back level
  // at the end of the ball's life.
  const furthest = Math.sqrt((speed * t) ** 2 - (0.5 * gravity * t * t) ** 2);

  it('matches the furthest a ball actually flies', () => {
    const rise = (0.5 * gravity * t) / speed;
    const dir: Vec3 = [0, rise, -Math.sqrt(1 - rise * rise)];
    assertNear(ballAt(weapon, from, dir, t), [0, 0, -furthest], 1e-6);
    assert.isTrue(reachable(weapon, from, [0, 0, -(furthest - 0.5)], 0));
    assert.isFalse(reachable(weapon, from, [0, 0, -(furthest + 0.5)], 0));
    assert.isTrue(reachable(weapon, from, [0, 0, -(furthest + 0.5)], 1));
  });

  it('reaches further down than up', () => {
    assert.isTrue(reachable(weapon, from, [0, -(speed * t + 20), 0], 0));
    assert.isFalse(reachable(weapon, from, [0, speed * t - 20, 0], 0));
  });

  it('never accepts more than a flight plus slack', () => {
    assert.isFalse(reachable(weapon, from, [500, 0, 0], 3));
    assert.isTrue(reachable(weapon, from, [10, 2, -10], 0));
  });
});
