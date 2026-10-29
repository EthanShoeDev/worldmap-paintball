import { useAtom, useAtomSet } from '@effect/atom-react';
import { outsideCoverageMessage } from '@worldmap-paintball/api-contract/coverage';
import { Array as Arr, Cause, String as Str } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';

import { apiErrorMessage } from '../api-client.ts';
import { parseCoordinates } from './coordinates.ts';
import { placesAtom, selectionAtom } from './location-atoms.ts';

const minQueryLength = 3;

const failureMessage = (cause: Cause.Cause<unknown>) =>
  apiErrorMessage(Cause.squash(cause));

export const LocationSearch = () => {
  const [query, setQuery] = useState('');
  const [places, search] = useAtom(placesAtom);
  const select = useAtomSet(selectionAtom);
  const trimmed = Str.trim(query);
  const tooShort = trimmed.length < minQueryLength;

  return (
    <div className='flex flex-col gap-3'>
      <form
        className='flex gap-2'
        onSubmit={(event) => {
          event.preventDefault();
          const coordinates = parseCoordinates(query);
          if (coordinates) {
            select({ ...coordinates, label: trimmed, flyTo: true });
          } else if (!tooShort) {
            search(trimmed);
          }
        }}
      >
        <input
          className='min-w-0 flex-1 rounded border border-slate-300 px-3 py-2'
          placeholder='Address or "51.5007, -0.1246"'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className='rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50'
          type='submit'
          disabled={tooShort}
        >
          Find
        </button>
      </form>
      {places.waiting && <p className='text-sm text-slate-500'>Searching…</p>}
      {AsyncResult.isFailure(places) && (
        <p className='text-sm text-red-600'>
          Search failed: {failureMessage(places.cause)}
        </p>
      )}
      {AsyncResult.isSuccess(places) &&
        (places.value.length === 0 ? (
          <p className='text-sm text-slate-500'>No places found.</p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {Arr.map(places.value, (place) => (
              <li key={`${place.lat},${place.lon}`}>
                <button
                  className='w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-transparent'
                  type='button'
                  disabled={!place.covered}
                  onClick={() => select({ ...place, flyTo: true })}
                >
                  {place.label}
                  {!place.covered && (
                    <span className='block text-xs'>
                      {outsideCoverageMessage}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
};
