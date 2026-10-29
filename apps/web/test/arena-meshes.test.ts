import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';
import { Vector3 } from 'three';

import {
  buildingsGeometry,
  roadsGeometry,
  spawnPoints,
} from '../src/game/arena-meshes.ts';

describe('buildingsGeometry', () => {
  it('extrudes footprints upwards in arena x/z', () => {
    const geometry = buildingsGeometry([
      {
        footprint: [
          [0, 0],
          [10, 0],
          [10, 20],
          [0, 20],
          [0, 0],
        ],
        height: 5,
      },
    ]);
    assert.isDefined(geometry);
    geometry?.computeBoundingBox();
    const box = geometry?.boundingBox;
    const corners = [
      ...(box?.min.toArray() ?? []),
      ...(box?.max.toArray() ?? []),
    ];
    for (const [i, expected] of [0, 0, 0, 10, 5, 20].entries()) {
      assert.closeTo(corners[i] ?? Number.NaN, expected, 1e-9);
    }
  });

  it('skips degenerate footprints', () => {
    assert.isUndefined(
      buildingsGeometry([
        {
          footprint: [
            [0, 0],
            [1, 1],
          ],
          height: 3,
        },
      ]),
    );
  });
});

describe('roadsGeometry', () => {
  it('builds an upward-facing ribbon of the road width', () => {
    const geometry = roadsGeometry(
      [
        {
          path: [
            [0, 0],
            [10, 0],
          ],
          width: 4,
        },
      ],
      0.1,
    );
    const position = geometry?.getAttribute('position');
    const index = geometry?.getIndex();
    if (position === undefined || !index) {
      return assert.fail('missing attributes');
    }
    const zs = Arr.makeBy(position.count, (i) => position.getZ(i));
    assert.deepStrictEqual(zs, [2, -2, 2, -2]);

    const vertex = (i: number) =>
      new Vector3().fromBufferAttribute(position, index.getX(i));
    const [a, b, c] = [vertex(0), vertex(1), vertex(2)];
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    assert.isAbove(normal.y, 0);
  });
});

describe('spawnPoints', () => {
  const road = (path: ReadonlyArray<readonly [number, number]>) => ({
    width: 6,
    path,
  });

  it('picks road nodes nearest the centre, spaced apart', () => {
    const points = spawnPoints(
      [
        road([
          [1, 0],
          [2, 0],
          [9, 0],
          [30, 0],
        ]),
        road([[0, -5]]),
      ],
      { count: 3, spacing: 4 },
    );
    assert.deepStrictEqual(points, [
      [1, 0],
      [0, -5],
      [9, 0],
    ]);
  });

  it('falls back to the centre without roads', () => {
    assert.deepStrictEqual(spawnPoints([]), [[0, 0]]);
  });
});
