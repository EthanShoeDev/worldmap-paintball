import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';

import { insideRing } from './trees.ts';
import { canopyTuning } from './tuning.ts';

type Point = readonly [number, number];

// RGBA bytes, row by row, as `getImageData` returns them.
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

// Tree cover on a `columns` × `columns` grid of `cellSize` metre squares
// spanning the arena from its north-west corner, row by row.
export interface Canopy {
  readonly columns: number;
  readonly cellSize: number;
  readonly cells: ReadonlyArray<boolean>;
}

const cellStats = (
  { width, height, data }: Pixels,
  columns: number,
  index: number,
) => {
  const { texturePixels } = canopyTuning;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = Math.max(
    0,
    Math.floor((column * width) / columns) - texturePixels,
  );
  const right = Math.min(
    width,
    Math.ceil(((column + 1) * width) / columns) + texturePixels,
  );
  const top = Math.max(0, Math.floor((row * height) / columns) - texturePixels);
  const bottom = Math.min(
    height,
    Math.ceil(((row + 1) * height) / columns) + texturePixels,
  );
  let count = 0;
  let luma = 0;
  let lumaSquared = 0;
  let green = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * width + x) * 4;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      const value = (r + g + b) / 3;
      count++;
      luma += value;
      lumaSquared += value * value;
      green += 2 * g - r - b;
    }
  }
  const samples = Math.max(1, count);
  const brightness = luma / samples;
  return {
    brightness,
    texture: Math.sqrt(Math.max(0, lumaSquared / samples - brightness ** 2)),
    green: green / samples,
  };
};

export const classifyCanopy = (photo: Pixels, halfSize: number) => {
  const {
    cellSize,
    minGreen,
    shadedBrightness,
    maxBrightness,
    minTexture,
    majority,
  } = canopyTuning;
  const columns = Math.max(1, Math.round((2 * halfSize) / cellSize));
  const raw = Arr.makeBy(columns * columns, (index) => {
    const { brightness, texture, green } = cellStats(photo, columns, index);
    return (
      green > minGreen &&
      (brightness < shadedBrightness ||
        (brightness < maxBrightness && texture > minTexture))
    );
  });
  // The arena's edge repeats its outermost cells, so corners keep their trees.
  const clampCell = (value: number) =>
    Math.max(0, Math.min(columns - 1, value));
  const at = (row: number, column: number) =>
    raw[clampCell(row) * columns + clampCell(column)] === true;
  const cells = Arr.makeBy(columns * columns, (index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    let votes = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) if (at(row + dz, column + dx)) votes++;
    }
    return votes >= majority;
  });
  return {
    columns,
    cellSize: (2 * halfSize) / columns,
    cells,
  } satisfies Canopy;
};

const distanceToSegment = ([x, z]: Point, [ax, az]: Point, [bx, bz]: Point) => {
  const [dx, dz] = [bx - ax, bz - az];
  const length = dx * dx + dz * dz;
  const t =
    length > 0
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length))
      : 0;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
};

const nearPath = (path: ReadonlyArray<Point>, point: Point, reach: number) =>
  Arr.some(path, (from, index) => {
    const to = path[index + 1];
    return to !== undefined && distanceToSegment(point, from, to) < reach;
  });

// The photo shows street trees overhanging roads and roofs, but trunks
// belong beside them: a cell within half its width of a carriageway or a
// building, or inside water, grows nothing.
export const clearOpenGround = (
  canopy: Canopy,
  {
    halfSize,
    roads,
    buildings,
    areas,
  }: Pick<Arena, 'halfSize' | 'roads' | 'buildings' | 'areas'>,
) => {
  const { columns, cellSize, cells } = canopy;
  const margin = cellSize / 2;
  const waters = Arr.filter(areas, ({ kind }) => kind === 'water');
  const isOpen = (centre: Point) =>
    Arr.some(roads, ({ path, width }) =>
      nearPath(path, centre, width / 2 + margin),
    ) ||
    Arr.some(
      buildings,
      ({ footprint }) =>
        insideRing(footprint, centre) ||
        nearPath([...footprint, ...Arr.take(footprint, 1)], centre, margin),
    ) ||
    Arr.some(waters, ({ outline }) => insideRing(outline, centre));
  return {
    ...canopy,
    cells: Arr.map(
      cells,
      (tree, index) =>
        tree &&
        !isOpen([
          -halfSize + ((index % columns) + 0.5) * cellSize,
          -halfSize + (Math.floor(index / columns) + 0.5) * cellSize,
        ]),
    ),
  } satisfies Canopy;
};

export const canopyCover = (
  photo: Pixels,
  arena: Pick<Arena, 'halfSize' | 'roads' | 'buildings' | 'areas'>,
) => clearOpenGround(classifyCanopy(photo, arena.halfSize), arena);
