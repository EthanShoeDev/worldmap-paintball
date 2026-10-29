import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';

export type Point = readonly [number, number];

// Road points as a walkable graph; nodes are indices into `points`.
export interface RoadGraph {
  readonly points: ReadonlyArray<Point>;
  readonly neighbours: ReadonlyArray<ReadonlyArray<number>>;
}

// Keeps waypoints off the boundary walls.
const wallMargin = 1.5;
// OSM ways that meet share a node, so their points coincide after rounding.
const keyPrecision = 10;

const keyOf = ([x, z]: Point) =>
  `${Math.round(x * keyPrecision)},${Math.round(z * keyPrecision)}`;

export const roadGraph = (roads: Arena['roads'], halfSize: number) => {
  const limit = Math.max(0, halfSize - wallMargin);
  const clamp = (value: number) => Math.max(-limit, Math.min(limit, value));
  const points: Array<Point> = [];
  const neighbours: Array<Set<number>> = [];
  const indices = new Map<string, number>();
  const nodeOf = ([x, z]: Point) => {
    const point = [clamp(x), clamp(z)] as const;
    const key = keyOf(point);
    const known = indices.get(key);
    if (known !== undefined) return known;
    indices.set(key, points.length);
    points.push(point);
    neighbours.push(new Set());
    return points.length - 1;
  };
  for (const { path } of roads) {
    const nodes = Arr.map(path, nodeOf);
    for (let index = 1; index < nodes.length; index++) {
      const a = nodes[index - 1];
      const b = nodes[index];
      if (a === undefined || b === undefined || a === b) continue;
      neighbours[a]?.add(b);
      neighbours[b]?.add(a);
    }
  }
  return {
    points,
    neighbours: Arr.map(neighbours, (set) => [...set]),
  } satisfies RoadGraph;
};

export const nearestNode = (graph: RoadGraph, [x, z]: Point) => {
  let nearest: number | undefined;
  let nearestDistance = Infinity;
  for (const [index, point] of graph.points.entries()) {
    const d = Math.hypot(point[0] - x, point[1] - z);
    if (d < nearestDistance) [nearest, nearestDistance] = [index, d];
  }
  return nearest;
};

// A random walk step that only turns back at a dead end; `roll` is in [0, 1).
export const nextNode = (
  graph: RoadGraph,
  at: number,
  from: number | undefined,
  roll: number,
) => {
  const all = graph.neighbours[at] ?? [];
  const onward = Arr.filter(all, (node) => node !== from);
  const choices = onward.length > 0 ? onward : all;
  return choices[Math.floor(roll * choices.length)] ?? at;
};
