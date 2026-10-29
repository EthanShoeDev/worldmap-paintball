import '@tanstack/react-start/client-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { Link } from '@tanstack/react-router';
import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr, Option, Order } from 'effect';

import {
  colorOf,
  endMatchAtom,
  type MatchView,
  matchViewAtom,
  type NetGame,
} from './net/net-game.ts';
import type { Score } from './net/protocol.ts';

type Net = NetGame['Service'];

const byScore = Order.mapInput(
  Order.flip(Order.Number),
  (row: { readonly score: number }) => row.score,
);

export const Scoreboard = ({
  view,
  scores,
}: {
  readonly view: MatchView;
  readonly scores: ReadonlyArray<Score>;
}) => {
  const present = new Set(view.present);
  const rows = Arr.sort(
    Arr.map(view.roster, (player) => {
      const score = Option.getOrUndefined(
        Arr.findFirst(scores, (entry) => entry.id === player.id),
      );
      return {
        ...player,
        score: score?.score ?? 0,
        deaths: score?.deaths ?? 0,
        present: present.has(player.id),
      };
    }),
    byScore,
  );
  return (
    <table className='text-sm'>
      <thead className='text-xs text-white/60'>
        <tr>
          <th className='pr-4 text-left font-normal'>Player</th>
          <th className='pr-3 text-right font-normal'>Hits</th>
          <th className='text-right font-normal'>Outs</th>
        </tr>
      </thead>
      <tbody>
        {Arr.map(rows, (row) => (
          <tr key={row.id} className={row.present ? '' : 'opacity-40'}>
            <td className='pr-4 font-semibold'>
              <span
                className='mr-2 inline-block size-2.5 rounded-full'
                style={{ backgroundColor: colorOf(view, row.id) }}
              />
              {row.name}
              {row.id === view.you && ' (you)'}
            </td>
            <td className='pr-3 text-right tabular-nums'>{row.score}</td>
            <td className='text-right text-white/60 tabular-nums'>
              {row.deaths}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const MatchHud = ({
  net,
  practice,
}: {
  readonly net: Net;
  // No lobby to end the match with, so it offers a way out instead.
  readonly practice: boolean;
}) => {
  const view = useAtomValue(matchViewAtom);
  const endMatch = useAtomSet(endMatchAtom);
  const nameOf = (id: PlayerId) =>
    Arr.findFirst(net.roster, (player) => player.id === id).pipe(
      Option.match({ onNone: () => 'Someone', onSome: ({ name }) => name }),
    );

  return (
    <>
      <div className='absolute top-3 left-3 rounded bg-black/50 px-3 py-2'>
        <Scoreboard view={view} scores={view.scores} />
        {practice && (
          <Link
            className='pointer-events-auto mt-2 block w-full rounded bg-slate-600 px-3 py-1 text-center text-sm font-semibold hover:bg-slate-500'
            to='/'
          >
            Leave
          </Link>
        )}
        {net.isHost && !practice && (
          <button
            className='pointer-events-auto mt-2 w-full rounded bg-rose-600 px-3 py-1 text-sm font-semibold hover:bg-rose-500'
            type='button'
            onClick={() => endMatch(net)}
          >
            End match
          </button>
        )}
      </div>
      <ul className='absolute top-8 right-3 flex flex-col items-end gap-1 text-sm'>
        {Arr.map(view.feed, (entry) => (
          <li key={entry.id} className='rounded bg-black/50 px-2 py-0.5'>
            <span style={{ color: colorOf(net, entry.shooter) }}>
              {nameOf(entry.shooter)}
            </span>{' '}
            splatted{' '}
            <span style={{ color: colorOf(net, entry.target) }}>
              {nameOf(entry.target)}
            </span>
          </li>
        ))}
      </ul>
      {view.eliminatedBy !== undefined && (
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-1 bg-rose-900/30'>
          <p className='text-3xl font-bold drop-shadow'>Eliminated</p>
          <p className='drop-shadow'>
            Splatted by {nameOf(view.eliminatedBy)} · respawning
            {view.respawnIn === undefined ? '…' : ` in ${view.respawnIn}s`}
          </p>
        </div>
      )}
    </>
  );
};
