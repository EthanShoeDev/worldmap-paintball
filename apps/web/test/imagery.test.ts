import { assert, describe, it } from '@effect/vitest';

import {
  imageryTileUrl,
  isBlank,
  mercatorPixel,
  tileCover,
} from '../src/game/imagery.ts';

const tiles = 2 ** 16;

// The north-west corner of a z16 tile, by the inverse Web Mercator formulas.
const tileCorner = (x: number, y: number) => ({
  lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / tiles))) * 180) / Math.PI,
  lon: (x / tiles) * 360 - 180,
});

describe('mercatorPixel', () => {
  it('puts the origin of lat/lon at the middle of the world', () => {
    const [x, y] = mercatorPixel(0, 0);
    assert.closeTo(x, (256 * tiles) / 2, 1e-6);
    assert.closeTo(y, (256 * tiles) / 2, 1e-6);
  });

  it('inverts the tile corner formulas', () => {
    const { lat, lon } = tileCorner(18_452, 25_784);
    const [x, y] = mercatorPixel(lat, lon);
    assert.closeTo(x, 18_452 * 256, 1e-6);
    assert.closeTo(y, 25_784 * 256, 1e-6);
  });
});

describe('tileCover', () => {
  it('crops a 300 m arena out of the one tile around it', () => {
    const {
      origin,
      tiles: cover,
      crop,
    } = tileCover({ lat: 35.7796, lon: -78.6382 }, 150);
    assert.deepStrictEqual(origin, { x: 18_452, y: 25_784 });
    assert.deepStrictEqual(cover, [{ x: 18_452, y: 25_784 }]);
    // About 1.94 m per pixel at this latitude.
    assert.closeTo(crop.width, 154.8, 0.1);
    assert.closeTo(crop.height, 155.9, 0.1);
    assert.closeTo(crop.x, 12.85, 0.1);
    assert.closeTo(crop.y, 69.72, 0.1);
  });

  it('takes every tile an arena on a tile corner touches', () => {
    const {
      origin,
      tiles: cover,
      crop,
    } = tileCover(tileCorner(18_453, 25_785), 150);
    assert.deepStrictEqual(origin, { x: 18_452, y: 25_784 });
    assert.deepStrictEqual(cover, [
      { x: 18_452, y: 25_784 },
      { x: 18_453, y: 25_784 },
      { x: 18_452, y: 25_785 },
      { x: 18_453, y: 25_785 },
    ]);
    // Centred on the corner the mosaic's tiles share.
    assert.closeTo(crop.x + crop.width / 2, 256, 0.5);
    assert.closeTo(crop.y + crop.height / 2, 256, 0.5);
  });

  it('builds y-before-x tile URLs at z16', () => {
    assert.strictEqual(
      imageryTileUrl({ x: 18_452, y: 25_784 }),
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/16/25784/18452',
    );
  });
});

describe('isBlank', () => {
  it('flags a flat colour and passes a photo with contrast', () => {
    assert.isTrue(isBlank([200, 200, 200, 255, 201, 201, 201, 255]));
    assert.isFalse(isBlank([40, 60, 30, 255, 180, 170, 160, 255]));
  });
});
