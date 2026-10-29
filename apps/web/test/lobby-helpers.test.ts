import { assert, describe, it } from '@effect/vitest';
import {
  type Lobby,
  defaultMapSettings,
  defaultMatchRules,
} from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr, String as Str } from 'effect';

import {
  canStartMatch,
  cleanLobbyCode,
  isCompleteLobbyCode,
  toLobbyLocation,
} from '../src/components/lobby-helpers.ts';

describe('cleanLobbyCode', () => {
  it('uppercases and strips spaces and dashes', () => {
    assert.strictEqual(cleanLobbyCode(' ab c-de f '), 'ABCDEF');
  });

  it('drops characters outside the code alphabet', () => {
    assert.strictEqual(cleanLobbyCode('AIO01B'), 'AB');
  });

  it('caps the code at six characters', () => {
    assert.strictEqual(cleanLobbyCode('ABCDEFGH'), 'ABCDEF');
  });

  it('extracts the code from a pasted invite link', () => {
    assert.strictEqual(
      cleanLobbyCode('https://example.com/lobby/xk7p2q'),
      'XK7P2Q',
    );
  });

  it('only accepts six characters as complete', () => {
    assert.isTrue(isCompleteLobbyCode('XK7P2Q'));
    assert.isFalse(isCompleteLobbyCode('XK7P2'));
  });
});

const lobby = (ready: ReadonlyArray<boolean>): Lobby => ({
  phase: 'waiting',
  hostId: 'host',
  location: { lat: 0, lon: 0 },
  map: defaultMapSettings,
  bots: 0,
  rules: defaultMatchRules,
  players: [
    { id: 'host', name: 'Host', ready: false },
    ...Arr.map(ready, (flag, index) => ({
      id: `p${index}`,
      name: `P${index}`,
      ready: flag,
    })),
  ],
});

describe('canStartMatch', () => {
  it('ignores the host ready flag', () => {
    assert.isTrue(canStartMatch(lobby([])));
  });

  it('needs every other player ready', () => {
    assert.isTrue(canStartMatch(lobby([true, true])));
    assert.isFalse(canStartMatch(lobby([true, false])));
  });
});

describe('toLobbyLocation', () => {
  it('rounds coordinates and truncates long labels', () => {
    const location = toLobbyLocation({
      lat: 51.500_712_34,
      lon: -0.124_6,
      label: Str.repeat(200)('x'),
    });
    assert.strictEqual(location.lat, 51.500_712);
    assert.strictEqual(location.lon, -0.124_6);
    assert.strictEqual(location.label.length, 120);
  });
});
