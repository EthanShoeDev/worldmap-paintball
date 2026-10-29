import { Euler, Vector3 } from 'three';

import { type Loadout, reloadProgress } from './loadout.ts';
import type { Vec3 } from './net/protocol.ts';
import {
  defaultWeapon,
  loadoutTuning,
  markerTuning,
  type WeaponId,
} from './tuning.ts';

const { muzzle, view, held, recoil, kick, bob, swap, reload } = markerTuning;

// The first-person marker between frames. Visual only: nothing here feeds
// back into the view or the aim.
export interface ViewmodelState {
  readonly shown: boolean;
  readonly phase: number;
  readonly amount: number;
  readonly sinceShot: number;
  // The model drawn, how far it is lowered for a swap and how far into its
  // reload pose, each from 0 to 1.
  readonly weapon: WeaponId;
  readonly lowered: number;
  readonly reloading: number;
}

export const idleViewmodel: ViewmodelState = {
  shown: true,
  phase: 0,
  amount: 0,
  sinceShot: Number.POSITIVE_INFINITY,
  weapon: defaultWeapon,
  lowered: 0,
  reloading: 0,
};

// A swap lowers the old weapon for its first half and raises the new one for
// the second; a reload eases into its pose, holds it, and eases out.
export const handling = (loadout: Loadout) => {
  const swapLeft = loadout.swap / loadoutTuning.swapTime;
  const progress = reloadProgress(loadout);
  return {
    weapon: swapLeft > 0.5 ? loadout.previous : loadout.weapon,
    lowered: swapLeft > 0.5 ? 2 - 2 * swapLeft : 2 * swapLeft,
    reloading:
      progress === undefined
        ? 0
        : Math.min(1, progress / reload.ease, (1 - progress) / reload.ease),
  };
};

// 0 to 1: a fast linear kick, then an exponential settle.
export const recoilKick = (sinceShot: number) =>
  sinceShot < recoil.rise
    ? sinceShot / recoil.rise
    : Math.exp(-(sinceShot - recoil.rise) / recoil.decay);

// Side-to-side once per stride cycle, and a dip at each footfall.
export const walkBob = (phase: number, amount: number) =>
  [
    Math.sin(phase) * bob.sway * amount,
    ((Math.cos(2 * phase) - 1) / 2) * bob.bounce * amount,
  ] as const;

export const stepViewmodel = (
  state: ViewmodelState,
  {
    shown,
    fired,
    speed,
    loadout,
    dt,
  }: {
    readonly shown: boolean;
    readonly fired: boolean;
    readonly speed: number;
    readonly loadout: Loadout;
    readonly dt: number;
  },
) => {
  const target = Math.min(1, speed / bob.fullSpeed);
  const ease = Math.min(1, bob.response * dt);
  return {
    ...handling(loadout),
    shown,
    phase: (state.phase + speed * bob.stride * dt) % (2 * Math.PI),
    amount: state.amount + (target - state.amount) * ease,
    sinceShot: fired ? 0 : state.sinceShot + dt,
  };
};

// The marker's pose in the view camera's frame, the group's 'XYZ' rotation.
export const viewmodelPose = (state: ViewmodelState) => {
  const shot = recoilKick(state.sinceShot) * kick[state.weapon];
  const [sway, dip] = walkBob(state.phase, state.amount);
  const { lowered, reloading } = state;
  const [x, y, z] = view.position;
  const [pitch, yaw, roll] = view.rotation;
  return {
    position: [
      x + sway,
      y +
        dip +
        shot * recoil.lift -
        lowered * swap.drop -
        reloading * reload.dip,
      z + shot * recoil.back,
    ],
    rotation: [
      pitch +
        shot * recoil.tilt -
        lowered * swap.pitch +
        reloading * reload.pitch,
      yaw,
      roll + reloading * reload.roll,
    ],
  } as const;
};

const toVec3 = ({ x, y, z }: Vector3) => [x, y, z] as const;

// Where the first-person marker's muzzle is in the world, for a camera at
// `eye`. The viewmodel's camera shares `viewFov`, so this point lies on the
// screen where the muzzle is drawn.
export const viewMuzzle = (
  eye: Vec3,
  yaw: number,
  pitch: number,
  state: ViewmodelState,
) => {
  const { position, rotation } = viewmodelPose(state);
  return toVec3(
    new Vector3(...muzzle[state.weapon])
      .applyEuler(new Euler(...rotation))
      .add(new Vector3(...position))
      .applyEuler(new Euler(pitch, yaw, 0, 'YXZ'))
      .add(new Vector3(...eye)),
  );
};

// Where a remote player's held marker's muzzle is, from their pose: the same
// transforms <RemotePlayers> applies to the model.
export const heldMuzzle = (
  position: Vec3,
  yaw: number,
  pitch: number,
  weapon: WeaponId,
) =>
  toVec3(
    new Vector3(...muzzle[weapon])
      .multiplyScalar(held.scale)
      .add(new Vector3(...held.position))
      .applyEuler(new Euler(pitch, 0, 0))
      .add(new Vector3(...held.pivot))
      .applyEuler(new Euler(0, yaw, 0))
      .add(new Vector3(...position)),
  );
