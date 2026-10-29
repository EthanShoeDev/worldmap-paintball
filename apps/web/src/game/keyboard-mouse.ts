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

// Listens on `element` for pointer lock and on the window for keys; `read`
// returns this frame's intent and consumes the accumulated mouse movement.
export const createKeyboardMouse = (element: HTMLElement) => {
  const keys = new Set<string>();
  let dx = 0;
  let dy = 0;
  let mouseDown = false;
  const locked = () => document.pointerLockElement === element;

  const onKeyDown = (event: KeyboardEvent) => {
    if (locked() && event.code === 'Space') event.preventDefault();
    keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  const onMouseMove = (event: MouseEvent) => {
    if (!locked()) return;
    dx += event.movementX;
    dy += event.movementY;
  };
  const onMouseDown = (event: MouseEvent) => {
    if (!locked()) {
      void element.requestPointerLock();
      return;
    }
    if (event.button === 0) mouseDown = true;
  };
  const onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) mouseDown = false;
  };
  const reset = () => {
    keys.clear();
    mouseDown = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', reset);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  element.addEventListener('mousedown', onMouseDown);

  return {
    read: () => {
      const intent = keyboardMouseIntent(keys, [dx, dy], mouseDown);
      dx = 0;
      dy = 0;
      return intent;
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      element.removeEventListener('mousedown', onMouseDown);
    },
  };
};
