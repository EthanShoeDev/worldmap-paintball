import { useAtom, useAtomValue } from '@effect/atom-react';
import { useNavigate } from '@tanstack/react-router';
import { Exit, String as Str } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';

import { joinLobbyAtom } from '../lobby/lobby-atoms.ts';
import {
  cleanLobbyCode,
  isCompleteLobbyCode,
  lobbyErrorMessage,
} from './lobby-helpers.ts';
import { playerNameAtom } from './player-name.tsx';

export const JoinLobbyForm = ({
  initialCode = '',
}: {
  readonly initialCode?: string;
}) => {
  const [code, setCode] = useState(() => cleanLobbyCode(initialCode));
  const name = Str.trim(useAtomValue(playerNameAtom));
  const [result, join] = useAtom(joinLobbyAtom, { mode: 'promiseExit' });
  const navigate = useNavigate();
  const ready = name.length > 0 && isCompleteLobbyCode(code);

  return (
    <form
      className='flex flex-col gap-2'
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        void join({ code, name }).then((exit) => {
          if (Exit.isSuccess(exit)) {
            return navigate({
              to: '/lobby/$code',
              params: { code: exit.value.code },
            });
          }
        });
      }}
    >
      <label className='flex flex-col gap-1 text-sm font-medium'>
        Lobby code
        <div className='flex gap-2'>
          <input
            className='min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-lg tracking-widest uppercase'
            placeholder='ABC234'
            autoCapitalize='characters'
            autoComplete='off'
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(cleanLobbyCode(event.target.value))}
          />
          <button
            className='rounded bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-50'
            type='submit'
            disabled={!ready || result.waiting}
          >
            {result.waiting ? 'Joining…' : 'Join'}
          </button>
        </div>
      </label>
      {name.length === 0 && (
        <p className='text-sm text-slate-500'>Enter your name to join.</p>
      )}
      {AsyncResult.isFailure(result) && !result.waiting && (
        <p className='text-sm text-red-600'>
          {lobbyErrorMessage(result.cause)}
        </p>
      )}
    </form>
  );
};
