import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr, Record as Rec } from 'effect';

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface OsmWay {
  readonly tags: Readonly<Record<string, string>>;
  readonly geometry: ReadonlyArray<LatLon>;
}

// What every map source (OSM ways, vector tiles) is reduced to before baking.
export type MapFeature =
  | {
      readonly type: 'building';
      readonly outline: ReadonlyArray<LatLon>;
      readonly height: number;
    }
  | {
      readonly type: 'road';
      readonly path: ReadonlyArray<LatLon>;
      readonly width: number;
    }
  | {
      readonly type: 'area';
      readonly kind: Arena['areas'][number]['kind'];
      readonly outline: ReadonlyArray<LatLon>;
    };

const METRES_PER_DEGREE_LAT = 110_540;
const METRES_PER_DEGREE_LON = 111_320;
const METRES_PER_LEVEL = 3;
export const DEFAULT_BUILDING_HEIGHT = 8;

// A Map, not an object literal, so tag values such as "constructor" miss.
const ROAD_WIDTHS = new Map<string, number>(
  Rec.toEntries({
    motorway: 14,
    trunk: 12,
    primary: 10,
    secondary: 9,
    tertiary: 8,
    residential: 6,
    unclassified: 6,
    service: 4,
    pedestrian: 4,
    living_street: 5,
    footway: 2,
    path: 2,
    cycleway: 2,
    steps: 2,
  }),
);

export const roadWidth = (type: string) => ROAD_WIDTHS.get(type);

// Equirectangular projection; accurate to well under a metre across an arena.
export const project = (center: LatLon, point: LatLon): [number, number] => {
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  return [
    (point.lon - center.lon) * METRES_PER_DEGREE_LON * cosLat,
    (center.lat - point.lat) * METRES_PER_DEGREE_LAT,
  ];
};

export const unproject = (
  center: LatLon,
  [x, z]: readonly [number, number],
) => {
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  return {
    lat: center.lat - z / METRES_PER_DEGREE_LAT,
    lon: center.lon + x / (METRES_PER_DEGREE_LON * cosLat),
  };
};

// Inverse of `project` for the arena bounds, as [south, west, north, east].
export const bounds = (center: LatLon, halfSize: number) => {
  const dLat = halfSize / METRES_PER_DEGREE_LAT;
  const dLon =
    halfSize / (METRES_PER_DEGREE_LON * Math.cos((center.lat * Math.PI) / 180));
  return [
    center.lat - dLat,
    center.lon - dLon,
    center.lat + dLat,
    center.lon + dLon,
  ] as const;
};

// OSM heights are free text such as "12", "12 m" or "12.5".
export const buildingHeight = (tags: OsmWay['tags']) => {
  const height = Number.parseFloat(tags.height ?? '');
  if (height > 0) return height;
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (levels > 0) return levels * METRES_PER_LEVEL;
  return DEFAULT_BUILDING_HEIGHT;
};

const projectAll = (center: LatLon, points: ReadonlyArray<LatLon>) =>
  Arr.map(points, (point) => project(center, point));

const closedRing = (center: LatLon, outline: ReadonlyArray<LatLon>) => {
  const ring = projectAll(center, outline);
  const first = ring[0];
  const last = ring.at(-1);
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    ring.pop();
  }
  return ring.length >= 3 ? ring : undefined;
};

// Like Overpass's bbox filter: keep anything whose bounding box touches the
// arena, whole, even where it extends past the edge.
const touchesArena = (
  points: ReadonlyArray<readonly [number, number]>,
  halfSize: number,
) =>
  Arr.some(points, ([x]) => x <= halfSize) &&
  Arr.some(points, ([x]) => x >= -halfSize) &&
  Arr.some(points, ([, z]) => z <= halfSize) &&
  Arr.some(points, ([, z]) => z >= -halfSize);

const areaKind = (tags: OsmWay['tags']) => {
  if (tags.natural === 'water') return 'water' as const;
  if (
    tags.leisure === 'park' ||
    tags.landuse === 'grass' ||
    tags.landuse === 'recreation_ground'
  ) {
    return 'park' as const;
  }
  return undefined;
};

const osmFeature = (way: OsmWay): ReadonlyArray<MapFeature> => {
  const { tags, geometry } = way;
  if (tags.building !== undefined && tags.building !== 'no') {
    return [
      { type: 'building', outline: geometry, height: buildingHeight(tags) },
    ];
  }
  const width =
    tags.highway === undefined ? undefined : roadWidth(tags.highway);
  if (width !== undefined && geometry.length >= 2) {
    return [{ type: 'road', path: geometry, width }];
  }
  const kind = areaKind(tags);
  return kind === undefined ? [] : [{ type: 'area', kind, outline: geometry }];
};

// Part of every durable arena cache key (`arenaKey` in map-data.ts). Bump it
// whenever baking output for the same map data changes, so bakes made by
// older code stop matching instead of being served.
export const BAKE_VERSION = 2;

export const bakeFeatures = (
  center: LatLon,
  halfSize: number,
  features: Iterable<MapFeature>,
) => {
  const arena = {
    ...center,
    halfSize,
    buildings: [] as Array<Arena['buildings'][number]>,
    roads: [] as Array<Arena['roads'][number]>,
    areas: [] as Array<Arena['areas'][number]>,
  };
  for (const feature of features) {
    if (feature.type === 'road') {
      const path = projectAll(center, feature.path);
      if (path.length >= 2 && touchesArena(path, halfSize)) {
        arena.roads.push({ path, width: feature.width });
      }
      continue;
    }
    const ring = closedRing(center, feature.outline);
    if (ring === undefined || !touchesArena(ring, halfSize)) continue;
    if (feature.type === 'building') {
      arena.buildings.push({ footprint: ring, height: feature.height });
    } else {
      arena.areas.push({ kind: feature.kind, outline: ring });
    }
  }
  return arena;
};

export const bakeArena = (
  center: LatLon,
  halfSize: number,
  ways: ReadonlyArray<OsmWay>,
) => bakeFeatures(center, halfSize, Arr.flatMap(ways, osmFeature));
