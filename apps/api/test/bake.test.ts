import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';

import {
  addFootprints,
  bakeArena,
  bakeFeatures,
  bounds,
  buildingHeight,
  footprintHeight,
  project,
} from '../src/bake.ts';

const center = { lat: 0, lon: 0 };
const offset = 0.0001;

const square = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: offset },
  { lat: offset, lon: offset },
  { lat: offset, lon: 0 },
];

describe('project', () => {
  it('maps the centre to the origin', () => {
    assert.deepStrictEqual(project(center, center), [0, 0]);
  });

  it('points east along +x and north along -z', () => {
    const [eastX, eastZ] = project(center, { lat: 0, lon: offset });
    assert.isAbove(eastX, 0);
    assert.strictEqual(eastZ, 0);

    const [northX, northZ] = project(center, { lat: offset, lon: 0 });
    assert.strictEqual(northX, 0);
    assert.isBelow(northZ, 0);
  });

  it('shrinks longitude spacing away from the equator', () => {
    const [equator] = project(center, { lat: 0, lon: offset });
    const north = { lat: 60, lon: 0 };
    const [highLat] = project(north, { lat: 60, lon: offset });
    assert.approximately(highLat, equator / 2, 1e-6);
  });
});

describe('bounds', () => {
  it('inverts project at the arena edges', () => {
    const origin = { lat: 51.5, lon: -0.12 };
    const [south, west, north, east] = bounds(origin, 150);
    const [westX, southZ] = project(origin, { lat: south, lon: west });
    const [eastX, northZ] = project(origin, { lat: north, lon: east });
    assert.approximately(westX, -150, 1e-6);
    assert.approximately(southZ, 150, 1e-6);
    assert.approximately(eastX, 150, 1e-6);
    assert.approximately(northZ, -150, 1e-6);
  });
});

describe('buildingHeight', () => {
  it('prefers an explicit height, ignoring units', () => {
    assert.strictEqual(
      buildingHeight({ height: '12.5 m', 'building:levels': '9' }),
      12.5,
    );
  });

  it('falls back to three metres per level', () => {
    assert.strictEqual(
      buildingHeight({ height: 'tall', 'building:levels': '4' }),
      12,
    );
  });

  it('defaults to eight metres', () => {
    assert.strictEqual(buildingHeight({ building: 'yes' }), 8);
    assert.strictEqual(
      buildingHeight({ height: '0', 'building:levels': '-1' }),
      8,
    );
  });
});

describe('bakeArena', () => {
  it('drops the duplicated closing node of a building ring', () => {
    const arena = bakeArena(center, 150, [
      { tags: { building: 'yes' }, geometry: [...square, { lat: 0, lon: 0 }] },
    ]);
    assert.deepStrictEqual(
      Arr.map(arena.buildings, (building) => building.footprint.length),
      [4],
    );
  });

  it('skips degenerate rings and building=no', () => {
    const arena = bakeArena(center, 150, [
      {
        tags: { building: 'yes' },
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: offset },
          { lat: 0, lon: 0 },
        ],
      },
      { tags: { building: 'no' }, geometry: square },
    ]);
    assert.strictEqual(arena.buildings.length, 0);
  });

  it('sizes roads by highway class and ignores unknown classes', () => {
    const path = square.slice(0, 2);
    const arena = bakeArena(center, 150, [
      { tags: { highway: 'primary' }, geometry: path },
      { tags: { highway: 'footway' }, geometry: path },
      { tags: { highway: 'proposed' }, geometry: path },
      { tags: { highway: 'residential' }, geometry: path.slice(0, 1) },
    ]);
    assert.deepStrictEqual(
      Arr.map(arena.roads, (road) => [road.width, road.path.length]),
      [
        [10, 2],
        [2, 2],
      ],
    );
  });

  it('classifies parks and water and ignores other areas', () => {
    const arena = bakeArena(center, 150, [
      { tags: { leisure: 'park' }, geometry: square },
      { tags: { landuse: 'grass' }, geometry: square },
      { tags: { natural: 'water' }, geometry: square },
      { tags: { landuse: 'industrial' }, geometry: square },
    ]);
    assert.deepStrictEqual(
      Arr.map(arena.areas, (area) => area.kind),
      ['park', 'park', 'water'],
    );
  });

  it('keeps the centre and half size', () => {
    const arena = bakeArena({ lat: 1, lon: 2 }, 150, []);
    assert.deepStrictEqual(arena, {
      lat: 1,
      lon: 2,
      halfSize: 150,
      buildings: [],
      roads: [],
      areas: [],
    });
  });
});

describe('bakeFeatures', () => {
  const far = 0.01;

  it('keeps features touching the arena and drops the rest', () => {
    const arena = bakeFeatures(center, 150, [
      { type: 'building', outline: square, height: 5 },
      {
        type: 'building',
        outline: Arr.map(square, ({ lat, lon }) => ({ lat, lon: lon + far })),
        height: 5,
      },
      {
        type: 'road',
        path: [
          { lat: 0, lon: -far },
          { lat: 0, lon: far },
        ],
        width: 6,
      },
      { type: 'area', kind: 'wood', outline: square },
      {
        type: 'area',
        kind: 'grass',
        outline: Arr.map(square, ({ lat, lon }) => ({ lat: lat + far, lon })),
      },
    ]);
    assert.deepStrictEqual(
      [arena.buildings.length, arena.roads.length, arena.areas.length],
      [1, 1, 1],
    );
    assert.strictEqual(arena.areas[0]?.kind, 'wood');
  });
});

describe('footprintHeight', () => {
  it('gives a house one storey and a roof', () => {
    assert.strictEqual(footprintHeight(120), 6);
    assert.strictEqual(footprintHeight(250), 6);
  });

  it('grows with the footprint up to a cap', () => {
    assert.closeTo(footprintHeight(500), 6 * Math.SQRT2, 1e-9);
    assert.strictEqual(footprintHeight(1000), 12);
    assert.strictEqual(footprintHeight(20_000), 12);
  });

  it('uses an estimate only when it is taller than the default', () => {
    assert.strictEqual(footprintHeight(120, 3.4), 6);
    assert.strictEqual(footprintHeight(2000, 21.5), 21.5);
  });
});

describe('addFootprints', () => {
  const far = 0.01;
  const osm = bakeFeatures(center, 150, [
    { type: 'building', outline: square, height: 5 },
  ]);
  const shifted = (dLat: number, dLon: number) =>
    Arr.map(square, ({ lat, lon }) => ({ lat: lat + dLat, lon: lon + dLon }));

  it('keeps OSM buildings and adds footprints in the gaps', () => {
    const arena = addFootprints(osm, [
      { outline: shifted(0.0005, 0.0005), height: undefined },
    ]);
    assert.strictEqual(arena.buildings.length, 2);
    assert.deepStrictEqual(arena.buildings[0], osm.buildings[0]);
    assert.strictEqual(arena.buildings[1]?.height, 6);
  });

  it('drops a footprint overlapping an OSM building, even a few metres off', () => {
    const arena = addFootprints(osm, [
      { outline: shifted(0.00004, 0.00004), height: 9 },
    ]);
    assert.deepStrictEqual(arena.buildings, osm.buildings);
  });

  it('keeps footprints that only overlap each other', () => {
    const arena = addFootprints(osm, [
      { outline: shifted(0.0005, 0.0005), height: undefined },
      { outline: shifted(0.00054, 0.0005), height: undefined },
    ]);
    assert.strictEqual(arena.buildings.length, 3);
  });

  it('drops footprints outside the arena and degenerate ones', () => {
    const arena = addFootprints(osm, [
      { outline: shifted(0, far), height: undefined },
      { outline: square.slice(0, 2), height: undefined },
    ]);
    assert.deepStrictEqual(arena.buildings, osm.buildings);
  });

  it('uses the estimate for a tall footprint', () => {
    const arena = addFootprints(osm, [
      { outline: shifted(0.0005, 0.0005), height: 14.2 },
    ]);
    assert.strictEqual(arena.buildings[1]?.height, 14.2);
  });
});
