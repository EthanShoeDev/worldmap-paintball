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

// With you, one per palette colour.
export const maxPracticeBots = 7;

// Practice bots; times in seconds, angles in radians, distances in metres.
export const botTuning = {
  engageRange: 60,
  viewCone: (110 * Math.PI) / 180,
  sightInterval: 0.2,
  turnRate: 3.5,
  aimJitter: 0.05,
  jitterInterval: 0.4,
  reaction: [0.35, 0.6],
  aimThreshold: 0.08,
  burst: [3, 5],
  burstPause: 0.6,
  strafeFlip: [0.6, 1.6],
  // Closes in on a target further than this, backs off from one nearer.
  engageDistance: [8, 25],
  // Aims at the chest: the eye sits above most of the hitbox.
  aimDrop: 0.6,
  waypointRadius: 1.5,
  stuckSpeed: 0.5,
  stuckAfter: 1,
} as const;

// The ground texture: an aerial photo when there is one, with the map's
// areas and roads painted over it. Alphas apply over the photo only; without
// one the fills are opaque.
export const groundTuning = {
  textureSize: 2048,
  imageryTimeoutMs: 8000,
  // Luma spread below which a photo counts as a blank tile.
  blankContrast: 8,
  photoAlpha: { park: 0.18, water: 0.35, wood: 0.12, grass: 0.1, roads: 0.5 },
  // Roads narrow over the photo, which already shows the carriageway.
  photoRoadWidth: 0.6,
} as const;

// Trees scattered through `wood` areas; visual only, without colliders.
export const treeTuning = {
  // Trees per square metre, scaled down when the arena's woods exceed the cap.
  density: 1 / 70,
  maxTrees: 1500,
  height: [6, 13],
  coniferShare: 0.4,
  // Keeps trunks off the boundary walls.
  wallMargin: 2,
  seed: 20_250_917,
} as const;

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
