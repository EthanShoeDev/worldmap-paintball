import '@tanstack/react-start/client-only';
import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';
import type { Arena } from '@worldmap-paintball/api-contract';
import type { Player, PlayerId } from '@worldmap-paintball/api-contract/lobby';
import {
  Array as Arr,
  Clock,
  Context,
  Effect,
  FiberSet,
  Layer,
  Option,
  Ref,
  Schedule,
  Stream,
  SubscriptionRef,
} from 'effect';
import { Atom, AtomRegistry } from 'effect/reactivity';

import {
  lobbyMessages,
  lobbyRuntime,
  peerNetworkAtom,
} from '../../lobby/lobby-atoms.ts';
import { LobbyClient } from '../../lobby/lobby-client.ts';
import { type PeerMessage, PeerNetwork } from '../../lobby/peer-network.ts';
import { spawnPoints } from '../arena-meshes.ts';
import { customArenaAtom, type MatchKey } from '../map-settings.ts';
import { freshPads, type Pad, padsOf, padsReady } from '../powerups.ts';
import { heightAt } from '../terrain.ts';
import {
  interpolationBufferMs,
  netTickMs,
  playerColor,
  type PowerUpKind,
  spawnHeight,
  type Weapons,
  weapons,
  weaponsAt,
} from '../tuning.ts';
import { isBot } from './bots.ts';
import {
  interpolatedPoses,
  interpolationSnapshot,
  type Pose,
} from './interpolation.ts';
import {
  applyGrab,
  applyHit,
  applyShot,
  type GrabEvent,
  type HitEvent,
  initialSpawn,
  makeMatch,
  receiveState,
  respawnDue,
  scoresOf,
  type ShotEvent,
  snapshotOf,
  syncRoster,
} from './match.ts';
import {
  decodeNetEvent,
  decodePlayerState,
  decodeWorldSnapshot,
  encodeNetEvent,
  encodePlayerState,
  encodeWorldSnapshot,
  Net,
  NetEvent,
  type PlayerState,
  type Score,
  type Vec3,
  type WorldSnapshot,
} from './protocol.ts';

// What the local <Player> needs from a match, called once per frame.
export interface LocalControls {
  readonly report: (state: PlayerState) => void;
  readonly alive: () => boolean;
  // A host-chosen respawn point to teleport to; returned once.
  readonly takeRespawn: () => Vec3 | undefined;
  // Asks the host for the power-up on a pad this player stands on.
  readonly grab: (pad: number) => void;
  // A power-up the host granted since the last call.
  readonly takePowerUp: () => PowerUpKind | undefined;
}

export interface FeedEntry {
  readonly id: number;
  readonly shooter: PlayerId;
  readonly target: PlayerId;
}

export interface MatchView {
  readonly you: PlayerId | undefined;
  // Lobby order when the match started; player colours follow it.
  readonly roster: ReadonlyArray<Player>;
  // Who is still in the match, from the network's players.
  readonly present: ReadonlyArray<PlayerId>;
  readonly scores: ReadonlyArray<Score>;
  readonly eliminatedBy: PlayerId | undefined;
  readonly respawnIn: number | undefined;
  readonly feed: ReadonlyArray<FeedEntry>;
  readonly final: ReadonlyArray<Score> | undefined;
}

export const idleMatchView: MatchView = {
  you: undefined,
  roster: [],
  present: [],
  scores: [],
  eliminatedBy: undefined,
  respawnIn: undefined,
  feed: [],
  final: undefined,
};

// Kept alive so the final scores outlive the match's peer network.
export const matchViewAtom = Atom.make(idleMatchView).pipe(Atom.keepAlive);

type Fields<E> = Omit<E, '_tag'>;

// A player this browser simulates: `you`, plus the bots on the host.
interface Local {
  state: PlayerState | undefined;
  alive: boolean;
  // A host-chosen respawn point to teleport to; taken once.
  respawnTo: Vec3 | undefined;
  powerUp: PowerUpKind | undefined;
  // The pad last asked for and when, so a grab is sent once, not each frame.
  asked: { readonly pad: number; readonly at: number } | undefined;
}

// Long enough for the host's answer, or its next snapshot, to arrive.
const regrabMs = 750;

const feedLength = 4;

const sameScores = (a: ReadonlyArray<Score>, b: ReadonlyArray<Score>) =>
  a.length === b.length &&
  Arr.every(a, (score, index) => {
    const other = b[index];
    return (
      other?.id === score.id &&
      other.score === score.score &&
      other.deaths === score.deaths
    );
  });

// See README.md in this folder for the netcode model.
export class NetGame extends Context.Service<
  NetGame,
  LocalControls & {
    readonly you: PlayerId;
    readonly isHost: boolean;
    // Lobby order when the match started; player colours follow it.
    readonly roster: ReadonlyArray<Player>;
    // Players the host simulates in this browser; empty on clients.
    readonly bots: ReadonlyArray<PlayerId>;
    readonly controls: (id: PlayerId) => LocalControls;
    readonly spawnOf: (id: PlayerId) => Vec3;
    readonly pads: ReadonlyArray<Pad>;
    // Which pads are ready, as of the latest snapshot.
    readonly padsReady: () => ReadonlyArray<boolean>;
    // Interpolated poses of living remote players; call once per frame.
    readonly updateRemotes: () => ReadonlyMap<PlayerId, Pose>;
    // Living players' centres as last rendered, the local one included.
    readonly targets: (
      except: PlayerId,
    ) => ReadonlyArray<readonly [PlayerId, Vec3]>;
    // Shots from players not simulated here since the last call, to replay.
    readonly takeShots: () => ReadonlyArray<ShotEvent>;
    // A shot leaving the muzzle; the shooter's own simulation of its balls
    // reports any `hit` when one lands.
    readonly fire: (shot: Fields<ShotEvent>) => void;
    readonly hit: (hit: Fields<HitEvent>) => void;
    readonly announceEnd: Effect.Effect<void>;
  }
>()('@worldmap-paintball/web/game/net/net-game/NetGame') {
  static readonly layerWith = (
    spawns: ReadonlyArray<Vec3>,
    table: Weapons = weapons,
    pads: ReadonlyArray<Pad> = [],
  ) =>
    Layer.effect(
      NetGame,
      Effect.gen(function* () {
        const network = yield* PeerNetwork;
        const registry = yield* AtomRegistry.AtomRegistry;
        const { you, isHost, hostId, roster } = network;
        const run = yield* FiberSet.makeRuntime();
        const interpolation = new SnapshotInterpolation();
        interpolation.interpolationBuffer.set(interpolationBufferMs);
        const matchRef = yield* Ref.make(
          makeMatch(Arr.map(roster, (player) => player.id)),
        );
        const padTimers = yield* Ref.make(freshPads(pads));
        const bots = isHost
          ? Arr.flatMap(roster, (player) => (isBot(player) ? [player.id] : []))
          : [];
        // Shared with the render loop, which must not wait on fibers.
        const locals = new Map<PlayerId, Local>(
          Arr.map([you, ...bots], (id) => [
            id,
            {
              state: undefined,
              alive: true,
              respawnTo: undefined,
              powerUp: undefined,
              asked: undefined,
            },
          ]),
        );
        const yours = locals.get(you);
        let respawnAt: number | undefined;
        let world: WorldSnapshot | undefined;
        let remotes: ReadonlyMap<PlayerId, Pose> = new Map();
        let shots: Array<ShotEvent> = [];
        let feedId = 0;
        let snapshotId = 0;

        const presentNow = Arr.map(
          yield* SubscriptionRef.get(network.players),
          (player) => player.id,
        );
        registry.set(matchViewAtom, {
          ...idleMatchView,
          you,
          roster,
          present: presentNow,
        });
        const updateView = (f: (view: MatchView) => MatchView) =>
          Effect.sync(() => registry.update(matchViewAtom, f));

        const eliminated = Effect.fn('NetGame.eliminated')(function* (
          event: typeof Net.Eliminated.Type,
        ) {
          const now = yield* Clock.currentTimeMillis;
          feedId += 1;
          const entry = {
            id: feedId,
            shooter: event.shooter,
            target: event.target,
          };
          const local = locals.get(event.target);
          if (local) {
            local.alive = false;
            local.powerUp = undefined;
          }
          const mine = event.target === you;
          if (mine) respawnAt = now + event.respawnInMs;
          yield* updateView((view) => ({
            ...view,
            feed: Arr.takeRight([...view.feed, entry], feedLength),
            eliminatedBy: mine ? event.shooter : view.eliminatedBy,
            respawnIn: mine
              ? Math.ceil(event.respawnInMs / 1000)
              : view.respawnIn,
          }));
        });

        const respawned = (event: typeof Net.Respawn.Type) =>
          Effect.suspend(() => {
            const local = locals.get(event.player);
            if (local) {
              local.respawnTo = event.position;
              local.alive = true;
            }
            if (event.player !== you) return Effect.void;
            respawnAt = undefined;
            return updateView((view) => ({
              ...view,
              eliminatedBy: undefined,
              respawnIn: undefined,
            }));
          });

        const applyLocal = (event: NetEvent) =>
          NetEvent.match(event, {
            Shot: (shot) =>
              Effect.sync(() => {
                if (!locals.has(shot.shooter)) shots.push(shot);
              }),
            Hit: () => Effect.void,
            Grab: () => Effect.void,
            PoweredUp: ({ player, kind }) =>
              Effect.sync(() => {
                const local = locals.get(player);
                if (local) local.powerUp = kind;
              }),
            Eliminated: eliminated,
            Respawn: respawned,
            Scored: ({ scores }) => updateView((view) => ({ ...view, scores })),
            MatchEnded: ({ scores }) =>
              updateView((view) => ({ ...view, final: scores })),
          });

        const broadcastEvent = Effect.fn('NetGame.broadcastEvent')(
          function* (event: NetEvent) {
            const data = yield* encodeNetEvent(event);
            yield* network.broadcast('events', data);
          },
          Effect.catch((error) =>
            Effect.logWarning('Event not sent', error.message),
          ),
        );

        // Host only: tell every client, then apply it here as well.
        const distribute = (events: ReadonlyArray<NetEvent>) =>
          Effect.forEach(
            events,
            (event) => Effect.andThen(broadcastEvent(event), applyLocal(event)),
            { discard: true },
          );

        const receiveWorld = (id: string, time: number, next: WorldSnapshot) =>
          Effect.suspend(() => {
            world = next;
            interpolation.snapshot.add(interpolationSnapshot(id, time, next));
            return updateView((view) =>
              sameScores(view.scores, next.scores)
                ? view
                : { ...view, scores: next.scores },
            );
          });

        const hostHit = Effect.fn('NetGame.hostHit')(function* (
          from: PlayerId,
          hit: HitEvent,
        ) {
          const now = yield* Clock.currentTimeMillis;
          const { outbox, rejected } = yield* Ref.modify(matchRef, (match) => {
            const step = applyHit(match, from, hit, now, table);
            return [step, step.match] as const;
          });
          if (rejected !== undefined) {
            yield* Effect.logDebug('Rejected hit', { from, rejected });
          }
          yield* distribute(outbox);
        });

        // Only shots the host accepts are relayed, and only they can score.
        const hostShot = Effect.fn('NetGame.hostShot')(function* (
          from: PlayerId,
          shot: ShotEvent,
        ) {
          const now = yield* Clock.currentTimeMillis;
          const rejected = yield* Ref.modify(matchRef, (match) => {
            const step = applyShot(match, from, shot, now);
            return [step.rejected, step.match] as const;
          });
          if (rejected !== undefined) {
            return yield* Effect.logDebug('Rejected shot', { from, rejected });
          }
          yield* distribute([shot]);
        });

        const hostGrab = Effect.fn('NetGame.hostGrab')(function* (
          from: PlayerId,
          grab: GrabEvent,
        ) {
          const now = yield* Clock.currentTimeMillis;
          const timers = yield* Ref.get(padTimers);
          const step = yield* Ref.modify(matchRef, (match) => {
            const result = applyGrab(match, pads, timers, from, grab, now);
            return [result, result.match] as const;
          });
          if (step.rejected !== undefined) {
            return yield* Effect.logDebug('Rejected grab', {
              from,
              rejected: step.rejected,
            });
          }
          yield* Ref.set(padTimers, step.timers);
          yield* distribute(step.outbox);
        });

        const hostHandle = (from: PlayerId, event: NetEvent) =>
          NetEvent.matchOrElse(
            event,
            {
              Shot: (shot) => hostShot(from, shot),
              Hit: (hit) => hostHit(from, hit),
              Grab: (grab) => hostGrab(from, grab),
            },
            (other) =>
              Effect.logWarning('Dropped host-only event from a client', {
                from,
                tag: other._tag,
              }),
          );

        const onMessage = Effect.fn('NetGame.onMessage')(function* ({
          from,
          channel,
          data,
        }: PeerMessage) {
          if (isHost && channel === 'state') {
            const state = yield* decodePlayerState(data);
            if (Option.isSome(state)) {
              yield* Ref.update(matchRef, (match) =>
                receiveState(match, from, state.value),
              );
            }
            return;
          }
          // A client's `state` traffic is snapshots, read from `snapshots`.
          if (channel !== 'events' || (!isHost && from !== hostId)) return;
          const event = yield* decodeNetEvent(data);
          if (Option.isNone(event)) return;
          yield* isHost
            ? hostHandle(from, event.value)
            : applyLocal(event.value);
        });

        yield* network.messages.pipe(
          Stream.runForEach(onMessage),
          Effect.forkScoped,
        );

        yield* SubscriptionRef.changes(network.players).pipe(
          Stream.runForEach((players) =>
            updateView((view) => ({
              ...view,
              present: Arr.map(players, (player) => player.id),
            })),
          ),
          Effect.forkScoped,
        );

        if (!isHost) {
          yield* network.snapshots.pipe(
            Stream.runForEach((snapshot) =>
              decodeWorldSnapshot(snapshot.state).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.void,
                    onSome: (decoded) =>
                      receiveWorld(snapshot.id, snapshot.time, decoded),
                  }),
                ),
              ),
            ),
            Effect.forkScoped,
          );
        }

        const hostTick = Effect.fn('NetGame.hostTick')(function* (now: number) {
          const members = Arr.map(
            yield* SubscriptionRef.get(network.players),
            (player) => player.id,
          );
          const states = Arr.flatMap([...locals], ([id, { state }]) =>
            state ? [[id, state] as const] : [],
          );
          const due = yield* Ref.modify(matchRef, (match) => {
            const step = respawnDue(
              Arr.reduce(
                states,
                syncRoster(match, members),
                (next, [id, state]) => receiveState(next, id, state),
              ),
              now,
              spawns,
            );
            return [step.outbox, step.match] as const;
          });
          yield* distribute(due);
          const snapshot = {
            ...snapshotOf(yield* Ref.get(matchRef)),
            pads: padsReady(yield* Ref.get(padTimers), now),
          };
          yield* network.sendSnapshot(yield* encodeWorldSnapshot(snapshot));
          snapshotId += 1;
          yield* receiveWorld(`host-${snapshotId}`, now, snapshot);
        });

        const tick = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const respawnIn =
            respawnAt === undefined
              ? undefined
              : Math.max(0, Math.ceil((respawnAt - now) / 1000));
          yield* updateView((view) =>
            view.respawnIn === respawnIn ? view : { ...view, respawnIn },
          );
          if (isHost) return yield* hostTick(now);
          const own = locals.get(you)?.state;
          if (own) {
            yield* network.broadcast('state', yield* encodePlayerState(own));
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning('Network tick failed', error.message),
          ),
        );

        yield* tick.pipe(
          Effect.repeat(Schedule.spaced(netTickMs)),
          Effect.forkScoped,
        );

        // Only players simulated here can fire, so a client fires as `you`.
        const send = Effect.fn('NetGame.send')(function* (
          event: ShotEvent | HitEvent,
        ) {
          yield* isHost
            ? hostHandle(event.shooter, event)
            : broadcastEvent(event);
        });

        const grab = Effect.fn('NetGame.grab')(function* (
          id: PlayerId,
          pad: number,
        ) {
          const local = locals.get(id);
          const now = yield* Clock.currentTimeMillis;
          if (local?.alive !== true) return;
          if (local.asked?.pad === pad && now - local.asked.at < regrabMs) {
            return;
          }
          local.asked = { pad, at: now };
          const event = Net.Grab.make({ player: id, pad });
          yield* isHost ? hostHandle(id, event) : broadcastEvent(event);
        });

        const fire = Effect.fn('NetGame.fire')(function* (
          shot: Fields<ShotEvent>,
        ) {
          if (locals.get(shot.shooter)?.alive !== true) return;
          yield* send(Net.Shot.make(shot));
        });

        const controls = (id: PlayerId) => {
          const local = locals.get(id);
          return {
            report: (state: PlayerState) => {
              if (local) local.state = state;
            },
            alive: () => local?.alive ?? false,
            takeRespawn: () => {
              const target = local?.respawnTo;
              if (local) local.respawnTo = undefined;
              return target;
            },
            grab: (pad: number) => {
              run(grab(id, pad));
            },
            takePowerUp: () => {
              const kind = local?.powerUp;
              if (local) local.powerUp = undefined;
              return kind;
            },
          };
        };

        const announceEnd = Effect.gen(function* () {
          if (!isHost) return;
          const scores = scoresOf(yield* Ref.get(matchRef));
          yield* distribute([Net.MatchEnded.make({ scores })]);
        });

        return NetGame.of({
          you,
          isHost,
          roster,
          bots,
          controls,
          ...controls(you),
          spawnOf: (id) => initialSpawn(spawns, rosterIndex(roster, id)),
          pads,
          padsReady: () => world?.pads ?? [],
          updateRemotes: () => {
            const living = new Set(
              Arr.flatMap(world?.players ?? [], (player) =>
                player.alive && player.id !== you ? [player.id] : [],
              ),
            );
            const poses = interpolatedPoses(interpolation);
            remotes = new Map(Arr.filter([...poses], ([id]) => living.has(id)));
            return remotes;
          },
          targets: (except) => [
            ...Arr.flatMap([...remotes], ([id, pose]) =>
              id === except ? [] : [[id, pose.position] as const],
            ),
            ...(yours?.alive === true && yours.state && except !== you
              ? [[you, yours.state.position] as const]
              : []),
          ],
          takeShots: () => {
            const taken = shots;
            shots = [];
            return taken;
          },
          fire: (shot) => {
            run(fire(shot));
          },
          hit: (hit) => {
            run(send(Net.Hit.make(hit)));
          },
          announceEnd,
        });
      }),
    );
}

const rosterIndex = (roster: ReadonlyArray<Player>, id: PlayerId) =>
  Arr.findFirstIndex(roster, (player) => player.id === id).pipe(
    Option.getOrElse(() => 0),
  );

export const colorOf = (
  { roster }: { readonly roster: ReadonlyArray<Player> },
  id: PlayerId,
) => playerColor(rosterIndex(roster, id));

export const arenaSpawns = (arena: Arena) =>
  Arr.map(
    spawnPoints(arena),
    ([x, z]) => [x, heightAt(arena, x, z) + spawnHeight, z] as const,
  );

// One per match and arena: rebuilt with the peer network, so a new match
// starts from fresh scores.
export const netGameAtom = Atom.family(({ rules, ...key }: MatchKey) =>
  lobbyRuntime.atom((get) =>
    Effect.gen(function* () {
      const network = yield* get.result(peerNetworkAtom);
      const arena = yield* get.result(customArenaAtom(key));
      const context = yield* Layer.build(
        NetGame.layerWith(
          arenaSpawns(arena),
          weaponsAt(rules.paintballSpeed),
          padsOf(arena),
        ),
      ).pipe(Effect.provideService(PeerNetwork, network));
      return Context.get(context, NetGame);
    }),
  ),
);

// Lets clients see the final scores before the lobby ends the match and
// tears down the peer network.
export const endMatchAtom = lobbyRuntime.fn(
  Effect.fn('endMatch')(function* (game: NetGame['Service']) {
    yield* game.announceEnd;
    const client = yield* LobbyClient;
    yield* client.send(lobbyMessages.endMatch());
  }),
);
