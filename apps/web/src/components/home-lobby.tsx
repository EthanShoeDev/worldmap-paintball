import '@tanstack/react-start/client-only';
import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  isCovered,
  outsideCoverageMessage,
} from '@worldmap-paintball/api-contract/coverage';
import { Array as Arr, Option, String as Str } from 'effect';
import { useState } from 'react';

import { maxPracticeBots } from '../game/tuning.ts';
import { createLobbyAtom, lobbyStateAtom } from '../lobby/lobby-atoms.ts';
import { activeLobbyCode } from '../lobby/lobby-view.ts';
import { selectionAtom, warmArenaAtom } from '../location/location-atoms.ts';
import { toLobbyLocation } from './lobby-helpers.ts';
import { playerNameAtom } from './player-name-atom.ts';
import { PlayerNameInput } from './player-name.tsx';

const PracticeLinks = ({
  lat,
  lon,
}: {
  readonly lat: number;
  readonly lon: number;
}) => {
  const [bots, setBots] = useState(3);
  return (
    <div className='flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-slate-600'>
      <Link className='underline' to='/play' search={{ lat, lon }}>
        Practice here solo
      </Link>
      <span className='flex items-center gap-1'>
        <Link className='underline' to='/play' search={{ lat, lon, bots }}>
          Practice here with
        </Link>
        <select
          className='rounded border border-slate-300 px-1'
          aria-label='Number of bots'
          value={bots}
          onChange={(event) => setBots(Number(event.target.value))}
        >
          {Arr.map(Arr.range(0, maxPracticeBots), (count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
        bots
      </span>
    </div>
  );
};

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
  const covered = isCovered(location.lat, location.lon);
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
        disabled={!covered || name.length === 0 || result.waiting}
        onClick={() => {
          warmArena(location);
          void create({ name, location }).then((code) =>
            navigate({ to: '/lobby/$code', params: { code } }),
          );
        }}
      >
        {result.waiting ? 'Creating…' : 'Create lobby'}
      </button>
      {covered ? (
        <>
          {name.length === 0 && (
            <p className='text-sm text-slate-500'>Enter your name to host.</p>
          )}
          <PracticeLinks lat={location.lat} lon={location.lon} />
        </>
      ) : (
        <p className='text-sm text-red-600'>{outsideCoverageMessage}</p>
      )}
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
