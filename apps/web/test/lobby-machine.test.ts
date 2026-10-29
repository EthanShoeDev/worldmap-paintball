import { assert, describe, it } from '@effect/vitest';
import { Machine } from '@typeonce/effect-machine';
import { MachineTest } from '@typeonce/effect-machine/testing';
import type {
  ClientMessage,
  Lobby,
  ServerMessage,
} from '@worldmap-paintball/api/lobby/protocol';
import {
  Array as Arr,
  Cause,
  Effect,
  Layer,
  Option,
  Queue,
  Record,
  Ref,
  Stream,
  SubscriptionRef,
} from 'effect';
import { TestClock } from 'effect/testing';

import {
  LobbyClient,
  LobbyConnectionError,
} from '../src/lobby/lobby-client.ts';
import {
  type LobbyEvent,
  LobbyEvents,
  LobbyMachine,
  type LobbySnapshot,
  LobbyStates,
} from '../src/lobby/lobby-machine.ts';
import { MatchNetwork } from '../src/lobby/match-network.ts';
import type { PeerNetwork } from '../src/lobby/peer-network.ts';

const code = 'ABC234';
const location = { lat: 51.5, lon: -0.12 };
const host = { id: 'host', name: 'Host', ready: false };
const guest = { id: 'guest', name: 'Guest', ready: true };

const lobby = (
  phase: Lobby['phase'],
  players: Lobby['players'] = [host, guest],
): Lobby => ({ phase, hostId: host.id, players, location });

const create = LobbyEvents.Create({ code, name: 'Host', location });
const join = (name = 'Guest') => LobbyEvents.Join({ code, name });
const welcomeHost = LobbyEvents.Welcomed({
  you: host.id,
  lobby: lobby('waiting', [host]),
});
const welcomeGuest = LobbyEvents.Welcomed({
  you: guest.id,
  lobby: lobby('waiting'),
});
const matchStarted = LobbyEvents.MatchStarted({ lobby: lobby('playing') });
const matchEnded = LobbyEvents.LobbyUpdated({ lobby: lobby('waiting') });
const leave = LobbyEvents.Leave();

const run = (events: ReadonlyArray<LobbyEvent>) =>
  MachineTest.run(LobbyMachine, { events });

const pathOf = (snapshot: LobbySnapshot) =>
  Arr.findFirst(
    [
      'Idle',
      'Session.Connecting',
      'Session.InLobby.Waiting',
      'Session.InLobby.Playing',
      'Ended.Lost',
      'Ended.Closed',
      'Ended.Failed',
    ] as const,
    (path) => LobbyStates.matches(snapshot, path),
  ).pipe(Option.getOrThrow);

const define = MachineTest.invariants(LobbyMachine);

// The lobby phase and the Waiting/Playing child can never disagree.
const phaseMatchesState = define.state(
  'lobby phase matches the active child',
  ({ snapshot }) =>
    Option.match(LobbyStates.get(snapshot, 'Session.InLobby'), {
      onNone: () => true,
      onSome: ({ lobby: current }) =>
        LobbyStates.matches(
          snapshot,
          current.phase === 'playing'
            ? 'Session.InLobby.Playing'
            : 'Session.InLobby.Waiting',
        ) || `phase ${current.phase} in the wrong child`,
    }),
);

const traces = {
  create: [create, welcomeHost],
  join: [join(), welcomeGuest],
  rejectedJoin: [join(), LobbyEvents.Rejected({ reason: 'LobbyFull' })],
  nameTakenRetry: [
    join(),
    LobbyEvents.Rejected({ reason: 'NameTaken' }),
    join('Guest 2'),
    welcomeGuest,
  ],
  unreachable: [create, LobbyEvents.Disconnected()],
  hostLeft: [
    join(),
    welcomeGuest,
    matchStarted,
    LobbyEvents.LobbyClosed({ reason: 'HostLeft' }),
    leave,
  ],
  matchRoundTrip: [
    create,
    welcomeHost,
    LobbyEvents.LobbyUpdated({ lobby: lobby('waiting') }),
    matchStarted,
    LobbyEvents.LobbyUpdated({ lobby: lobby('playing', [host]) }),
    matchEnded,
  ],
  noticeInLobby: [
    create,
    welcomeHost,
    LobbyEvents.Rejected({ reason: 'PlayersNotReady' }),
  ],
  lostInLobby: [join(), welcomeGuest, LobbyEvents.Disconnected(), leave],
  leaveConnecting: [create, leave],
  leaveWaiting: [create, welcomeHost, leave],
  leavePlaying: [create, welcomeHost, matchStarted, leave],
  leaveFailed: [join(), LobbyEvents.Rejected({ reason: 'NameTaken' }), leave],
  // Defensive edges the server never takes: they keep phase and state in step.
  phaseFromUpdate: [
    create,
    welcomeHost,
    LobbyEvents.LobbyUpdated({ lobby: lobby('playing') }),
  ],
  waitingMatchStart: [
    create,
    welcomeHost,
    LobbyEvents.MatchStarted({ lobby: lobby('waiting') }),
  ],
  switchLobby: [create, welcomeHost, join()],
} satisfies Record<string, ReadonlyArray<LobbyEvent>>;

const final = (events: ReadonlyArray<LobbyEvent>) =>
  Effect.map(run(events), (trace) => trace.final);

describe('LobbyMachine planner', () => {
  it.effect('creates a lobby and lands in Waiting', () =>
    Effect.gen(function* () {
      const end = yield* final(traces.create);
      assert.strictEqual(pathOf(end), 'Session.InLobby.Waiting');
      assert.deepStrictEqual(
        Option.map(LobbyStates.get(end, 'Session'), (session) => session.code),
        Option.some(code),
      );
    }),
  );

  it.effect('joins a lobby', () =>
    Effect.gen(function* () {
      const end = yield* final(traces.join);
      assert.deepStrictEqual(
        Option.map(LobbyStates.get(end, 'Session.InLobby'), ({ you }) => you),
        Option.some(guest.id),
      );
    }),
  );

  it.effect('a rejected join fails and closes the session', () =>
    Effect.gen(function* () {
      const end = yield* final(traces.rejectedJoin);
      assert.isFalse(LobbyStates.matches(end, 'Session'));
      assert.deepStrictEqual(
        failureOf(end),
        Option.some({
          request: 'Join' as const,
          reason: 'LobbyFull' as const,
        }),
      );
    }),
  );

  it.effect('retries a NameTaken join with another name', () =>
    Effect.gen(function* () {
      const trace = yield* run(traces.nameTakenRetry);
      assert.deepStrictEqual(
        Arr.map(trace.steps, (step) => pathOf(step.after)),
        [
          'Session.Connecting',
          'Ended.Failed',
          'Session.Connecting',
          'Session.InLobby.Waiting',
        ],
      );
      assert.deepStrictEqual(
        Option.map(
          LobbyStates.get(trace.final, 'Session'),
          ({ request }) => request,
        ),
        Option.some({ _tag: 'Join' as const, name: 'Guest 2' }),
      );
    }),
  );

  it.effect('an unreachable server fails the attempt', () =>
    Effect.gen(function* () {
      const end = yield* final(traces.unreachable);
      assert.deepStrictEqual(
        failureOf(end),
        Option.some({
          request: 'Create' as const,
          reason: 'Unreachable' as const,
        }),
      );
    }),
  );

  it.effect('the host leaving mid-match closes the lobby', () =>
    Effect.gen(function* () {
      const trace = yield* run(traces.hostLeft);
      assert.deepStrictEqual(
        Arr.map(trace.steps, (step) => pathOf(step.after)),
        [
          'Session.Connecting',
          'Session.InLobby.Waiting',
          'Session.InLobby.Playing',
          'Ended.Closed',
          'Idle',
        ],
      );
    }),
  );

  it.effect(
    'a match starts and ends without restarting on roster changes',
    () =>
      Effect.gen(function* () {
        const trace = yield* run(traces.matchRoundTrip);
        assert.deepStrictEqual(
          Arr.map(trace.steps, (step) => pathOf(step.after)),
          [
            'Session.Connecting',
            'Session.InLobby.Waiting',
            'Session.InLobby.Waiting',
            'Session.InLobby.Playing',
            'Session.InLobby.Playing',
            'Session.InLobby.Waiting',
          ],
        );
        // A player leaving mid-match updates the lobby but keeps Playing (and
        // its peer network) running.
        const rosterChange = trace.steps[4];
        assert.deepStrictEqual(
          Arr.flatMap(
            rosterChange?.plan.microsteps ?? [],
            (step) => step.exitPaths,
          ),
          [],
        );
        assert.deepStrictEqual(
          Option.map(
            LobbyStates.get(
              rosterChange?.after ?? trace.final,
              'Session.InLobby',
            ),
            ({ lobby: current }) => current.players.length,
          ),
          Option.some(1),
        );
      }),
  );

  it.effect('a refused lobby action is a notice, not state', () =>
    Effect.gen(function* () {
      const trace = yield* run(traces.noticeInLobby);
      const refused = trace.steps[2];
      assert.deepStrictEqual(refused?.plan.emittedEvents, [
        { _tag: 'ActionRejected', reason: 'PlayersNotReady' },
      ]);
      assert.deepStrictEqual(refused?.after, refused?.before);
    }),
  );

  it.effect('a dropped socket in the lobby ends the session', () =>
    Effect.gen(function* () {
      const trace = yield* run(traces.lostInLobby);
      assert.strictEqual(
        pathOf(trace.steps[2]?.after ?? trace.final),
        'Ended.Lost',
      );
      assert.strictEqual(pathOf(trace.final), 'Idle');
    }),
  );

  it.effect('leaves from every connected state', () =>
    Effect.gen(function* () {
      for (const events of [
        traces.leaveConnecting,
        traces.leaveWaiting,
        traces.leavePlaying,
        traces.leaveFailed,
      ]) {
        const trace = yield* run(events);
        assert.strictEqual(pathOf(trace.final), 'Idle');
      }
    }),
  );

  it.effect('joining elsewhere replaces the session and its socket', () =>
    Effect.gen(function* () {
      const trace = yield* run(traces.switchLobby);
      const exits = Arr.flatMap(
        trace.steps[2]?.plan.microsteps ?? [],
        (step) => step.exitPaths,
      );
      assert.include(exits, 'Session');
      assert.strictEqual(pathOf(trace.final), 'Session.Connecting');
    }),
  );

  it.effect('keeps every trace valid and the phase in step', () =>
    Effect.gen(function* () {
      const all = yield* Effect.forEach(Record.values(traces), run);
      for (const trace of all) {
        yield* MachineTest.verify(LobbyMachine, trace);
        yield* MachineTest.assertInvariants(LobbyMachine, trace, [
          phaseMatchesState,
        ]);
      }
    }),
  );

  it.effect('covers every event transition; invocations are covered live', () =>
    Effect.gen(function* () {
      const all = yield* Effect.forEach(Record.values(traces), run);
      const coverage = MachineTest.coverage(LobbyMachine, all);
      assert.deepStrictEqual(
        Arr.filter(
          coverage.transitions.branches.misses,
          ({ trigger }) => trigger.type !== 'invoke',
        ),
        [],
      );
      assert.deepStrictEqual(
        Arr.map(
          coverage.transitions.definitions.misses,
          ({ source, trigger }) => [source, trigger],
        ),
        [
          ['Session', { type: 'invoke', id: 'socket', outcome: 'element' }],
          ['Session', { type: 'invoke', id: 'socket', outcome: 'done' }],
          ['Session', { type: 'invoke', id: 'socket', outcome: 'failure' }],
          [
            'Session.Connecting',
            { type: 'invoke', id: 'connectTimeout', outcome: 'done' },
          ],
        ],
      );
      assert.deepStrictEqual(coverage.states.activation.misses, []);
    }),
  );
});

// A scripted socket: each `connect` reads the same queue of server messages.
const fakeLobby = Effect.gen(function* () {
  const inbox = yield* Queue.unbounded<
    ServerMessage,
    LobbyConnectionError | Cause.Done
  >();
  const hellos = yield* Ref.make<ReadonlyArray<ClientMessage>>([]);
  const open = yield* Ref.make(0);
  const matches = yield* Ref.make({ started: 0, stopped: 0 });
  const client = LobbyClient.of({
    connect: (_code, hello) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* Ref.update(hellos, Arr.append(hello));
          yield* Ref.update(open, (count) => count + 1);
          yield* Effect.addFinalizer(() =>
            Ref.update(open, (count) => count - 1),
          );
          return Stream.fromQueue(inbox);
        }),
      ),
    send: () => Effect.void,
    signals: Stream.empty,
    lobbies: Stream.empty,
  });
  const network = MatchNetwork.of({
    play: () =>
      Ref.update(matches, (count) => ({
        ...count,
        started: count.started + 1,
      })).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Ref.update(matches, (count) => ({
            ...count,
            stopped: count.stopped + 1,
          })),
        ),
      ),
    current: yield* SubscriptionRef.make(Option.none<PeerNetwork['Service']>()),
  });
  return {
    inbox,
    hellos,
    open,
    matches,
    layer: Layer.mergeAll(
      Layer.succeed(LobbyClient, client),
      Layer.succeed(MatchNetwork, network),
    ),
  };
});

const at =
  (path: Parameters<typeof LobbyStates.matches>[1]) =>
  (snapshot: { readonly status: string; readonly state: LobbySnapshot }) =>
    snapshot.status === 'active' && LobbyStates.matches(snapshot.state, path);

const failureOf = (snapshot: LobbySnapshot) =>
  Option.map(
    LobbyStates.get(snapshot, 'Ended.Failed'),
    ({ request, reason }) => ({
      request,
      reason,
    }),
  );

describe('LobbyMachine runtime', () => {
  it.effect(
    'server messages drive the session and the socket lives in Session',
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeLobby;
        yield* Effect.gen(function* () {
          const ref = yield* Machine.start(LobbyMachine);
          yield* ref.send(create);
          yield* Machine.waitFor(ref, at('Session.Connecting'));
          assert.strictEqual(yield* Ref.get(fake.open), 1);
          assert.deepStrictEqual(yield* Ref.get(fake.hellos), [
            { _tag: 'CreateLobby', name: 'Host', location },
          ]);
          yield* Queue.offer(fake.inbox, {
            _tag: 'Welcome',
            you: host.id,
            lobby: lobby('waiting', [host]),
          });
          yield* Queue.offer(fake.inbox, {
            _tag: 'Signal',
            from: guest.id,
            signal: { _tag: 'Answer', sdp: '' },
          });
          yield* Queue.offer(fake.inbox, {
            _tag: 'MatchStarted',
            lobby: lobby('playing'),
          });
          yield* Machine.waitFor(ref, at('Session.InLobby.Playing'));
          yield* Effect.yieldNow;
          assert.deepStrictEqual(yield* Ref.get(fake.matches), {
            started: 1,
            stopped: 0,
          });
          yield* Queue.offer(fake.inbox, {
            _tag: 'LobbyUpdated',
            lobby: lobby('waiting'),
          });
          yield* Machine.waitFor(ref, at('Session.InLobby.Waiting'));
          assert.deepStrictEqual(yield* Ref.get(fake.matches), {
            started: 1,
            stopped: 1,
          });
          yield* ref.send(leave);
          yield* Machine.waitFor(ref, at('Idle'));
          yield* Effect.yieldNow;
          assert.strictEqual(yield* Ref.get(fake.open), 0);
        }).pipe(Effect.provide(fake.layer));
      }),
  );

  it.effect('a socket that fails or closes ends the session', () =>
    Effect.gen(function* () {
      const fake = yield* fakeLobby;
      yield* Effect.gen(function* () {
        const ref = yield* Machine.start(LobbyMachine);
        yield* ref.send(join());
        yield* Machine.waitFor(ref, at('Session.Connecting'));
        yield* Queue.fail(
          fake.inbox,
          LobbyConnectionError.make({ cause: 'refused' }),
        );
        const failed = yield* Machine.waitFor(ref, at('Ended.Failed'));
        assert.deepStrictEqual(
          failureOf(failed.state),
          Option.some({
            request: 'Join' as const,
            reason: 'Unreachable' as const,
          }),
        );
      }).pipe(Effect.provide(fake.layer));

      const closing = yield* fakeLobby;
      yield* Effect.gen(function* () {
        const ref = yield* Machine.start(LobbyMachine);
        yield* ref.send(join());
        yield* Queue.offer(closing.inbox, {
          _tag: 'Welcome',
          you: guest.id,
          lobby: lobby('waiting'),
        });
        yield* Machine.waitFor(ref, at('Session.InLobby.Waiting'));
        yield* Queue.end(closing.inbox);
        yield* Machine.waitFor(ref, at('Ended.Lost'));
        yield* Effect.yieldNow;
        assert.strictEqual(yield* Ref.get(closing.open), 0);
      }).pipe(Effect.provide(closing.layer));
    }),
  );

  it.effect('gives up when the server does not answer in time', () =>
    Effect.gen(function* () {
      const fake = yield* fakeLobby;
      yield* Effect.gen(function* () {
        const ref = yield* Machine.start(LobbyMachine);
        yield* ref.send(create);
        yield* Machine.waitFor(ref, at('Session.Connecting'));
        yield* TestClock.adjust('9 seconds');
        assert.isTrue(
          LobbyStates.matches(yield* ref.state, 'Session.Connecting'),
        );
        yield* TestClock.adjust('1 second');
        const failed = yield* Machine.waitFor(ref, at('Ended.Failed'));
        assert.deepStrictEqual(
          failureOf(failed.state),
          Option.some({
            request: 'Create' as const,
            reason: 'TimedOut' as const,
          }),
        );
        yield* Effect.yieldNow;
        assert.strictEqual(yield* Ref.get(fake.open), 0);
      }).pipe(Effect.provide(fake.layer));
    }),
  );
});
