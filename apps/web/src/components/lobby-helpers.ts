import type {
  Lobby,
  RejectReason,
} from '@worldmap-paintball/api/lobby/protocol';
import { Array as Arr, Cause, Option, String as Str } from 'effect';

import type {
  LobbyConnectionError,
  LobbyNotConnectedError,
  LobbyRejectedError,
} from '../lobby/lobby-client.ts';

const codeLength = 6;
const notInAlphabet = /[^A-HJ-NP-Z2-9]/g;

// Drops spaces, dashes and the characters the protocol leaves out (I, O, 0, 1).
// Taking the last path segment lets people paste a whole invite link.
export const cleanLobbyCode = (input: string) =>
  Str.toUpperCase(input.slice(input.lastIndexOf('/') + 1))
    .replace(notInAlphabet, '')
    .slice(0, codeLength);

export const isCompleteLobbyCode = (code: string) => code.length === codeLength;

export const maxNameLength = 16;

const rejectionMessages: Record<RejectReason, string> = {
  LobbyExists: 'That lobby code is already in use. Try again.',
  LobbyNotFound: 'No lobby with that code. Check the code with your host.',
  LobbyFull: 'That lobby is full.',
  NameTaken: 'Someone in that lobby already has your name. Pick another.',
  AlreadyInLobby: 'You are already in this lobby.',
  NotInLobby: 'You are no longer in this lobby.',
  NotHost: 'Only the host can do that.',
  PlayersNotReady: 'Everyone needs to be ready before the match can start.',
  MatchInProgress:
    'A match is already running in that lobby. Try again after it ends.',
  MatchNotStarted: 'The match has not started yet.',
  UnknownPeer: 'That player is not in the lobby.',
  PeerNotHost: 'Players can only connect to the host.',
  InvalidMessage: 'The server did not accept that request.',
};

export const rejectionMessage = (reason: RejectReason) =>
  rejectionMessages[reason];

export const lobbyErrorMessage = (
  cause: Cause.Cause<
    LobbyConnectionError | LobbyRejectedError | LobbyNotConnectedError
  >,
) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => 'Something went wrong. Try again.',
    onSome: (error) => {
      switch (error._tag) {
        case 'LobbyRejectedError':
          return rejectionMessage(error.reason);
        case 'LobbyNotConnectedError':
          return 'You are not connected to the lobby.';
        case 'LobbyConnectionError':
          return 'Could not reach the lobby server.';
      }
    },
  });

export const canStartMatch = (lobby: Lobby) =>
  Arr.every(
    lobby.players,
    (player) => player.id === lobby.hostId || player.ready,
  );

const labelLength = 120;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

export const toLobbyLocation = (selection: {
  readonly lat: number;
  readonly lon: number;
  readonly label: string;
}) => ({
  lat: round(selection.lat),
  lon: round(selection.lon),
  label: selection.label.slice(0, labelLength),
});
