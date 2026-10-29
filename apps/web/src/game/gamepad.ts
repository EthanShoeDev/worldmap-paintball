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
export const Button = {
  a: 0,
  x: 2,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  l3: 10,
  left: 14,
  right: 15,
} as const;

// Which buttons are down; triggers count past half travel.
export const pressedButtons = (pad: PadState) =>
  Arr.map(pad.buttons, (button) => button.pressed || button.value > 0.5);

// `held` is last frame's `pressedButtons`, so a held bumper cycles once.
// `sprinting` is last frame's sprint: clicking L3 while moving forward turns
// it on, and it stays on until the stick stops pushing forward, the player
// fires or aims, or L3 is clicked again.
export const gamepadIntent = (
  pad: PadState,
  dt: number,
  settings = defaultGamepadSettings,
  held: ReadonlyArray<boolean> = [],
  sprinting = false,
): Intent => {
  const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
  const [moveX, moveY] = applyDeadzone([lx, ly], settings.deadzone);
  const [lookX, lookY] = applyDeadzone([rx, ry], settings.deadzone);
  const down = pressedButtons(pad);
  const pressed = (index: number) => down[index] === true;
  const tapped = (...indices: ReadonlyArray<number>) =>
    Arr.some(indices, (index) => pressed(index) && held[index] !== true);
  const cycle =
    (tapped(Button.rb, Button.right) ? 1 : 0) -
    (tapped(Button.lb, Button.left) ? 1 : 0);
  const forward = -moveY > 0;
  const busy = pressed(Button.rt) || pressed(Button.lt);
  const sprint =
    forward && !busy && (tapped(Button.l3) ? !sprinting : sprinting);
  return {
    move: [moveX, -moveY],
    look: [
      lookX * settings.lookSpeed[0] * dt,
      lookY * settings.lookSpeed[1] * dt,
    ],
    jump: pressed(Button.a),
    sprint,
    fire: pressed(Button.rt),
    reload: pressed(Button.x),
    zoom: pressed(Button.lt),
    selectWeapon: cycle === 0 ? undefined : { cycle },
  };
};

// `held` holds each pad's `pressedButtons` from last frame, and `sprinting`
// each pad's sprint, in pad order. Returns the merged intent and each pad's
// sprint, to pass back next frame.
export const pollGamepads = (
  pads: ReadonlyArray<PadState>,
  dt: number,
  held: ReadonlyArray<ReadonlyArray<boolean>> = [],
  sprinting: ReadonlyArray<boolean> = [],
  settings = defaultGamepadSettings,
) => {
  const intents = Arr.map(pads, (pad, index) =>
    gamepadIntent(pad, dt, settings, held[index], sprinting[index]),
  );
  return {
    intent: Arr.reduce(intents, idleIntent, mergeIntents),
    sprinting: Arr.map(intents, (intent) => intent.sprint),
  };
};
