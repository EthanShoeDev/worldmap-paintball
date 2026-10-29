import { Array as Arr } from 'effect';

import { scatterOpen, type Spawnable } from './arena-meshes.ts';
import type { Vec3 } from './net/protocol.ts';
import { type PowerUpKind, powerUpKinds, powerUpTuning } from './tuning.ts';

export interface Pad {
  readonly kind: PowerUpKind;
  readonly position: readonly [number, number];
}

const padSeed = 104_729;

// How each kind looks on its pad and in the HUD.
export const powerUpLooks: Record<
  PowerUpKind,
  { readonly label: string; readonly hint: string; readonly color: string }
> = {
  jetpack: {
    label: 'Jetpack',
    hint: 'Hold jump in the air to fly',
    color: '#38bdf8',
  },
  launcher: {
    label: 'Paint launcher',
    hint: 'Key 4: splats everyone where it bursts',
    color: '#f97316',
  },
  xray: {
    label: 'X-ray',
    hint: 'See everyone through walls',
    color: '#a855f7',
  },
  speed: { label: 'Speed boost', hint: 'Run faster', color: '#22c55e' },
};

// Derived from the arena alone, so every peer lays out the same pads.
export const padsOf = (arena: Spawnable): ReadonlyArray<Pad> =>
  Arr.map(
    scatterOpen(
      arena,
      Math.round(arena.halfSize / powerUpTuning.padSpacing),
      padSeed,
    ),
    (position, index) => ({
      kind: powerUpKinds[index % powerUpKinds.length] ?? 'jetpack',
      position,
    }),
  );

// When each pad is next ready, in the clock's milliseconds; 0 is now.
export type PadTimers = ReadonlyArray<number>;

export const freshPads = (pads: ReadonlyArray<Pad>): PadTimers =>
  Arr.map(pads, () => 0);

export const padsReady = (timers: PadTimers, now: number) =>
  Arr.map(timers, (readyAt) => readyAt <= now);

const reach = ([x, , z]: Vec3, { position: [px, pz] }: Pad) =>
  Math.hypot(x - px, z - pz);

// The ready pad a body at `position` stands on, if any.
export const padUnder = (
  pads: ReadonlyArray<Pad>,
  ready: ReadonlyArray<boolean>,
  position: Vec3,
) =>
  Arr.findFirstIndex(
    pads,
    (pad, index) =>
      ready[index] === true && reach(position, pad) <= powerUpTuning.grabRadius,
  );

// Takes `pad` for a body at `position`, or says why not. `tolerance` widens
// the reach for a position that may be out of date.
export const takePad = (
  pads: ReadonlyArray<Pad>,
  timers: PadTimers,
  index: number,
  position: Vec3,
  now: number,
  tolerance = 0,
) => {
  const pad = pads[index];
  const readyAt = timers[index];
  if (!pad || readyAt === undefined) return { rejected: 'UnknownPad' } as const;
  if (readyAt > now) return { rejected: 'NotReady' } as const;
  if (reach(position, pad) > powerUpTuning.grabRadius + tolerance) {
    return { rejected: 'TooFar' } as const;
  }
  const next = [...timers];
  next[index] = now + powerUpTuning.padRespawn * 1000;
  return { rejected: undefined, kind: pad.kind, timers: next };
};

// The power-up a player has running; `fuel` is the jetpack's.
export interface ActivePowerUp {
  readonly kind: PowerUpKind;
  readonly remaining: number;
  readonly fuel: number;
}

export const activate = (kind: PowerUpKind): ActivePowerUp => ({
  kind,
  remaining: powerUpTuning.duration[kind],
  fuel: powerUpTuning.jetpack.fuel,
});

// One frame of a running power-up; undefined once it runs out. The jetpack
// burns fuel while `thrusting` and refills it on the ground.
export const tickPowerUp = (
  power: ActivePowerUp | undefined,
  dt: number,
  { thrusting, grounded }: { thrusting: boolean; grounded: boolean },
) => {
  if (!power) return undefined;
  const remaining = power.remaining - dt;
  if (remaining <= 0) return undefined;
  const { fuel: tank, refill } = powerUpTuning.jetpack;
  const fuel = thrusting
    ? Math.max(0, power.fuel - dt)
    : grounded
      ? Math.min(tank, power.fuel + refill * dt)
      : power.fuel;
  return { ...power, remaining, fuel };
};

// What a player's frame needs from the pads, from a match or solo practice.
export interface PowerUpLink {
  readonly pads: ReadonlyArray<Pad>;
  readonly ready: () => ReadonlyArray<boolean>;
  // Asks for the pad under the player; its power-up arrives through `take`.
  readonly grab: (pad: number) => void;
  readonly take: () => PowerUpKind | undefined;
}

// Solo practice runs the pads itself, trusting the player's own `grab`.
export const soloPowerUps = (
  pads: ReadonlyArray<Pad>,
  now: () => number,
): PowerUpLink => {
  let timers = freshPads(pads);
  let granted: PowerUpKind | undefined;
  return {
    pads,
    ready: () => padsReady(timers, now()),
    grab: (index) => {
      const pad = pads[index];
      if (!pad) return;
      const [x, z] = pad.position;
      const taken = takePad(pads, timers, index, [x, 0, z], now());
      if (taken.rejected !== undefined) return;
      timers = taken.timers;
      granted = taken.kind;
    },
    take: () => {
      const kind = granted;
      granted = undefined;
      return kind;
    },
  };
};

// What the HUD shows of a running power-up: whole seconds left, and the
// jetpack's fuel in tenths.
export interface PowerUpView {
  readonly kind: PowerUpKind;
  readonly seconds: number;
  readonly fuel: number;
}

export const powerUpViewOf = (power: ActivePowerUp | undefined) =>
  power && {
    kind: power.kind,
    seconds: Math.ceil(power.remaining),
    fuel: Math.round((power.fuel / powerUpTuning.jetpack.fuel) * 10) / 10,
  };

export const samePowerUpView = (
  a: PowerUpView | undefined,
  b: PowerUpView | undefined,
) =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.kind === b.kind &&
    a.seconds === b.seconds &&
    a.fuel === b.fuel);
