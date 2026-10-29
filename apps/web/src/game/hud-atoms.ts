import '@tanstack/react-start/client-only';
import { Array as Arr } from 'effect';
import { Atom } from 'effect/reactivity';

import { connectedGamepads } from './devices.ts';
import { type CombatView, combatViewOf, makeLoadout } from './loadout.ts';
import type { PowerUpView } from './powerups.ts';

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

// Set by the render loop, at most once a frame and only on a change.
export const combatViewAtom = Atom.make<CombatView>(
  combatViewOf(makeLoadout(), false),
);

// Counts this player's balls that reached another player; each new count
// flashes the hit marker.
export const hitMarkerAtom = Atom.make(0);

// The local player's running power-up; set by the render loop on a change.
export const powerUpViewAtom = Atom.make<PowerUpView | undefined>(undefined);
