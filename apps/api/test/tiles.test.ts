import { assert, describe, it } from '@effect/vitest';

import { bounds } from '../src/bake.ts';
import {
  tileLatLon,
  tilePosition,
  tilesCovering,
  tileUrl,
} from '../src/tiles.ts';

const tile = { z: 14, x: 4574, y: 6463 };

describe('tilePosition', () => {
  it('inverts tileLatLon', () => {
    const [x, y] = tilePosition(tileLatLon(tile, [0.25, 0.75]), tile.z);
    assert.approximately(x, tile.x + 0.25, 1e-9);
    assert.approximately(y, tile.y + 0.75, 1e-9);
  });

  it('puts null island at the centre of the world', () => {
    assert.deepStrictEqual(tilePosition({ lat: 0, lon: 0 }, 1), [1, 1]);
  });
});

describe('tilesCovering', () => {
  it('returns the one tile around an arena in its middle', () => {
    const center = tileLatLon(tile, [0.5, 0.5]);
    assert.deepStrictEqual(tilesCovering(bounds(center, 150), 14), [tile]);
  });

  it('returns the four tiles meeting at a corner, north-west first', () => {
    const center = tileLatLon(tile, [0, 0]);
    assert.deepStrictEqual(tilesCovering(bounds(center, 150), 14), [
      { z: 14, x: 4573, y: 6462 },
      { z: 14, x: 4574, y: 6462 },
      { z: 14, x: 4573, y: 6463 },
      { z: 14, x: 4574, y: 6463 },
    ]);
  });

  it('grows by the margin', () => {
    const center = tileLatLon(tile, [0.5, 0.5]);
    assert.strictEqual(tilesCovering(bounds(center, 150), 14, 0.5).length, 9);
  });
});

describe('tileUrl', () => {
  it('fills a z/x/y template', () => {
    assert.strictEqual(
      tileUrl('https://example.com/v1/{z}/{x}/{y}.pbf', tile),
      'https://example.com/v1/14/4574/6463.pbf',
    );
  });
});
