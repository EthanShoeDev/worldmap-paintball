import { assert, describe, it } from '@effect/vitest';

import { arenaSquare, parseCoordinates } from '../src/location/coordinates.ts';

describe('parseCoordinates', () => {
  it('accepts comma-separated coordinates', () => {
    assert.deepStrictEqual(parseCoordinates('51.5, -0.12'), {
      lat: 51.5,
      lon: -0.12,
    });
  });

  it('accepts space-separated coordinates', () => {
    assert.deepStrictEqual(parseCoordinates(' 51.5 -0.12 '), {
      lat: 51.5,
      lon: -0.12,
    });
  });

  it('accepts integers and the range edges', () => {
    assert.deepStrictEqual(parseCoordinates('-85,180'), { lat: -85, lon: 180 });
  });

  it('rejects out-of-range values', () => {
    assert.isUndefined(parseCoordinates('86, 0'));
    assert.isUndefined(parseCoordinates('0, -180.5'));
  });

  it('rejects addresses', () => {
    assert.isUndefined(parseCoordinates('10 Downing Street'));
    assert.isUndefined(parseCoordinates('51.5'));
    assert.isUndefined(parseCoordinates('51.5, -0.12, 3'));
  });
});

describe('arenaSquare', () => {
  it('spans the half size in metres around the centre', () => {
    const [ring] = arenaSquare({ lat: 0, lon: 10 }, 110_540).geometry
      .coordinates;
    assert.strictEqual(ring?.length, 5);
    assert.deepStrictEqual(ring?.[0], ring?.[4]);
    const [west, south] = ring?.[0] ?? [];
    assert.closeTo(south ?? Number.NaN, -1, 1e-9);
    assert.closeTo(west ?? Number.NaN, 10 - 110_540 / 111_320, 1e-9);
  });
});
