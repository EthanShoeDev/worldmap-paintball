import { assert, describe, it } from '@effect/vitest';
import { Group, Object3D, PerspectiveCamera, Vector3 } from 'three';

import { makeLoadout, stepLoadout } from '../src/game/loadout.ts';
import {
  handling,
  heldMuzzle,
  idleViewmodel,
  recoilKick,
  stepViewmodel,
  viewmodelPose,
  viewMuzzle,
  walkBob,
} from '../src/game/marker-motion.ts';
import {
  loadoutTuning,
  markerTuning,
  type WeaponId,
  weapons,
} from '../src/game/tuning.ts';

const { recoil, bob, view, held, muzzle, kick, swap } = markerTuning;

const assertNear = (
  actual: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
) => {
  assert.strictEqual(actual.length, expected.length);
  for (const [index, value] of actual.entries()) {
    assert.closeTo(value, expected[index] ?? Number.NaN, 1e-9);
  }
};

const worldOf = (object: Object3D, weapon: WeaponId = 'assault') => {
  object.updateMatrixWorld(true);
  const { x, y, z } = object.localToWorld(new Vector3(...muzzle[weapon]));
  return [x, y, z] as const;
};

describe('recoilKick', () => {
  it('rises to a peak, then settles back to rest', () => {
    assert.strictEqual(recoilKick(0), 0);
    assert.closeTo(recoilKick(recoil.rise / 2), 0.5, 1e-9);
    assert.closeTo(recoilKick(recoil.rise), 1, 1e-9);
    assert.isBelow(recoilKick(recoil.rise + recoil.decay), 0.4);
    assert.isBelow(recoilKick(1), 1e-4);
    assert.strictEqual(recoilKick(Number.POSITIVE_INFINITY), 0);
  });

  it('only ever decays after the peak', () => {
    for (let t = recoil.rise; t < 0.5; t += 0.01) {
      assert.isAtMost(recoilKick(t + 0.01), recoilKick(t));
    }
  });
});

describe('walkBob', () => {
  it('is still at rest and at the start of a stride', () => {
    assertNear(walkBob(1.2, 0), [0, 0]);
    assertNear(walkBob(0, 1), [0, 0]);
  });

  it('sways to full width and dips, never lifts', () => {
    const [sway, dip] = walkBob(Math.PI / 2, 1);
    assert.closeTo(sway, bob.sway, 1e-9);
    assert.closeTo(dip, -bob.bounce, 1e-9);
    for (let phase = 0; phase < 2 * Math.PI; phase += 0.1) {
      assert.isAtMost(walkBob(phase, 1)[1], 0);
    }
  });
});

describe('stepViewmodel', () => {
  const step = {
    shown: true,
    fired: false,
    speed: 0,
    loadout: makeLoadout(),
    dt: 0.016,
  };

  it('restarts the kick on a shot and ages it otherwise', () => {
    const fired = stepViewmodel(idleViewmodel, { ...step, fired: true });
    assert.strictEqual(fired.sinceShot, 0);
    assert.closeTo(stepViewmodel(fired, step).sinceShot, 0.016, 1e-9);
  });

  it('strides only while moving and eases the bob in', () => {
    assert.strictEqual(stepViewmodel(idleViewmodel, step).phase, 0);
    let state = idleViewmodel;
    for (let frame = 0; frame < 300; frame++) {
      state = stepViewmodel(state, { ...step, speed: bob.fullSpeed * 2 });
      assert.isAtLeast(state.phase, 0);
      assert.isBelow(state.phase, 2 * Math.PI);
      assert.isAtMost(state.amount, 1);
    }
    assert.closeTo(state.amount, 1, 1e-6);
  });

  it('hides with the player', () => {
    assert.isFalse(
      stepViewmodel(idleViewmodel, { ...step, shown: false }).shown,
    );
  });

  it('draws the weapon in hand', () => {
    const loadout = makeLoadout('shotgun');
    assert.strictEqual(
      stepViewmodel(idleViewmodel, { ...step, loadout }).weapon,
      'shotgun',
    );
  });
});

describe('handling', () => {
  const swapped = stepLoadout(
    makeLoadout('assault'),
    { fire: false, reload: false, selectWeapon: { slot: 1 } },
    0,
  ).loadout;
  const after = (seconds: number) => ({
    ...swapped,
    swap: Math.max(0, loadoutTuning.swapTime - seconds),
  });

  it('lowers the old weapon, then raises the new one', () => {
    const { swapTime } = loadoutTuning;
    assert.deepInclude(handling(after(0)), { weapon: 'assault', lowered: 0 });
    const out = handling(after(swapTime * 0.49));
    assert.strictEqual(out.weapon, 'assault');
    assert.closeTo(out.lowered, 0.98, 1e-9);
    const back = handling(after(swapTime * 0.51));
    assert.strictEqual(back.weapon, 'sniper');
    assert.closeTo(back.lowered, 0.98, 1e-9);
    assert.deepInclude(handling(after(swapTime)), {
      weapon: 'sniper',
      lowered: 0,
    });
  });

  it('eases into the reload pose, holds it, and eases out', () => {
    const { reloadTime } = weapons.assault;
    const reloading = (left: number) =>
      handling({ ...makeLoadout(), reload: left }).reloading;
    assert.strictEqual(reloading(0), 0);
    assert.closeTo(reloading(reloadTime * 0.95), 0.25, 1e-9);
    assert.strictEqual(reloading(reloadTime / 2), 1);
    assert.closeTo(reloading(reloadTime * 0.05), 0.25, 1e-9);
  });
});

describe('viewmodelPose', () => {
  it('rests at the tuned pose', () => {
    const { position, rotation } = viewmodelPose(idleViewmodel);
    assertNear(position, view.position);
    assertNear(rotation, view.rotation);
  });

  it('kicks back and up at the peak of a shot', () => {
    const { position, rotation } = viewmodelPose({
      ...idleViewmodel,
      sinceShot: recoil.rise,
    });
    assert.closeTo(position[2] - view.position[2], recoil.back, 1e-9);
    assert.closeTo(position[1] - view.position[1], recoil.lift, 1e-9);
    assert.closeTo(rotation[0] - view.rotation[0], recoil.tilt, 1e-9);
  });

  it('kicks harder for the heavier weapons', () => {
    const lift = (weapon: WeaponId) =>
      viewmodelPose({ ...idleViewmodel, weapon, sinceShot: recoil.rise })
        .position[1] - view.position[1];
    assert.closeTo(lift('shotgun'), recoil.lift * kick.shotgun, 1e-9);
    assert.isAbove(lift('sniper'), lift('assault'));
  });

  it('drops and pitches down when lowered for a swap', () => {
    const { position, rotation } = viewmodelPose({
      ...idleViewmodel,
      lowered: 1,
    });
    assert.closeTo(view.position[1] - position[1], swap.drop, 1e-9);
    assert.closeTo(view.rotation[0] - rotation[0], swap.pitch, 1e-9);
  });

  it('rolls in while reloading', () => {
    const { rotation } = viewmodelPose({ ...idleViewmodel, reloading: 1 });
    assert.isAbove(rotation[2], view.rotation[2]);
  });
});

describe('viewMuzzle', () => {
  const eye = [3, 2, -7] as const;

  it('matches the viewmodel drawn under the world camera', () => {
    for (const [yaw, pitch, weapon] of [
      [0, 0, 'assault'],
      [1.1, -0.4, 'sniper'],
      [-2.5, 0.9, 'shotgun'],
    ] as const) {
      const state = {
        ...idleViewmodel,
        phase: 1,
        amount: 0.7,
        sinceShot: 0.05,
        weapon,
        reloading: 0.4,
      };
      const camera = new PerspectiveCamera();
      camera.position.set(...eye);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const marker = new Group();
      const { position, rotation } = viewmodelPose(state);
      marker.position.set(...position);
      marker.rotation.set(...rotation);
      camera.add(marker);
      assertNear(viewMuzzle(eye, yaw, pitch, state), worldOf(marker, weapon));
    }
  });

  it('sits ahead of the eye, along the aim', () => {
    const [x, y, z] = viewMuzzle(eye, 0, 0, idleViewmodel);
    assert.isBelow(z, eye[2]);
    assert.isAbove(x, eye[0]);
    assert.isBelow(y, eye[1]);
  });
});

describe('heldMuzzle', () => {
  it('matches the marker a remote avatar holds', () => {
    const position = [-4, 1, 9] as const;
    for (const [yaw, pitch, weapon] of [
      [0, 0, 'assault'],
      [0.7, 0.3, 'sniper'],
      [-1.9, -0.6, 'shotgun'],
    ] as const) {
      const body = new Group();
      body.position.set(...position);
      body.rotation.set(0, yaw, 0);
      const aim = new Group();
      aim.position.set(...held.pivot);
      aim.rotation.set(pitch, 0, 0);
      const marker = new Group();
      marker.position.set(...held.position);
      marker.scale.setScalar(held.scale);
      body.add(aim);
      aim.add(marker);
      assertNear(
        heldMuzzle(position, yaw, pitch, weapon),
        worldOf(marker, weapon),
      );
    }
  });

  it('is further out for a longer barrel', () => {
    const reach = (weapon: WeaponId) => -heldMuzzle([0, 0, 0], 0, 0, weapon)[2];
    assert.isAbove(reach('sniper'), reach('assault'));
    assert.isAbove(reach('assault'), reach('shotgun'));
  });
});
