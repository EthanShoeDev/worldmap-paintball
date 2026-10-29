import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import {
  ClientOnly,
  Link,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router';
import { Exit, String as Str } from 'effect';
import { AsyncResult } from 'effect/reactivity';

import { JoinLobbyForm } from '../components/join-lobby-form.tsx';
import {
  lobbyErrorMessage,
  toLobbyLocation,
} from '../components/lobby-helpers.ts';
import { OsmAttribution } from '../components/osm-attribution.tsx';
import { PlayerNameInput, playerNameAtom } from '../components/player-name.tsx';
import { createLobbyAtom, lobbySessionAtom } from '../lobby/lobby-atoms.ts';
import { selectionAtom, warmArenaAtom } from '../location/location-atoms.ts';
import { LocationMap } from '../location/location-map.tsx';
import { LocationSearch } from '../location/location-search.tsx';

const HostActions = () => {
  const selection = useAtomValue(selectionAtom);
  const name = Str.trim(useAtomValue(playerNameAtom));
  const [result, create] = useAtom(createLobbyAtom, { mode: 'promiseExit' });
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
          void create({ name, location }).then((exit) => {
            if (Exit.isSuccess(exit)) {
              return navigate({
                to: '/lobby/$code',
                params: { code: exit.value.code },
              });
            }
          });
        }}
      >
        {result.waiting ? 'Creating…' : 'Create lobby'}
      </button>
      {name.length === 0 && (
        <p className='text-sm text-slate-500'>Enter your name to host.</p>
      )}
      {AsyncResult.isFailure(result) && !result.waiting && (
        <p className='text-sm text-red-600'>
          {lobbyErrorMessage(result.cause)}
        </p>
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
  const { code, lobby } = useAtomValue(lobbySessionAtom);
  if (code === undefined || lobby === undefined) return null;
  return (
    <Link
      className='rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700'
      to='/lobby/$code'
      params={{ code }}
    >
      You are in lobby <span className='font-mono font-semibold'>{code}</span>.
      Back to lobby →
    </Link>
  );
};

const Home = () => (
  <main className='flex h-screen flex-col md:flex-row'>
    <section className='flex flex-col gap-5 overflow-y-auto p-6 md:w-96'>
      <h1 className='text-2xl font-bold'>Worldmap Paintball</h1>
      <ClientOnly>
        <ActiveLobby />
        <PlayerNameInput />
      </ClientOnly>
      <div className='flex flex-col gap-3'>
        <h2 className='font-semibold'>Host a match</h2>
        <p className='text-sm text-slate-600'>
          Pick anywhere on Earth for the arena.
        </p>
        <LocationSearch />
        <ClientOnly>
          <HostActions />
        </ClientOnly>
      </div>
      <div className='flex flex-col gap-3'>
        <h2 className='font-semibold'>Join a match</h2>
        <ClientOnly>
          <JoinLobbyForm />
        </ClientOnly>
      </div>
      <OsmAttribution className='mt-auto text-slate-500' />
    </section>
    <section className='min-h-80 flex-1'>
      <LocationMap />
    </section>
  </main>
);

export const Route = createFileRoute('/')({ component: Home });
