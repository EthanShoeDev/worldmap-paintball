import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Color } from 'three';

import type { PlayerHit } from './net/hit-test.ts';
import type { Vec3 } from './net/protocol.ts';
import { flyBall, pelletDirections } from './projectile.ts';
import type { Hit } from './splats.ts';
import {
  paintballTuning,
  type WeaponId,
  type WeaponSpec,
  weapons,
} from './tuning.ts';

export interface Volley {
  readonly shooter: PlayerId | undefined;
  readonly weapon: WeaponId;
  readonly origin: Vec3;
  readonly dir: Vec3;
  readonly seed: number;
  readonly color: string;
  // Only the shooter's own simulation reports hits; replays are visual.
  readonly onHit: ((hit: PlayerHit) => void) | undefined;
}

export interface Paintball {
  readonly shooter: PlayerId | undefined;
  readonly weapon: WeaponSpec;
  readonly origin: Vec3;
  readonly dir: Vec3;
  readonly color: string;
  readonly tint: Color;
  readonly onHit: ((hit: PlayerHit) => void) | undefined;
  age: number;
}

// Every ball in flight, oldest first. Mutated in place by the render loop.
export type Paintballs = Array<Paintball>;

export interface Impact {
  readonly player: PlayerHit | undefined;
  readonly surface: Hit | undefined;
}

// One ball per pellet; past the cap the oldest go first.
export const launch = (balls: Paintballs, volley: Volley) => {
  const weapon = weapons[volley.weapon];
  const tint = new Color(volley.color);
  for (const dir of pelletDirections(weapon, volley.dir, volley.seed)) {
    balls.push({ ...volley, weapon, dir, tint, age: 0 });
  }
  const extra = balls.length - paintballTuning.maxBalls;
  if (extra > 0) balls.splice(0, extra);
};

// Flies every ball on by `dt`, reports the shooter's own hits, and drops
// balls that landed or expired. Returns the splats to paint.
export const advance = (
  balls: Paintballs,
  dt: number,
  impactOf: (ball: Paintball, start: Vec3, end: Vec3) => Impact | undefined,
) => {
  const landed: Array<readonly [Hit, string]> = [];
  let kept = 0;
  for (const ball of balls) {
    const { impact, done } = flyBall(
      ball.weapon,
      ball.origin,
      ball.dir,
      ball.age,
      ball.age + dt,
      (start, end) => impactOf(ball, start, end),
    );
    ball.age += dt;
    if (impact?.surface) landed.push([impact.surface, ball.color]);
    if (impact?.player) ball.onHit?.(impact.player);
    if (!done) {
      balls[kept] = ball;
      kept += 1;
    }
  }
  balls.length = kept;
  return landed;
};
