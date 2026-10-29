import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Order } from 'effect';

import { nearestNode, nextNode, roadGraph } from '../src/game/bot-nav.ts';

const road = (...path: ReadonlyArray<readonly [number, number]>) => ({
  path,
  width: 6,
});

const rolls = [0, 0.25, 0.5, 0.75, 0.999];

describe('roadGraph', () => {
  it('merges ways that share a junction', () => {
    const graph = roadGraph(
      [
        road([0, 0], [0, -20]),
        road([0.00001, 0], [20, 0]),
        road([0, 0], [-20, 0]),
      ],
      100,
    );
    assert.strictEqual(graph.points.length, 4);
    const junction = nearestNode(graph, [0, 0]);
    assert.isDefined(junction);
    assert.strictEqual(graph.neighbours[junction ?? -1]?.length, 3);
  });

  it('joins only consecutive points', () => {
    const graph = roadGraph([road([0, 0], [0, -10], [0, -20])], 100);
    assert.deepStrictEqual(
      Arr.map(graph.neighbours, (neighbours) =>
        Arr.sort(neighbours, Order.Number),
      ),
      [[1], [0, 2], [1]],
    );
  });

  it('clamps points inside the arena walls', () => {
    const graph = roadGraph([road([0, 0], [80, -80])], 50);
    assert.deepStrictEqual(graph.points[1], [48.5, -48.5]);
  });
});

describe('nextNode', () => {
  const line = roadGraph([road([0, 0], [0, -10], [0, -20])], 100);

  it('keeps going instead of turning back', () => {
    for (const roll of rolls) assert.strictEqual(nextNode(line, 1, 0, roll), 2);
  });

  it('turns back at a dead end', () => {
    for (const roll of rolls) assert.strictEqual(nextNode(line, 2, 1, roll), 1);
  });

  it('picks among the onward roads at a junction', () => {
    const cross = roadGraph(
      [road([0, 20], [0, 0], [0, -20]), road([-20, 0], [0, 0], [20, 0])],
      100,
    );
    const centre = nearestNode(cross, [0, 0]) ?? -1;
    const from = nearestNode(cross, [0, 20]);
    const picks = new Set(
      Arr.map(rolls, (roll) => nextNode(cross, centre, from, roll)),
    );
    assert.strictEqual(picks.size, 3);
    assert.isFalse(picks.has(from ?? -1));
  });

  it('stays put on an isolated point', () => {
    const lone = roadGraph([road([5, 5])], 100);
    assert.strictEqual(nextNode(lone, 0, undefined, 0.5), 0);
  });
});
