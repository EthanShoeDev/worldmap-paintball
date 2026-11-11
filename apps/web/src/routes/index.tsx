import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { coverageName } from '@worldmap-paintball/api-contract/coverage';
import { MAX_PLAYERS } from '@worldmap-paintball/api-contract/lobby';
import { lazy, type ReactNode, Suspense } from 'react';

import { Logo } from '../components/logo.tsx';
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

const Step = ({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <section className='flex flex-col gap-3'>
    <h2 className='flex items-center gap-2 font-display text-sm tracking-wider text-ink uppercase'>
      <span className='flex size-6 items-center justify-center rounded-full bg-lime-300 text-xs text-night'>
        {number}
      </span>
      {title}
    </h2>
    {children}
  </section>
);

const Home = () => (
  <main className='flex min-h-screen flex-col md:block md:h-screen md:overflow-hidden'>
    <section className='h-[42vh] md:absolute md:inset-0 md:h-auto'>
      <ClientOnly>
        <Suspense>
          <LocationMap />
        </Suspense>
      </ClientOnly>
    </section>
    {/* Keeps the panel's edge readable over a busy map. */}
    <div className='pointer-events-none absolute inset-y-0 left-0 hidden w-[36rem] bg-linear-to-r from-night/70 to-transparent md:block' />
    <section className='relative z-10 -mt-6 flex flex-col gap-6 rounded-t-3xl border-t border-line bg-panel p-6 md:absolute md:top-4 md:bottom-4 md:left-4 md:mt-0 md:w-[26rem] md:overflow-y-auto md:rounded-3xl md:border md:shadow-2xl md:shadow-black/50'>
      <header className='flex flex-col gap-3 pt-2'>
        <Logo />
        <p className='text-muted'>
          Your street is the arena. Pick a real place in {coverageName}, and its
          roads, houses and hills become a paintball map for up to {MAX_PLAYERS}{' '}
          players.
        </p>
      </header>
      <ClientOnly>
        <Suspense>
          <Step number={1} title='Your callsign'>
            <PlayerIdentity />
          </Step>
        </Suspense>
      </ClientOnly>
      <Step number={2} title='Pick your arena'>
        <LocationSearch />
        <ClientOnly>
          <Suspense>
            <HostActions />
          </Suspense>
        </ClientOnly>
      </Step>
      <Step number={3} title='Or join friends'>
        <ClientOnly>
          <Suspense>
            <JoinLobbyForm />
          </Suspense>
        </ClientOnly>
      </Step>
      <OsmAttribution className='mt-auto text-muted' />
    </section>
  </main>
);

export const Route = createFileRoute('/')({ component: Home });
