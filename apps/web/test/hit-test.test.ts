import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';

import {
  nearestPlayerHit,
  playerHitbox,
  rayCapsule,
} from '../src/game/net/hit-test.ts';
import type { Vec3 } from '../src/game/net/protocol.ts';

const a: Vec3 = [0, 0, 0];
const b: Vec3 = [0, 2, 0];
const radius = 0.5;

const closeTo = (actual: number | undefined, expected: number) => {
  assert.isDefined(actual);
  assert.closeTo(actual ?? Number.NaN, expected, 1e-9);
};

describe('rayCapsule', () => {
  it('hits the body side-on', () => {
    closeTo(rayCapsule([-5, 1, 0], [1, 0, 0], a, b, radius), 4.5);
  });

  it('hits the top cap from above', () => {
    closeTo(rayCapsule([0, 10, 0], [0, -1, 0], a, b, radius), 7.5);
  });

  it('hits the bottom cap from below', () => {
    closeTo(rayCapsule([0, -10, 0], [0, 1, 0], a, b, radius), 9.5);
  });

  it('hits a cap at a glancing angle past the body', () => {
    const t = rayCapsule([-5, 2.3, 0], [1, 0, 0], a, b, radius);
    closeTo(t, 5 - Math.sqrt(radius ** 2 - 0.3 ** 2));
  });

  it('misses a ray that passes beside it', () => {
    assert.isUndefined(rayCapsule([-5, 1, 2], [1, 0, 0], a, b, radius));
  });

  it('misses a ray that passes over the top', () => {
    assert.isUndefined(rayCapsule([-5, 2.6, 0], [1, 0, 0], a, b, radius));
  });

  it('ignores a capsule behind the ray', () => {
    assert.isUndefined(rayCapsule([5, 1, 0], [1, 0, 0], a, b, radius));
  });

  it('does not count a ray starting inside', () => {
    assert.isUndefined(rayCapsule([0, 1, 0], [1, 0, 0], a, b, radius));
  });
});

describe('nearestPlayerHit', () => {
  const dir: Vec3 = [0, 0, -1];
  const players: ReadonlyArray<readonly [string, Vec3]> = [
    ['far', [0, 1.35, -20]],
    ['near', [0, 1.35, -8]],
    ['beside', [3, 1.35, -4]],
  ];

  it('picks the first capsule along the ray', () => {
    const hit = nearestPlayerHit([0, 1.6, 0], dir, players, 200);
    assert.strictEqual(hit?.target, 'near');
    closeTo(hit?.distance, 8 - 0.35);
    assert.deepStrictEqual(
      Arr.map(hit?.point ?? [], (v) => Math.round(v * 100) / 100),
      [0, 1.6, -7.65],
    );
  });

  it('stops at the arena, which blocks players behind it', () => {
    assert.isUndefined(nearestPlayerHit([0, 1.6, 0], dir, players, 5));
  });

  it('covers the head above the collider', () => {
    const [, top] = playerHitbox([0, 1.35, -8]);
    const hit = nearestPlayerHit([0, top[1] + 0.2, 0], dir, players, 200);
    assert.strictEqual(hit?.target, 'near');
  });
});
