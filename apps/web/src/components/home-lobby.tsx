import '@tanstack/react-start/client-only';
import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  isCovered,
  outsideCoverageMessage,
} from '@worldmap-paintball/api-contract/coverage';
import { Array as Arr, Option, String as Str } from 'effect';

import { createLobbyAtom, lobbyStateAtom } from '../lobby/lobby-atoms.ts';
import { activeLobbyCode } from '../lobby/lobby-view.ts';
import { selectionAtom, warmArenaAtom } from '../location/location-atoms.ts';
import { recentPlacesAtom, rememberPlace } from '../location/saved-atoms.ts';
import { toLobbyLocation } from './lobby-helpers.ts';
import { playerNameAtom } from './player-name-atom.ts';
import { PlayerNameInput } from './player-name.tsx';

const RecentPlaces = () => {
  const places = useAtomValue(recentPlacesAtom);
  const select = useAtomSet(selectionAtom);
  if (places.length === 0) return null;
  return (
    <section className='flex flex-col gap-1'>
      <h2 className='text-sm font-semibold text-muted'>Recent places</h2>
      <ul className='flex flex-col gap-1'>
        {Arr.map(places, (place) => (
          <li key={`${place.lat},${place.lon}`}>
            <button
              className='w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-white/10'
              type='button'
              onClick={() =>
                select({
                  ...place,
                  label: place.label ?? `${place.lat}, ${place.lon}`,
                  flyTo: true,
                })
              }
            >
              {place.label ?? 'Dropped pin'}
              <span className='block text-xs text-muted'>
                {place.lat}, {place.lon}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export const HostActions = () => (
  <>
    <Host />
    <RecentPlaces />
  </>
);

const Host = () => {
  const selection = useAtomValue(selectionAtom);
  const [recent, setRecent] = useAtom(recentPlacesAtom);
  const name = Str.trim(useAtomValue(playerNameAtom));
  const [result, create] = useAtom(createLobbyAtom, { mode: 'promise' });
  const warmArena = useAtomSet(warmArenaAtom);
  const navigate = useNavigate();
  if (!selection) {
    return (
      <p className='text-sm text-muted'>
        Search, enter coordinates, or click the map.
      </p>
    );
  }
  const location = toLobbyLocation(selection);
  const covered = isCovered(location.lat, location.lon);
  return (
    <div className='flex flex-col gap-3 rounded-2xl border border-line bg-white/5 p-4'>
      <p className='text-sm'>
        <span className='font-medium'>{location.label}</span>
        <br />
        <span className='text-muted'>
          {location.lat}, {location.lon}
        </span>
      </p>
      <button
        className='button-paint px-4 py-3 text-lg'
        type='button'
        disabled={!covered || name.length === 0 || result.waiting}
        onClick={() => {
          warmArena(location);
          setRecent(rememberPlace(recent, location));
          void create({ name, location }).then((code) =>
            navigate({ to: '/lobby/$code', params: { code } }),
          );
        }}
      >
        {result.waiting ? 'Creating…' : 'Create lobby'}
      </button>
      {covered ? (
        name.length === 0 && (
          <p className='text-sm text-muted'>
            Enter your name to host. Practice and map options are in the lobby.
          </p>
        )
      ) : (
        <p className='text-sm text-red-400'>{outsideCoverageMessage}</p>
      )}
    </div>
  );
};

const ActiveLobby = () => {
  const code = Option.flatMap(useAtomValue(lobbyStateAtom), activeLobbyCode);
  if (Option.isNone(code)) return null;
  return (
    <Link
      className='rounded-xl border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-sm text-rose-200'
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
