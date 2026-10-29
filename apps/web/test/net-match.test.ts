import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Option } from 'effect';

import {
  applyHit,
  type HitEvent,
  initialSpawn,
  makeMatch,
  type Match,
  pickSpawn,
  receiveState,
  respawnDue,
  scoresOf,
  snapshotOf,
  spawnFallback,
  syncRoster,
  validateHit,
} from '../src/game/net/match.ts';
import { Net, type PlayerState, type Vec3 } from '../src/game/net/protocol.ts';
import { fireRange, respawnDelayMs } from '../src/game/tuning.ts';

const at = (position: Vec3): PlayerState => ({
  position,
  velocity: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  firing: false,
});

const arena = (): Match => {
  let match = makeMatch(['host', 'alice', 'bob']);
  match = receiveState(match, 'host', at([0, 1.35, 0]));
  match = receiveState(match, 'alice', at([0, 1.35, -10]));
  match = receiveState(match, 'bob', at([20, 1.35, 0]));
  return match;
};

const hit = (overrides: Partial<HitEvent> = {}) =>
  Net.Hit.make({
    shooter: 'host',
    target: 'alice',
    point: [0, 1.5, -9.7],
    ...overrides,
  });

describe('snapshot assembly', () => {
  it('includes every player with a known state, in roster order', () => {
    const snapshot = snapshotOf(arena());
    assert.deepStrictEqual(
      Arr.map(snapshot.players, (player) => [
        player.id,
        player.position,
        player.alive,
      ]),
      [
        ['host', [0, 1.35, 0], true],
        ['alice', [0, 1.35, -10], true],
        ['bob', [20, 1.35, 0], true],
      ],
    );
    assert.deepStrictEqual(snapshot.scores, [
      { id: 'host', score: 0, deaths: 0 },
      { id: 'alice', score: 0, deaths: 0 },
      { id: 'bob', score: 0, deaths: 0 },
    ]);
  });

  it('leaves out players who have not reported yet', () => {
    const match = receiveState(
      makeMatch(['host', 'late']),
      'host',
      at([0, 1, 0]),
    );
    assert.deepStrictEqual(
      Arr.map(snapshotOf(match).players, (player) => player.id),
      ['host'],
    );
    assert.strictEqual(snapshotOf(match).scores.length, 2);
  });

  it('ignores state from someone outside the match', () => {
    const match = arena();
    assert.strictEqual(receiveState(match, 'stranger', at([0, 0, 0])), match);
  });

  it('follows the lobby roster, keeping existing slots', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    const synced = syncRoster(match, ['host', 'alice']);
    assert.deepStrictEqual([...synced.keys()], ['host', 'alice']);
    assert.strictEqual(synced.get('host')?.score, 1);
    assert.strictEqual(syncRoster(synced, ['host', 'alice']), synced);
  });
});

describe('hit validation', () => {
  it('accepts a plausible hit', () => {
    assert.isUndefined(validateHit(arena(), 'host', hit()));
  });

  it('rejects a hit claimed for someone else', () => {
    assert.strictEqual(validateHit(arena(), 'bob', hit()), 'NotShooter');
  });

  it('rejects shooting yourself', () => {
    assert.strictEqual(
      validateHit(arena(), 'host', hit({ target: 'host' })),
      'SelfHit',
    );
  });

  it('rejects unknown players', () => {
    assert.strictEqual(
      validateHit(arena(), 'host', hit({ target: 'ghost' })),
      'UnknownPlayer',
    );
  });

  it('rejects hits on a player who is already out', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    assert.strictEqual(
      validateHit(match, 'bob', hit({ shooter: 'bob' })),
      'TargetDead',
    );
  });

  it('rejects hits from a player who is out', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    assert.strictEqual(
      validateHit(
        match,
        'alice',
        hit({ shooter: 'alice', target: 'bob', point: [20, 1.5, 0] }),
      ),
      'ShooterDead',
    );
  });

  it('rejects a point far from where the host last saw the target', () => {
    assert.strictEqual(
      validateHit(arena(), 'host', hit({ point: [0, 1.5, -20] })),
      'MissedTarget',
    );
  });

  it('rejects a hit beyond paintball range', () => {
    const far = receiveState(
      arena(),
      'alice',
      at([0, 1.35, -(fireRange + 50)]),
    );
    assert.strictEqual(
      validateHit(far, 'host', hit({ point: [0, 1.5, -(fireRange + 49.7)] })),
      'OutOfRange',
    );
  });
});

describe('score reducer', () => {
  it('scores the shooter and eliminates the target', () => {
    const { match, outbox, rejected } = applyHit(arena(), 'host', hit(), 1000);
    assert.isUndefined(rejected);
    assert.deepStrictEqual(scoresOf(match), [
      { id: 'host', score: 1, deaths: 0 },
      { id: 'alice', score: 0, deaths: 1 },
      { id: 'bob', score: 0, deaths: 0 },
    ]);
    const alice = match.get('alice');
    assert.strictEqual(alice?.alive, false);
    assert.strictEqual(alice?.respawnAt, 1000 + respawnDelayMs);
    assert.deepStrictEqual(outbox, [
      Net.Eliminated.make({
        shooter: 'host',
        target: 'alice',
        respawnInMs: respawnDelayMs,
      }),
      Net.Scored.make({ scores: scoresOf(match) }),
    ]);
  });

  it('counts a second shot at the same target only once', () => {
    const first = applyHit(arena(), 'host', hit(), 0);
    const second = applyHit(first.match, 'host', hit(), 10);
    assert.strictEqual(second.rejected, 'TargetDead');
    assert.strictEqual(second.match, first.match);
    assert.deepStrictEqual(second.outbox, []);
  });

  it('marks the eliminated player dead in snapshots', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    const alice = Arr.findFirst(
      snapshotOf(match).players,
      (player) => player.id === 'alice',
    );
    assert.isTrue(Option.isSome(alice) && !alice.value.alive);
  });
});

describe('respawns', () => {
  const spawns: ReadonlyArray<Vec3> = [
    [0, 1.35, -11],
    [100, 1.35, 100],
  ];

  it('waits for the respawn delay', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    const early = respawnDue(match, respawnDelayMs - 1, spawns);
    assert.strictEqual(early.match, match);
    assert.deepStrictEqual(early.outbox, []);
  });

  it('respawns at the spawn furthest from living players', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    const { match: next, outbox } = respawnDue(match, respawnDelayMs, spawns);
    assert.deepStrictEqual(outbox, [
      Net.Respawn.make({ player: 'alice', position: [100, 1.35, 100] }),
    ]);
    const alice = next.get('alice');
    assert.strictEqual(alice?.alive, true);
    assert.isUndefined(alice?.respawnAt);
    assert.deepStrictEqual(alice?.state?.position, [100, 1.35, 100]);
    assert.isUndefined(
      validateHit(next, 'host', hit({ point: [100, 1.5, 100] })),
    );
  });

  it('falls back to the origin without spawn points', () => {
    assert.deepStrictEqual(pickSpawn([], []), spawnFallback);
    assert.deepStrictEqual(initialSpawn([], 3), spawnFallback);
  });

  it('gives each player their own initial spawn', () => {
    assert.deepStrictEqual(initialSpawn(spawns, 0), spawns[0]);
    assert.deepStrictEqual(initialSpawn(spawns, 1), spawns[1]);
    assert.deepStrictEqual(initialSpawn(spawns, 2), spawns[0]);
  });
});
