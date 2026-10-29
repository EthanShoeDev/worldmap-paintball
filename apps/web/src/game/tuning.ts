// Player capsule: the rapier collider and the hitbox remote shots test.
export const bodyRadius = 0.35;
export const bodyHalfHeight = 0.5;
export const eyeOffset = 0.75;
// Bodies drop in from slightly above the ground so they never start embedded.
export const spawnHeight = bodyHalfHeight + bodyRadius + 0.5;

export const fireInterval = 0.15;
export const fireRange = 200;

export const respawnDelayMs = 3000;
export const netTickMs = 50;
export const interpolationBufferMs = 100;

const palette = [
  '#ff3b6b',
  '#3b82f6',
  '#facc15',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#06b6d4',
  '#ec4899',
];

export const playerColor = (index: number) =>
  palette[((index % palette.length) + palette.length) % palette.length] ??
  '#ff3b6b';
