import { assert, describe, it } from '@effect/vitest';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';

import { heightAt } from '../src/game/terrain.ts';
import { insideRing, scatterTrees } from '../src/game/trees.ts';
import { treeTuning } from '../src/game/tuning.ts';

const square = (x: number, z: number, side: number) =>
  [
    [x, z],
    [x + side, z],
    [x + side, z + side],
    [x, z + side],
    [x, z],
  ] as const;

// An L-shaped wood, so its bounding box holds ground outside it.
const ell = [
  [-60, -60],
  [0, -60],
  [0, 0],
  [-30, 0],
  [-30, 30],
  [-60, 30],
] as const;

const arena = (areas: Arena['areas']) => ({
  halfSize: 150,
  terrain: { size: 2, heights: [0, 10, 20, 30] },
  areas,
});

describe('scatterTrees', () => {
  it('is deterministic', () => {
    const woods = arena([{ kind: 'wood', outline: ell }]);
    assert.deepStrictEqual(scatterTrees(woods), scatterTrees(woods));
  });

  it('keeps trees inside wood outlines, on the ground', () => {
    const woods = arena([
      { kind: 'wood', outline: ell },
      { kind: 'park', outline: square(20, 20, 80) },
    ]);
    const trees = scatterTrees(woods);
    assert.isAbove(trees.length, 0);
    for (const { position } of trees) {
      const [x, y, z] = position;
      assert.isTrue(insideRing(ell, [x, z]));
      assert.closeTo(y, heightAt(woods, x, z), 1e-9);
    }
  });

  it('fills a wood at about the tuned density', () => {
    const trees = scatterTrees(arena([{ kind: 'wood', outline: ell }]));
    const area = 60 * 60 + 30 * 30;
    assert.closeTo(trees.length, area * treeTuning.density, 12);
  });

  it('fills the part of a wood inside the arena, and only that', () => {
    const limit = 150 - treeTuning.wallMargin;
    const trees = scatterTrees(
      arena([{ kind: 'wood', outline: square(-2000, -2000, 2100) }]),
    );
    const inside = (limit + 100) * (limit + 100);
    assert.closeTo(trees.length, inside * treeTuning.density, 40);
    for (const { position } of trees) {
      assert.isAtMost(Math.abs(position[0]), limit);
      assert.isAtMost(Math.abs(position[2]), limit);
    }
  });

  it('respects the cap across all woods', () => {
    const woods = arena([
      { kind: 'wood', outline: square(-140, -140, 140) },
      { kind: 'wood', outline: square(0, 0, 140) },
    ]);
    const trees = scatterTrees(woods, 50);
    assert.isAtMost(trees.length, 50);
    assert.isAtLeast(trees.length, 45);
    // Shared out by area rather than spent on the first wood.
    assert.isAbove(Arr.filter(trees, ({ position: [x] }) => x > 0).length, 15);
  });

  it('plants nothing without woods', () => {
    assert.deepStrictEqual(
      scatterTrees(arena([{ kind: 'grass', outline: ell }])),
      [],
    );
  });
});

describe('insideRing', () => {
  it('tells inside from the notch of an L', () => {
    assert.isTrue(insideRing(ell, [-45, 15]));
    assert.isFalse(insideRing(ell, [-15, 15]));
    assert.isFalse(insideRing(ell, [10, -30]));
  });
});
