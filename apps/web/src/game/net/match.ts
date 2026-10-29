import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';

import { nextRandom } from '../bot-brain.ts';
import { type Pad, type PadTimers, takePad } from '../powerups.ts';
import { reachable } from '../projectile.ts';
import {
  fairnessTuning,
  powerUpTuning,
  respawnDelayMs,
  spawnHeight,
  type WeaponId,
  type Weapons,
  weapons,
} from '../tuning.ts';
import { distance } from './hit-test.ts';
import { Net, type NetEvent, type PlayerState, type Vec3 } from './protocol.ts';

// How fast one player has fired one weapon, in host milliseconds. `due` is
// when the next shot may leave at the weapon's fire interval, kept as a
// virtual schedule so a burst that arrives bunched still fits; `rounds` counts
// shots since the last pause long enough to reload.
export interface Trigger {
  readonly due: number;
  readonly last: number;
  readonly rounds: number;
}

// The host's view of the match. Pure: every function returns a new match.
export interface Slot {
  readonly state: PlayerState | undefined;
  readonly alive: boolean;
  readonly respawnAt: number | undefined;
  readonly score: number;
  readonly deaths: number;
  readonly triggers: ReadonlyMap<WeaponId, Trigger>;
  // Rounds left of a power-up's weapon, granted by the host with the pad.
  readonly launcher: number;
}

export type Match = ReadonlyMap<PlayerId, Slot>;

export type HitEvent = typeof Net.Hit.Type;
export type ShotEvent = typeof Net.Shot.Type;
export type GrabEvent = typeof Net.Grab.Type;

const freshSlot: Slot = {
  state: undefined,
  alive: true,
  respawnAt: undefined,
  score: 0,
  deaths: 0,
  triggers: new Map(),
  launcher: 0,
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
// trip behind the host's, so the point only has to be near the target, and
// near somewhere the weapon's ball can fly from the shooter.
export const hitTolerance = 3;

// Whether a shot fits its weapon: no faster than the fire interval, and no
// more rounds than a pod holds without a pause long enough to reload. Both
// allow `fairnessTuning.jitter` for messages that arrive bunched.
export const checkTrigger = (
  trigger: Trigger | undefined,
  weapon: WeaponId,
  now: number,
) => {
  const { fireInterval, magazine, reloadTime } = weapons[weapon];
  const { jitter } = fairnessTuning;
  const reloaded =
    trigger === undefined || now - trigger.last >= reloadTime * 1000 - jitter;
  const rounds = reloaded ? 0 : trigger.rounds;
  if (trigger && trigger.due - now > jitter) {
    return { rejected: 'TooFast', trigger } as const;
  }
  if (rounds >= magazine) {
    return { rejected: 'MagazineEmpty', trigger } as const;
  }
  const next: Trigger = {
    due: Math.max(trigger?.due ?? now, now) + fireInterval * 1000,
    last: now,
    rounds: rounds + 1,
  };
  return { rejected: undefined, trigger: next };
};

// Records a shot on the host, or says why it is rejected. A rejected shot
// is not relayed, and its balls can't score.
export const applyShot = (
  match: Match,
  from: PlayerId,
  shot: Omit<ShotEvent, '_tag'>,
  now: number,
) => {
  const slot = match.get(shot.shooter);
  const refuse = <R extends string>(rejected: R) => ({ match, rejected });
  if (shot.shooter !== from) return refuse('NotShooter');
  if (!slot) return refuse('UnknownPlayer');
  if (!slot.alive) return refuse('ShooterDead');
  const { rejected, trigger } = checkTrigger(
    slot.triggers.get(shot.weapon),
    shot.weapon,
    now,
  );
  if (rejected !== undefined) return refuse(rejected);
  const pickup = weapons[shot.weapon].pickup === true;
  if (pickup && slot.launcher <= 0) return refuse('NoPowerUp');
  const triggers = new Map(slot.triggers).set(shot.weapon, trigger);
  const launcher = pickup ? slot.launcher - 1 : slot.launcher;
  return {
    match: new Map(match).set(shot.shooter, { ...slot, triggers, launcher }),
    rejected,
  };
};

export const validateHit = (
  match: Match,
  from: PlayerId,
  hit: HitEvent,
  now: number,
  table: Weapons = weapons,
) => {
  if (hit.shooter !== from) return 'NotShooter';
  if (hit.shooter === hit.target) return 'SelfHit';
  const shooter = match.get(hit.shooter);
  const target = match.get(hit.target);
  if (!shooter?.state || !target?.state) return 'UnknownPlayer';
  if (!shooter.alive) return 'ShooterDead';
  if (!target.alive) return 'TargetDead';
  const weapon = table[hit.weapon];
  // A hit rides the same ordered channel as its shot, so it must follow an
  // accepted shot of the same weapon by no more than the ball's flight.
  const fired = shooter.triggers.get(hit.weapon);
  if (
    !fired ||
    now - fired.last > weapon.lifetime * 1000 + fairnessTuning.hitLag
  ) {
    return 'NoShot';
  }
  if (!reachable(weapon, shooter.state.position, hit.point, hitTolerance)) {
    return 'OutOfRange';
  }
  if (
    distance(target.state.position, hit.point) >
    hitTolerance + (weapon.blast ?? 0)
  ) {
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
  table: Weapons = weapons,
) => {
  const rejected = validateHit(match, from, hit, now, table);
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
      launcher: 0,
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

// Gives a living player the pad they stand on, by the host's last view of
// them; the launcher's rounds are granted here, the rest run on the client.
export const applyGrab = (
  match: Match,
  pads: ReadonlyArray<Pad>,
  timers: PadTimers,
  from: PlayerId,
  grab: GrabEvent,
  now: number,
) => {
  const refuse = <R extends string>(rejected: R) => ({
    match,
    timers,
    outbox: [],
    rejected,
  });
  const slot = match.get(grab.player);
  if (grab.player !== from) return refuse('NotPlayer');
  if (!slot?.state) return refuse('UnknownPlayer');
  if (!slot.alive) return refuse('PlayerDead');
  const taken = takePad(
    pads,
    timers,
    grab.pad,
    slot.state.position,
    now,
    powerUpTuning.grabTolerance,
  );
  if (taken.rejected !== undefined) return refuse(taken.rejected);
  const { kind } = taken;
  const next = new Map(match).set(grab.player, {
    ...slot,
    launcher: kind === 'launcher' ? weapons.launcher.magazine : slot.launcher,
  });
  const outbox: ReadonlyArray<NetEvent> = [
    Net.PoweredUp.make({ player: grab.player, pad: grab.pad, kind }),
  ];
  return { match: next, timers: taken.timers, outbox, rejected: undefined };
};

export const spawnFallback: Vec3 = [0, spawnHeight, 0];

// Respawns land at least this far from every living player when they can.
export const respawnClearance = 30;

// A spawn picked by `roll` in [0, 1) from those clear of every living player,
// so respawns don't all crowd into the arena's far corners; with none clear,
// the one furthest from them.
export const pickSpawn = (
  spawns: ReadonlyArray<Vec3>,
  others: ReadonlyArray<Vec3>,
  roll = 0,
) => {
  const clearance = (spawn: Vec3) =>
    Math.min(...Arr.map(others, (other) => distance(spawn, other)));
  const clear = Arr.filter(
    spawns,
    (spawn) => clearance(spawn) >= respawnClearance,
  );
  const picked = clear[Math.floor(roll * clear.length)];
  if (picked) return picked;
  let best = spawns[0] ?? spawnFallback;
  let bestClearance = -Infinity;
  for (const spawn of spawns) {
    const gap = clearance(spawn);
    if (gap > bestClearance) [best, bestClearance] = [spawn, gap];
  }
  return best;
};

const respawnRoll = (now: number, index: number) => {
  const [, warm] = nextRandom(
    ((Math.floor(now) + index * 7919) % 2_147_483_646) + 1,
  );
  return nextRandom(warm)[0];
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
  for (const [index, [id, slot]] of [...match].entries()) {
    if (slot.alive || slot.respawnAt === undefined || slot.respawnAt > now) {
      continue;
    }
    const position = pickSpawn(
      spawns,
      livingPositions(next),
      respawnRoll(now, index),
    );
    next = new Map(next).set(id, {
      ...slot,
      alive: true,
      respawnAt: undefined,
      // Ammo refills on respawn.
      triggers: new Map(),
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
