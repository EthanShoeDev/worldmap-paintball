import { Array as Arr } from 'effect';

import { type Intent, type Vec2, clampLength } from './intent.ts';

// Radians per pixel of pointer-locked mouse movement.
const mouseSensitivity = 0.0022;

const axis = (
  keys: ReadonlySet<string>,
  negative: ReadonlyArray<string>,
  positive: ReadonlyArray<string>,
) =>
  (Arr.some(positive, (key) => keys.has(key)) ? 1 : 0) -
  (Arr.some(negative, (key) => keys.has(key)) ? 1 : 0);

export const keyboardMouseIntent = (
  keys: ReadonlySet<string>,
  mouseDelta: Vec2,
  mouseDown: boolean,
): Intent => ({
  move: clampLength([
    axis(keys, ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
    axis(keys, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']),
  ]),
  look: [mouseDelta[0] * mouseSensitivity, mouseDelta[1] * mouseSensitivity],
  jump: keys.has('Space'),
  sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  fire: mouseDown,
});
