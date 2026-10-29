import { Record } from 'effect';

// Player capsule: the rapier collider and the hitbox remote shots test.
export const bodyRadius = 0.35;
export const bodyHalfHeight = 0.5;
export const eyeOffset = 0.75;
// Bodies drop in from slightly above the ground so they never start embedded.
export const spawnHeight = bodyHalfHeight + bodyRadius + 0.5;

// Weapons, in m/s, radians and seconds. `spread` is the half-angle of the
// cone each pellet leaves in; `gravityScale` multiplies paintball gravity.
// One hit eliminates, so weapons differ only in how they shoot. Their order
// is the slot order, keys 1 to 3; a power-up's weapon takes key 4.
export const weaponIds = ['assault', 'sniper', 'shotgun'] as const;
export const allWeaponIds = [...weaponIds, 'launcher'] as const;
export type WeaponId = (typeof allWeaponIds)[number];

export interface WeaponSpec {
  readonly muzzleSpeed: number;
  readonly gravityScale: number;
  readonly spread: number;
  readonly pellets: number;
  readonly fireInterval: number;
  readonly lifetime: number;
  // Rounds in a pod, and the seconds to swap in a full one.
  readonly magazine: number;
  readonly reloadTime: number;
  // The field of view while zoomed, in degrees, for a weapon with a scope.
  readonly zoomFov?: number;
  // Only from a power-up: never reloads, and is put away once empty.
  readonly pickup?: true;
  // Eliminates everyone within this many metres of where a ball lands.
  readonly blast?: number;
  // Multiplies the drawn ball's size.
  readonly ballScale?: number;
}

const degrees = (angle: number) => (angle * Math.PI) / 180;

export type Weapons = Record<WeaponId, WeaponSpec>;

export const weapons: Weapons = {
  assault: {
    muzzleSpeed: 90,
    gravityScale: 1,
    spread: degrees(0.6),
    pellets: 1,
    fireInterval: 0.15,
    lifetime: 2.5,
    magazine: 40,
    reloadTime: 2,
  },
  sniper: {
    muzzleSpeed: 140,
    gravityScale: 0.6,
    spread: 0,
    pellets: 1,
    fireInterval: 1.1,
    lifetime: 4,
    magazine: 5,
    reloadTime: 2.5,
    zoomFov: 30,
  },
  // An 8° cone, and a lifetime that ends the balls about 25 m out.
  shotgun: {
    muzzleSpeed: 70,
    gravityScale: 1,
    spread: degrees(4),
    pellets: 6,
    fireInterval: 0.7,
    lifetime: 0.36,
    magazine: 8,
    reloadTime: 2.5,
  },
  // A slow, heavy paint grenade that bursts where it lands.
  launcher: {
    muzzleSpeed: 38,
    gravityScale: 0.7,
    spread: 0,
    pellets: 1,
    fireInterval: 1.2,
    lifetime: 4,
    magazine: 3,
    reloadTime: 0,
    pickup: true,
    blast: 4,
    ballScale: 3,
  },
};

// The weapons under a match's paintball speed mutator. Lifetimes stay put,
// so faster balls also fly further.
export const weaponsAt = (paintballSpeed: number): Weapons =>
  paintballSpeed === 1
    ? weapons
    : Record.map(weapons, (spec) => ({
        ...spec,
        muzzleSpeed: spec.muzzleSpeed * paintballSpeed,
      }));

export const defaultWeapon: WeaponId = 'assault';

// Seconds to put one weapon away and raise the next; `zoomResponse` is how
// fast the field of view eases toward its target, per second.
export const loadoutTuning = { swapTime: 0.3, zoomResponse: 14 } as const;

// What the host tolerates before it rejects a shot or hit, in milliseconds.
// Reliable messages can bunch up after a loss, so shots may arrive up to
// `jitter` early against their weapon's fire interval and reload time. A hit
// must follow a shot of its weapon within the ball's lifetime plus `hitLag`.
export const fairnessTuning = { jitter: 250, hitLag: 1000 } as const;

// Paintballs in flight; metres and seconds.
export const paintballTuning = {
  gravity: 9.81,
  // The longest step a ball is raycast along, so a slow frame can't tunnel.
  subStep: 1 / 60,
  // The crosshair's point is never nearer the eye than this, so a ball from
  // the muzzle never turns back across the view.
  minAim: 2,
  maxBalls: 256,
  // Drawn larger than a real 17 mm ball so it reads at a distance.
  radius: 0.035,
  trail: { length: 1.6, radius: 0.014, opacity: 0.35 },
} as const;

// Shared by the world camera and the first-person marker's, so a point in the
// marker's view space projects where the same point would in the world.
export const viewFov = 75;

// Fog and the sky's haze share it, so far terrain melts into the horizon.
export const hazeColor = '#c9dcec';

// Device pixels per CSS pixel. A 4K laptop at native ratio draws ~8M pixels a
// frame, which most laptop GPUs can't shade at 60 fps, so Auto caps below it
// and lowers it further while the frame rate is short.
export const renderTuning = { minDpr: 0.5, autoMaxDpr: 1.5, flipflops: 3 };

// The paintball markers, in metres in their own frame: receiver at the
// origin, barrel along -z. Angles in radians, times in seconds.
export const markerTuning = {
  muzzle: {
    assault: [0, 0.012, -0.445],
    sniper: [0, 0.012, -0.72],
    shotgun: [0, 0.012, -0.36],
    launcher: [0, 0.03, -0.5],
  },
  // First person, in the view camera's frame: lower right, barrel ahead.
  view: { position: [0.2, -0.21, -0.42], rotation: [0.02, 0.05, 0] },
  // Third person, in the avatar's frame: pitched about the shoulder, held at
  // the right of the chest, a little oversized to read at a distance.
  held: { pivot: [0, 0.42, 0], position: [0.24, -0.14, -0.34], scale: 1.3 },
  recoil: { rise: 0.025, decay: 0.07, back: 0.05, lift: 0.012, tilt: 0.12 },
  // Multiplies the recoil kick per weapon.
  kick: { assault: 1, sniper: 1.8, shotgun: 2.2, launcher: 3 },
  // Bob phase advances `stride` radians per metre walked; `amount` eases
  // toward speed / fullSpeed at `response` per second.
  bob: { stride: 2.4, sway: 0.01, bounce: 0.008, fullSpeed: 7.5, response: 8 },
  // Fully lowered during a swap: dropped `drop` and pitched down `pitch`.
  swap: { drop: 0.2, pitch: 0.7 },
  // Mid-reload: dipped, pitched up and rolled in toward the centre. The pose
  // eases in and out over `ease` of the reload.
  reload: { dip: 0.05, pitch: 0.25, roll: 0.6, ease: 0.2 },
} as const;

export const respawnDelayMs = 3000;

// Power-up pads, in metres, seconds and m/s². Pads hold one kind each and
// come back `padRespawn` after they are taken. A jetpack burns `fuel`
// seconds of thrust while jump is held in the air and refills on the ground.
export const powerUpKinds = ['jetpack', 'launcher', 'xray', 'speed'] as const;
export type PowerUpKind = (typeof powerUpKinds)[number];

export const powerUpTuning = {
  // One pad per `padSpacing` metres of half size, so 6, 8 and 12.
  padSpacing: 20,
  padRespawn: 25,
  grabRadius: 1.6,
  // The host's tolerance on top, for a state up to a round trip old.
  grabTolerance: 2.5,
  duration: { jetpack: 15, launcher: 30, xray: 12, speed: 10 },
  jetpack: { thrust: 19, maxRise: 7, fuel: 2.5, refill: 1 },
  speed: 1.6,
} as const;
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
  engageDistance: {
    assault: [8, 25],
    sniper: [20, 45],
    shotgun: [3, 10],
    launcher: [10, 30],
  },
  // Scales aim jitter for a scoped weapon: bots zoom without a camera.
  zoomJitter: 0.35,
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

// Tree canopy read from the aerial photo, which shows woods the map lacks.
// Colours are 0–255 sRGB means over a cell and a rim of `texturePixels`.
export const canopyTuning = {
  cellSize: 4,
  texturePixels: 1,
  // Excess green, 2G − R − B: vegetation rather than roofs, roads and soil.
  minGreen: 8,
  // Crowns are darker than grass and fields in the same light: below
  // `shadedBrightness` a green cell is canopy, up to `maxBrightness` it must
  // also be rough (luma standard deviation), as crowns are and lawns aren't.
  shadedBrightness: 85,
  maxBrightness: 130,
  minTexture: 9,
  // Of a cell and its eight neighbours, how many must look like canopy.
  majority: 5,
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
