import { isCovered } from '@worldmap-paintball/api-contract/coverage';
import {
  ClientMessage,
  type Lobby,
  MAX_PLAYERS,
  type PlayerId,
  type RejectReason,
  ServerMessage,
} from '@worldmap-paintball/api-contract/lobby';
import { Array, String } from 'effect';

export interface Envelope {
  readonly to: PlayerId;
  readonly message: ServerMessage;
}

export interface Step {
  readonly lobby: Lobby | undefined;
  readonly outbox: ReadonlyArray<Envelope>;
}

const Server = ServerMessage.cases;

const reject = (
  lobby: Lobby | undefined,
  to: PlayerId,
  reason: RejectReason,
): Step => ({
  lobby,
  outbox: [{ to, message: Server.Rejected.make({ reason }) }],
});

const broadcast = (lobby: Lobby, message: ServerMessage) =>
  Array.map(lobby.players, (player): Envelope => ({ to: player.id, message }));

const updated = (lobby: Lobby): Step => ({
  lobby,
  outbox: broadcast(lobby, Server.LobbyUpdated.make({ lobby })),
});

const welcome = (lobby: Lobby, you: PlayerId): Envelope => ({
  to: you,
  message: Server.Welcome.make({ you, lobby }),
});

const isMember = (lobby: Lobby, id: PlayerId) =>
  Array.some(lobby.players, (player) => player.id === id);

const unready = (lobby: Lobby): Lobby => ({
  ...lobby,
  players: Array.map(lobby.players, (player) => ({ ...player, ready: false })),
});

const leave = (lobby: Lobby, from: PlayerId): Step => {
  const players = Array.filter(lobby.players, (player) => player.id !== from);
  const [nextHost] = players;
  if (nextHost === undefined) return { lobby: undefined, outbox: [] };
  if (from !== lobby.hostId) return updated({ ...lobby, players });
  // Mid-match the host's machine is the game server, so its state is gone.
  if (lobby.phase === 'playing') {
    const closed = Server.LobbyClosed.make({ reason: 'HostLeft' });
    return {
      lobby: undefined,
      outbox: Array.map(players, (player) => ({
        to: player.id,
        message: closed,
      })),
    };
  }
  return updated({ ...lobby, players, hostId: nextHost.id });
};

const join = (lobby: Lobby, from: PlayerId, name: string): Step => {
  if (lobby.phase === 'playing') return reject(lobby, from, 'MatchInProgress');
  if (lobby.players.length >= MAX_PLAYERS) {
    return reject(lobby, from, 'LobbyFull');
  }
  const taken = String.toLowerCase(name);
  if (
    Array.some(
      lobby.players,
      (player) => String.toLowerCase(player.name) === taken,
    )
  ) {
    return reject(lobby, from, 'NameTaken');
  }
  const next: Lobby = {
    ...lobby,
    players: [...lobby.players, { id: from, name, ready: false }],
  };
  return {
    lobby: next,
    outbox: [
      welcome(next, from),
      ...broadcast(lobby, Server.LobbyUpdated.make({ lobby: next })),
    ],
  };
};

const hostOnly = (lobby: Lobby, from: PlayerId, step: () => Step) =>
  from === lobby.hostId ? step() : reject(lobby, from, 'NotHost');

const whileWaiting = (lobby: Lobby, from: PlayerId, step: () => Step) =>
  lobby.phase === 'waiting' ? step() : reject(lobby, from, 'MatchInProgress');

const asMember = (lobby: Lobby, from: PlayerId, message: ClientMessage) =>
  ClientMessage.match(message, {
    CreateLobby: () => reject(lobby, from, 'AlreadyInLobby'),
    JoinLobby: () => reject(lobby, from, 'AlreadyInLobby'),
    LeaveLobby: () => leave(lobby, from),
    SetReady: ({ ready }) =>
      whileWaiting(lobby, from, () =>
        updated({
          ...lobby,
          players: Array.map(lobby.players, (player) =>
            player.id === from ? { ...player, ready } : player,
          ),
        }),
      ),
    Signal: ({ to, signal }): Step => {
      if (to === from || !isMember(lobby, to)) {
        return reject(lobby, from, 'UnknownPeer');
      }
      // Star topology: clients only ever connect to the host.
      if (from !== lobby.hostId && to !== lobby.hostId) {
        return reject(lobby, from, 'PeerNotHost');
      }
      return {
        lobby,
        outbox: [{ to, message: Server.Signal.make({ from, signal }) }],
      };
    },
    SetLocation: ({ location }) =>
      hostOnly(lobby, from, () =>
        whileWaiting(lobby, from, () =>
          isCovered(location.lat, location.lon)
            ? // Players agreed to a place; a new place needs a fresh agreement.
              updated(unready({ ...lobby, location }))
            : reject(lobby, from, 'OutsideCoverage'),
        ),
      ),
    StartMatch: () =>
      hostOnly(lobby, from, () =>
        whileWaiting(lobby, from, () => {
          const everyoneReady = Array.every(
            lobby.players,
            (player) => player.id === lobby.hostId || player.ready,
          );
          if (!everyoneReady) return reject(lobby, from, 'PlayersNotReady');
          const started: Lobby = { ...lobby, phase: 'playing' };
          return {
            lobby: started,
            outbox: broadcast(
              started,
              Server.MatchStarted.make({ lobby: started }),
            ),
          };
        }),
      ),
    EndMatch: () =>
      hostOnly(lobby, from, () =>
        lobby.phase === 'playing'
          ? updated(unready({ ...lobby, phase: 'waiting' }))
          : reject(lobby, from, 'MatchNotStarted'),
      ),
  });

const asOutsider = (lobby: Lobby, from: PlayerId, message: ClientMessage) =>
  ClientMessage.matchOrElse(
    message,
    {
      CreateLobby: () => reject(lobby, from, 'LobbyExists'),
      JoinLobby: ({ name }) => join(lobby, from, name),
    },
    () => reject(lobby, from, 'NotInLobby'),
  );

const create = (from: PlayerId, message: ClientMessage) =>
  ClientMessage.matchOrElse(
    message,
    {
      CreateLobby: ({ name, location }): Step => {
        if (!isCovered(location.lat, location.lon)) {
          return reject(undefined, from, 'OutsideCoverage');
        }
        const created: Lobby = {
          phase: 'waiting',
          hostId: from,
          players: [{ id: from, name, ready: false }],
          location,
        };
        return { lobby: created, outbox: [welcome(created, from)] };
      },
      JoinLobby: () => reject(undefined, from, 'LobbyNotFound'),
    },
    () => reject(undefined, from, 'NotInLobby'),
  );

export const reduce = (
  lobby: Lobby | undefined,
  from: PlayerId,
  message: ClientMessage,
): Step => {
  if (lobby === undefined) return create(from, message);
  return isMember(lobby, from)
    ? asMember(lobby, from, message)
    : asOutsider(lobby, from, message);
};

// The transport calls this when a socket closes or errors; it is never sent
// over the wire.
export const disconnect = (lobby: Lobby | undefined, from: PlayerId): Step =>
  lobby !== undefined && isMember(lobby, from)
    ? leave(lobby, from)
    : { lobby, outbox: [] };
