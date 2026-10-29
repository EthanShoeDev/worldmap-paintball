import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';

export type Ground = Pick<Arena, 'halfSize' | 'terrain'>;

type Point = readonly [number, number];

// A local coordinate in grid cells from the north or west edge, clamped to
// the grid.
const gridCoordinate = (halfSize: number, size: number, value: number) =>
  Math.max(
    0,
    Math.min(size - 1, ((value + halfSize) / (2 * halfSize)) * (size - 1)),
  );

export const heightAt = (
  { halfSize, terrain }: Ground,
  x: number,
  z: number,
) => {
  if (!terrain) return 0;
  const { size, heights } = terrain;
  const gx = gridCoordinate(halfSize, size, x);
  const gz = gridCoordinate(halfSize, size, z);
  const column = Math.min(Math.floor(gx), size - 2);
  const row = Math.min(Math.floor(gz), size - 2);
  const at = (r: number, c: number) => heights[r * size + c] ?? 0;
  const tx = gx - column;
  const north = at(row, column) * (1 - tx) + at(row, column + 1) * tx;
  const south = at(row + 1, column) * (1 - tx) + at(row + 1, column + 1) * tx;
  const tz = gz - row;
  return north * (1 - tz) + south * tz;
};

// The lowest grid node of every cell under the points' bounding box: the
// ground mesh interpolates between those nodes, so it never dips below this.
export const groundBelow = (
  { halfSize, terrain }: Ground,
  points: ReadonlyArray<Point>,
) => {
  if (!terrain || points.length === 0) return 0;
  const { size, heights } = terrain;
  const xs = Arr.map(points, ([x]) => gridCoordinate(halfSize, size, x));
  const zs = Arr.map(points, ([, z]) => gridCoordinate(halfSize, size, z));
  let lowest = Infinity;
  for (
    let row = Math.floor(Math.min(...zs));
    row <= Math.ceil(Math.max(...zs));
    row++
  ) {
    for (
      let column = Math.floor(Math.min(...xs));
      column <= Math.ceil(Math.max(...xs));
      column++
    ) {
      lowest = Math.min(lowest, heights[row * size + column] ?? 0);
    }
  }
  return lowest;
};

export const heightRange = ({ terrain }: Ground) =>
  terrain && terrain.heights.length > 0
    ? {
        lowest: Math.min(...terrain.heights),
        highest: Math.max(...terrain.heights),
      }
    : { lowest: 0, highest: 0 };
