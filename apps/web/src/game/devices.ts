import '@tanstack/react-start/client-only';
import { Array as Arr } from 'effect';

import { keyboardMouseIntent } from './keyboard-mouse.ts';

export const connectedGamepads = () =>
  Arr.filter(
    navigator.getGamepads(),
    (pad): pad is Gamepad => pad?.connected === true,
  );

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
