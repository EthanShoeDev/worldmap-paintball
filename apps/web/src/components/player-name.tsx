import { useAtom } from '@effect/atom-react';
import { BrowserKeyValueStore } from '@effect/platform-browser';
import { Schema } from 'effect';
import { Atom } from 'effect/reactivity';

import { maxNameLength } from './lobby-helpers.ts';

// Storage failures (private mode, blocked site data) leave the name in memory only.
export const playerNameAtom = Atom.kvs({
  runtime: Atom.runtime(BrowserKeyValueStore.layerLocalStorage),
  key: 'worldmap-paintball/player-name',
  schema: Schema.String,
  defaultValue: () => '',
});

export const PlayerNameInput = () => {
  const [name, setName] = useAtom(playerNameAtom);
  return (
    <label className='flex flex-col gap-1 text-sm font-medium'>
      Your name
      <input
        className='rounded border border-slate-300 px-3 py-2 font-normal'
        placeholder='Splatter'
        maxLength={maxNameLength}
        autoComplete='nickname'
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    </label>
  );
};
