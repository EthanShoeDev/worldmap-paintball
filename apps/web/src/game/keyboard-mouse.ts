import { Array as Arr, Option } from 'effect';

import { type Intent, type Vec2, clampLength } from './intent.ts';

// Radians per pixel of pointer-locked mouse movement.
const mouseSensitivity = 0.0022;

const slotKeys = [
  ['Digit1', 'Numpad1'],
  ['Digit2', 'Numpad2'],
  ['Digit3', 'Numpad3'],
  ['Digit4', 'Numpad4'],
] as const;

export const MouseButton = { primary: 0, secondary: 2 } as const;

export interface MouseInput {
  readonly delta: Vec2;
  readonly buttons: ReadonlySet<number>;
  // Wheel notches since the last frame, positive scrolling down.
  readonly wheel: number;
}

const axis = (
  keys: ReadonlySet<string>,
  negative: ReadonlyArray<string>,
  positive: ReadonlyArray<string>,
) =>
  (Arr.some(positive, (key) => keys.has(key)) ? 1 : 0) -
  (Arr.some(negative, (key) => keys.has(key)) ? 1 : 0);

export const keyboardMouseIntent = (
  keys: ReadonlySet<string>,
  mouse: MouseInput,
): Intent => {
  const slot = Arr.findFirstIndex(slotKeys, (codes) =>
    Arr.some(codes, (code) => keys.has(code)),
  );
  return {
    move: clampLength([
      axis(keys, ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
      axis(keys, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
    ]),
    look: [
      mouse.delta[0] * mouseSensitivity,
      mouse.delta[1] * mouseSensitivity,
    ],
    jump: keys.has('Space'),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    fire: mouse.buttons.has(MouseButton.primary),
    reload: keys.has('KeyR'),
    zoom: mouse.buttons.has(MouseButton.secondary),
    selectWeapon: Option.isSome(slot)
      ? { slot: slot.value }
      : mouse.wheel === 0
        ? undefined
        : { cycle: Math.sign(mouse.wheel) },
  };
};
