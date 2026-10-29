import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Option } from 'effect';

import {
  activate,
  freshPads,
  type Pad,
  padsOf,
  padsReady,
  padUnder,
  soloPowerUps,
  takePad,
  tickPowerUp,
} from '../src/game/powerups.ts';
import { powerUpKinds, powerUpTuning } from '../src/game/tuning.ts';

const pads: ReadonlyArray<Pad> = [
  { kind: 'jetpack', position: [0, 0] },
  { kind: 'xray', position: [30, 0] },
];

describe('padsOf', () => {
  it('lays out the same pads every time, one of each kind in turn', () => {
    const arena = {
      roads: [],
      buildings: [],
      areas: [],
      halfSize: 150,
    };
    const laid = padsOf(arena);
    assert.lengthOf(laid, 8);
    assert.deepStrictEqual(padsOf(arena), laid);
    assert.deepStrictEqual(
      Arr.map(Arr.take(laid, powerUpKinds.length), (pad) => pad.kind),
      [...powerUpKinds],
    );
  });
});

describe('takePad', () => {
  it('takes a ready pad in reach until it comes back', () => {
    const taken = takePad(pads, freshPads(pads), 1, [30.5, 1, 1], 1000);
    assert.isUndefined(taken.rejected);
    if (taken.rejected !== undefined) return;
    assert.strictEqual(taken.kind, 'xray');
    const back = 1000 + powerUpTuning.padRespawn * 1000;
    assert.deepStrictEqual(padsReady(taken.timers, back - 1), [true, false]);
    assert.deepStrictEqual(padsReady(taken.timers, back), [true, true]);
    assert.strictEqual(
      takePad(pads, taken.timers, 1, [30, 1, 0], back - 1).rejected,
      'NotReady',
    );
  });

  it('refuses a pad out of reach, allowing a tolerance', () => {
    const timers = freshPads(pads);
    assert.strictEqual(
      takePad(pads, timers, 0, [3, 1, 0], 0).rejected,
      'TooFar',
    );
    assert.isUndefined(takePad(pads, timers, 0, [3, 1, 0], 0, 2).rejected);
    assert.strictEqual(
      takePad(pads, timers, 5, [0, 1, 0], 0).rejected,
      'UnknownPad',
    );
  });

  it('finds the ready pad underfoot', () => {
    assert.deepStrictEqual(
      padUnder(pads, [true, true], [29, 1, 0.5]),
      Option.some(1),
    );
    assert.isTrue(Option.isNone(padUnder(pads, [true, false], [29, 1, 0.5])));
  });
});

describe('a running power-up', () => {
  it('runs out after its duration', () => {
    const still = { thrusting: false, grounded: true };
    const speed = activate('speed');
    const almost = tickPowerUp(
      speed,
      powerUpTuning.duration.speed - 0.1,
      still,
    );
    assert.isDefined(almost);
    assert.isUndefined(tickPowerUp(almost, 0.2, still));
  });

  it('burns jetpack fuel in the air and refills it on the ground', () => {
    const jetpack = activate('jetpack');
    const burnt = tickPowerUp(jetpack, 1, { thrusting: true, grounded: false });
    assert.closeTo(burnt?.fuel ?? 0, powerUpTuning.jetpack.fuel - 1, 1e-9);
    const coasting = tickPowerUp(burnt, 1, {
      thrusting: false,
      grounded: false,
    });
    assert.strictEqual(coasting?.fuel, burnt?.fuel);
    const landed = tickPowerUp(coasting, 5, {
      thrusting: false,
      grounded: true,
    });
    assert.strictEqual(landed?.fuel, powerUpTuning.jetpack.fuel);
  });
});

describe('soloPowerUps', () => {
  it('grants a pad once and hides it until it comes back', () => {
    let now = 0;
    const link = soloPowerUps(pads, () => now);
    link.grab(0);
    link.grab(0);
    assert.strictEqual(link.take(), 'jetpack');
    assert.isUndefined(link.take());
    assert.deepStrictEqual(link.ready(), [false, true]);
    now = powerUpTuning.padRespawn * 1000;
    assert.deepStrictEqual(link.ready(), [true, true]);
  });
});
