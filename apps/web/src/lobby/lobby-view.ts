import { Option } from 'effect';

import { type LobbySnapshot, LobbyStates } from './lobby-machine.ts';

const sessionCode = (snapshot: LobbySnapshot) =>
  Option.map(LobbyStates.get(snapshot, 'Session'), ({ code }) => code);

const endedCode = (snapshot: LobbySnapshot) =>
  Option.map(LobbyStates.get(snapshot, 'Ended'), ({ code }) => code);

// Each reader takes the page's code: a session for another code is not this
// page's business.

export const connectingFor = (snapshot: LobbySnapshot, code: string) =>
  LobbyStates.matches(snapshot, 'Session.Connecting') &&
  Option.contains(sessionCode(snapshot), code);

export const inLobbyFor = (snapshot: LobbySnapshot, code: string) =>
  Option.contains(sessionCode(snapshot), code)
    ? LobbyStates.get(snapshot, 'Session.InLobby')
    : Option.none();

export const failureFor = (snapshot: LobbySnapshot, code: string) =>
  Option.contains(endedCode(snapshot), code)
    ? LobbyStates.get(snapshot, 'Ended.Failed')
    : Option.none();

export const endedFor = (snapshot: LobbySnapshot, code: string) =>
  Option.contains(endedCode(snapshot), code);

export const activeLobbyCode = (snapshot: LobbySnapshot) =>
  LobbyStates.matches(snapshot, 'Session.InLobby')
    ? sessionCode(snapshot)
    : Option.none();
