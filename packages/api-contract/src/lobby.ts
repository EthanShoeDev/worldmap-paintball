import { Array, Effect, Schema, String } from 'effect';
import { SecureRandom } from 'effect/crypto';

import { ArenaSize, BakeId } from './index.ts';

export const MAX_PLAYERS = 8;
// Bots the host's browser simulates alongside the players.
export const MAX_BOTS = 7;

export const BotCount = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_BOTS }),
);

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

export const MAX_DRAWN_BUILDINGS = 64;

// A house the host traced where the baked arena has none, in the arena's
// local metres (x east, z south), so it stays put only at this location.
export const DrawnBuilding = Schema.Struct({
  footprint: Schema.Array(
    Schema.Tuple([
      Schema.Finite.check(Schema.isBetween({ minimum: -500, maximum: 500 })),
      Schema.Finite.check(Schema.isBetween({ minimum: -500, maximum: 500 })),
    ]),
  ).check(Schema.isMinLength(3), Schema.isMaxLength(24)),
  height: Schema.Finite.check(Schema.isBetween({ minimum: 2, maximum: 40 })),
});
export type DrawnBuilding = typeof DrawnBuilding.Type;

// The host's changes to the baked arena. Clients apply them on top of the
// shared bake, so the server's arena cache stays one entry per place.
export const ArenaShape = Schema.Literals(['square', 'circle']);
export type ArenaShape = typeof ArenaShape.Type;

export const MapSettings = Schema.Struct({
  // Saved and stored settings from before sizes existed are medium.
  size: ArenaSize.pipe(Schema.withDecodingDefaultKey(Effect.succeed('medium'))),
  // A circle walls off the square bake's corners, where respawns and
  // campers otherwise gather.
  shape: ArenaShape.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('square')),
  ),
  elevationScale: Schema.Finite.check(
    Schema.isBetween({ minimum: 0, maximum: 5 }),
  ),
  buildings: Schema.Array(DrawnBuilding).check(
    Schema.isMaxLength(MAX_DRAWN_BUILDINGS),
  ),
});
export type MapSettings = typeof MapSettings.Type;

export const defaultMapSettings: MapSettings = {
  size: 'medium',
  shape: 'square',
  elevationScale: 1,
  buildings: [],
};

const Multiplier = (maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum }));

// Mutators the host sets for the match. Every member's game reads them from
// the lobby, so all browsers agree on movement and ball flight.
export const MatchRules = Schema.Struct({
  moveSpeed: Multiplier(2.5),
  jumpHeight: Multiplier(4),
  paintballSpeed: Multiplier(2.5),
  // Everyone on everyone's minimap, all match long.
  revealPlayers: Schema.Boolean,
});
export type MatchRules = typeof MatchRules.Type;

export const defaultMatchRules: MatchRules = {
  moveSpeed: 1,
  jumpHeight: 1,
  paintballSpeed: 1,
  revealPlayers: false,
};

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
  // Lobbies stored before these existed decode with the defaults.
  map: MapSettings.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(defaultMapSettings)),
  ),
  bots: BotCount.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  rules: MatchRules.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(defaultMatchRules)),
  ),
  // The bake of the arena the host sees, which every member fetches; absent
  // until the host's browser has one.
  bake: Schema.optionalKey(BakeId),
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
  SetMapSettings: { map: MapSettings },
  SetBots: { bots: BotCount },
  SetRules: { rules: MatchRules },
  PinBake: { bake: BakeId },
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
