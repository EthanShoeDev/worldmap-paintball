import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';

import { nextRandom } from './bot-brain.ts';
import { type Ground, heightAt } from './terrain.ts';
import type { Canopy } from './tree-cover.ts';
import { treeTuning } from './tuning.ts';

type Point = readonly [number, number];
type Ring = ReadonlyArray<Point>;

export interface Tree {
  readonly position: readonly [number, number, number];
  readonly height: number;
  readonly yaw: number;
  readonly conifer: boolean;
}

// Even-odd ray casting; a repeated closing node adds a zero-length edge.
export const insideRing = (ring: Ring, [x, z]: Point) => {
  let inside = false;
  for (const [index, [ax, az]] of ring.entries()) {
    const [bx, bz] = ring[(index + 1) % ring.length] ?? [ax, az];
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) {
      inside = !inside;
    }
  }
  return inside;
};

// Seeded, so every peer grows the same trees from the same arena. Each wood
// is sampled at the tuned density over its bounding box clipped to the arena,
// keeping the samples inside it: woods often reach far beyond the arena.
// Canopy read from the photo adds trees at the same density where the map
// has no wood; peers' browsers may decode it a little differently, which
// only matters to the eye.
export const scatterTrees = (
  arena: Ground & Pick<Arena, 'areas'>,
  canopy?: Canopy,
  maxTrees: number = treeTuning.maxTrees,
) => {
  const { density, height, coniferShare, wallMargin, seed } = treeTuning;
  const limit = arena.halfSize - wallMargin;
  const clamp = (value: number) => Math.max(-limit, Math.min(limit, value));
  const woods = Arr.flatMap(arena.areas, ({ kind, outline }) => {
    if (kind !== 'wood' || outline.length < 3) return [];
    const xs = Arr.map(outline, ([x]) => x);
    const zs = Arr.map(outline, ([, z]) => z);
    const [west, east] = [clamp(Math.min(...xs)), clamp(Math.max(...xs))];
    const [north, south] = [clamp(Math.min(...zs)), clamp(Math.max(...zs))];
    const samples = (east - west) * (south - north) * density;
    return samples > 0 ? [{ outline, west, east, north, south, samples }] : [];
  });
  const cellSize = canopy?.cellSize ?? 0;
  const glades = canopy
    ? Arr.flatMap(canopy.cells, (tree, index) => {
        const { columns } = canopy;
        const west = -arena.halfSize + (index % columns) * cellSize;
        const north = -arena.halfSize + Math.floor(index / columns) * cellSize;
        const centre: Point = [west + cellSize / 2, north + cellSize / 2];
        return tree &&
          !Arr.some(woods, ({ outline }) => insideRing(outline, centre))
          ? [{ west, north }]
          : [];
      })
    : [];
  const perGlade = cellSize ** 2 * density;
  const total =
    Arr.reduce(woods, 0, (sum, wood) => sum + wood.samples) +
    glades.length * perGlade;
  const share = total > maxTrees ? maxTrees / total : 1;
  let state: number = seed;
  const roll = () => {
    const [value, next] = nextRandom(state);
    state = next;
    return value;
  };
  const trees: Array<Tree> = [];
  const plant = (x: number, z: number, keep: boolean) => {
    const [grow, turn, kind] = [roll(), roll(), roll()];
    if (!keep) return;
    trees.push({
      position: [x, heightAt(arena, x, z), z],
      height: height[0] + grow * (height[1] - height[0]),
      yaw: turn * Math.PI * 2,
      conifer: kind < coniferShare,
    });
  };
  for (const { outline, west, east, north, south, samples } of woods) {
    for (let sample = 0; sample < Math.round(samples * share); sample++) {
      const x = west + roll() * (east - west);
      const z = north + roll() * (south - north);
      plant(x, z, insideRing(outline, [x, z]));
    }
  }
  const expected = perGlade * share;
  for (const { west, north } of glades) {
    const count = Math.floor(expected) + (roll() < expected % 1 ? 1 : 0);
    for (let sample = 0; sample < count; sample++) {
      const x = west + roll() * cellSize;
      const z = north + roll() * cellSize;
      plant(x, z, Math.abs(x) <= limit && Math.abs(z) <= limit);
    }
  }
  return Arr.take(trees, maxTrees);
};
