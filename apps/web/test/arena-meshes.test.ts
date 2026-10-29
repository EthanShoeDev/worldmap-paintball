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
  const house = (x: number, z: number, half: number) => ({
    footprint: [
      [x - half, z - half],
      [x + half, z - half],
      [x + half, z + half],
      [x - half, z + half],
    ] as const,
    height: 1,
  });
  const empty = { roads: [], buildings: [], areas: [], halfSize: 50 };

  it('scatters points inside the walls, the same on every call', () => {
    const points = spawnPoints(empty, { count: 20 });
    assert.lengthOf(points, 20);
    assert.deepStrictEqual(spawnPoints(empty, { count: 20 }), points);
    for (const [x, z] of points) {
      assert.isAtMost(Math.abs(x), 45);
      assert.isAtMost(Math.abs(z), 45);
    }
  });

  it('spreads the first spawns apart', () => {
    const [a, b] = spawnPoints(empty);
    assert.isDefined(a);
    assert.isDefined(b);
    assert.isAbove(Math.hypot(a[0] - b[0], a[1] - b[1]), 50);
  });

  it('never spawns inside or beside a building, or in water', () => {
    const pond = {
      kind: 'water' as const,
      outline: [
        [-45, -45],
        [0, -45],
        [0, 0],
        [-45, 0],
      ] as const,
    };
    const points = spawnPoints({
      ...empty,
      buildings: [house(20, 20, 15)],
      areas: [pond],
    });
    assert.isAbove(points.length, 10);
    for (const [x, z] of points) {
      assert.isFalse(x <= 0 && z <= 0, `in the pond at ${x}, ${z}`);
      assert.isFalse(
        Math.abs(x - 20) < 16.5 && Math.abs(z - 20) < 16.5,
        `in the house at ${x}, ${z}`,
      );
    }
  });

  it('falls back to the centre when nothing is open', () => {
    assert.deepStrictEqual(
      spawnPoints({ ...empty, buildings: [house(0, 0, 60)] }),
      [[0, 0]],
    );
  });
});
