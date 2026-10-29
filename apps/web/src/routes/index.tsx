import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { coverageNames } from '@worldmap-paintball/api-contract/coverage';
import { lazy, Suspense } from 'react';

import { OsmAttribution } from '../components/osm-attribution.tsx';
import { LocationSearch } from '../location/location-search.tsx';

// Browser-only modules load lazily so the server bundle never imports them.
const PlayerIdentity = lazy(() =>
  // dynamic-import -- keeps browser-only modules out of the server bundle.
  import('../components/home-lobby.tsx').then((module) => ({
    default: module.PlayerIdentity,
  })),
);
const HostActions = lazy(() =>
  // dynamic-import -- keeps browser-only modules out of the server bundle.
  import('../components/home-lobby.tsx').then((module) => ({
    default: module.HostActions,
  })),
);
const JoinLobbyForm = lazy(() =>
  // dynamic-import -- keeps browser-only modules out of the server bundle.
  import('../components/join-lobby-form.tsx').then((module) => ({
    default: module.JoinLobbyForm,
  })),
);
const LocationMap = lazy(() =>
  // dynamic-import -- keeps browser-only modules out of the server bundle.
  import('../location/location-map.tsx').then((module) => ({
    default: module.LocationMap,
  })),
);

const Home = () => (
  <main className='flex h-screen flex-col md:flex-row'>
    <section className='flex flex-col gap-5 overflow-y-auto p-6 md:w-96'>
      <h1 className='text-2xl font-bold'>Worldmap Paintball</h1>
      <ClientOnly>
        <Suspense>
          <PlayerIdentity />
        </Suspense>
      </ClientOnly>
      <div className='flex flex-col gap-3'>
        <h2 className='font-semibold'>Host a match</h2>
        <p className='text-sm text-slate-600'>
          Pick anywhere in {coverageNames} for the arena.
        </p>
        <LocationSearch />
        <ClientOnly>
          <Suspense>
            <HostActions />
          </Suspense>
        </ClientOnly>
      </div>
      <div className='flex flex-col gap-3'>
        <h2 className='font-semibold'>Join a match</h2>
        <ClientOnly>
          <Suspense>
            <JoinLobbyForm />
          </Suspense>
        </ClientOnly>
      </div>
      <OsmAttribution className='mt-auto text-slate-500' />
    </section>
    <section className='min-h-80 flex-1'>
      <ClientOnly>
        <Suspense>
          <LocationMap />
        </Suspense>
      </ClientOnly>
    </section>
  </main>
);

export const Route = createFileRoute('/')({ component: Home });
