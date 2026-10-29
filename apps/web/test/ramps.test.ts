import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';
import { Quaternion, Vector3 } from 'three';

import { rampsOf } from '../src/game/ramps.ts';

const house = (x: number, z: number) => ({
  footprint: [
    [x, z],
    [x + 12, z],
    [x + 12, z + 8],
    [x, z + 8],
  ] as const,
  height: 6,
});

const houses = Arr.flatMap(Arr.range(0, 9), (row) =>
  Arr.map(Arr.range(0, 9), (column) => house(column * 20 - 95, row * 20 - 95)),
);

describe('rampsOf', () => {
  const ramps = rampsOf({ halfSize: 150, buildings: houses });

  it('gives some houses, not all, a ramp, the same every time', () => {
    assert.isAbove(ramps.length, 10);
    assert.isBelow(ramps.length, houses.length);
    assert.deepStrictEqual(
      rampsOf({ halfSize: 150, buildings: houses }),
      ramps,
    );
  });

  it('runs each ramp from the flat ground up to the roof', () => {
    for (const { position, quaternion, halfExtents } of ramps) {
      const along = new Vector3(1, 0, 0).applyQuaternion(
        new Quaternion(...quaternion),
      );
      const surface = new Vector3(0, 1, 0)
        .applyQuaternion(new Quaternion(...quaternion))
        .multiplyScalar(halfExtents[1]);
      const centre = new Vector3(...position).add(surface);
      const top = centre.clone().addScaledVector(along, halfExtents[0]);
      const bottom = centre.clone().addScaledVector(along, -halfExtents[0]);
      const [high, low] = top.y > bottom.y ? [top, bottom] : [bottom, top];
      assert.closeTo(high.y, 6, 1e-6);
      assert.closeTo(low.y, 0, 1e-6);
    }
  });
});
