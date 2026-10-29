import { assert, describe, it } from '@effect/vitest';

import { groundBelow, heightAt, heightRange } from '../src/game/terrain.ts';

// 3×3 over ±10 m: nodes every 10 m, rows from north (z = -10) to south.
const ground = {
  halfSize: 10,
  terrain: { size: 3, heights: [0, 1, 2, 3, 4, 5, 6, 7, 20] },
};

describe('heightAt', () => {
  it('is flat without terrain', () => {
    assert.strictEqual(heightAt({ halfSize: 10 }, 3, -4), 0);
  });

  it('returns node heights at the nodes', () => {
    assert.strictEqual(heightAt(ground, -10, -10), 0);
    assert.strictEqual(heightAt(ground, 10, -10), 2);
    assert.strictEqual(heightAt(ground, -10, 10), 6);
    assert.strictEqual(heightAt(ground, 0, 0), 4);
    assert.strictEqual(heightAt(ground, 10, 10), 20);
  });

  it('interpolates bilinearly inside a cell', () => {
    assert.closeTo(heightAt(ground, -5, -10), 0.5, 1e-9);
    assert.closeTo(heightAt(ground, -10, -5), 1.5, 1e-9);
    // Cell corners 4, 5, 7, 20.
    assert.closeTo(heightAt(ground, 5, 5), (4 + 5 + 7 + 20) / 4, 1e-9);
    assert.closeTo(heightAt(ground, 7.5, 2.5), 7.75, 1e-9);
  });

  it('clamps to the edge outside the arena', () => {
    assert.strictEqual(heightAt(ground, 50, 50), 20);
    assert.strictEqual(heightAt(ground, -50, -10), 0);
  });
});

describe('groundBelow', () => {
  it('takes the lowest node of the cells under the points', () => {
    assert.strictEqual(
      groundBelow(ground, [
        [6, 6],
        [8, 9],
      ]),
      4,
    );
  });

  it('never exceeds the interpolated ground under the points', () => {
    const points = [
      [-7, 2],
      [3, 8],
    ] as const;
    const base = groundBelow(ground, points);
    for (const [x, z] of points) assert.isAtMost(base, heightAt(ground, x, z));
  });

  it('is 0 without terrain', () => {
    assert.strictEqual(groundBelow({ halfSize: 10 }, [[1, 1]]), 0);
  });
});

describe('heightRange', () => {
  it('spans the grid', () => {
    assert.deepStrictEqual(heightRange(ground), { lowest: 0, highest: 20 });
    assert.deepStrictEqual(heightRange({ halfSize: 10 }), {
      lowest: 0,
      highest: 0,
    });
  });
});
