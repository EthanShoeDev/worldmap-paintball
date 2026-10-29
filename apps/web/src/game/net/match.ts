import type { PlayerId } from '@worldmap-paintball/api/lobby/protocol';
import { Array as Arr } from 'effect';

import { fireRange, respawnDelayMs, spawnHeight } from '../tuning.ts';
import { distance } from './hit-test.ts';
import { Net, type NetEvent, type PlayerState, type Vec3 } from './protocol.ts';

// The host's view of the match. Pure: every function returns a new match.
export interface Slot {
  readonly state: PlayerState | undefined;
  readonly alive: boolean;
  readonly respawnAt: number | undefined;
  readonly score: number;
  readonly deaths: number;
}

export type Match = ReadonlyMap<PlayerId, Slot>;

export type HitEvent = typeof Net.Hit.Type;

const freshSlot: Slot = {
  state: undefined,
  alive: true,
  respawnAt: undefined,
  score: 0,
  deaths: 0,
};

export const makeMatch = (ids: ReadonlyArray<PlayerId>): Match =>
  new Map(Arr.map(ids, (id) => [id, freshSlot] as const));

// Follows the lobby: players who left drop out, keeping everyone else's slot.
export const syncRoster = (match: Match, ids: ReadonlyArray<PlayerId>) =>
  ids.length === match.size && Arr.every(ids, (id) => match.has(id))
    ? match
    : new Map(Arr.map(ids, (id) => [id, match.get(id) ?? freshSlot] as const));

export const receiveState = (
  match: Match,
  id: PlayerId,
  state: PlayerState,
) => {
  const slot = match.get(id);
  return slot ? new Map(match).set(id, { ...slot, state }) : match;
};

// The shooter, target and point come from the shooter's view, up to a round
// trip behind the host's, so the point only has to be near the target.
export const hitTolerance = 3;

export const validateHit = (match: Match, from: PlayerId, hit: HitEvent) => {
  if (hit.shooter !== from) return 'NotShooter';
  if (hit.shooter === hit.target) return 'SelfHit';
  const shooter = match.get(hit.shooter);
  const target = match.get(hit.target);
  if (!shooter?.state || !target?.state) return 'UnknownPlayer';
  if (!shooter.alive) return 'ShooterDead';
  if (!target.alive) return 'TargetDead';
  if (distance(shooter.state.position, hit.point) > fireRange + hitTolerance) {
    return 'OutOfRange';
  }
  if (distance(target.state.position, hit.point) > hitTolerance) {
    return 'MissedTarget';
  }
  return undefined;
};

export const scoresOf = (match: Match) =>
  Arr.map([...match], ([id, { score, deaths }]) => ({ id, score, deaths }));

// The score reducer: a valid hit eliminates the target and scores a point.
export const applyHit = (
  match: Match,
  from: PlayerId,
  hit: HitEvent,
  now: number,
) => {
  const rejected = validateHit(match, from, hit);
  const shooter = match.get(hit.shooter);
  const target = match.get(hit.target);
  if (rejected !== undefined || !shooter || !target) {
    return { match, outbox: [], rejected };
  }
  const next = new Map(match)
    .set(hit.shooter, { ...shooter, score: shooter.score + 1 })
    .set(hit.target, {
      ...target,
      alive: false,
      respawnAt: now + respawnDelayMs,
      deaths: target.deaths + 1,
    });
  const outbox: ReadonlyArray<NetEvent> = [
    Net.Eliminated.make({
      shooter: hit.shooter,
      target: hit.target,
      respawnInMs: respawnDelayMs,
    }),
    Net.Scored.make({ scores: scoresOf(next) }),
  ];
  return { match: next, outbox, rejected };
};

export const spawnFallback: Vec3 = [0, spawnHeight, 0];

// The spawn furthest from every other living player.
export const pickSpawn = (
  spawns: ReadonlyArray<Vec3>,
  others: ReadonlyArray<Vec3>,
) => {
  let best = spawns[0] ?? spawnFallback;
  let bestClearance = -Infinity;
  for (const spawn of spawns) {
    const clearance = Math.min(
      ...Arr.map(others, (other) => distance(spawn, other)),
    );
    if (clearance > bestClearance) [best, bestClearance] = [spawn, clearance];
  }
  return best;
};

export const initialSpawn = (spawns: ReadonlyArray<Vec3>, index: number) =>
  spawns.length === 0
    ? spawnFallback
    : (spawns[index % spawns.length] ?? spawnFallback);

const livingPositions = (match: Match) =>
  Arr.flatMap([...match.values()], (slot) =>
    slot.alive && slot.state ? [slot.state.position] : [],
  );

export const respawnDue = (
  match: Match,
  now: number,
  spawns: ReadonlyArray<Vec3>,
) => {
  let next = match;
  const outbox: Array<NetEvent> = [];
  for (const [id, slot] of match) {
    if (slot.alive || slot.respawnAt === undefined || slot.respawnAt > now) {
      continue;
    }
    const position = pickSpawn(spawns, livingPositions(next));
    next = new Map(next).set(id, {
      ...slot,
      alive: true,
      respawnAt: undefined,
      state: slot.state && { ...slot.state, position, velocity: [0, 0, 0] },
    });
    outbox.push(Net.Respawn.make({ player: id, position }));
  }
  return { match: next, outbox };
};

export const snapshotOf = (match: Match) => ({
  players: Arr.flatMap([...match], ([id, { state, alive }]) =>
    state ? [{ id, ...state, alive }] : [],
  ),
  scores: scoresOf(match),
});
