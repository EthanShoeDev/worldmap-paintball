import { Array, Effect, Schema, String } from 'effect';
import { SecureRandom } from 'effect/crypto';

export const MAX_PLAYERS = 8;

// No I, O, 0 or 1: codes get read aloud and typed on phones.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export const LobbyCode = Schema.String.check(
  Schema.isPattern(/^[A-HJ-NP-Z2-9]{6}$/),
);

// 256 is a multiple of the alphabet size, so `byte % 32` stays uniform.
export const makeLobbyCode = Effect.sync(() =>
  Array.join(
    Array.map(
      Array.fromIterable(SecureRandom.randomBytesUnsafe(CODE_LENGTH)),
      (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length] ?? '',
    ),
    '',
  ),
);

export const normalizeLobbyCode = (input: string) =>
  String.toUpperCase(String.trim(input));

export const PlayerId = Schema.String.check(Schema.isBetweenLength(1, 64));
export type PlayerId = typeof PlayerId.Type;

export const PlayerName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isBetweenLength(1, 16),
);

// Same bounds as `GET /arenas`. The lobby also refuses places outside
// ./coverage, so a lobby location always bakes.
export const Location = Schema.Struct({
  lat: Schema.Finite.check(Schema.isBetween({ minimum: -85, maximum: 85 })),
  lon: Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  label: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(120))),
});
export type Location = typeof Location.Type;

export const Player = Schema.Struct({
  id: PlayerId,
  name: PlayerName,
  ready: Schema.Boolean,
});
export type Player = typeof Player.Type;

// `players` is in join order; host migration promotes the earliest joiner.
export const Lobby = Schema.Struct({
  phase: Schema.Literals(['waiting', 'playing']),
  hostId: PlayerId,
  players: Schema.Array(Player).check(Schema.isMaxLength(MAX_PLAYERS)),
  location: Location,
});
export type Lobby = typeof Lobby.Type;

const Sdp = Schema.String.check(Schema.isMaxLength(32_768));

export const SignalPayload = Schema.TaggedUnion({
  Offer: { sdp: Sdp },
  Answer: { sdp: Sdp },
  IceCandidate: {
    candidate: Schema.String.check(Schema.isMaxLength(1024)),
    sdpMid: Schema.NullOr(Schema.String),
    sdpMLineIndex: Schema.NullOr(Schema.Int),
    usernameFragment: Schema.NullOr(Schema.String),
  },
});
export type SignalPayload = typeof SignalPayload.Type;

export const ClientMessage = Schema.TaggedUnion({
  CreateLobby: { name: PlayerName, location: Location },
  JoinLobby: { name: PlayerName },
  LeaveLobby: {},
  SetLocation: { location: Location },
  SetReady: { ready: Schema.Boolean },
  StartMatch: {},
  EndMatch: {},
  Signal: { to: PlayerId, signal: SignalPayload },
});
export type ClientMessage = typeof ClientMessage.Type;

export const RejectReason = Schema.Literals([
  'LobbyExists',
  'LobbyNotFound',
  'LobbyFull',
  'NameTaken',
  'AlreadyInLobby',
  'NotInLobby',
  'NotHost',
  'PlayersNotReady',
  'MatchInProgress',
  'MatchNotStarted',
  'OutsideCoverage',
  'UnknownPeer',
  'PeerNotHost',
  'InvalidMessage',
]);
export type RejectReason = typeof RejectReason.Type;

export const ServerMessage = Schema.TaggedUnion({
  Welcome: { you: PlayerId, lobby: Lobby },
  LobbyUpdated: { lobby: Lobby },
  MatchStarted: { lobby: Lobby },
  LobbyClosed: { reason: Schema.Literals(['HostLeft']) },
  Signal: { from: PlayerId, signal: SignalPayload },
  Rejected: { reason: RejectReason },
});
export type ServerMessage = typeof ServerMessage.Type;

export const ClientMessageJson = Schema.fromJsonString(ClientMessage);
export const ServerMessageJson = Schema.fromJsonString(ServerMessage);

export const lobbySocketPath = (code: string) => `/lobbies/${code}/ws`;
