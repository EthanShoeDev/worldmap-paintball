import { assert, describe, it } from '@effect/vitest';
import {
  ClientMessage,
  ClientMessageJson,
  LobbyCode,
  makeLobbyCode,
  MAX_PLAYERS,
  type PlayerId,
  type ServerMessage,
} from '@worldmap-paintball/api-contract/lobby';
import { Array, Effect, Exit, Schema } from 'effect';

import { disconnect, reduce, type Step } from '../src/lobby/reducer.ts';

const Client = ClientMessage.cases;
const raleigh = { lat: 35.7796, lon: -78.6382, label: 'Raleigh' };
const toronto = { lat: 43.6532, lon: -79.3832, label: 'Toronto, ON' };
const offer = { _tag: 'Offer', sdp: 'v=0' } as const;

const run = (
  messages: ReadonlyArray<readonly [PlayerId, ClientMessage]>,
): Step =>
  Array.reduce(
    messages,
    { lobby: undefined, outbox: [] } as Step,
    (step, [from, message]) => reduce(step.lobby, from, message),
  );

const hostWithGuests = (count: number) =>
  run([
    ['host', Client.CreateLobby.make({ name: 'Host', location: raleigh })],
    // `Array.makeBy` always yields at least one element.
    ...Array.take(
      Array.makeBy(
        Math.max(count, 1),
        (i) => [`p${i}`, Client.JoinLobby.make({ name: `P${i}` })] as const,
      ),
      count,
    ),
  ]);

const sentTo = (step: Step, to: PlayerId) =>
  Array.map(
    Array.filter(step.outbox, (envelope) => envelope.to === to),
    (envelope) => envelope.message,
  );

const rejection = (step: Step, to: PlayerId) => {
  const [message] = sentTo(step, to);
  return message?._tag === 'Rejected' ? message.reason : undefined;
};

const tags = (messages: ReadonlyArray<ServerMessage>) =>
  Array.map(messages, (message) => message._tag);

describe('lobby reducer', () => {
  it('creates a lobby with the creator as host', () => {
    const step = hostWithGuests(0);
    assert.strictEqual(step.lobby?.hostId, 'host');
    assert.deepStrictEqual(step.lobby?.location, raleigh);
    assert.deepStrictEqual(tags(sentTo(step, 'host')), ['Welcome']);
  });

  it('rejects creating over an existing lobby', () => {
    const lobby = hostWithGuests(0).lobby;
    const step = reduce(
      lobby,
      'other',
      Client.CreateLobby.make({ name: 'Other', location: raleigh }),
    );
    assert.strictEqual(rejection(step, 'other'), 'LobbyExists');
    assert.strictEqual(step.lobby, lobby);
  });

  it('rejects joining a lobby that does not exist', () => {
    const step = reduce(undefined, 'p0', Client.JoinLobby.make({ name: 'P0' }));
    assert.strictEqual(rejection(step, 'p0'), 'LobbyNotFound');
  });

  it('welcomes a joiner and tells everyone else', () => {
    const before = hostWithGuests(1);
    const step = reduce(
      before.lobby,
      'p1',
      Client.JoinLobby.make({ name: 'P1' }),
    );
    assert.deepStrictEqual(
      Array.map(step.lobby?.players ?? [], (player) => player.id),
      ['host', 'p0', 'p1'],
    );
    assert.deepStrictEqual(tags(sentTo(step, 'p1')), ['Welcome']);
    assert.deepStrictEqual(tags(sentTo(step, 'host')), ['LobbyUpdated']);
    assert.deepStrictEqual(tags(sentTo(step, 'p0')), ['LobbyUpdated']);
  });

  it('rejects duplicate names case-insensitively', () => {
    const step = reduce(
      hostWithGuests(1).lobby,
      'p1',
      Client.JoinLobby.make({ name: 'host' }),
    );
    assert.strictEqual(rejection(step, 'p1'), 'NameTaken');
    assert.strictEqual(step.lobby?.players.length, 2);
  });

  it('rejects joining twice from the same connection', () => {
    const step = reduce(
      hostWithGuests(1).lobby,
      'p0',
      Client.JoinLobby.make({ name: 'Again' }),
    );
    assert.strictEqual(rejection(step, 'p0'), 'AlreadyInLobby');
  });

  it(`caps the lobby at ${MAX_PLAYERS} players`, () => {
    const full = hostWithGuests(MAX_PLAYERS - 1);
    assert.strictEqual(full.lobby?.players.length, MAX_PLAYERS);
    const step = reduce(
      full.lobby,
      'late',
      Client.JoinLobby.make({ name: 'Late' }),
    );
    assert.strictEqual(rejection(step, 'late'), 'LobbyFull');
  });

  it('only lets the host start, once every guest is ready', () => {
    const lobby = hostWithGuests(2).lobby;
    const byGuest = reduce(lobby, 'p0', Client.StartMatch.make({}));
    assert.strictEqual(rejection(byGuest, 'p0'), 'NotHost');

    const unready = reduce(lobby, 'host', Client.StartMatch.make({}));
    assert.strictEqual(rejection(unready, 'host'), 'PlayersNotReady');

    const ready = Array.reduce(
      ['p0', 'p1'],
      { lobby, outbox: [] } as Step,
      (step, id) =>
        reduce(step.lobby, id, Client.SetReady.make({ ready: true })),
    );
    const step = reduce(ready.lobby, 'host', Client.StartMatch.make({}));
    assert.strictEqual(step.lobby?.phase, 'playing');
    for (const id of ['host', 'p0', 'p1']) {
      const [message] = sentTo(step, id);
      assert.strictEqual(message?._tag, 'MatchStarted');
      if (message?._tag === 'MatchStarted') {
        assert.deepStrictEqual(message.lobby.location, raleigh);
      }
    }
  });

  it('resets readiness when the host moves the lobby', () => {
    const ready = reduce(
      hostWithGuests(1).lobby,
      'p0',
      Client.SetReady.make({ ready: true }),
    );
    const charlotte = { lat: 35.2271, lon: -80.8431 };
    const byGuest = reduce(
      ready.lobby,
      'p0',
      Client.SetLocation.make({ location: charlotte }),
    );
    assert.strictEqual(rejection(byGuest, 'p0'), 'NotHost');
    const moved = reduce(
      ready.lobby,
      'host',
      Client.SetLocation.make({ location: charlotte }),
    );
    assert.deepStrictEqual(moved.lobby?.location, charlotte);
    assert.isFalse(moved.lobby?.players[1]?.ready);
  });

  it('lets only the host change map settings, keeping readiness', () => {
    const ready = reduce(
      hostWithGuests(1).lobby,
      'p0',
      Client.SetReady.make({ ready: true }),
    );
    const house = {
      footprint: [
        [0, 0],
        [8, 0],
        [8, 10],
      ] as const,
      height: 6,
    };
    const map = {
      size: 'large' as const,
      shape: 'circle' as const,
      elevationScale: 2,
      buildings: [house],
    };
    const byGuest = reduce(
      ready.lobby,
      'p0',
      Client.SetMapSettings.make({ map }),
    );
    assert.strictEqual(rejection(byGuest, 'p0'), 'NotHost');
    const changed = reduce(
      ready.lobby,
      'host',
      Client.SetMapSettings.make({ map }),
    );
    assert.deepStrictEqual(changed.lobby?.map, map);
    assert.isTrue(changed.lobby?.players[1]?.ready);
    assert.deepStrictEqual(tags(sentTo(changed, 'p0')), ['LobbyUpdated']);
    const moved = reduce(
      changed.lobby,
      'host',
      Client.SetLocation.make({ location: { lat: 35.2271, lon: -80.8431 } }),
    );
    assert.deepStrictEqual(moved.lobby?.map, {
      size: 'large',
      shape: 'circle',
      elevationScale: 2,
      buildings: [],
    });
  });

  it('lets only the host set the bots', () => {
    const lobby = hostWithGuests(1).lobby;
    const byGuest = reduce(lobby, 'p0', Client.SetBots.make({ bots: 3 }));
    assert.strictEqual(rejection(byGuest, 'p0'), 'NotHost');
    const set = reduce(lobby, 'host', Client.SetBots.make({ bots: 3 }));
    assert.strictEqual(set.lobby?.bots, 3);
    assert.deepStrictEqual(tags(sentTo(set, 'p0')), ['LobbyUpdated']);
  });

  it('pins the host bake until the arena changes', () => {
    const lobby = hostWithGuests(1).lobby;
    const byGuest = reduce(lobby, 'p0', Client.PinBake.make({ bake: 'abc' }));
    assert.strictEqual(rejection(byGuest, 'p0'), 'NotHost');
    const pinned = reduce(lobby, 'host', Client.PinBake.make({ bake: 'abc' }));
    assert.strictEqual(pinned.lobby?.bake, 'abc');
    const map = pinned.lobby?.map;
    assert.isDefined(map);
    const steeper = reduce(
      pinned.lobby,
      'host',
      Client.SetMapSettings.make({ map: { ...map, elevationScale: 2 } }),
    );
    assert.strictEqual(steeper.lobby?.bake, 'abc');
    const larger = reduce(
      pinned.lobby,
      'host',
      Client.SetMapSettings.make({ map: { ...map, size: 'large' } }),
    );
    assert.isUndefined(larger.lobby?.bake);
    const moved = reduce(
      pinned.lobby,
      'host',
      Client.SetLocation.make({ location: { lat: 35.2271, lon: -80.8431 } }),
    );
    assert.isUndefined(moved.lobby?.bake);
  });

  it('lets only the host set the match rules', () => {
    const lobby = hostWithGuests(1).lobby;
    const rules = {
      moveSpeed: 1.5,
      jumpHeight: 2,
      paintballSpeed: 0.75,
      revealPlayers: true,
    };
    const byGuest = reduce(lobby, 'p0', Client.SetRules.make({ rules }));
    assert.strictEqual(rejection(byGuest, 'p0'), 'NotHost');
    const set = reduce(lobby, 'host', Client.SetRules.make({ rules }));
    assert.deepStrictEqual(set.lobby?.rules, rules);
  });

  it('refuses to create a lobby outside coverage', () => {
    const step = reduce(
      undefined,
      'host',
      Client.CreateLobby.make({ name: 'Host', location: toronto }),
    );
    assert.isUndefined(step.lobby);
    assert.strictEqual(rejection(step, 'host'), 'OutsideCoverage');
  });

  it('refuses to move the lobby outside coverage', () => {
    const ready = reduce(
      hostWithGuests(1).lobby,
      'p0',
      Client.SetReady.make({ ready: true }),
    );
    const step = reduce(
      ready.lobby,
      'host',
      Client.SetLocation.make({ location: toronto }),
    );
    assert.strictEqual(rejection(step, 'host'), 'OutsideCoverage');
    assert.strictEqual(step.lobby, ready.lobby);
    assert.lengthOf(step.outbox, 1);
  });

  it('migrates the host to the earliest joiner while waiting', () => {
    const step = disconnect(hostWithGuests(2).lobby, 'host');
    assert.strictEqual(step.lobby?.hostId, 'p0');
    assert.deepStrictEqual(tags(sentTo(step, 'p0')), ['LobbyUpdated']);
    assert.deepStrictEqual(tags(sentTo(step, 'p1')), ['LobbyUpdated']);
  });

  it('closes the lobby when the host leaves mid-match', () => {
    const started = reduce(
      reduce(
        hostWithGuests(1).lobby,
        'p0',
        Client.SetReady.make({ ready: true }),
      ).lobby,
      'host',
      Client.StartMatch.make({}),
    );
    const step = reduce(started.lobby, 'host', Client.LeaveLobby.make({}));
    assert.isUndefined(step.lobby);
    assert.deepStrictEqual(sentTo(step, 'p0'), [
      { _tag: 'LobbyClosed', reason: 'HostLeft' },
    ]);
  });

  it('drops the lobby when the last player leaves', () => {
    assert.isUndefined(disconnect(hostWithGuests(0).lobby, 'host').lobby);
  });

  it('ignores disconnects from sockets that never joined', () => {
    const lobby = hostWithGuests(1).lobby;
    const step = disconnect(lobby, 'stranger');
    assert.strictEqual(step.lobby, lobby);
    assert.lengthOf(step.outbox, 0);
  });

  it('relays signaling only between members', () => {
    const lobby = hostWithGuests(1).lobby;
    const relayed = reduce(
      lobby,
      'host',
      Client.Signal.make({ to: 'p0', signal: offer }),
    );
    assert.deepStrictEqual(relayed.outbox, [
      { to: 'p0', message: { _tag: 'Signal', from: 'host', signal: offer } },
    ]);

    const toStranger = reduce(
      lobby,
      'host',
      Client.Signal.make({ to: 'stranger', signal: offer }),
    );
    assert.strictEqual(rejection(toStranger, 'host'), 'UnknownPeer');

    const fromStranger = reduce(
      lobby,
      'stranger',
      Client.Signal.make({ to: 'p0', signal: offer }),
    );
    assert.strictEqual(rejection(fromStranger, 'stranger'), 'NotInLobby');
    assert.isEmpty(sentTo(fromStranger, 'p0'));

    const toSelf = reduce(
      lobby,
      'p0',
      Client.Signal.make({ to: 'p0', signal: offer }),
    );
    assert.strictEqual(rejection(toSelf, 'p0'), 'UnknownPeer');
  });

  it('relays signaling only along the host star', () => {
    const lobby = hostWithGuests(2).lobby;
    const answer = { _tag: 'Answer', sdp: 'v=0' } as const;
    const toHost = reduce(
      lobby,
      'p0',
      Client.Signal.make({ to: 'host', signal: answer }),
    );
    assert.deepStrictEqual(toHost.outbox, [
      { to: 'host', message: { _tag: 'Signal', from: 'p0', signal: answer } },
    ]);

    const toClient = reduce(
      lobby,
      'p0',
      Client.Signal.make({ to: 'p1', signal: offer }),
    );
    assert.strictEqual(rejection(toClient, 'p0'), 'PeerNotHost');
    assert.isEmpty(sentTo(toClient, 'p1'));

    // After migration the new host may signal everyone.
    const migrated = disconnect(lobby, 'host').lobby;
    const fromNewHost = reduce(
      migrated,
      'p0',
      Client.Signal.make({ to: 'p1', signal: offer }),
    );
    assert.deepStrictEqual(tags(sentTo(fromNewHost, 'p1')), ['Signal']);
  });

  it('returns to the lobby when the host ends the match', () => {
    const started = reduce(
      reduce(
        hostWithGuests(1).lobby,
        'p0',
        Client.SetReady.make({ ready: true }),
      ).lobby,
      'host',
      Client.StartMatch.make({}),
    );
    const ended = reduce(started.lobby, 'host', Client.EndMatch.make({}));
    assert.strictEqual(ended.lobby?.phase, 'waiting');
    assert.isFalse(ended.lobby?.players[1]?.ready);
  });
});

describe('lobby protocol', () => {
  it.effect('generates codes that the schema accepts', () =>
    Effect.gen(function* () {
      const code = yield* makeLobbyCode;
      assert.isTrue(Schema.is(LobbyCode)(code));
    }),
  );

  it.effect('decodes client messages from JSON', () =>
    Effect.gen(function* () {
      const message = yield* Schema.decodeEffect(ClientMessageJson)(
        '{"_tag":"JoinLobby","name":"Ada"}',
      );
      assert.deepStrictEqual(message, Client.JoinLobby.make({ name: 'Ada' }));
    }),
  );

  it('rejects names that are blank, untrimmed or too long', () => {
    const decode = Schema.decodeUnknownExit(ClientMessage);
    for (const name of ['', ' Ada', 'Seventeen chars!!']) {
      assert.isTrue(Exit.isFailure(decode({ _tag: 'JoinLobby', name })));
    }
  });
});
