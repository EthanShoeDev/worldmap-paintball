import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr, Order, type Types } from 'effect';

import { nearestNode, nextNode, type RoadGraph } from './bot-nav.ts';
import { clampLength, idleIntent, type Intent } from './intent.ts';
import { distance } from './net/hit-test.ts';
import type { Vec3 } from './net/protocol.ts';
import {
  botTuning,
  eyeOffset,
  paintballTuning,
  type WeaponId,
  weaponIds,
  type WeaponSpec,
} from './tuning.ts';

// Everything a bot carries between frames. Pure data, so a seed replays it.
export interface BotMemory {
  readonly mode: 'wander' | 'engage';
  readonly node: number | undefined;
  readonly previous: number | undefined;
  readonly targetId: PlayerId | undefined;
  readonly seenFor: number;
  readonly reaction: number;
  readonly aimOffset: readonly [number, number];
  readonly aimFor: number;
  readonly burstLeft: number;
  // Until the next shot may leave; mirrors the character's fire cooldown.
  readonly pauseFor: number;
  readonly strafe: number;
  readonly strafeFor: number;
  readonly stuckFor: number;
  // Drawn at spawn and at every respawn.
  readonly weapon: WeaponId;
  readonly seed: number;
}

export interface SeenPlayer {
  readonly id: PlayerId;
  readonly eye: Vec3;
  readonly velocity: Vec3;
}

export interface BotSenses {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly alive: boolean;
  // The weapon in hand, its rounds left, and whether it is neither being
  // swapped nor reloaded.
  readonly weapon: WeaponSpec;
  readonly ammo: number;
  readonly ready: boolean;
  readonly visible: ReadonlyArray<SeenPlayer>;
}

const turn = Math.PI * 2;

// The forward of a camera rotated by Euler(pitch, yaw, 0, 'YXZ'), as the
// player's is.
export const aimDirection = (yaw: number, pitch: number) =>
  [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ] as const;

export const eyeOf = ([x, y, z]: Vec3) => [x, y + eyeOffset, z] as const;

// Park-Miller: exact in doubles, so a seed replays on any engine. Seeds live
// in [1, modulus - 1].
const modulus = 2_147_483_647;

export const nextRandom = (seed: number) => {
  const next = (seed * 16_807) % modulus;
  return [(next - 1) / (modulus - 1), next] as const;
};

const between = ([min, max]: readonly [number, number], roll: number) =>
  min + roll * (max - min);

const burstSize = (roll: number) => {
  const [min, max] = botTuning.burst;
  return min + Math.floor(roll * (max - min + 1));
};

const weaponOf = (roll: number) =>
  weaponIds[Math.floor(roll * weaponIds.length)] ?? weaponIds[0];

export const botMemory = (seed: number) => {
  // Small seeds give small first draws, so skip one.
  const [, warm] = nextRandom((Math.abs(Math.trunc(seed)) % (modulus - 1)) + 1);
  const [roll, armed] = nextRandom(warm);
  const [pick, next] = nextRandom(armed);
  const memory: BotMemory = {
    mode: 'wander',
    node: undefined,
    previous: undefined,
    targetId: undefined,
    seenFor: 0,
    reaction: botTuning.reaction[0],
    aimOffset: [0, 0],
    aimFor: 0,
    burstLeft: burstSize(roll),
    pauseFor: 0,
    strafe: 1,
    strafeFor: 0,
    stuckFor: 0,
    weapon: weaponOf(pick),
    seed: next,
  };
  return memory;
};

// A fresh weapon for a respawn, from the bot's own seed.
export const rearmBot = (memory: BotMemory) => {
  const [pick, seed] = nextRandom(memory.seed);
  const rearmed: BotMemory = { ...memory, weapon: weaponOf(pick), seed };
  return rearmed;
};

// The signed shortest turn from one angle to another, in (-π, π].
const angleBetween = (from: number, to: number) => {
  const d = (((to - from) % turn) + turn) % turn;
  return d > Math.PI ? d - turn : d;
};

export const turnToward = (current: number, desired: number, maxStep: number) =>
  current +
  Math.max(-maxStep, Math.min(maxStep, angleBetween(current, desired)));

export const yawTowards = (from: Vec3, to: Vec3) =>
  Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));

export const pitchTowards = (from: Vec3, to: Vec3) =>
  Math.atan2(to[1] - from[1], Math.hypot(to[0] - from[0], to[2] - from[2]));

const angleOf = (a: Vec3, b: Vec3) =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// Within engage range and the view cone; line of sight is the caller's job.
export const inView = (eye: Vec3, yaw: number, pitch: number, target: Vec3) => {
  const range = distance(eye, target);
  if (range > botTuning.engageRange) return false;
  if (range === 0) return true;
  const towards = [
    (target[0] - eye[0]) / range,
    (target[1] - eye[1]) / range,
    (target[2] - eye[2]) / range,
  ] as const;
  return angleOf(aimDirection(yaw, pitch), towards) <= botTuning.viewCone / 2;
};

const look = (senses: BotSenses, yaw: number, pitch: number) =>
  [senses.yaw - yaw, senses.pitch - pitch] as const;

type Thinking = Types.Mutable<BotMemory>;

interface Step {
  readonly next: Thinking;
  readonly senses: BotSenses;
  readonly roll: () => number;
  readonly maxStep: number;
  readonly dt: number;
}

// Follows the road graph, jumping and re-routing when something blocks it.
const wander = (
  { next, senses, roll, maxStep, dt }: Step,
  graph: RoadGraph,
) => {
  next.mode = 'wander';
  next.targetId = undefined;
  next.seenFor = 0;
  const [x, , z] = senses.position;
  const pitch = turnToward(senses.pitch, 0, maxStep);
  if (next.node === undefined) {
    next.node = nearestNode(graph, [x, z]);
    next.previous = undefined;
  }
  const at = next.node;
  const point = at === undefined ? undefined : graph.points[at];
  if (at === undefined || point === undefined) {
    return { ...idleIntent, look: look(senses, senses.yaw, pitch) };
  }
  let goal = at;
  if (Math.hypot(point[0] - x, point[1] - z) < botTuning.waypointRadius) {
    goal = nextNode(graph, at, next.previous, roll());
    next.previous = at;
  }
  const speed = Math.hypot(senses.velocity[0], senses.velocity[2]);
  next.stuckFor = speed < botTuning.stuckSpeed ? next.stuckFor + dt : 0;
  const stuck = next.stuckFor >= botTuning.stuckAfter;
  if (stuck) {
    const from = nearestNode(graph, [x, z]) ?? at;
    next.stuckFor = 0;
    goal = nextNode(graph, from, goal, roll());
    next.previous = from;
  }
  next.node = goal;
  const heading = graph.points[goal] ?? point;
  const desired = yawTowards(senses.position, [heading[0], 0, heading[1]]);
  const yaw = turnToward(senses.yaw, desired, maxStep);
  return {
    ...idleIntent,
    // Slows for sharp turns so it doesn't circle the waypoint.
    move: [0, Math.abs(angleBetween(yaw, desired)) > 1 ? 0.3 : 1] as const,
    look: look(senses, yaw, pitch),
    jump: stuck,
  };
};

// Turns on the target at a capped rate with a wandering aim error, strafes,
// and fires in bursts once it has reacted and is roughly on target.
const engage = (
  { next, senses, roll, maxStep, dt }: Step,
  eye: Vec3,
  target: SeenPlayer,
) => {
  next.mode = 'engage';
  next.stuckFor = 0;
  if (target.id !== next.targetId) {
    next.targetId = target.id;
    next.seenFor = 0;
    next.reaction = between(botTuning.reaction, roll());
    next.aimFor = 0;
  }
  next.seenFor += dt;
  next.aimFor -= dt;
  const { weapon } = senses;
  if (next.aimFor <= 0) {
    const jitter =
      botTuning.aimJitter *
      (weapon.zoomFov === undefined ? 1 : botTuning.zoomJitter);
    next.aimFor = botTuning.jitterInterval;
    next.aimOffset = [(roll() * 2 - 1) * jitter, (roll() * 2 - 1) * jitter];
  }
  next.strafeFor -= dt;
  if (next.strafeFor <= 0) {
    next.strafeFor = between(botTuning.strafeFlip, roll());
    if (roll() < 0.5) next.strafe = -next.strafe;
  }

  // Leads a moving target by the ball's flight time and aims over the drop.
  const range = distance(eye, target.eye);
  const flight = range / weapon.muzzleSpeed;
  const drop =
    0.5 * paintballTuning.gravity * weapon.gravityScale * flight * flight;
  const aimPoint = [
    target.eye[0] + target.velocity[0] * flight,
    target.eye[1] - botTuning.aimDrop + drop,
    target.eye[2] + target.velocity[2] * flight,
  ] as const;
  const desiredYaw = yawTowards(eye, aimPoint) + next.aimOffset[0];
  const desiredPitch = pitchTowards(eye, aimPoint) + next.aimOffset[1];
  const yaw = turnToward(senses.yaw, desiredYaw, maxStep);
  const pitch = turnToward(senses.pitch, desiredPitch, maxStep);
  const aimError = angleOf(
    aimDirection(yaw, pitch),
    aimDirection(desiredYaw, desiredPitch),
  );
  const fire =
    next.seenFor >= next.reaction &&
    aimError < botTuning.aimThreshold &&
    next.pauseFor === 0 &&
    senses.ready &&
    senses.ammo > 0 &&
    range <= weapon.muzzleSpeed * weapon.lifetime;
  if (fire) {
    next.burstLeft -= 1;
    next.pauseFor =
      next.burstLeft > 0
        ? weapon.fireInterval
        : Math.max(botTuning.burstPause, weapon.fireInterval);
    if (next.burstLeft <= 0) next.burstLeft = burstSize(roll());
  }

  const [near, far] = botTuning.engageDistance[next.weapon];
  return {
    ...idleIntent,
    move: clampLength([
      next.strafe,
      range > far ? 0.6 : range < near ? -0.5 : 0,
    ]),
    look: look(senses, yaw, pitch),
    fire,
    reload: senses.ammo === 0,
  };
};

const byDistanceFrom = (eye: Vec3) =>
  Order.mapInput(Order.Number, (seen: SeenPlayer) => distance(eye, seen.eye));

// One frame of a bot: the same Intent a human's devices produce.
export const thinkBot = (
  memory: BotMemory,
  senses: BotSenses,
  graph: RoadGraph,
  dt: number,
) => {
  const next: Thinking = {
    ...memory,
    pauseFor: Math.max(0, memory.pauseFor - dt),
  };
  if (!senses.alive) {
    const resting: BotMemory = {
      ...next,
      mode: 'wander',
      node: undefined,
      previous: undefined,
      targetId: undefined,
      seenFor: 0,
      stuckFor: 0,
    };
    return { intent: idleIntent, memory: resting };
  }
  const roll = () => {
    const [value, seed] = nextRandom(next.seed);
    next.seed = seed;
    return value;
  };
  const step = { next, senses, roll, maxStep: botTuning.turnRate * dt, dt };
  const eye = eyeOf(senses.position);
  // Tops up between fights, and when empty in one.
  const intent: Intent = Arr.isReadonlyArrayNonEmpty(senses.visible)
    ? engage(step, eye, Arr.min(senses.visible, byDistanceFrom(eye)))
    : { ...wander(step, graph), reload: senses.ammo < senses.weapon.magazine };
  const thought: BotMemory = next;
  return { intent, memory: thought };
};
