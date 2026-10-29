import { assert, describe, it } from '@effect/vitest';

import {
  applyDeadzone,
  Button,
  gamepadIntent,
  pollGamepads,
  pressedButtons,
} from '../src/game/gamepad.ts';
import { idleIntent, mergeIntents } from '../src/game/intent.ts';
import {
  keyboardMouseIntent,
  MouseButton,
} from '../src/game/keyboard-mouse.ts';

const mouse = (buttons: ReadonlyArray<number> = [], wheel = 0) => ({
  delta: [0, 0] as const,
  buttons: new Set(buttons),
  wheel,
});

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
    const intent = gamepadIntent(
      pad([0, 0, 0, 0], [Button.a, Button.rt, Button.l3, Button.x, Button.lt]),
      1 / 60,
    );
    assert.isTrue(intent.jump);
    assert.isTrue(intent.sprint);
    assert.isTrue(intent.fire);
    assert.isTrue(intent.reload);
    assert.isTrue(intent.zoom);
    const idle = gamepadIntent(pad([0, 0, 0, 0]), 1 / 60);
    assert.isFalse(idle.reload || idle.zoom || idle.fire);
    assert.isUndefined(idle.selectWeapon);
  });

  it('cycles weapons on a bumper or d-pad press, once per press', () => {
    const cycle = (buttons: number[], held: number[] = []) =>
      gamepadIntent(
        pad([0, 0, 0, 0], buttons),
        1 / 60,
        undefined,
        pressedButtons(pad([0, 0, 0, 0], held)),
      ).selectWeapon;
    assert.deepStrictEqual(cycle([Button.rb]), { cycle: 1 });
    assert.deepStrictEqual(cycle([Button.right]), { cycle: 1 });
    assert.deepStrictEqual(cycle([Button.lb]), { cycle: -1 });
    assert.deepStrictEqual(cycle([Button.left]), { cycle: -1 });
    assert.isUndefined(cycle([Button.rb], [Button.rb]));
    assert.isUndefined(cycle([Button.lb, Button.rb]));
    assert.isFalse(gamepadIntent(pad([0, 0, 0, 0], [Button.lb]), 1).sprint);
  });

  it('remembers each pad held separately', () => {
    const rb = pad([0, 0, 0, 0], [Button.rb]);
    const idle = pad([0, 0, 0, 0]);
    assert.deepStrictEqual(
      pollGamepads([idle, rb], 1 / 60, [pressedButtons(rb), []]).selectWeapon,
      { cycle: 1 },
    );
    assert.isUndefined(
      pollGamepads([idle, rb], 1 / 60, [[], pressedButtons(rb)]).selectWeapon,
    );
  });

  it('is idle without pads', () => {
    assert.deepStrictEqual(pollGamepads([], 1 / 60), idleIntent);
  });
});

describe('keyboardMouseIntent', () => {
  it('normalises diagonal movement', () => {
    const intent = keyboardMouseIntent(new Set(['KeyW', 'KeyD']), mouse());
    assertClose(intent.move, [Math.SQRT1_2, Math.SQRT1_2]);
  });

  it('cancels opposing keys and reads actions', () => {
    const intent = keyboardMouseIntent(
      new Set(['KeyW', 'KeyS', 'Space', 'ShiftLeft', 'KeyR']),
      mouse([MouseButton.primary, MouseButton.secondary]),
    );
    assertClose(intent.move, [0, 0]);
    assert.isTrue(intent.jump && intent.sprint && intent.fire);
    assert.isTrue(intent.reload && intent.zoom);
    const idle = keyboardMouseIntent(new Set(), mouse());
    assert.deepStrictEqual(idle, idleIntent);
  });

  it('zooms on the right button without firing', () => {
    const intent = keyboardMouseIntent(
      new Set(),
      mouse([MouseButton.secondary]),
    );
    assert.isTrue(intent.zoom);
    assert.isFalse(intent.fire);
  });

  it('selects a slot with 1 to 3 and steps with the wheel', () => {
    const select = (keys: string[], wheel = 0) =>
      keyboardMouseIntent(new Set(keys), mouse([], wheel)).selectWeapon;
    assert.deepStrictEqual(select(['Digit1']), { slot: 0 });
    assert.deepStrictEqual(select(['Digit2']), { slot: 1 });
    assert.deepStrictEqual(select(['Numpad3']), { slot: 2 });
    assert.deepStrictEqual(select([], 1), { cycle: 1 });
    assert.deepStrictEqual(select([], -2), { cycle: -1 });
    assert.deepStrictEqual(select(['Digit3'], 1), { slot: 2 });
    assert.isUndefined(select(['Digit4']));
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

  it('ors reload and zoom and keeps the first weapon selection', () => {
    const merged = mergeIntents(
      { ...idleIntent, reload: true, selectWeapon: { slot: 2 } },
      { ...idleIntent, zoom: true, selectWeapon: { cycle: 1 } },
    );
    assert.isTrue(merged.reload && merged.zoom);
    assert.deepStrictEqual(merged.selectWeapon, { slot: 2 });
    assert.deepStrictEqual(
      mergeIntents(idleIntent, { ...idleIntent, selectWeapon: { cycle: -1 } })
        .selectWeapon,
      { cycle: -1 },
    );
  });
});
