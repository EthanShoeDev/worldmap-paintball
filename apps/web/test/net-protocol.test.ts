import { assert, describe, it } from '@effect/vitest';
import { Effect, Option, Schema } from 'effect';

import {
  decodeNetEvent,
  decodePlayerState,
  decodeWorldSnapshot,
  encodeNetEvent,
  encodePlayerState,
  encodeWorldSnapshot,
  Net,
  type NetEvent,
  type PlayerState,
  type WorldSnapshot,
} from '../src/game/net/protocol.ts';

// What `PeerNetwork` does to a message: JSON out, JSON back in.
const Json = Schema.fromJsonString(Schema.Unknown);
const overTheWire = (value: unknown) =>
  Effect.flatMap(Schema.encodeEffect(Json)(value), Schema.decodeEffect(Json));

const state: PlayerState = {
  position: [1.5, 1.35, -20],
  velocity: [0, -0.2, 4.5],
  yaw: -7.1,
  pitch: 0.3,
  firing: true,
  weapon: 'shotgun',
};

const world: WorldSnapshot = {
  players: [
    { id: 'host', ...state, alive: true },
    { id: 'guest', ...state, position: [3, 1, 3], firing: false, alive: false },
  ],
  scores: [
    { id: 'host', score: 2, deaths: 0 },
    { id: 'guest', score: 0, deaths: 2 },
  ],
};

const events: ReadonlyArray<NetEvent> = [
  Net.Shot.make({
    shooter: 'a',
    origin: [0, 2, 0],
    dir: [0, 0, -1],
    weapon: 'assault',
    seed: 42,
  }),
  Net.Hit.make({
    shooter: 'a',
    target: 'b',
    point: [0, 1.5, -8],
    weapon: 'assault',
  }),
  Net.Eliminated.make({ shooter: 'a', target: 'b', respawnInMs: 3000 }),
  Net.Scored.make({ scores: world.scores }),
  Net.Respawn.make({ player: 'b', position: [10, 1.35, 4] }),
  Net.MatchEnded.make({ scores: world.scores }),
];

describe('net protocol', () => {
  it.effect('round-trips a player state', () =>
    Effect.gen(function* () {
      const wire = yield* overTheWire(yield* encodePlayerState(state));
      assert.deepStrictEqual(
        yield* decodePlayerState(wire),
        Option.some(state),
      );
    }),
  );

  it.effect('round-trips a world snapshot', () =>
    Effect.gen(function* () {
      const wire = yield* overTheWire(yield* encodeWorldSnapshot(world));
      assert.deepStrictEqual(
        yield* decodeWorldSnapshot(wire),
        Option.some(world),
      );
    }),
  );

  it.effect('round-trips every event', () =>
    Effect.gen(function* () {
      for (const event of events) {
        const wire = yield* overTheWire(yield* encodeNetEvent(event));
        assert.deepStrictEqual(yield* decodeNetEvent(wire), Option.some(event));
      }
    }),
  );

  it.effect('drops malformed messages instead of failing', () =>
    Effect.gen(function* () {
      const bad: ReadonlyArray<unknown> = [
        null,
        'hello',
        { ...state, position: [1, 2] },
        { ...state, yaw: 'left' },
        { ...state, firing: undefined },
        { ...state, weapon: 'bazooka' },
        { ...state, weapon: undefined },
      ];
      for (const message of bad) {
        assert.isTrue(Option.isNone(yield* decodePlayerState(message)));
      }
      assert.isTrue(
        Option.isNone(
          yield* decodeNetEvent({ _tag: 'Teleport', to: [0, 0, 0] }),
        ),
      );
      assert.isTrue(
        Option.isNone(
          yield* decodeNetEvent({ _tag: 'Hit', shooter: 'a', target: 'b' }),
        ),
      );
      assert.isTrue(
        Option.isNone(
          yield* decodeNetEvent({
            _tag: 'Shot',
            shooter: 'a',
            origin: [0, 2, 0],
            dir: [0, 0, -1],
            weapon: 'bazooka',
            seed: 1,
          }),
        ),
      );
      assert.isTrue(
        Option.isNone(
          yield* decodeNetEvent({
            _tag: 'Shot',
            shooter: 'a',
            origin: [0, 2, 0],
            dir: [0, 0, -1],
            seed: 1,
          }),
        ),
      );
      assert.isTrue(
        Option.isNone(
          yield* decodeWorldSnapshot({ players: [{ id: 'x' }], scores: [] }),
        ),
      );
    }),
  );

  it.effect('rejects non-finite numbers, which JSON cannot carry', () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        encodePlayerState({ ...state, position: [Number.NaN, 0, 0] }),
      );
      assert.strictEqual(result._tag, 'Failure');
    }),
  );
});
