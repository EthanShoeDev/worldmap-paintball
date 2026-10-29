import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';
import {
  type BufferGeometry,
  ExtrudeGeometry,
  PlaneGeometry,
  Shape,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { nextRandom } from './bot-brain.ts';
import { rampsGeometry, rampsOf } from './ramps.ts';
import { type Ground, groundBelow, inArena } from './terrain.ts';

type Point = readonly [number, number];
type Ring = ReadonlyArray<Point>;

// OSM rings repeat the first node at the end; three's shapes close themselves.
const openRing = (ring: Ring) => {
  const first = ring[0];
  const last = ring.at(-1);
  return first && last && first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
};

// Arena points are (x east, z south). A shape lives in the XY plane, so use
// sy = -z: rotateX(-π/2) then maps (sx, sy, depth) to (x, depth, z).
const toShape = (ring: Ring) => {
  const points = openRing(ring);
  return points.length >= 3
    ? new Shape(Arr.map(points, ([x, z]) => new Vector2(x, -z)))
    : undefined;
};

const merge = (geometries: BufferGeometry[]) => {
  if (geometries.length === 0) return undefined;
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  return merged ?? undefined;
};

// Each building stands on the lowest ground under its footprint, so it never
// floats on a slope.
export const buildingsGeometry = ({
  buildings,
  ...ground
}: Ground & Pick<Arena, 'buildings'>) =>
  merge(
    Arr.flatMap(buildings, ({ footprint, height }) => {
      const shape = toShape(footprint);
      if (!shape || height <= 0) return [];
      const geometry = new ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, groundBelow(ground, footprint), 0);
      return [geometry];
    }),
  );

// The terrain grid as a mesh. PlaneGeometry lays its vertices out row by row
// from the north-west corner once rotated flat, the same order as the grid.
export const groundGeometry = ({ halfSize, terrain }: Ground) => {
  const segments = terrain ? terrain.size - 1 : 1;
  const geometry = new PlaneGeometry(
    halfSize * 2,
    halfSize * 2,
    segments,
    segments,
  );
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    position.setY(index, terrain?.heights[index] ?? 0);
  }
  geometry.computeVertexNormals();
  return geometry;
};

export const arenaGeometries = (arena: Arena) => ({
  buildings: buildingsGeometry(arena),
  ground: groundGeometry(arena),
  ramps: rampsGeometry(rampsOf(arena)),
});

export const insideRing = ([x, z]: Point, ring: Ring) => {
  let inside = false;
  for (const [index, [ax, az]] of ring.entries()) {
    const [bx, bz] = ring.at(index - 1) ?? [ax, az];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) {
      inside = !inside;
    }
  }
  return inside;
};

const distanceToRing = ([x, z]: Point, ring: Ring) =>
  Math.min(
    ...Arr.map(ring, ([ax, az], index) => {
      const [bx, bz] = ring.at(index - 1) ?? [ax, az];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
      );
      return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    }),
  );

// Clear of a player's body.
const spawnClearance = 1.5;

const isClear = (point: Point, buildings: Arena['buildings']) =>
  Arr.every(
    buildings,
    ({ footprint }) =>
      !insideRing(point, footprint) &&
      distanceToRing(point, footprint) >= spawnClearance,
  );

// Spawns are scattered over open ground: clear of buildings, their ramps and
// water, and far enough inside the walls not to start against one. The seed
// is fixed so every peer derives the same list.
const edgeMargin = 5;
const spawnSeed = 7919;
const spawnTries = 400;

export type Spawnable = Pick<
  Arena,
  'buildings' | 'areas' | 'halfSize' | 'terrain' | 'round'
>;

const openGround = (arena: Spawnable) => {
  const ramps = rampsOf(arena);
  const water = Arr.filter(arena.areas, ({ kind }) => kind === 'water');
  return (point: Point) =>
    isClear(point, arena.buildings) &&
    Arr.every(
      ramps,
      ({ position: [x, , z], halfExtents: [reach] }) =>
        Math.hypot(point[0] - x, point[1] - z) > reach + spawnClearance,
    ) &&
    Arr.every(water, ({ outline }) => !insideRing(point, outline));
};

const gap = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Each next point is the one farthest from all picked so far, so however many
// players take the first spawns, they start spread across the arena.
const farthestFirst = (points: ReadonlyArray<Point>) => {
  const [first, ...rest] = points;
  if (!first) return [];
  const picked: Array<Point> = [first];
  const left = [...rest];
  while (left.length > 0) {
    let best = 0;
    let bestGap = -1;
    for (const [index, point] of left.entries()) {
      const nearest = Math.min(...Arr.map(picked, (p) => gap(p, point)));
      if (nearest > bestGap) [best, bestGap] = [index, nearest];
    }
    picked.push(...left.splice(best, 1));
  }
  return picked;
};

// Up to `count` open points from `seed`, spread out farthest first.
export const scatterOpen = (arena: Spawnable, count: number, from: number) => {
  const open = openGround(arena);
  const limit = arena.halfSize - edgeMargin;
  const found: Array<Point> = [];
  // Small seeds give small first draws, so skip one.
  let seed = nextRandom(from)[1];
  for (let tries = 0; tries < spawnTries && found.length < count; tries++) {
    const [u, next] = nextRandom(seed);
    const [v, after] = nextRandom(next);
    seed = after;
    const point = [(u * 2 - 1) * limit, (v * 2 - 1) * limit] as const;
    if (inArena(arena, ...point, edgeMargin) && open(point)) found.push(point);
  }
  return farthestFirst(found);
};

// Respawns pick the one farthest from the living.
export const spawnPoints = (arena: Spawnable, { count = 32 } = {}) => {
  const spread = scatterOpen(arena, count, spawnSeed);
  return spread.length > 0 ? spread : [[0, 0] as const];
};

export const spawnPoint = (arena: Spawnable) =>
  spawnPoints(arena)[0] ?? ([0, 0] as const);
