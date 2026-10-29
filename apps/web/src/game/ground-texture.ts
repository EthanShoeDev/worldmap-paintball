import '@tanstack/react-start/client-only';
import type { Arena } from '@worldmap-paintball/api-contract';

import { groundTuning } from './tuning.ts';

type Ring = ReadonlyArray<readonly [number, number]>;

const plainGround = '#b9b09a';
const areaColors: Record<Arena['areas'][number]['kind'], string> = {
  park: '#6fa35a',
  water: '#4f86c6',
  wood: '#4f7d40',
  grass: '#93b26f',
};
const roadColor = '#55575c';
// Small areas sit on top of the large ones they are usually inside.
const areaOrder: ReadonlyArray<Arena['areas'][number]['kind']> = [
  'grass',
  'park',
  'wood',
  'water',
];

const trace = (context: CanvasRenderingContext2D, ring: Ring) => {
  context.beginPath();
  for (const [index, [x, z]] of ring.entries()) {
    if (index === 0) context.moveTo(x, z);
    else context.lineTo(x, z);
  }
};

// The map painted flat, in arena metres: x across, z down, so the canvas top
// is north and the ground mesh's UVs line up with no further transform.
// Painting onto the ground's texture drapes areas and roads over any hills.
export const paintGround = (
  arena: Arena,
  photo: CanvasImageSource | undefined,
) => {
  const size = groundTuning.textureSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const { halfSize } = arena;
  const scale = size / (2 * halfSize);
  context.setTransform(scale, 0, 0, scale, halfSize * scale, halfSize * scale);
  if (photo) {
    context.drawImage(photo, -halfSize, -halfSize, 2 * halfSize, 2 * halfSize);
  } else {
    context.fillStyle = plainGround;
    context.fillRect(-halfSize, -halfSize, 2 * halfSize, 2 * halfSize);
  }

  for (const kind of areaOrder) {
    context.fillStyle = areaColors[kind];
    context.globalAlpha = photo ? groundTuning.photoAlpha[kind] : 1;
    for (const area of arena.areas) {
      if (area.kind !== kind) continue;
      trace(context, area.outline);
      context.fill();
    }
  }

  // Roads go on their own layer first so that, translucent, their junctions
  // don't darken where they overlap.
  const roads = document.createElement('canvas');
  roads.width = size;
  roads.height = size;
  const layer = roads.getContext('2d');
  if (!layer) return canvas;
  layer.setTransform(context.getTransform());
  layer.strokeStyle = roadColor;
  layer.lineCap = 'round';
  layer.lineJoin = 'round';
  for (const { path, width } of arena.roads) {
    if (path.length < 2) continue;
    layer.lineWidth = photo ? width * groundTuning.photoRoadWidth : width;
    trace(layer, path);
    layer.stroke();
  }
  context.resetTransform();
  context.globalAlpha = photo ? groundTuning.photoAlpha.roads : 1;
  context.drawImage(roads, 0, 0);
  context.globalAlpha = 1;
  if (arena.round === true) {
    // Out of bounds past a round arena's wall: the square's corners, dimmed.
    context.setTransform(layer.getTransform());
    context.fillStyle = 'rgb(20 24 32 / 0.55)';
    context.beginPath();
    context.rect(-halfSize, -halfSize, 2 * halfSize, 2 * halfSize);
    context.arc(0, 0, halfSize, 0, Math.PI * 2, true);
    context.fill();
    context.resetTransform();
  }
  return canvas;
};

// The ground seen from above with building footprints on it, `size` pixels
// square: the editor's backdrop and the minimap.
export const paintPlan = (
  arena: Arena,
  ground: CanvasImageSource,
  size: number,
) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.drawImage(ground, 0, 0, size, size);
  const { halfSize } = arena;
  const scale = size / (2 * halfSize);
  context.setTransform(scale, 0, 0, scale, halfSize * scale, halfSize * scale);
  context.fillStyle = 'rgba(40, 40, 48, 0.6)';
  context.strokeStyle = '#f1eee8';
  context.lineWidth = 1 / scale;
  for (const { footprint } of arena.buildings) {
    trace(context, footprint);
    context.closePath();
    context.fill();
    context.stroke();
  }
  return canvas;
};
