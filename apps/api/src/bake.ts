import { Array as Arr } from 'effect';

import type { Arena } from './api.ts';

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

export interface OsmWay {
  readonly tags: Readonly<Record<string, string>>;
  readonly geometry: ReadonlyArray<LatLon>;
}

const METRES_PER_DEGREE_LAT = 110_540;
const METRES_PER_DEGREE_LON = 111_320;
const METRES_PER_LEVEL = 3;
const DEFAULT_BUILDING_HEIGHT = 8;

const ROAD_WIDTHS: Readonly<Record<string, number>> = {
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
};

// Equirectangular projection; accurate to well under a metre across an arena.
export const project = (center: LatLon, point: LatLon): [number, number] => {
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  return [
    (point.lon - center.lon) * METRES_PER_DEGREE_LON * cosLat,
    (center.lat - point.lat) * METRES_PER_DEGREE_LAT,
  ];
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

const closedRing = (center: LatLon, way: OsmWay) => {
  const ring = projectAll(center, way.geometry);
  const first = ring[0];
  const last = ring.at(-1);
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    ring.pop();
  }
  return ring.length >= 3 ? ring : undefined;
};

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

// Part of every durable arena cache key (`arenaKey` in map-data.ts). Bump it
// whenever bakeArena's output for the same OSM input changes, so bakes made
// by older code stop matching instead of being served.
export const BAKE_VERSION = 1;

export const bakeArena = (
  center: LatLon,
  halfSize: number,
  ways: ReadonlyArray<OsmWay>,
): Arena => {
  const arena = {
    ...center,
    halfSize,
    buildings: [] as Array<Arena['buildings'][number]>,
    roads: [] as Array<Arena['roads'][number]>,
    areas: [] as Array<Arena['areas'][number]>,
  };
  for (const way of ways) {
    const { tags } = way;
    const roadWidth =
      tags.highway === undefined ? undefined : ROAD_WIDTHS[tags.highway];
    if (tags.building !== undefined && tags.building !== 'no') {
      const footprint = closedRing(center, way);
      if (footprint) {
        arena.buildings.push({ footprint, height: buildingHeight(tags) });
      }
    } else if (roadWidth !== undefined && way.geometry.length >= 2) {
      arena.roads.push({
        path: projectAll(center, way.geometry),
        width: roadWidth,
      });
    } else {
      const kind = areaKind(tags);
      const outline = closedRing(center, way);
      if (kind !== undefined && outline !== undefined) {
        arena.areas.push({ kind, outline });
      }
    }
  }
  return arena;
};
