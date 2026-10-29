import type { Vec3 } from './net/protocol.ts';

// Moves the minimap's markers outside React, since they change every frame.

const percentOf = (halfSize: number, value: number) =>
  `${((value + halfSize) / (2 * halfSize)) * 100}%`;

export const placeArrow = (
  arrow: HTMLElement,
  halfSize: number,
  x: number,
  z: number,
  yaw: number,
) => {
  arrow.style.left = percentOf(halfSize, x);
  arrow.style.top = percentOf(halfSize, z);
  arrow.style.transform = `translate(-50%, -50%) rotate(${-yaw}rad)`;
};

// One dot per other player, in their colour, for the reveal mutator. Dots are
// made as players appear and hidden, not removed, as they leave.
export const placeDots = (
  container: HTMLElement,
  halfSize: number,
  others: ReadonlyArray<readonly [string, Vec3]>,
  colorOf: (id: string) => string,
) => {
  while (container.children.length < others.length) {
    const dot = document.createElement('div');
    dot.className =
      'absolute size-2.5 -translate-1/2 rounded-full ring-2 ring-white/80';
    container.append(dot);
  }
  for (const [index, dot] of [...container.children].entries()) {
    if (!(dot instanceof HTMLElement)) continue;
    const other = others[index];
    dot.hidden = other === undefined;
    if (!other) continue;
    const [id, [x, , z]] = other;
    dot.style.left = percentOf(halfSize, x);
    dot.style.top = percentOf(halfSize, z);
    dot.style.backgroundColor = colorOf(id);
  }
};
