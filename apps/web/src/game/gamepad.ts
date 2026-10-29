import { Array as Arr } from 'effect';

import { type Intent, type Vec2, idleIntent, mergeIntents } from './intent.ts';

export interface GamepadSettings {
  readonly deadzone: number;
  // Radians per second at full right-stick deflection.
  readonly lookSpeed: Vec2;
}

export const defaultGamepadSettings: GamepadSettings = {
  deadzone: 0.15,
  lookSpeed: [3.2, 2.2],
};

// Radial deadzone, rescaled so output ramps from 0 at the deadzone edge.
export const applyDeadzone = ([x, y]: Vec2, deadzone: number): Vec2 => {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return [0, 0];
  const scale =
    (Math.min(magnitude, 1) - deadzone) / (1 - deadzone) / magnitude;
  return [x * scale, y * scale];
};

type PadState = Pick<Gamepad, 'axes' | 'buttons'>;

// Standard mapping: https://w3c.github.io/gamepad/#remapping
const Button = { a: 0, lb: 4, rt: 7, l3: 10 } as const;

const pressed = (pad: PadState, index: number) => {
  const button = pad.buttons[index];
  return button !== undefined && (button.pressed || button.value > 0.5);
};

export const gamepadIntent = (
  pad: PadState,
  dt: number,
  settings = defaultGamepadSettings,
): Intent => {
  const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
  const [moveX, moveY] = applyDeadzone([lx, ly], settings.deadzone);
  const [lookX, lookY] = applyDeadzone([rx, ry], settings.deadzone);
  return {
    move: [moveX, -moveY],
    look: [
      lookX * settings.lookSpeed[0] * dt,
      lookY * settings.lookSpeed[1] * dt,
    ],
    jump: pressed(pad, Button.a),
    sprint: pressed(pad, Button.l3) || pressed(pad, Button.lb),
    fire: pressed(pad, Button.rt),
  };
};

export const pollGamepads = (
  pads: ReadonlyArray<PadState>,
  dt: number,
  settings = defaultGamepadSettings,
) =>
  Arr.reduce(pads, idleIntent, (intent, pad) =>
    mergeIntents(intent, gamepadIntent(pad, dt, settings)),
  );
