import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';
import { Quaternion, Vector3 } from 'three';

import { insideRing } from '../src/game/arena-meshes.ts';
import { carSizes, parkedCars } from '../src/game/cars.ts';

const street = (z: number, width = 8) => ({
  path: [
    [-140, z],
    [140, z],
  ] as const,
  width,
});

const town = {
  lat: 0,
  lon: 0,
  halfSize: 150,
  roads: [street(0)],
  buildings: [],
  areas: [],
};

describe('parkedCars', () => {
  it('parks the same cars every time, along the kerbs', () => {
    const cars = parkedCars(town);
    assert.isAbove(cars.length, 3);
    assert.deepStrictEqual(parkedCars(town), cars);
    for (const { kind, centre, quaternion } of cars) {
      const [, width] = carSizes[kind];
      assert.closeTo(Math.abs(centre[2]), 4 - width / 2 - 0.3, 1e-9);
      // Lengthwise along the street, which runs east.
      const length = new Vector3(0, 0, 1).applyQuaternion(
        new Quaternion(...quaternion),
      );
      assert.closeTo(Math.abs(length.x), 1, 1e-9);
    }
  });

  it('leaves footpaths and service lanes empty', () => {
    assert.lengthOf(parkedCars({ ...town, roads: [street(0, 4)] }), 0);
  });

  it('keeps off junctions', () => {
    const crossing = {
      path: [
        [0, -140],
        [0, 140],
      ] as const,
      width: 8,
    };
    const cars = parkedCars({ ...town, roads: [street(0), crossing] });
    assert.isAbove(cars.length, 3);
    for (const { centre } of cars) {
      assert.isAbove(Math.hypot(centre[0], centre[2]), 6);
    }
  });

  it('never parks in a building', () => {
    const footprint = [
      [-60, -5],
      [60, -5],
      [60, 5],
      [-60, 5],
    ] as const;
    const cars = parkedCars({
      ...town,
      buildings: [{ footprint, height: 30 }],
    });
    for (const { centre } of cars) {
      assert.isFalse(insideRing([centre[0], centre[2]], footprint));
    }
  });

  it('parks a limited number in a dense town', () => {
    const grid = Arr.makeBy(30, (row) => street(-145 + row * 10));
    assert.isAtMost(parkedCars({ ...town, roads: grid }).length, 75);
  });
});
