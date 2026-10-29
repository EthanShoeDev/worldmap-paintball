import { assert, describe, it } from '@effect/vitest';
import { Array as Arr, Option } from 'effect';

import {
  applyHit,
  applyShot,
  checkTrigger,
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
import { aimRange } from '../src/game/projectile.ts';
import {
  fairnessTuning,
  respawnDelayMs,
  type WeaponId,
  weapons,
} from '../src/game/tuning.ts';

const at = (position: Vec3): PlayerState => ({
  position,
  velocity: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  firing: false,
  weapon: 'assault',
});

const shot = (shooter: string, weapon: WeaponId = 'assault') => ({
  shooter,
  origin: [0, 1.9, 0] as const,
  dir: [0, 0, -1] as const,
  weapon,
  seed: 1,
});

// A hit is judged `now` ms in, after the host fired an assault shot at 0.
const now = 100;

const arena = (): Match => {
  let match = makeMatch(['host', 'alice', 'bob']);
  match = receiveState(match, 'host', at([0, 1.35, 0]));
  match = receiveState(match, 'alice', at([0, 1.35, -10]));
  match = receiveState(match, 'bob', at([20, 1.35, 0]));
  return applyShot(match, 'host', shot('host'), 0).match;
};

const hit = (overrides: Partial<HitEvent> = {}) =>
  Net.Hit.make({
    shooter: 'host',
    target: 'alice',
    point: [0, 1.5, -9.7],
    weapon: 'assault',
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
    assert.isUndefined(validateHit(arena(), 'host', hit(), now));
  });

  it('rejects a hit claimed for someone else', () => {
    assert.strictEqual(validateHit(arena(), 'bob', hit(), now), 'NotShooter');
  });

  it('rejects shooting yourself', () => {
    assert.strictEqual(
      validateHit(arena(), 'host', hit({ target: 'host' }), now),
      'SelfHit',
    );
  });

  it('rejects unknown players', () => {
    assert.strictEqual(
      validateHit(arena(), 'host', hit({ target: 'ghost' }), now),
      'UnknownPlayer',
    );
  });

  it('rejects hits on a player who is already out', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    assert.strictEqual(
      validateHit(match, 'bob', hit({ shooter: 'bob' }), now),
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
        now,
      ),
      'ShooterDead',
    );
  });

  it('rejects a point far from where the host last saw the target', () => {
    assert.strictEqual(
      validateHit(arena(), 'host', hit({ point: [0, 1.5, -20] }), now),
      'MissedTarget',
    );
  });

  const range = aimRange(weapons.assault);
  const aliceAt = (position: Vec3) =>
    receiveState(arena(), 'alice', at(position));

  it('rejects a hit beyond paintball range', () => {
    const far = aliceAt([0, 1.35, -(range + 50)]);
    assert.strictEqual(
      validateHit(far, 'host', hit({ point: [0, 1.5, -(range + 49.7)] }), now),
      'OutOfRange',
    );
  });

  it('accepts a long lob a ball can reach, and a shot straight down', () => {
    const lob = aliceAt([0, 1.35, -150]);
    assert.isUndefined(
      validateHit(lob, 'host', hit({ point: [0, 1.5, -149.7] }), now),
    );
    const below = aliceAt([0, -40, 0]);
    assert.isUndefined(
      validateHit(below, 'host', hit({ point: [0, -39.6, 0] }), now),
    );
  });

  it('rejects a point no ball reaches in its lifetime', () => {
    // Gravity costs a ball height: as far up as it can go level is too far.
    const above = aliceAt([0, range, 0]);
    assert.strictEqual(
      validateHit(above, 'host', hit({ point: [0, range - 0.3, 0] }), now),
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
      validateHit(next, 'host', hit({ point: [100, 1.5, 100] }), now),
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

describe('fire rate fairness', () => {
  const { jitter, hitLag } = fairnessTuning;
  const ms = (seconds: number) => seconds * 1000;

  // Fires `weapon` at each arrival time, in ms, and lists what was rejected.
  const fireAt = (
    times: ReadonlyArray<number>,
    weapon: WeaponId = 'assault',
    start = arena(),
  ) => {
    let match = start;
    const rejected = Arr.map(times, (time) => {
      const step = applyShot(match, 'bob', shot('bob', weapon), time);
      match = step.match;
      return step.rejected;
    });
    return { match, rejected };
  };

  const spaced = (interval: number, count: number) =>
    Arr.makeBy(count, (index) => index * interval);

  it('accepts a full pod at the fire interval', () => {
    const { fireInterval, magazine } = weapons.assault;
    const { rejected } = fireAt(spaced(ms(fireInterval), magazine));
    assert.deepStrictEqual(
      rejected,
      Arr.makeBy(magazine, () => undefined),
    );
  });

  it('accepts a burst that arrives bunched within the jitter', () => {
    // Fired every 150 ms; the second shot is held up and lands with the third.
    const { rejected } = fireAt([0, 300, 300, 450, 600, 750]);
    assert.isTrue(Arr.every(rejected, (reason) => reason === undefined));
  });

  it('rejects fire faster than the interval allows', () => {
    const sniper = ms(weapons.sniper.fireInterval);
    assert.deepStrictEqual(
      fireAt([0, sniper - jitter - 50], 'sniper').rejected,
      [undefined, 'TooFast'],
    );
    assert.deepStrictEqual(
      fireAt([0, sniper - jitter + 50], 'sniper').rejected,
      [undefined, undefined],
    );
    // Twice the assault's rate: the jitter covers a shot or two, no more.
    const { rejected } = fireAt(
      spaced(ms(weapons.assault.fireInterval) / 2, 10),
    );
    assert.include(rejected, 'TooFast');
    assert.deepStrictEqual(rejected.slice(0, 2), [undefined, undefined]);
  });

  it('rejects more rounds than a pod without a pause to reload', () => {
    const { fireInterval, magazine, reloadTime } = weapons.sniper;
    const pod = spaced(ms(fireInterval), magazine);
    const last = pod.at(-1) ?? 0;
    const early = fireAt([...pod, last + ms(fireInterval)], 'sniper');
    assert.strictEqual(early.rejected.at(-1), 'MagazineEmpty');
    const reloaded = fireAt(
      [...pod, last + ms(reloadTime) - jitter + 1],
      'sniper',
    );
    assert.isUndefined(reloaded.rejected.at(-1));
  });

  it('counts each weapon apart', () => {
    const sniper = fireAt([0], 'sniper');
    const shotgun = fireAt([100], 'shotgun', sniper.match);
    assert.deepStrictEqual(shotgun.rejected, [undefined]);
    assert.deepStrictEqual(fireAt([200], 'sniper', shotgun.match).rejected, [
      'TooFast',
    ]);
  });

  it('only counts accepted shots', () => {
    const first = checkTrigger(undefined, 'sniper', 0);
    const rejected = checkTrigger(first.trigger, 'sniper', 10);
    assert.strictEqual(rejected.rejected, 'TooFast');
    assert.strictEqual(rejected.trigger, first.trigger);
  });

  it('refills every pod on respawn', () => {
    const { magazine, fireInterval } = weapons.sniper;
    const emptied = fireAt(spaced(ms(fireInterval), magazine), 'sniper');
    const { match } = applyHit(
      emptied.match,
      'host',
      hit({ target: 'bob', point: [20, 1.5, 0] }),
      0,
    );
    const respawned = respawnDue(match, respawnDelayMs, [[0, 1.35, 30]]).match;
    assert.strictEqual(respawned.get('bob')?.triggers.size, 0);
    assert.deepStrictEqual(
      fireAt([ms(fireInterval) * magazine], 'sniper', respawned).rejected,
      [undefined],
    );
  });

  it('rejects shots from a dead or spoofed shooter', () => {
    const { match } = applyHit(arena(), 'host', hit(), 0);
    assert.strictEqual(
      applyShot(match, 'alice', shot('alice'), 10).rejected,
      'ShooterDead',
    );
    assert.strictEqual(
      applyShot(arena(), 'alice', shot('bob'), 10).rejected,
      'NotShooter',
    );
    assert.strictEqual(
      applyShot(arena(), 'ghost', shot('ghost'), 10).rejected,
      'UnknownPlayer',
    );
  });

  it('rejects a hit without a recent shot of its weapon', () => {
    assert.strictEqual(
      validateHit(arena(), 'host', hit({ weapon: 'shotgun' }), now),
      'NoShot',
    );
    const flight = ms(weapons.assault.lifetime) + hitLag;
    assert.isUndefined(validateHit(arena(), 'host', hit(), flight));
    assert.strictEqual(
      validateHit(arena(), 'host', hit(), flight + 1),
      'NoShot',
    );
  });
});
