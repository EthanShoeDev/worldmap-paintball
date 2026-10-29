import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Order } from 'effect';

import { bakeFeatures } from '../src/bake.ts';
import {
  clipLine,
  clipRing,
  type TileFeature,
  tileFeatures,
} from '../src/openfreemap.ts';
import { tileLatLon } from '../src/tiles.ts';

const tile = { z: 14, x: 4574, y: 6463 };
const extent = 4096;
const center = tileLatLon(tile, [0.5, 0.5]);

// A closed ring around the middle of the tile, wound like MVT outer rings.
const square = (x: number, y: number, size = 10) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
  { x, y },
];

const feature = (
  layer: string,
  properties: TileFeature['properties'],
  geometry: TileFeature['geometry'] = [square(2048, 2048)],
  type = 3,
): TileFeature => ({ layer, extent, type, properties, geometry });

const line = [
  { x: 2000, y: 2048 },
  { x: 2100, y: 2048 },
];

describe('tileFeatures', () => {
  it('extrudes buildings by render_height, with a default', () => {
    const features = tileFeatures(tile, [
      feature('building', { render_height: 12 }),
      feature('building', {}),
    ]);
    assert.deepStrictEqual(
      Arr.map(features, (f) => (f.type === 'building' ? f.height : 0)),
      [12, 8],
    );
  });

  it('skips hidden outlines and parts above the ground', () => {
    const features = tileFeatures(tile, [
      feature('building', { render_height: 30, hide_3d: true }),
      feature('building', { render_height: 9, render_min_height: 5 }),
    ]);
    assert.strictEqual(features.length, 0);
  });

  it('sizes roads by class and path subclass, skipping tunnels', () => {
    const road = (properties: TileFeature['properties']) =>
      feature('transportation', properties, [line], 2);
    const features = tileFeatures(tile, [
      road({ class: 'primary' }),
      road({ class: 'minor' }),
      road({ class: 'path', subclass: 'footway' }),
      road({ class: 'path', subclass: 'bridleway' }),
      road({ class: 'rail', subclass: 'rail' }),
      road({ class: 'secondary', brunnel: 'tunnel' }),
      road({ class: 'service', brunnel: 'bridge' }),
      feature('transportation', { class: 'pier' }),
    ]);
    assert.deepStrictEqual(
      Arr.map(features, (f) => (f.type === 'road' ? f.width : 0)),
      [10, 6, 2, 4],
    );
  });

  it('classifies water, parks, wood and grass, ignoring the rest', () => {
    const features = tileFeatures(tile, [
      feature('water', { class: 'lake' }),
      feature('park', { class: 'park' }),
      feature('park', { class: 'national_park' }),
      feature('landcover', { class: 'wood', subclass: 'forest' }),
      feature('landcover', { class: 'grass', subclass: 'meadow' }),
      feature('landcover', { class: 'farmland' }),
      feature('landuse', { class: 'residential' }),
      feature('poi', { class: 'park' }, [[{ x: 2048, y: 2048 }]], 1),
    ]);
    assert.deepStrictEqual(
      Arr.map(features, (f) => (f.type === 'area' ? f.kind : f.type)),
      ['water', 'park', 'wood', 'grass'],
    );
  });

  it('keeps outer rings and drops holes', () => {
    const outer = square(2000, 2000, 100);
    const hole = Arr.reverse(square(2040, 2040, 20));
    const features = tileFeatures(tile, [
      feature('water', {}, [outer, hole, square(2200, 2200)]),
    ]);
    assert.strictEqual(features.length, 2);
  });

  it('drops geometry that lies only in the tile buffer', () => {
    const features = tileFeatures(tile, [
      feature('building', {}, [square(-60, 2048)]),
      feature('transportation', { class: 'primary' }, [
        [
          { x: 4100, y: 0 },
          { x: 4150, y: 100 },
        ],
      ]),
    ]);
    assert.strictEqual(features.length, 0);
  });

  it('bakes into an arena around the centre', () => {
    const arena = bakeFeatures(
      center,
      150,
      tileFeatures(tile, [
        feature('building', { render_height: 6 }),
        feature('building', {}, [square(100, 100)]),
        feature('transportation', { class: 'primary' }, [line], 2),
        feature('landcover', { class: 'wood' }),
      ]),
    );
    assert.deepStrictEqual(
      [arena.buildings.length, arena.roads.length, arena.areas.length],
      [1, 1, 1],
    );
    const [x, z] = arena.buildings[0]?.footprint[0] ?? [];
    assert.approximately(x ?? Number.NaN, 0, 1);
    assert.approximately(z ?? Number.NaN, 0, 1);
  });
});

describe('clipRing', () => {
  it('cuts a ring at the tile edge', () => {
    const clipped = clipRing(square(-10, 100, 20), extent);
    assert.deepStrictEqual(
      Arr.sort(
        Arr.map(clipped, ({ x }) => x),
        Order.Number,
      ),
      [0, 0, 10, 10],
    );
  });

  it('leaves an inside ring alone, without the closing point', () => {
    assert.deepStrictEqual(
      clipRing(square(100, 100), extent),
      square(100, 100).slice(0, -1),
    );
  });
});

describe('clipLine', () => {
  it('splits a line that leaves the tile and comes back', () => {
    const pieces = clipLine(
      [
        { x: 100, y: 10 },
        { x: 100, y: -10 },
        { x: 200, y: -10 },
        { x: 200, y: 10 },
        { x: 300, y: 10 },
      ],
      extent,
    );
    assert.deepStrictEqual(pieces, [
      [
        { x: 100, y: 10 },
        { x: 100, y: 0 },
      ],
      [
        { x: 200, y: 0 },
        { x: 200, y: 10 },
        { x: 300, y: 10 },
      ],
    ]);
  });
});
