import { assert, describe, it } from '@effect/vitest';
import { MachineTest } from '@typeonce/effect-machine/testing';
import {
  type Lobby,
  defaultMapSettings,
  defaultMatchRules,
} from '@worldmap-paintball/api-contract/lobby';
import { Effect } from 'effect';

import { lobbyMatchCode, matchStatus } from '../src/game/net/session.ts';
import {
  type LobbyEvent,
  LobbyEvents,
  LobbyMachine,
} from '../src/lobby/lobby-machine.ts';

const lobby = (phase: Lobby['phase']): Lobby => ({
  phase,
  hostId: 'host',
  players: [{ id: 'host', name: 'Host', ready: false }],
  location: { lat: 51.5, lon: -0.12 },
  map: defaultMapSettings,
  bots: 0,
  rules: defaultMatchRules,
});

const after = (...events: ReadonlyArray<LobbyEvent>) =>
  Effect.map(MachineTest.run(LobbyMachine, { events }), (trace) => trace.final);

const inLobby = [
  LobbyEvents.Create({
    code: 'ABC234',
    name: 'Host',
    location: { lat: 51.5, lon: -0.12 },
  }),
  LobbyEvents.Welcomed({ you: 'host', lobby: lobby('waiting') }),
];
const playing = [
  ...inLobby,
  LobbyEvents.MatchStarted({ lobby: lobby('playing') }),
];

describe('lobbyMatchCode', () => {
  it.effect('joins a running match at the same location', () =>
    Effect.gen(function* () {
      const session = yield* after(...playing);
      assert.strictEqual(
        lobbyMatchCode(session, { lat: 51.5, lon: -0.12 }),
        'ABC234',
      );
    }),
  );

  it.effect('is solo practice anywhere else', () =>
    Effect.gen(function* () {
      const here = { lat: 51.5, lon: -0.12 };
      const elsewhere = yield* after(...playing);
      assert.isUndefined(lobbyMatchCode(elsewhere, { lat: 51.5, lon: -0.13 }));
      const waiting = yield* after(...inLobby);
      assert.isUndefined(lobbyMatchCode(waiting, here));
      const idle = yield* after();
      assert.isUndefined(lobbyMatchCode(idle, here));
    }),
  );
});

describe('matchStatus', () => {
  it.effect('is playing while the lobby is', () =>
    Effect.gen(function* () {
      const session = yield* after(...playing);
      assert.strictEqual(matchStatus(session, 'ABC234'), 'playing');
    }),
  );

  it.effect('has ended once the lobby is waiting again', () =>
    Effect.gen(function* () {
      const ended = yield* after(
        ...playing,
        LobbyEvents.LobbyUpdated({ lobby: lobby('waiting') }),
      );
      assert.strictEqual(matchStatus(ended, 'ABC234'), 'ended');
    }),
  );

  it.effect('is closed when the host left, the socket dropped or we left', () =>
    Effect.gen(function* () {
      for (const end of [
        LobbyEvents.LobbyClosed({ reason: 'HostLeft' }),
        LobbyEvents.Disconnected(),
        LobbyEvents.Leave(),
      ]) {
        const ended = yield* after(...playing, end);
        assert.strictEqual(matchStatus(ended, 'ABC234'), 'closed');
      }
      const otherMatch = yield* after(...playing);
      assert.strictEqual(matchStatus(otherMatch, 'XYZ789'), 'closed');
    }),
  );
});
