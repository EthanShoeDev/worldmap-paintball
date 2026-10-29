import '@tanstack/react-start/client-only';
import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Option, String as Str } from 'effect';

import { createLobbyAtom, lobbyStateAtom } from '../lobby/lobby-atoms.ts';
import { activeLobbyCode } from '../lobby/lobby-view.ts';
import { selectionAtom, warmArenaAtom } from '../location/location-atoms.ts';
import { toLobbyLocation } from './lobby-helpers.ts';
import { playerNameAtom } from './player-name-atom.ts';
import { PlayerNameInput } from './player-name.tsx';

export const HostActions = () => {
  const selection = useAtomValue(selectionAtom);
  const name = Str.trim(useAtomValue(playerNameAtom));
  const [result, create] = useAtom(createLobbyAtom, { mode: 'promise' });
  const warmArena = useAtomSet(warmArenaAtom);
  const navigate = useNavigate();
  if (!selection) {
    return (
      <p className='text-sm text-slate-500'>
        Search, enter coordinates, or click the map.
      </p>
    );
  }
  const location = toLobbyLocation(selection);
  return (
    <div className='flex flex-col gap-2 rounded border border-slate-200 p-3'>
      <p className='text-sm'>
        <span className='font-medium'>{location.label}</span>
        <br />
        <span className='text-slate-500'>
          {location.lat}, {location.lon}
        </span>
      </p>
      <button
        className='rounded bg-rose-600 px-4 py-2 font-semibold text-white disabled:opacity-50'
        type='button'
        disabled={name.length === 0 || result.waiting}
        onClick={() => {
          warmArena(location);
          void create({ name, location }).then((code) =>
            navigate({ to: '/lobby/$code', params: { code } }),
          );
        }}
      >
        {result.waiting ? 'Creating…' : 'Create lobby'}
      </button>
      {name.length === 0 && (
        <p className='text-sm text-slate-500'>Enter your name to host.</p>
      )}
      <Link
        className='text-center text-sm text-slate-600 underline'
        to='/play'
        search={{ lat: location.lat, lon: location.lon }}
      >
        Practice here solo
      </Link>
    </div>
  );
};

const ActiveLobby = () => {
  const code = Option.flatMap(useAtomValue(lobbyStateAtom), activeLobbyCode);
  if (Option.isNone(code)) return null;
  return (
    <Link
      className='rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700'
      to='/lobby/$code'
      params={{ code: code.value }}
    >
      You are in lobby{' '}
      <span className='font-mono font-semibold'>{code.value}</span>. Back to
      lobby →
    </Link>
  );
};

export const PlayerIdentity = () => (
  <>
    <ActiveLobby />
    <PlayerNameInput />
  </>
);
