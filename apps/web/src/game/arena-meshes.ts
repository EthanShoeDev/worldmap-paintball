import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr, Order } from 'effect';
import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

export const buildingsGeometry = (buildings: Arena['buildings']) =>
  merge(
    Arr.flatMap(buildings, ({ footprint, height }) => {
      const shape = toShape(footprint);
      if (!shape || height <= 0) return [];
      const geometry = new ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
      });
      geometry.rotateX(-Math.PI / 2);
      return [geometry];
    }),
  );

export const areasGeometry = (outlines: ReadonlyArray<Ring>, y: number) =>
  merge(
    Arr.flatMap(outlines, (outline) => {
      const shape = toShape(outline);
      if (!shape) return [];
      const geometry = new ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, y, 0);
      return [geometry];
    }),
  );

// Miter joins, capped so sharp turns don't spike far beyond the road width.
const maxMiter = 2;

const offsets = (path: Ring, index: number): Point => {
  const point = path[index] ?? [0, 0];
  const previous = path[index - 1] ?? point;
  const next = path[index + 1] ?? point;
  const direction = (from: Point, to: Point): Point => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return length === 0
      ? [0, 0]
      : [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  };
  const incoming = direction(previous, point);
  const outgoing = direction(point, next);
  const tangent = [
    incoming[0] + outgoing[0],
    incoming[1] + outgoing[1],
  ] as const;
  const tangentLength = Math.hypot(tangent[0], tangent[1]) || 1;
  const normal: Point = [
    -tangent[1] / tangentLength,
    tangent[0] / tangentLength,
  ];
  const segment = index > 0 ? incoming : outgoing;
  const cos = Math.abs(normal[0] * -segment[1] + normal[1] * segment[0]);
  const scale = Math.min(1 / Math.max(cos, 1e-6), maxMiter);
  return [normal[0] * scale, normal[1] * scale];
};

// One flat quad strip per road at height y. Triangles wind counter-clockwise
// seen from above so their faces point +y.
export const roadsGeometry = (roads: Arena['roads'], y: number) => {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const { path, width } of roads) {
    if (path.length < 2) continue;
    const base = positions.length / 3;
    const halfWidth = width / 2;
    for (const [index, [x, z]] of path.entries()) {
      const [nx, nz] = offsets(path, index);
      positions.push(
        x + nx * halfWidth,
        y,
        z + nz * halfWidth,
        x - nx * halfWidth,
        y,
        z - nz * halfWidth,
      );
    }
    for (let index = 0; index < path.length - 1; index++) {
      const left = base + index * 2;
      const right = left + 1;
      indices.push(left, left + 2, right, right, left + 2, right + 2);
    }
  }
  if (indices.length === 0) return undefined;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(
      Arr.flatten(Arr.makeBy(positions.length / 3, () => [0, 1, 0])),
      3,
    ),
  );
  geometry.setIndex(indices);
  return geometry;
};

const outlines = (
  areas: Arena['areas'],
  kind: Arena['areas'][number]['kind'],
) =>
  Arr.map(
    Arr.filter(areas, (area) => area.kind === kind),
    (area) => area.outline,
  );

export const arenaGeometries = (arena: Arena) => ({
  buildings: buildingsGeometry(arena.buildings),
  parks: areasGeometry(outlines(arena.areas, 'park'), 0.02),
  water: areasGeometry(outlines(arena.areas, 'water'), 0.03),
  roads: roadsGeometry(arena.roads, 0.05),
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
