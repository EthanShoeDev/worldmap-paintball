import '@tanstack/react-start/client-only';
import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';
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

import { arenaAtom } from '../../api-client.ts';
import {
  lobbyMessages,
  lobbyRuntime,
  peerNetworkAtom,
} from '../../lobby/lobby-atoms.ts';
import { LobbyClient } from '../../lobby/lobby-client.ts';
import { type PeerMessage, PeerNetwork } from '../../lobby/peer-network.ts';
import type { Coordinates } from '../../location/coordinates.ts';
import { spawnPoints } from '../arena-meshes.ts';
import {
  interpolationBufferMs,
  netTickMs,
  playerColor,
  spawnHeight,
} from '../tuning.ts';
import type { PlayerHit } from './hit-test.ts';
import {
  interpolatedPoses,
  interpolationSnapshot,
  type Pose,
} from './interpolation.ts';
import {
  applyHit,
  type HitEvent,
  initialSpawn,
  makeMatch,
  receiveState,
  respawnDue,
  scoresOf,
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
  readonly scores: ReadonlyArray<Score>;
  readonly eliminatedBy: PlayerId | undefined;
  readonly respawnIn: number | undefined;
  readonly feed: ReadonlyArray<FeedEntry>;
  readonly final: ReadonlyArray<Score> | undefined;
}

export const idleMatchView: MatchView = {
  you: undefined,
  roster: [],
  scores: [],
  eliminatedBy: undefined,
  respawnIn: undefined,
  feed: [],
  final: undefined,
};

// Kept alive so the final scores outlive the match's peer network.
export const matchViewAtom = Atom.make(idleMatchView).pipe(Atom.keepAlive);

type ShotEvent = typeof Net.Shot.Type;

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
    readonly spawn: Vec3;
    // Interpolated poses of living remote players; call once per frame.
    readonly updateRemotes: () => ReadonlyMap<PlayerId, Pose>;
    // Living players' centres as last rendered, the local one included.
    readonly targets: (
      except: PlayerId,
    ) => ReadonlyArray<readonly [PlayerId, Vec3]>;
    // Other players' shots since the last call, to paint their splats.
    readonly takeShots: () => ReadonlyArray<ShotEvent>;
    readonly fire: (
      origin: Vec3,
      dir: Vec3,
      hit: PlayerHit | undefined,
    ) => void;
    readonly announceEnd: Effect.Effect<void>;
  }
>()('@worldmap-paintball/web/game/net/net-game/NetGame') {
  static readonly layerWith = (spawns: ReadonlyArray<Vec3>) =>
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
        // Shared with the render loop, which must not wait on fibers.
        let localState: PlayerState | undefined;
        let alive = true;
        let respawnTo: Vec3 | undefined;
        let respawnAt: number | undefined;
        let world: WorldSnapshot | undefined;
        let remotes: ReadonlyMap<PlayerId, Pose> = new Map();
        let shots: Array<ShotEvent> = [];
        let feedId = 0;
        let snapshotId = 0;

        registry.set(matchViewAtom, { ...idleMatchView, you, roster });
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
          const mine = event.target === you;
          if (mine) {
            alive = false;
            respawnAt = now + event.respawnInMs;
          }
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
          event.player === you
            ? Effect.suspend(() => {
                respawnTo = event.position;
                alive = true;
                respawnAt = undefined;
                return updateView((view) => ({
                  ...view,
                  eliminatedBy: undefined,
                  respawnIn: undefined,
                }));
              })
            : Effect.void;

        const applyLocal = (event: NetEvent) =>
          NetEvent.match(event, {
            Shot: (shot) =>
              Effect.sync(() => {
                if (shot.shooter !== you) shots.push(shot);
              }),
            Hit: () => Effect.void,
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
            const step = applyHit(match, from, hit, now);
            return [step, step.match] as const;
          });
          if (rejected !== undefined) {
            yield* Effect.logDebug('Rejected hit', { from, rejected });
          }
          yield* distribute(outbox);
        });

        const hostHandle = (from: PlayerId, event: NetEvent) =>
          NetEvent.matchOrElse(
            event,
            {
              Shot: (shot) =>
                shot.shooter === from
                  ? distribute([shot])
                  : Effect.logWarning('Dropped spoofed shot', from),
              Hit: (hit) => hostHit(from, hit),
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
          const own = localState;
          const due = yield* Ref.modify(matchRef, (match) => {
            const synced = syncRoster(match, members);
            const step = respawnDue(
              own ? receiveState(synced, you, own) : synced,
              now,
              spawns,
            );
            return [step.outbox, step.match] as const;
          });
          yield* distribute(due);
          const snapshot = snapshotOf(yield* Ref.get(matchRef));
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
          if (localState) {
            yield* network.broadcast(
              'state',
              yield* encodePlayerState(localState),
            );
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

        const fire = Effect.fn('NetGame.fire')(function* (
          origin: Vec3,
          dir: Vec3,
          hit: PlayerHit | undefined,
        ) {
          if (!alive) return;
          const events: ReadonlyArray<NetEvent> = [
            Net.Shot.make({ shooter: you, origin, dir }),
            ...(hit
              ? [
                  Net.Hit.make({
                    shooter: you,
                    target: hit.target,
                    point: hit.point,
                  }),
                ]
              : []),
          ];
          yield* Effect.forEach(
            events,
            (event) =>
              isHost ? hostHandle(you, event) : broadcastEvent(event),
            { discard: true },
          );
        });

        const announceEnd = Effect.gen(function* () {
          if (!isHost) return;
          const scores = scoresOf(yield* Ref.get(matchRef));
          yield* distribute([Net.MatchEnded.make({ scores })]);
        });

        return NetGame.of({
          you,
          isHost,
          roster,
          spawn: initialSpawn(spawns, rosterIndex(roster, you)),
          report: (state) => {
            localState = state;
          },
          alive: () => alive,
          takeRespawn: () => {
            const target = respawnTo;
            respawnTo = undefined;
            return target;
          },
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
            ...(alive && localState && except !== you
              ? [[you, localState.position] as const]
              : []),
          ],
          takeShots: () => {
            const taken = shots;
            shots = [];
            return taken;
          },
          fire: (origin, dir, hit) => {
            run(fire(origin, dir, hit));
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

// One per match and arena: rebuilt with the peer network, so a new match
// starts from fresh scores.
export const netGameAtom = Atom.family((coordinates: Coordinates) =>
  lobbyRuntime.atom((get) =>
    Effect.gen(function* () {
      const network = yield* get.result(peerNetworkAtom);
      const arena = yield* get.result(arenaAtom(coordinates));
      const spawns = Arr.map(
        spawnPoints(arena.roads),
        ([x, z]) => [x, spawnHeight, z] as const,
      );
      const context = yield* Layer.build(NetGame.layerWith(spawns)).pipe(
        Effect.provideService(PeerNetwork, network),
      );
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
