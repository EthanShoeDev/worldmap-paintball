import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Option } from 'effect';
import { Euler, Vector3 } from 'three';

import {
  aimDirection,
  type BotMemory,
  botMemory,
  type BotSenses,
  eyeOf,
  inView,
  pitchTowards,
  thinkBot,
  turnToward,
  yawTowards,
} from '../src/game/bot-brain.ts';
import { roadGraph } from '../src/game/bot-nav.ts';
import { idleIntent } from '../src/game/intent.ts';
import type { Vec3 } from '../src/game/net/protocol.ts';
import { botTuning, fireInterval } from '../src/game/tuning.ts';

const dt = 1 / 60;

const closeTo = (actual: Vec3, expected: Vec3, tolerance = 1e-9) => {
  for (const [index, value] of actual.entries()) {
    assert.closeTo(value, expected[index] ?? Number.NaN, tolerance);
  }
};

const unit = (from: Vec3, to: Vec3) => {
  const d = new Vector3(...to).sub(new Vector3(...from)).normalize();
  return [d.x, d.y, d.z] as const;
};

// Two roads meeting at the origin: north to (0, -20), east to (20, 0).
const graph = roadGraph(
  [
    {
      path: [
        [0, 0],
        [0, -20],
      ],
      width: 6,
    },
    {
      path: [
        [0, 0],
        [20, 0],
      ],
      width: 6,
    },
  ],
  100,
);

const senses = (overrides: Partial<BotSenses> = {}): BotSenses => ({
  position: [0, 1, 0],
  velocity: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  alive: true,
  visible: [],
  ...overrides,
});

// Steps the brain like <BotPlayer>: each frame's look turns the next frame's
// senses, the way stepCharacter turns the body.
const simulate = (memory: BotMemory, start: BotSenses, frames: number) => {
  let current = start;
  let mind = memory;
  return Arr.makeBy(frames, (frame) => {
    const { intent, memory: next } = thinkBot(mind, current, graph, dt);
    mind = next;
    current = {
      ...current,
      yaw: current.yaw - intent.look[0],
      pitch: current.pitch - intent.look[1],
    };
    return { frame, intent, memory: next };
  });
};

// A target 10 m straight ahead (-z) at eye height.
const ahead = { id: 'alice', eye: eyeOf([0, 1, -10]) };

describe('aiming', () => {
  it('aimDirection is the forward of a YXZ camera', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [0.7, -0.3],
      [-2.4, 1.1],
      [3.5, 0.05],
    ] as const) {
      const forward = new Vector3(0, 0, -1).applyEuler(
        new Euler(pitch, yaw, 0, 'YXZ'),
      );
      closeTo(aimDirection(yaw, pitch), [forward.x, forward.y, forward.z]);
    }
  });

  it('yawTowards and pitchTowards point at the target', () => {
    const from: Vec3 = [1, 2, 3];
    for (const to of [
      [5, 2, 3],
      [-4, 7, -9],
      [1, -1, 10],
    ] as const) {
      closeTo(
        aimDirection(yawTowards(from, to), pitchTowards(from, to)),
        unit(from, to),
      );
    }
  });

  it('turnToward takes the short way round and caps the step', () => {
    assert.closeTo(turnToward(3, -3, 1), 3 + (Math.PI * 2 - 6), 1e-9);
    assert.closeTo(turnToward(0, 2, 0.5), 0.5, 1e-9);
    assert.closeTo(turnToward(0, -2, 0.5), -0.5, 1e-9);
    assert.closeTo(turnToward(0, 0.2, 0.5), 0.2, 1e-9);
    assert.closeTo(turnToward(0.1, Math.PI * 2, 1), 0, 1e-9);
  });

  it('sees within range and the view cone only', () => {
    const eye = eyeOf([0, 1, 0]);
    assert.isTrue(inView(eye, 0, 0, [0, 1.75, -30]));
    assert.isTrue(inView(eye, 0, 0, [20, 1.75, -20]));
    assert.isFalse(inView(eye, 0, 0, [0, 1.75, 30]));
    assert.isFalse(inView(eye, 0, 0, [20, 1.75, 0]));
    assert.isFalse(inView(eye, 0, 0, [0, 1.75, -botTuning.engageRange - 5]));
  });
});

describe('wander', () => {
  it('heads for the nearest node, then on along the road', () => {
    // Just south of the junction, facing east: the junction is to its left.
    const first = thinkBot(
      botMemory(1),
      senses({ position: [0, 1, 5], yaw: -Math.PI / 2 }),
      graph,
      dt,
    );
    assert.strictEqual(first.memory.mode, 'wander');
    assert.deepStrictEqual(graph.points[first.memory.node ?? -1], [0, 0]);
    assert.isBelow(first.intent.look[0], 0);
    assert.isAbove(first.intent.move[1], 0);

    const arrived = thinkBot(
      first.memory,
      senses({ position: [0, 1, 0.5] }),
      graph,
      dt,
    );
    assert.notDeepEqual(graph.points[arrived.memory.node ?? -1], [0, 0]);
    assert.deepStrictEqual(graph.points[arrived.memory.previous ?? -1], [0, 0]);
  });

  it('jumps and re-routes when stuck', () => {
    const junction = 0;
    const north = 1;
    const stuck = { ...botMemory(1), node: north, previous: junction };
    const steps = simulate(stuck, senses({ position: [0, 1, -3] }), 70);
    const jump = Option.getOrThrow(
      Arr.findFirst(steps, (step) => step.intent.jump),
    );
    assert.isAtLeast(jump.frame * dt, botTuning.stuckAfter - dt * 2);
    assert.notStrictEqual(jump.memory.node, north);
  });

  it('does not count as stuck while moving', () => {
    const steps = simulate(
      botMemory(1),
      senses({ position: [0, 1, 5], velocity: [0, 0, -4.5] }),
      120,
    );
    assert.isFalse(Arr.some(steps, (step) => step.intent.jump));
  });
});

describe('engage', () => {
  it('targets the nearest visible player', () => {
    const { memory } = thinkBot(
      botMemory(1),
      senses({
        visible: [
          { id: 'far', eye: eyeOf([0, 1, -30]) },
          { id: 'near', eye: eyeOf([5, 1, -8]) },
        ],
      }),
      graph,
      dt,
    );
    assert.strictEqual(memory.mode, 'engage');
    assert.strictEqual(memory.targetId, 'near');
  });

  it('waits out its reaction time before firing', () => {
    const steps = simulate(botMemory(1), senses({ visible: [ahead] }), 60);
    const first = Option.getOrThrow(
      Arr.findFirstIndex(steps, (step) => step.intent.fire),
    );
    const reaction = steps[0]?.memory.reaction ?? 0;
    assert.isAtLeast(reaction, botTuning.reaction[0]);
    assert.isAtMost(reaction, botTuning.reaction[1]);
    assert.isAtLeast((first + 1) * dt, reaction - 1e-9);
  });

  it('holds fire while its aim is off the target', () => {
    const reacted = {
      ...botMemory(1),
      mode: 'engage' as const,
      targetId: ahead.id,
      seenFor: 5,
    };
    // Facing away: the capped turn can't close the gap in one frame.
    const { intent } = thinkBot(
      reacted,
      senses({ yaw: Math.PI, visible: [ahead] }),
      graph,
      dt,
    );
    assert.isFalse(intent.fire);
    assert.closeTo(Math.abs(intent.look[0]), botTuning.turnRate * dt, 1e-9);
  });

  it('fires in bursts with a pause between them', () => {
    const steps = simulate(botMemory(7), senses({ visible: [ahead] }), 60 * 6);
    const shots = Arr.flatMap(steps, (step) =>
      step.intent.fire ? [step.frame * dt] : [],
    );
    assert.isAbove(shots.length, 6);
    const bursts: Array<Array<number>> = [];
    for (const [index, time] of shots.entries()) {
      const gap = time - (shots[index - 1] ?? -Infinity);
      assert.isAtLeast(gap, fireInterval - 1e-9);
      if (gap >= botTuning.burstPause - 1e-9) bursts.push([time]);
      else bursts.at(-1)?.push(time);
    }
    assert.isAbove(bursts.length, 2);
    // The last burst may be cut off by the end of the run.
    for (const burst of bursts.slice(0, -1)) {
      assert.isAtLeast(burst.length, botTuning.burst[0]);
      assert.isAtMost(burst.length, botTuning.burst[1]);
    }
  });

  it('replays exactly from the same seed', () => {
    const run = () =>
      Arr.map(
        simulate(botMemory(42), senses({ visible: [ahead] }), 120),
        ({ intent }) => intent,
      );
    assert.deepStrictEqual(run(), run());
    const other = Arr.map(
      simulate(botMemory(43), senses({ visible: [ahead] }), 120),
      ({ intent }) => intent,
    );
    assert.notDeepEqual(run(), other);
  });
});

describe('a dead bot', () => {
  it('idles and forgets its route and target', () => {
    const engaged = thinkBot(
      botMemory(1),
      senses({ visible: [ahead] }),
      graph,
      dt,
    ).memory;
    const { intent, memory } = thinkBot(
      engaged,
      senses({ alive: false, visible: [ahead] }),
      graph,
      dt,
    );
    assert.deepStrictEqual(intent, idleIntent);
    assert.strictEqual(memory.mode, 'wander');
    assert.isUndefined(memory.targetId);
    assert.isUndefined(memory.node);
  });
});
