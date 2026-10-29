import { assert, describe, it } from '@effect/vitest';
import { BoxGeometry, Group, Mesh } from 'three';

import type { Vec3 } from '../src/game/net/protocol.ts';
import { aimShot, clearLine, segmentImpact } from '../src/game/shots.ts';
import { weapons } from '../src/game/tuning.ts';

// A 10 m cube centred 20 m ahead (-z) of the origin.
const block = () => {
  const arena = new Group();
  const cube = new Mesh(new BoxGeometry(10, 10, 10));
  cube.position.set(0, 0, -20);
  arena.add(cube);
  arena.updateMatrixWorld(true);
  return arena;
};

describe('segmentImpact', () => {
  it('splats on the face a step crosses, facing back at the ball', () => {
    const impact = segmentImpact(block(), [], [0, 1, -14], [0, 1, -16]);
    assert.isUndefined(impact?.player);
    const surface = impact?.surface;
    assert.closeTo(surface?.point.z ?? 0, -15, 1e-6);
    assert.closeTo(surface?.normal.z ?? 0, 1, 1e-6);
  });

  it('misses a step that stops short of the wall', () => {
    assert.isUndefined(segmentImpact(block(), [], [0, 1, -10], [0, 1, -14.9]));
  });

  it('hits a player in front of the wall first', () => {
    const players: ReadonlyArray<readonly [string, Vec3]> = [
      ['alice', [0, 1, -14.5]],
    ];
    const impact = segmentImpact(block(), players, [0, 1, -13], [0, 1, -16]);
    assert.strictEqual(impact?.player?.target, 'alice');
    assert.isUndefined(impact?.surface);
  });
});

describe('aimShot', () => {
  const eye: Vec3 = [0, 1.6, 0];
  const ahead: Vec3 = [0, 0, -1];

  it('fires from the muzzle toward where the eye ray meets the wall', () => {
    const muzzle: Vec3 = [0.2, 1.4, -0.45];
    const { origin, dir } = aimShot(
      block(),
      weapons.assault,
      eye,
      ahead,
      muzzle,
      [],
    );
    assert.deepStrictEqual(origin, muzzle);
    // From the muzzle to (0, 1.6, -15).
    const t = (-15 - muzzle[2]) / dir[2];
    assert.closeTo(muzzle[0] + dir[0] * t, 0, 1e-6);
    assert.closeTo(muzzle[1] + dir[1] * t, 1.6, 1e-6);
  });

  it('fires from the eye when the muzzle pokes through a wall', () => {
    const { origin, dir } = aimShot(
      block(),
      weapons.assault,
      [0, 1.6, -14.8],
      ahead,
      [0.2, 1.4, -15.25],
      [],
    );
    assert.deepStrictEqual(origin, [0, 1.6, -14.8]);
    assert.deepStrictEqual(dir, ahead);
    assert.isFalse(clearLine(block(), [0, 1.6, -14.8], [0.2, 1.4, -15.25]));
  });
});
