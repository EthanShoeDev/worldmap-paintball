import { assert, describe, it } from '@effect/vitest';
import type { Arena } from '@worldmap-paintball/api-contract';
import { defaultMapSettings } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';

import { spawnPoints } from '../src/game/arena-meshes.ts';
import { clipToCircle, customizeArena } from '../src/game/map-settings.ts';

const square = (x: number, z: number) =>
  [
    [x - 2, z - 2],
    [x + 2, z - 2],
    [x + 2, z + 2],
    [x - 2, z + 2],
  ] as const;

const baked: Arena = {
  lat: 35.9,
  lon: -79,
  halfSize: 100,
  buildings: [
    { footprint: square(0, 0), height: 6 },
    { footprint: square(90, 90), height: 6 },
  ],
  roads: [
    {
      width: 6,
      path: [
        [-95, 95],
        [0, 0],
        [95, -95],
        [99, -99],
      ],
    },
  ],
  areas: [],
};

describe('customizeArena', () => {
  it('keeps a square bake as it is', () => {
    const arena = customizeArena(baked, defaultMapSettings);
    assert.isUndefined(arena.round);
    assert.lengthOf(arena.buildings, 2);
    assert.deepStrictEqual(arena.roads, baked.roads);
  });

  it('walls a circle: corner houses go and roads stop at the wall', () => {
    const arena = customizeArena(baked, {
      ...defaultMapSettings,
      shape: 'circle',
      buildings: [
        { footprint: square(-90, -90), height: 3 },
        { footprint: square(0, 50), height: 3 },
      ],
    });
    assert.isTrue(arena.round);
    assert.deepStrictEqual(
      Arr.map(arena.buildings, ({ footprint }) => footprint[0]),
      [square(0, 0)[0], square(0, 50)[0]],
    );
    assert.lengthOf(arena.roads, 1);
    const [entry, middle, exit] = arena.roads[0]?.path ?? [];
    assert.deepStrictEqual(middle, [0, 0]);
    assert.closeTo(Math.hypot(...(entry ?? [0, 0])), 100, 1e-9);
    assert.closeTo(Math.hypot(...(exit ?? [0, 0])), 100, 1e-9);
    assert.lengthOf(arena.roads[0]?.path ?? [], 3);
  });

  it('splits a road that leaves and comes back', () => {
    const runs = clipToCircle(
      [
        [0, 0],
        [200, 0],
        [200, 10],
        [0, 10],
      ],
      100,
    );
    assert.lengthOf(runs, 2);
    assert.deepStrictEqual(runs[0]?.[0], [0, 0]);
    assert.deepStrictEqual(runs[1]?.at(-1), [0, 10]);
  });

  it('spawns only inside the circle', () => {
    const arena = customizeArena(
      { ...baked, buildings: [], roads: [] },
      { ...defaultMapSettings, shape: 'circle' },
    );
    for (const [x, z] of spawnPoints(arena)) {
      assert.isAtMost(Math.hypot(x, z), 95);
    }
  });
});
