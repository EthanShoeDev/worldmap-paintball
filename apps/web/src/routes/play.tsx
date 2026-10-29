import { useAtomValue } from '@effect/atom-react';
import {
  type ErrorComponentProps,
  Link,
  type SearchSchemaInput,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router';
import { Effect, Fiber, Result, Schema } from 'effect';
import { type ReactNode, useEffect, useState } from 'react';

import { Game } from '../game/game.tsx';
import { Scoreboard } from '../game/match-hud.tsx';
import { matchViewAtom } from '../game/net/net-game.ts';
import { lobbyMatchCode, matchStatus } from '../game/net/session.ts';
import { lobbySessionAtom } from '../lobby/lobby-atoms.ts';
import { Coordinates } from '../location/coordinates.ts';

const decodeCoordinates = Schema.decodeUnknownResult(Coordinates);

// Failing here would make SSR answer 500 instead of rendering the error UI,
// and the router merges whatever this returns back into the URL, so it passes
// the raw values through and <Play> validates them.
const rawSearch = ({
  lat,
  lon,
}: Coordinates & SearchSchemaInput): Readonly<
  Record<keyof Coordinates, unknown>
> => ({ lat, lon });

const resultDelayMs = 4000;

// Runs `go` after `delayMs`; the returned cleanup cancels it.
const after = (delayMs: number, go: () => Promise<void>) => {
  const fiber = Effect.runFork(
    Effect.sleep(delayMs).pipe(Effect.andThen(Effect.promise(go))),
  );
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
};

const Notice = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <main className='flex min-h-screen flex-col items-center justify-center gap-4 p-6'>
    <h1 className='text-xl font-bold'>{title}</h1>
    {children}
  </main>
);

const PlayError = ({ error }: { readonly error: unknown }) => (
  <Notice title='Could not build this arena'>
    <p className='text-slate-600'>
      {error instanceof Error ? error.message : 'Unknown error'}
    </p>
    <Link className='underline' to='/'>
      Pick another location
    </Link>
  </Notice>
);

const RouteError = ({ error }: ErrorComponentProps) => (
  <PlayError error={error} />
);

// Leaves for the lobby once the host ends the match, after a moment on the
// final scores if they arrived.
const MatchEnded = ({ code }: { readonly code: string }) => {
  const navigate = useNavigate();
  const { final } = useAtomValue(matchViewAtom);
  const hasResults = final !== undefined;
  useEffect(
    () =>
      after(hasResults ? resultDelayMs : 0, () =>
        navigate({ to: '/lobby/$code', params: { code } }),
      ),
    [code, hasResults, navigate],
  );
  return (
    <Notice title='Match over'>
      <MatchResults />
      <Link className='underline' to='/lobby/$code' params={{ code }}>
        Back to the lobby
      </Link>
    </Notice>
  );
};

const MatchResults = () => {
  const view = useAtomValue(matchViewAtom);
  return view.final === undefined ? null : (
    <div className='rounded bg-slate-800 px-4 py-3 text-white'>
      <Scoreboard view={view} scores={view.final} />
    </div>
  );
};

const LobbyClosed = () => {
  const navigate = useNavigate();
  useEffect(
    () => after(resultDelayMs, () => navigate({ to: '/' })),
    [navigate],
  );
  return (
    <Notice title='The lobby closed'>
      <p className='text-slate-600'>
        The host left or the connection to the lobby dropped, so the match is
        over.
      </p>
      <Link className='underline' to='/'>
        Back to the start
      </Link>
    </Notice>
  );
};

const LobbyMatch = ({
  code,
  coordinates,
}: {
  readonly code: string;
  readonly coordinates: Coordinates;
}) => {
  const status = matchStatus(useAtomValue(lobbySessionAtom), code);
  if (status === 'closed') return <LobbyClosed />;
  if (status === 'ended') return <MatchEnded code={code} />;
  return <Game coordinates={coordinates} networked />;
};

const PlayAt = ({ coordinates }: { readonly coordinates: Coordinates }) => {
  const live = lobbyMatchCode(useAtomValue(lobbySessionAtom), coordinates);
  // Latched, so a match that ends leads back to the lobby, not to practice.
  const [code, setCode] = useState(live);
  if (live !== undefined && live !== code) setCode(live);
  return code === undefined ? (
    <Game coordinates={coordinates} networked={false} />
  ) : (
    <LobbyMatch code={code} coordinates={coordinates} />
  );
};

const Play = () => {
  const coordinates = decodeCoordinates(Route.useSearch());
  if (Result.isFailure(coordinates)) {
    return <PlayError error={new Error(coordinates.failure.message)} />;
  }
  const { lat, lon } = coordinates.success;
  return <PlayAt key={`${lat},${lon}`} coordinates={coordinates.success} />;
};

export const Route = createFileRoute('/play')({
  ssr: false,
  validateSearch: rawSearch,
  component: Play,
  errorComponent: RouteError,
});
