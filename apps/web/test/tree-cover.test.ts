import { assert, describe, it } from '@effect/vitest';
import { Array as Arr } from 'effect';

import {
  canopyCover,
  classifyCanopy,
  clearOpenGround,
} from '../src/game/tree-cover.ts';
import { scatterTrees } from '../src/game/trees.ts';
import { canopyTuning, treeTuning } from '../src/game/tuning.ts';

type Rgb = readonly [number, number, number];

// A square photo of `pixels` across, coloured pixel by pixel.
const photo = (pixels: number, paint: (x: number, y: number) => Rgb) => ({
  width: pixels,
  height: pixels,
  data: Arr.flatten(
    Arr.makeBy(pixels * pixels, (index) => [
      ...paint(index % pixels, Math.floor(index / pixels)),
      255,
    ]),
  ),
});

const checker = (a: Rgb, b: Rgb) => (x: number, y: number) =>
  (x + y) % 2 === 0 ? a : b;

const uniform = (colour: Rgb) => () => colour;

// Six cells across at two pixels a cell.
const halfSize = 3 * canopyTuning.cellSize;
const pixels = 12;

const everyCell = (paint: (x: number, y: number) => Rgb) =>
  classifyCanopy(photo(pixels, paint), halfSize).cells;

const flat = {
  halfSize,
  terrain: { size: 2, heights: [0, 0, 0, 0] },
  roads: [],
  buildings: [],
  areas: [],
};

describe('classifyCanopy', () => {
  it('reads shaded, dark green crowns as canopy', () => {
    const cells = everyCell(uniform([45, 80, 35]));
    assert.strictEqual(cells.length, 36);
    assert.isTrue(Arr.every(cells, Boolean));
  });

  it('reads rough, sunlit green as canopy', () => {
    assert.isTrue(
      Arr.every(everyCell(checker([70, 120, 50], [110, 165, 85])), Boolean),
    );
  });

  it('leaves smooth bright grass and fields open', () => {
    assert.isFalse(Arr.some(everyCell(uniform([110, 170, 80])), Boolean));
    assert.isFalse(
      Arr.some(everyCell(checker([150, 200, 110], [170, 215, 130])), Boolean),
    );
  });

  it('leaves grey roofs, roads and shadows open, however rough', () => {
    assert.isFalse(Arr.some(everyCell(uniform([128, 128, 128])), Boolean));
    assert.isFalse(
      Arr.some(everyCell(checker([40, 42, 45], [150, 150, 150])), Boolean),
    );
    assert.isFalse(Arr.some(everyCell(uniform([30, 32, 40])), Boolean));
  });

  it('finds a wood in the west half of a field', () => {
    const { columns, cells } = classifyCanopy(
      photo(pixels, (x) => (x < 6 ? [45, 80, 35] : [110, 170, 80])),
      halfSize,
    );
    // The cell just past the edge sees the edge as texture.
    for (const [index, tree] of cells.entries()) {
      if (index % columns !== 3) assert.strictEqual(tree, index % columns < 3);
    }
  });

  it('ignores a lone dark pixel in a field', () => {
    const cells = everyCell((x, y) =>
      x === 5 && y === 5 ? [20, 60, 15] : [110, 170, 80],
    );
    assert.isFalse(Arr.some(cells, Boolean));
  });
});

describe('clearOpenGround', () => {
  const wood = classifyCanopy(photo(pixels, uniform([45, 80, 35])), halfSize);
  const rows = (cells: ReadonlyArray<boolean>) =>
    Arr.map(Arr.chunksOf(cells, wood.columns), (row) =>
      Arr.every(row, Boolean),
    );

  it('clears the cells along a road', () => {
    const { cells } = clearOpenGround(wood, {
      ...flat,
      roads: [
        {
          path: [
            [-20, 0],
            [20, 0],
          ],
          width: 2,
        },
      ],
    });
    // Rows centred 2 m off the centreline fall within half a cell of it.
    assert.deepStrictEqual(rows(cells), [true, true, false, false, true, true]);
  });

  it('clears the cells under and beside a building, and in water', () => {
    const square = (x: number, z: number, side: number) =>
      [
        [x, z],
        [x + side, z],
        [x + side, z + side],
        [x, z + side],
      ] as const;
    const { cells } = clearOpenGround(wood, {
      ...flat,
      buildings: [{ footprint: square(-9, -11, 2), height: 6 }],
      areas: [{ kind: 'water', outline: square(4, 4, 8) }],
    });
    // The two cells the building straddles, and the pond's four in the
    // south-east corner.
    assert.deepStrictEqual(
      Arr.flatMap(cells, (tree, index) => (tree ? [] : [index])),
      [0, 1, 28, 29, 34, 35],
    );
  });
});

describe('scatterTrees with canopy', () => {
  const canopy = canopyCover(photo(pixels, uniform([45, 80, 35])), flat);
  const big = { ...flat, halfSize: 150 };
  const forest = canopyCover(
    photo(150, checker([60, 100, 45], [40, 75, 30])),
    big,
  );

  it('is deterministic', () => {
    assert.deepStrictEqual(
      scatterTrees(big, forest),
      scatterTrees(big, forest),
    );
    assert.deepStrictEqual(
      scatterTrees(flat, canopy),
      scatterTrees(flat, canopy),
    );
  });

  it('plants canopy at the tuned density, inside the walls', () => {
    const trees = scatterTrees(big, forest);
    const limit = 150 - treeTuning.wallMargin;
    assert.closeTo(trees.length, limit * limit * 4 * treeTuning.density, 40);
    for (const { position } of trees) {
      assert.isAtMost(Math.abs(position[0]), limit);
      assert.isAtMost(Math.abs(position[2]), limit);
    }
  });

  it('adds nothing where a mapped wood already grows', () => {
    const wooded = {
      ...big,
      areas: [
        {
          kind: 'wood' as const,
          outline: [
            [-200, -200],
            [200, -200],
            [200, 200],
            [-200, 200],
          ] as const,
        },
      ],
    };
    assert.deepStrictEqual(scatterTrees(wooded, forest), scatterTrees(wooded));
  });

  it('shares the cap between mapped woods and canopy', () => {
    const trees = scatterTrees(big, forest, 100);
    assert.isAtMost(trees.length, 100);
    assert.isAtLeast(trees.length, 80);
    assert.isAbove(
      Arr.filter(trees, ({ position }) => position[2] > 0).length,
      30,
    );
  });

  it('falls back to mapped woods alone without a photo', () => {
    assert.deepStrictEqual(scatterTrees(big, undefined), []);
  });
});
