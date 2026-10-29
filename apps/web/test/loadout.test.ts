import { assert, describe, it } from '@effect/vitest';

import type { WeaponSelection } from '../src/game/intent.ts';
import {
  armLauncher,
  combatViewOf,
  disarmLauncher,
  type Loadout,
  lookScale,
  makeLoadout,
  reloadProgress,
  respawnLoadout,
  sameCombatView,
  screenShare,
  selectedWeapon,
  stepLoadout,
  zoomFovOf,
} from '../src/game/loadout.ts';
import {
  loadoutTuning,
  viewFov,
  weaponIds,
  weapons,
} from '../src/game/tuning.ts';

const dt = 1 / 60;

interface Held {
  readonly fire?: boolean;
  readonly reload?: boolean;
  readonly selectWeapon?: WeaponSelection;
}

const press = ({ fire = false, reload = false, selectWeapon }: Held = {}) => ({
  fire,
  reload,
  selectWeapon,
});

// Runs `frames` frames holding the same input; returns the last loadout and
// the times, in seconds from the start, that a shot left.
const hold = (start: Loadout, held: Held, frames: number) => {
  let loadout = start;
  const shots: Array<number> = [];
  for (let frame = 0; frame < frames; frame++) {
    const step = stepLoadout(loadout, press(held), dt);
    loadout = step.loadout;
    if (step.fired) shots.push(frame * dt);
  }
  return { loadout, shots };
};

const seconds = (time: number) => Math.ceil(time / dt);

describe('makeLoadout', () => {
  it('starts with full pods and nothing in progress', () => {
    const loadout = makeLoadout('sniper');
    assert.strictEqual(loadout.weapon, 'sniper');
    for (const id of weaponIds) {
      assert.strictEqual(loadout.ammo[id], weapons[id].magazine);
      assert.strictEqual(loadout.cooldown[id], 0);
    }
    assert.strictEqual(loadout.reload, 0);
    assert.strictEqual(loadout.swap, 0);
  });
});

describe('fire gating', () => {
  it('fires no faster than the weapon fire interval', () => {
    for (const id of weaponIds) {
      const { fireInterval } = weapons[id];
      const { shots } = hold(makeLoadout(id), { fire: true }, seconds(3));
      assert.isAbove(shots.length, 1);
      for (const [index, time] of shots.entries()) {
        if (index === 0) continue;
        assert.isAtLeast(time - (shots[index - 1] ?? 0), fireInterval - 1e-9);
        assert.isAtMost(
          time - (shots[index - 1] ?? 0),
          fireInterval + dt * 1.5,
        );
      }
    }
  });

  it('fires on the first frame the trigger is pulled', () => {
    const step = stepLoadout(makeLoadout(), press({ fire: true }), dt);
    assert.isTrue(step.fired);
    assert.strictEqual(step.loadout.ammo.assault, weapons.assault.magazine - 1);
  });

  it('holds fire without the trigger', () => {
    const { shots, loadout } = hold(makeLoadout(), {}, 60);
    assert.deepStrictEqual(shots, []);
    assert.deepStrictEqual(loadout.ammo, makeLoadout().ammo);
  });
});

describe('magazines and reloading', () => {
  it('empties the pod, then reloads when fired empty', () => {
    const { magazine, fireInterval, reloadTime } = weapons.sniper;
    const emptying = hold(
      makeLoadout('sniper'),
      { fire: true },
      seconds(fireInterval * magazine),
    );
    assert.strictEqual(emptying.shots.length, magazine);
    assert.strictEqual(emptying.loadout.ammo.sniper, 0);
    assert.isAbove(emptying.loadout.reload, 0);
    // Can't fire while reloading.
    const midway = hold(emptying.loadout, { fire: true }, seconds(1));
    assert.deepStrictEqual(midway.shots, []);
    const done = hold(emptying.loadout, {}, seconds(reloadTime));
    assert.strictEqual(done.loadout.ammo.sniper, magazine);
    assert.strictEqual(done.loadout.reload, 0);
  });

  it('reloads on request, taking the weapon reload time', () => {
    const fired = hold(makeLoadout('shotgun'), { fire: true }, 1).loadout;
    const started = stepLoadout(fired, press({ reload: true }), dt).loadout;
    assert.strictEqual(started.reload, weapons.shotgun.reloadTime);
    assert.strictEqual(reloadProgress(started), 0);
    const almost = hold(started, {}, seconds(weapons.shotgun.reloadTime) - 2);
    assert.strictEqual(
      almost.loadout.ammo.shotgun,
      weapons.shotgun.magazine - 1,
    );
    assert.isAbove(reloadProgress(almost.loadout) ?? 0, 0.95);
    const done = hold(almost.loadout, {}, 3).loadout;
    assert.strictEqual(done.ammo.shotgun, weapons.shotgun.magazine);
    assert.isUndefined(reloadProgress(done));
  });

  it('does not reload a full pod', () => {
    const step = stepLoadout(makeLoadout(), press({ reload: true }), dt);
    assert.strictEqual(step.loadout.reload, 0);
  });

  it('refills every pod on respawn, keeping the weapon in hand', () => {
    const used = hold(makeLoadout('assault'), { fire: true }, seconds(1));
    const swapped = hold(
      used.loadout,
      { fire: true, selectWeapon: { slot: 2 } },
      seconds(1),
    ).loadout;
    assert.isBelow(swapped.ammo.assault, weapons.assault.magazine);
    assert.isBelow(swapped.ammo.shotgun, weapons.shotgun.magazine);
    const respawned = respawnLoadout({ ...swapped, reload: 1 });
    assert.deepStrictEqual(respawned, makeLoadout('shotgun'));
  });
});

describe('switching weapons', () => {
  it('selects slots and cycles round them', () => {
    assert.strictEqual(
      selectedWeapon('assault', { slot: 1 }, makeLoadout().ammo),
      'sniper',
    );
    assert.strictEqual(
      selectedWeapon('assault', { slot: 7 }, makeLoadout().ammo),
      'assault',
    );
    assert.strictEqual(
      selectedWeapon('assault', { cycle: 1 }, makeLoadout().ammo),
      'sniper',
    );
    assert.strictEqual(
      selectedWeapon('assault', { cycle: -1 }, makeLoadout().ammo),
      'shotgun',
    );
    assert.strictEqual(
      selectedWeapon('shotgun', { cycle: 1 }, makeLoadout().ammo),
      'assault',
    );
    assert.strictEqual(
      selectedWeapon('sniper', undefined, makeLoadout().ammo),
      'sniper',
    );
  });

  it('waits out the swap delay before the new weapon fires', () => {
    const swap = stepLoadout(
      makeLoadout(),
      press({ fire: true, selectWeapon: { slot: 2 } }),
      dt,
    );
    assert.isFalse(swap.fired);
    assert.strictEqual(swap.loadout.weapon, 'shotgun');
    assert.strictEqual(swap.loadout.previous, 'assault');
    assert.strictEqual(swap.loadout.swap, loadoutTuning.swapTime);
    const { shots } = hold(swap.loadout, { fire: true }, seconds(0.5));
    assert.isAtLeast(shots[0] ?? Number.NaN, loadoutTuning.swapTime - dt * 2);
    assert.isAtMost(shots[0] ?? Number.NaN, loadoutTuning.swapTime + dt);
  });

  it('keeps each weapon ammo apart', () => {
    const fired = hold(makeLoadout('assault'), { fire: true }, seconds(1));
    const back = hold(
      fired.loadout,
      { selectWeapon: { slot: 1 } },
      seconds(0.5),
    ).loadout;
    const again = stepLoadout(back, press({ selectWeapon: { slot: 0 } }), dt);
    assert.strictEqual(again.loadout.ammo.assault, fired.loadout.ammo.assault);
    assert.strictEqual(again.loadout.ammo.sniper, weapons.sniper.magazine);
  });

  it('cancels a reload, which then starts over', () => {
    const fired = hold(makeLoadout('assault'), { fire: true }, 1).loadout;
    const reloading = hold(fired, { reload: true }, seconds(1.5)).loadout;
    assert.isAbove(reloading.reload, 0);
    const swapped = stepLoadout(
      reloading,
      press({ selectWeapon: { slot: 1 } }),
      dt,
    ).loadout;
    assert.strictEqual(swapped.reload, 0);
    const back = hold(
      swapped,
      { selectWeapon: { slot: 0 } },
      seconds(loadoutTuning.swapTime) + 2,
    ).loadout;
    assert.strictEqual(back.ammo.assault, weapons.assault.magazine - 1);
    assert.strictEqual(back.reload, 0);
  });

  it('does not let a swap skip the fire interval', () => {
    const fired = stepLoadout(
      makeLoadout('sniper'),
      press({ fire: true }),
      dt,
    ).loadout;
    const there = hold(fired, { selectWeapon: { slot: 0 } }, 1).loadout;
    const back = hold(
      there,
      { selectWeapon: { slot: 1 }, fire: true },
      seconds(0.8),
    );
    assert.deepStrictEqual(back.shots, []);
  });
});

describe('zoom', () => {
  it('zooms only a scoped weapon that is ready', () => {
    const sniper = makeLoadout('sniper');
    assert.strictEqual(zoomFovOf(sniper, true), weapons.sniper.zoomFov);
    assert.isUndefined(zoomFovOf(sniper, false));
    assert.isUndefined(zoomFovOf(makeLoadout('assault'), true));
    assert.isUndefined(zoomFovOf({ ...sniper, reload: 1 }, true));
    assert.isUndefined(zoomFovOf({ ...sniper, swap: 0.1 }, true));
  });

  it('slows the look with the field of view', () => {
    assert.closeTo(lookScale(viewFov), 1, 1e-12);
    const zoomed = lookScale(weapons.sniper.zoomFov ?? viewFov);
    assert.isBelow(zoomed, 0.4);
    assert.isAbove(zoomed, 0.3);
  });

  it('measures angles as a share of half the screen', () => {
    assert.closeTo(screenShare((viewFov * Math.PI) / 360), 1, 1e-12);
    assert.isBelow(screenShare(weapons.shotgun.spread), 0.2);
  });
});

describe('the launcher', () => {
  it('starts empty, so key 4 does nothing', () => {
    const loadout = makeLoadout();
    assert.strictEqual(loadout.ammo.launcher, 0);
    assert.strictEqual(
      selectedWeapon('assault', { slot: 3 }, loadout.ammo),
      'assault',
    );
  });

  it('is raised by its power-up, fires its rounds, then is put away', () => {
    const armed = armLauncher(makeLoadout('sniper'));
    assert.strictEqual(armed.weapon, 'launcher');
    const firing = hold(armed, { fire: true }, seconds(3.5));
    assert.lengthOf(firing.shots, weapons.launcher.magazine);
    const { loadout } = hold(firing.loadout, {}, seconds(1));
    assert.strictEqual(loadout.weapon, 'sniper');
    assert.strictEqual(loadout.ammo.launcher, 0);
    assert.strictEqual(loadout.reload, 0);
  });

  it('can be swapped away and back while loaded', () => {
    const armed = armLauncher(makeLoadout());
    assert.strictEqual(
      selectedWeapon('assault', { slot: 3 }, armed.ammo),
      'launcher',
    );
    assert.strictEqual(
      selectedWeapon('shotgun', { cycle: 1 }, armed.ammo),
      'launcher',
    );
  });

  it('refills in hand on a second power-up', () => {
    const armed = armLauncher(makeLoadout());
    const again = armLauncher({
      ...armed,
      ammo: { ...armed.ammo, launcher: 1 },
    });
    assert.strictEqual(again.ammo.launcher, weapons.launcher.magazine);
    assert.strictEqual(again.previous, 'assault');
  });

  it('is lost when the power-up ends or its holder respawns', () => {
    const armed = armLauncher(makeLoadout('shotgun'));
    const disarmed = disarmLauncher(armed);
    assert.strictEqual(disarmed.weapon, 'shotgun');
    assert.strictEqual(disarmed.ammo.launcher, 0);
    assert.deepStrictEqual(respawnLoadout(armed), makeLoadout('shotgun'));
  });
});

describe('combat view', () => {
  it('reports the weapon in hand and its reload in 2% steps', () => {
    const loadout = {
      ...makeLoadout('shotgun'),
      reload: weapons.shotgun.reloadTime * 0.333,
    };
    const view = combatViewOf(loadout, false);
    assert.deepStrictEqual(view, {
      weapon: 'shotgun',
      ammo: weapons.shotgun.magazine,
      reload: 0.66,
      zoomed: false,
      launcher: 0,
    });
    const nudged = combatViewOf(
      { ...loadout, reload: loadout.reload - 0.001 },
      false,
    );
    assert.isTrue(sameCombatView(view, nudged));
    assert.isFalse(sameCombatView(view, { ...view, zoomed: true }));
  });

  it('changes a bounded number of times over a reload', () => {
    const start = {
      ...makeLoadout('sniper'),
      ammo: { ...makeLoadout().ammo, sniper: 0 },
      reload: weapons.sniper.reloadTime,
    };
    let loadout: Loadout = start;
    let shown = combatViewOf(loadout, false);
    let changes = 0;
    for (let frame = 0; frame <= seconds(weapons.sniper.reloadTime); frame++) {
      loadout = stepLoadout(loadout, press(), dt).loadout;
      const next = combatViewOf(loadout, false);
      if (!sameCombatView(shown, next)) changes += 1;
      shown = next;
    }
    assert.isAtMost(changes, 52);
    assert.strictEqual(shown.ammo, weapons.sniper.magazine);
  });
});
