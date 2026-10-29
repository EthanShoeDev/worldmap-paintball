import { assert, describe, it } from '@effect/vitest';
import type { Lobby } from '@worldmap-paintball/api/lobby/protocol';

import { lobbyMatchCode, matchStatus } from '../src/game/net/session.ts';
import { idleSession, type LobbySession } from '../src/lobby/lobby-client.ts';

const lobby: Lobby = {
  phase: 'playing',
  hostId: 'host',
  players: [{ id: 'host', name: 'Host', ready: false }],
  location: { lat: 51.5, lon: -0.12 },
};

const session = (overrides: Partial<LobbySession> = {}): LobbySession => ({
  ...idleSession,
  status: 'connected',
  code: 'ABC234',
  you: 'host',
  lobby,
  ...overrides,
});

describe('lobbyMatchCode', () => {
  it('joins a running match at the same location', () => {
    assert.strictEqual(
      lobbyMatchCode(session(), { lat: 51.5, lon: -0.12 }),
      'ABC234',
    );
  });

  it('is solo practice anywhere else', () => {
    assert.isUndefined(lobbyMatchCode(session(), { lat: 51.5, lon: -0.13 }));
    assert.isUndefined(
      lobbyMatchCode(session({ lobby: { ...lobby, phase: 'waiting' } }), {
        lat: 51.5,
        lon: -0.12,
      }),
    );
    assert.isUndefined(lobbyMatchCode(idleSession, { lat: 51.5, lon: -0.12 }));
  });
});

describe('matchStatus', () => {
  it('is playing while the lobby is', () => {
    assert.strictEqual(matchStatus(session(), 'ABC234'), 'playing');
  });

  it('has ended once the lobby is waiting again', () => {
    assert.strictEqual(
      matchStatus(session({ lobby: { ...lobby, phase: 'waiting' } }), 'ABC234'),
      'ended',
    );
  });

  it('is closed when the host left, the socket dropped or we left', () => {
    assert.strictEqual(
      matchStatus(session({ lobby: undefined, closed: 'HostLeft' }), 'ABC234'),
      'closed',
    );
    assert.strictEqual(
      matchStatus(session({ status: 'disconnected' }), 'ABC234'),
      'closed',
    );
    assert.strictEqual(matchStatus(idleSession, 'ABC234'), 'closed');
  });
});
