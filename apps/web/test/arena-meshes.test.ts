import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';
import { Vector3 } from 'three';

import {
  buildingsGeometry,
  groundGeometry,
  spawnPoints,
} from '../src/game/arena-meshes.ts';

const building = {
  footprint: [
    [0, 0],
    [10, 0],
    [10, 20],
    [0, 20],
    [0, 0],
  ] as const,
  height: 5,
};

describe('buildingsGeometry', () => {
  it('extrudes footprints upwards in arena x/z', () => {
    const geometry = buildingsGeometry({
      halfSize: 150,
      buildings: [building],
    });
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

  it('stands on the lowest ground under the footprint', () => {
    // A 3×3 grid over ±10 m: the box covers the south-east quarter's nodes.
    const geometry = buildingsGeometry({
      halfSize: 10,
      buildings: [building],
      terrain: { size: 3, heights: [9, 9, 9, 9, 4, 6, 9, 7, 5] },
    });
    geometry?.computeBoundingBox();
    assert.closeTo(geometry?.boundingBox?.min.y ?? Number.NaN, 4, 1e-9);
    assert.closeTo(geometry?.boundingBox?.max.y ?? Number.NaN, 9, 1e-9);
  });

  it('skips degenerate footprints', () => {
    assert.isUndefined(
      buildingsGeometry({
        halfSize: 150,
        buildings: [
          {
            footprint: [
              [0, 0],
              [1, 1],
            ],
            height: 3,
          },
        ],
      }),
    );
  });
});

describe('groundGeometry', () => {
  it('lays the terrain grid out from the north-west, row by row', () => {
    const geometry = groundGeometry({
      halfSize: 10,
      terrain: { size: 2, heights: [1, 2, 3, 4] },
    });
    const position = geometry.getAttribute('position');
    const vertices = Arr.makeBy(position.count, (i) =>
      new Vector3().fromBufferAttribute(position, i).toArray(),
    );
    assert.deepStrictEqual(vertices, [
      [-10, 1, -10],
      [10, 2, -10],
      [-10, 3, 10],
      [10, 4, 10],
    ]);
  });

  it('is flat without terrain', () => {
    const position = groundGeometry({ halfSize: 10 }).getAttribute('position');
    assert.deepStrictEqual(
      Arr.makeBy(position.count, (i) => position.getY(i)),
      [0, 0, 0, 0],
    );
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
