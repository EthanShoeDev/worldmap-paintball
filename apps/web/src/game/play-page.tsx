import '@tanstack/react-start/client-only';
import { useAtomValue } from '@effect/atom-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Effect, Fiber, Option } from 'effect';
import { useEffect, useState } from 'react';

import { PlayNotice } from '../components/play-notice.tsx';
import { lobbyStateAtom } from '../lobby/lobby-atoms.ts';
import type { Coordinates } from '../location/coordinates.ts';
import { Game } from './game.tsx';
import { Scoreboard } from './match-hud.tsx';
import { matchViewAtom } from './net/net-game.ts';
import { lobbyMatchCode, matchStatus } from './net/session.ts';

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
    <PlayNotice title='Match over'>
      <MatchResults />
      <Link className='underline' to='/lobby/$code' params={{ code }}>
        Back to the lobby
      </Link>
    </PlayNotice>
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
    <PlayNotice title='The lobby closed'>
      <p className='text-slate-600'>
        The host left or the connection to the lobby dropped, so the match is
        over.
      </p>
      <Link className='underline' to='/'>
        Back to the start
      </Link>
    </PlayNotice>
  );
};

const LobbyMatch = ({
  code,
  coordinates,
}: {
  readonly code: string;
  readonly coordinates: Coordinates;
}) => {
  const status = Option.match(useAtomValue(lobbyStateAtom), {
    onNone: () => 'closed' as const,
    onSome: (snapshot) => matchStatus(snapshot, code),
  });
  if (status === 'closed') return <LobbyClosed />;
  if (status === 'ended') return <MatchEnded code={code} />;
  return <Game coordinates={coordinates} networked />;
};

export const PlayAt = ({
  coordinates,
  bots,
}: {
  readonly coordinates: Coordinates;
  // Practice opponents when no lobby match runs here.
  readonly bots: number;
}) => {
  const live = Option.getOrUndefined(
    Option.flatMapNullishOr(useAtomValue(lobbyStateAtom), (snapshot) =>
      lobbyMatchCode(snapshot, coordinates),
    ),
  );
  // Latched, so a match that ends leads back to the lobby, not to practice.
  const [code, setCode] = useState(live);
  if (live !== undefined && live !== code) setCode(live);
  return code === undefined ? (
    <Game coordinates={coordinates} networked={false} bots={bots} />
  ) : (
    <LobbyMatch code={code} coordinates={coordinates} />
  );
};
