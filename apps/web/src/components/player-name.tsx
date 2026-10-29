import '@tanstack/react-start/client-only';
import { useAtom } from '@effect/atom-react';

import { maxNameLength } from './lobby-helpers.ts';
import { playerNameAtom } from './player-name-atom.ts';

export const PlayerNameInput = () => {
  const [name, setName] = useAtom(playerNameAtom);
  return (
    <label className='flex flex-col gap-1 text-sm font-medium'>
      Your name
      <input
        className='field px-3 py-2 font-normal'
        placeholder='Splatter'
        maxLength={maxNameLength}
        // The name is already remembered in localStorage.
        autoComplete='off'
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    </label>
  );
};
