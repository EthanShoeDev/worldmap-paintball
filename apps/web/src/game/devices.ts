import '@tanstack/react-start/client-only';
import { Array as Arr } from 'effect';

import { keyboardMouseIntent } from './keyboard-mouse.ts';

export const connectedGamepads = () =>
  Arr.filter(
    navigator.getGamepads(),
    (pad): pad is Gamepad => pad?.connected === true,
  );

// Browsers without raw input reject the option, so lock without it there; a
// lock asked for too soon after Esc is refused and needs another click.
export const lockPointer = (element: HTMLElement) => {
  void element
    .requestPointerLock({ unadjustedMovement: true })
    .catch(() => element.requestPointerLock())
    .catch(() => undefined);
};

// Pixels in one pointer-locked event beyond which it is a glitch, not a flick.
const maxMouseJump = 400;
const wheelGapMs = 120;

// Listens on `element` for pointer lock and on the window for keys; `read`
// returns this frame's intent and consumes the accumulated mouse movement.
export const createKeyboardMouse = (element: HTMLElement) => {
  const keys = new Set<string>();
  let dx = 0;
  let dy = 0;
  const buttons = new Set<number>();
  let wheel = 0;
  let lastWheel = Number.NEGATIVE_INFINITY;
  let settling = false;
  const locked = () => document.pointerLockElement === element;

  const onKeyDown = (event: KeyboardEvent) => {
    if (locked() && event.code === 'Space') event.preventDefault();
    keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  // Chromium (notably on Windows) can report a large bogus movement on a
  // click, and on the first move after locking; raw input avoids most of it
  // and these filters drop what remains.
  const onMouseMove = (event: MouseEvent) => {
    if (!locked()) return;
    if (settling) {
      settling = false;
      return;
    }
    if (
      Math.abs(event.movementX) > maxMouseJump ||
      Math.abs(event.movementY) > maxMouseJump
    ) {
      return;
    }
    dx += event.movementX;
    dy += event.movementY;
  };
  const onLockChange = () => {
    settling = locked();
  };
  const onMouseDown = (event: MouseEvent) => {
    if (!locked()) {
      lockPointer(element);
      return;
    }
    buttons.add(event.button);
  };
  const onMouseUp = (event: MouseEvent) => {
    buttons.delete(event.button);
  };
  // A trackpad sends a stream of small wheel events for one swipe, so only
  // the first in each `wheelGapMs` steps the weapon.
  const onWheel = (event: WheelEvent) => {
    if (!locked() || event.deltaY === 0) return;
    if (event.timeStamp - lastWheel < wheelGapMs) return;
    lastWheel = event.timeStamp;
    wheel += Math.sign(event.deltaY);
  };
  // The right button zooms.
  const onContextMenu = (event: MouseEvent) => event.preventDefault();
  const reset = () => {
    keys.clear();
    buttons.clear();
    wheel = 0;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', reset);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);
  element.addEventListener('mousedown', onMouseDown);
  element.addEventListener('wheel', onWheel, { passive: true });
  element.addEventListener('contextmenu', onContextMenu);

  return {
    read: () => {
      const intent = keyboardMouseIntent(keys, {
        delta: [dx, dy],
        buttons,
        wheel,
      });
      dx = 0;
      dy = 0;
      wheel = 0;
      return intent;
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      element.removeEventListener('mousedown', onMouseDown);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
    },
  };
};
