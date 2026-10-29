import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr, Order } from 'effect';
import {
  type BufferGeometry,
  ExtrudeGeometry,
  PlaneGeometry,
  Shape,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { type Ground, groundBelow } from './terrain.ts';

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
});

// Roads are rarely inside buildings, so spawn on the road node nearest the centre.
export const spawnPoint = (roads: Arena['roads']) => {
  let best: Point = [0, 0];
  let bestDistance = Infinity;
  for (const point of Arr.flatMap(roads, (road) => road.path)) {
    const distance = Math.hypot(point[0], point[1]);
    if (distance < bestDistance) [best, bestDistance] = [point, distance];
  }
  return best;
};

// Road nodes nearest the centre, at least `spacing` metres apart, so each
// player gets their own spawn and respawns can pick one away from the fight.
export const spawnPoints = (
  roads: Arena['roads'],
  { count = 24, spacing = 6 } = {},
) => {
  const nodes = Arr.sort(
    Arr.flatMap(roads, (road) => road.path),
    Order.mapInput(Order.Number, ([x, z]: Point) => Math.hypot(x, z)),
  );
  const picked: Array<Point> = [];
  for (const node of nodes) {
    if (picked.length >= count) break;
    if (
      Arr.every(
        picked,
        (p) => Math.hypot(p[0] - node[0], p[1] - node[1]) >= spacing,
      )
    ) {
      picked.push(node);
    }
  }
  return picked.length > 0 ? picked : [spawnPoint(roads)];
};
