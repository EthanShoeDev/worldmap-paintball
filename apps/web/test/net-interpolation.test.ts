import { assert, describe, it } from '@effect/vitest';
import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';

import {
  interpolationParameters,
  interpolationSnapshot,
  posesOf,
  wrapAngle,
} from '../src/game/net/interpolation.ts';
import type {
  SnapshotPlayer,
  WorldSnapshot,
} from '../src/game/net/protocol.ts';

const player = (
  id: string,
  position: SnapshotPlayer['position'],
  yaw: number,
): SnapshotPlayer => ({
  id,
  position,
  velocity: [0, 0, 0],
  yaw,
  pitch: 0.1,
  firing: false,
  weapon: 'sniper',
  alive: true,
});

const world = (players: ReadonlyArray<SnapshotPlayer>): WorldSnapshot => ({
  players,
  scores: [],
});

describe('wrapAngle', () => {
  it('maps any angle into [0, 2π)', () => {
    assert.closeTo(wrapAngle(-Math.PI / 2), (3 * Math.PI) / 2, 1e-12);
    assert.closeTo(wrapAngle(5 * Math.PI), Math.PI, 1e-12);
    assert.strictEqual(wrapAngle(0), 0);
  });
});

describe('snapshot interpolation', () => {
  it('interpolates positions halfway between two host snapshots', () => {
    const interpolation = new SnapshotInterpolation();
    const older = interpolationSnapshot(
      '1',
      1000,
      world([player('a', [0, 1, 0], 0.2)]),
    );
    const newer = interpolationSnapshot(
      '2',
      1050,
      world([player('a', [10, 1, -4], 0.4)]),
    );
    const result = interpolation.interpolate(
      older,
      newer,
      1025,
      interpolationParameters,
    );
    const pose = posesOf(result.state).get('a');
    assert.deepStrictEqual(pose?.position, [5, 1, -2]);
    assert.closeTo(pose?.yaw ?? Number.NaN, 0.3, 1e-9);
  });

  it('turns the short way round across zero yaw', () => {
    const interpolation = new SnapshotInterpolation();
    const result = interpolation.interpolate(
      interpolationSnapshot('1', 0, world([player('a', [0, 0, 0], -0.1)])),
      interpolationSnapshot('2', 100, world([player('a', [0, 0, 0], 0.1)])),
      0.5,
      interpolationParameters,
    );
    const yaw = posesOf(result.state).get('a')?.yaw ?? Number.NaN;
    assert.closeTo(Math.cos(yaw), 1, 1e-9);
  });

  it('takes the weapon in hand from the newer snapshot', () => {
    const interpolation = new SnapshotInterpolation();
    const result = interpolation.interpolate(
      interpolationSnapshot('1', 0, world([player('a', [0, 0, 0], 0)])),
      interpolationSnapshot(
        '2',
        100,
        world([{ ...player('a', [2, 0, 0], 0), weapon: 'shotgun' }]),
      ),
      0.25,
      interpolationParameters,
    );
    assert.strictEqual(posesOf(result.state).get('a')?.weapon, 'shotgun');
  });

  it('skips entities missing a field', () => {
    const poses = posesOf([{ id: 'broken', x: 1, y: 2 }]);
    assert.strictEqual(poses.size, 0);
  });
});
