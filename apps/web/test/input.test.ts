import { assert, describe, it } from '@effect/vitest';

import {
  applyDeadzone,
  gamepadIntent,
  pollGamepads,
} from '../src/game/gamepad.ts';
import { idleIntent, mergeIntents } from '../src/game/intent.ts';
import { keyboardMouseIntent } from '../src/game/keyboard-mouse.ts';

const button = (value: number) => ({
  pressed: value > 0.5,
  touched: value > 0,
  value,
});

const pad = (axes: number[], pressedButtons: number[] = []) => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, index) =>
    button(pressedButtons.includes(index) ? 1 : 0),
  ),
});

const assertClose = (
  actual: readonly number[],
  expected: readonly number[],
) => {
  for (const [index, value] of actual.entries()) {
    assert.closeTo(value, expected[index] ?? Number.NaN, 1e-9);
  }
};

describe('applyDeadzone', () => {
  it('zeroes input inside the deadzone', () => {
    assert.deepStrictEqual(applyDeadzone([0.1, -0.05], 0.15), [0, 0]);
  });

  it('rescales from the deadzone edge to full deflection', () => {
    assertClose(applyDeadzone([0.575, 0], 0.15), [0.5, 0]);
    assertClose(applyDeadzone([1, 0], 0.15), [1, 0]);
  });

  it('keeps direction and caps magnitude at 1', () => {
    const [x, y] = applyDeadzone([1, 1], 0.15);
    assert.closeTo(Math.hypot(x, y), 1, 1e-9);
    assert.closeTo(x, y, 1e-9);
  });
});

describe('gamepadIntent', () => {
  it('maps sticks with forward as stick-up', () => {
    const intent = gamepadIntent(pad([0, -1, 1, 0]), 0.5, {
      deadzone: 0.1,
      lookSpeed: [2, 2],
    });
    assertClose(intent.move, [0, 1]);
    assertClose(intent.look, [1, 0]);
  });

  it('maps standard buttons', () => {
    const intent = gamepadIntent(pad([0, 0, 0, 0], [0, 4, 7]), 1 / 60);
    assert.isTrue(intent.jump);
    assert.isTrue(intent.sprint);
    assert.isTrue(intent.fire);
    assert.isTrue(gamepadIntent(pad([0, 0, 0, 0], [10]), 1 / 60).sprint);
  });

  it('is idle without pads', () => {
    assert.deepStrictEqual(pollGamepads([], 1 / 60), idleIntent);
  });
});

describe('keyboardMouseIntent', () => {
  it('normalises diagonal movement', () => {
    const intent = keyboardMouseIntent(
      new Set(['KeyW', 'KeyD']),
      [0, 0],
      false,
    );
    assertClose(intent.move, [Math.SQRT1_2, Math.SQRT1_2]);
  });

  it('cancels opposing keys and reads actions', () => {
    const intent = keyboardMouseIntent(
      new Set(['KeyW', 'KeyS', 'Space', 'ShiftLeft']),
      [0, 0],
      true,
    );
    assertClose(intent.move, [0, 0]);
    assert.isTrue(intent.jump && intent.sprint && intent.fire);
  });
});

describe('mergeIntents', () => {
  it('adds look, clamps move and ors buttons', () => {
    const merged = mergeIntents(
      { ...idleIntent, move: [1, 0], look: [0.1, 0], jump: true },
      { ...idleIntent, move: [0, 1], look: [0.2, -0.1], fire: true },
    );
    assertClose(merged.move, [Math.SQRT1_2, Math.SQRT1_2]);
    assertClose(merged.look, [0.3, -0.1]);
    assert.isTrue(merged.jump && merged.fire);
    assert.isFalse(merged.sprint);
  });
});
