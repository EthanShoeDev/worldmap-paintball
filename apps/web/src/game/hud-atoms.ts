import '@tanstack/react-start/client-only';
import { Array as Arr } from 'effect';
import { Atom } from 'effect/reactivity';

import { connectedGamepads } from './devices.ts';

const listen = (
  target: EventTarget,
  events: ReadonlyArray<string>,
  onEvent: () => void,
) => {
  for (const event of events) target.addEventListener(event, onEvent);
  return () => {
    for (const event of events) target.removeEventListener(event, onEvent);
  };
};

export const pointerLockedAtom = Atom.make((get) => {
  const locked = () => document.pointerLockElement !== null;
  get.addFinalizer(
    listen(document, ['pointerlockchange'], () => get.setSelf(locked())),
  );
  return locked();
});

export const gamepadNamesAtom = Atom.make((get) => {
  const names = () => Arr.map(connectedGamepads(), (pad) => pad.id);
  get.addFinalizer(
    listen(window, ['gamepadconnected', 'gamepaddisconnected'], () =>
      get.setSelf(names()),
    ),
  );
  return names();
});
