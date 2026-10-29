import { assert, describe, it } from '@effect/vitest';

import { renderDpr, renderScaleLabel } from '../src/game/render-scale.ts';

describe('renderDpr', () => {
  it('scales a fixed choice from the screen’s own ratio', () => {
    assert.strictEqual(renderDpr('100', 2, 0), 2);
    assert.strictEqual(renderDpr('50', 2, 1), 1);
    assert.strictEqual(renderDpr('75', 2, 1), 1.5);
  });

  it('never goes below the floor', () => {
    assert.strictEqual(renderDpr('35', 1, 1), 0.5);
    assert.strictEqual(renderDpr('auto', 2, 0), 0.5);
  });

  it('caps auto below native on high-DPI screens', () => {
    assert.strictEqual(renderDpr('auto', 2.5, 1), 1.5);
    assert.strictEqual(renderDpr('auto', 1, 1), 1);
  });

  it('follows the monitor factor in steps of 0.05', () => {
    assert.strictEqual(renderDpr('auto', 2, 0.5), 1);
    assert.strictEqual(renderDpr('auto', 2, 0.33), 0.85);
  });
});

describe('renderScaleLabel', () => {
  it('names each choice', () => {
    assert.strictEqual(renderScaleLabel('auto'), 'Auto');
    assert.strictEqual(renderScaleLabel('100'), 'Native');
    assert.strictEqual(renderScaleLabel('50'), '50%');
  });
});
