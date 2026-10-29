import { Record as Rec } from 'effect';

import type { Intent, WeaponSelection } from './intent.ts';
import {
  defaultWeapon,
  loadoutTuning,
  viewFov,
  type WeaponId,
  weaponIds,
  weapons,
} from './tuning.ts';

type PerWeapon<A> = Readonly<Record<WeaponId, A>>;

// Every weapon a player carries, in slot order, and the one in hand. Pure:
// `stepLoadout` returns a new loadout each frame.
export interface Loadout {
  readonly weapon: WeaponId;
  // The weapon being put away, drawn for the first half of a swap.
  readonly previous: WeaponId;
  readonly ammo: PerWeapon<number>;
  // Seconds until each weapon may fire again.
  readonly cooldown: PerWeapon<number>;
  // Seconds left of a reload or a swap; 0 when there is none.
  readonly reload: number;
  readonly swap: number;
}

const perWeapon = <A>(f: (id: WeaponId) => A) =>
  Rec.map(weapons, (_, id) => f(id));

export const makeLoadout = (weapon = defaultWeapon): Loadout => ({
  weapon,
  previous: weapon,
  ammo: perWeapon((id) => (weapons[id].pickup ? 0 : weapons[id].magazine)),
  cooldown: perWeapon(() => 0),
  reload: 0,
  swap: 0,
});

const slotWeapon = (loadout: Loadout) =>
  weapons[loadout.weapon].pickup ? loadout.previous : loadout.weapon;

// Full pods and nothing in progress, the same weapon in hand; a power-up's
// weapon is lost.
export const respawnLoadout = (loadout: Loadout) =>
  makeLoadout(slotWeapon(loadout));

const swapTo = (loadout: Loadout, weapon: WeaponId): Loadout => ({
  ...loadout,
  weapon,
  previous: loadout.weapon,
  reload: 0,
  swap: loadoutTuning.swapTime,
});

// A power-up's launcher, loaded and raised.
export const armLauncher = (loadout: Loadout) => {
  const { magazine } = weapons.launcher;
  const loaded = { ...loadout, ammo: { ...loadout.ammo, launcher: magazine } };
  return loadout.weapon === 'launcher' ? loaded : swapTo(loaded, 'launcher');
};

// The power-up ran out: the launcher is emptied and put away.
export const disarmLauncher = (loadout: Loadout) => {
  const emptied = { ...loadout, ammo: { ...loadout.ammo, launcher: 0 } };
  return loadout.weapon === 'launcher'
    ? swapTo(emptied, loadout.previous)
    : emptied;
};

// The slot weapons, then any loaded power-up weapon, key 4.
const carried = (ammo: PerWeapon<number>): ReadonlyArray<WeaponId> =>
  ammo.launcher > 0 ? [...weaponIds, 'launcher'] : weaponIds;

export const selectedWeapon = (
  current: WeaponId,
  selection: WeaponSelection | undefined,
  ammo: PerWeapon<number>,
) => {
  if (!selection) return current;
  const slots = carried(ammo);
  const count = slots.length;
  const index =
    'slot' in selection
      ? selection.slot
      : (((slots.indexOf(current) + selection.cycle) % count) + count) % count;
  return slots[index] ?? current;
};

// One frame: swap, reload and fire, in that order. Switching weapons cancels
// a reload; pulling the trigger on an empty pod starts one.
export const stepLoadout = (
  loadout: Loadout,
  intent: Pick<Intent, 'fire' | 'reload' | 'selectWeapon'>,
  dt: number,
) => {
  const cooldown = perWeapon((id) => Math.max(0, loadout.cooldown[id] - dt));
  const { weapon } = loadout;
  const spec = weapons[weapon];
  const spent =
    spec.pickup === true &&
    loadout.ammo[weapon] === 0 &&
    cooldown[weapon] === 0;
  const target = spent
    ? loadout.previous
    : selectedWeapon(weapon, intent.selectWeapon, loadout.ammo);
  if (target !== weapon) {
    return { loadout: swapTo({ ...loadout, cooldown }, target), fired: false };
  }
  const swap = Math.max(0, loadout.swap - dt);
  let reload = Math.max(0, loadout.reload - dt);
  let ammo =
    loadout.reload > 0 && reload === 0
      ? { ...loadout.ammo, [weapon]: spec.magazine }
      : loadout.ammo;
  const rounds = ammo[weapon];
  const ready = swap === 0 && reload === 0;
  const fired = ready && intent.fire && rounds > 0 && cooldown[weapon] === 0;
  if (fired) {
    ammo = { ...ammo, [weapon]: rounds - 1 };
  } else if (
    ready &&
    spec.pickup !== true &&
    rounds < spec.magazine &&
    (intent.reload || (intent.fire && rounds === 0))
  ) {
    reload = spec.reloadTime;
  }
  const next: Loadout = {
    ...loadout,
    ammo,
    cooldown: fired ? { ...cooldown, [weapon]: spec.fireInterval } : cooldown,
    reload,
    swap,
  };
  return { loadout: next, fired };
};

// How far through its reload the weapon in hand is, from 0 to 1.
export const reloadProgress = (loadout: Loadout) =>
  loadout.reload > 0
    ? 1 - loadout.reload / weapons[loadout.weapon].reloadTime
    : undefined;

// Only a scoped weapon zooms, and not while it is being swapped or reloaded.
export const zoomFovOf = (loadout: Loadout, wantsZoom: boolean) => {
  const { zoomFov } = weapons[loadout.weapon];
  return wantsZoom && loadout.swap === 0 && loadout.reload === 0
    ? zoomFov
    : undefined;
};

const halfTan = (fov: number) => Math.tan((fov * Math.PI) / 360);

// Look speed at `fov`, so the crosshair sweeps the same share of the screen
// for the same mouse movement however far zoomed in.
export const lookScale = (fov: number) => halfTan(fov) / halfTan(viewFov);

// The share of half the screen's height that `angle` off the aim covers.
export const screenShare = (angle: number, fov = viewFov) =>
  Math.tan(angle) / halfTan(fov);

// What the combat HUD shows; reload progress in 2% steps, so the view only
// changes a few dozen times over a reload.
export interface CombatView {
  readonly weapon: WeaponId;
  readonly ammo: number;
  readonly reload: number | undefined;
  readonly zoomed: boolean;
  // Rounds of a power-up's launcher, held or not.
  readonly launcher: number;
}

export const combatViewOf = (loadout: Loadout, zoomed: boolean): CombatView => {
  const progress = reloadProgress(loadout);
  return {
    weapon: loadout.weapon,
    ammo: loadout.ammo[loadout.weapon],
    reload: progress === undefined ? undefined : Math.round(progress * 50) / 50,
    zoomed,
    launcher: loadout.ammo.launcher,
  };
};

export const sameCombatView = (a: CombatView, b: CombatView) =>
  a.weapon === b.weapon &&
  a.ammo === b.ammo &&
  a.reload === b.reload &&
  a.zoomed === b.zoomed &&
  a.launcher === b.launcher;
