import '@tanstack/react-start/client-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { useNavigate } from '@tanstack/react-router';
import { Option, String as Str } from 'effect';
import { useState } from 'react';

import { lobbyStateAtom, sendLobbyEventAtom } from '../lobby/lobby-atoms.ts';
import { LobbyEvents } from '../lobby/lobby-machine.ts';
import { connectingFor, failureFor } from '../lobby/lobby-view.ts';
import {
  cleanLobbyCode,
  failureMessage,
  isCompleteLobbyCode,
} from './lobby-helpers.ts';
import { playerNameAtom } from './player-name-atom.ts';

export const JoinLobbyForm = ({
  initialCode = '',
}: {
  readonly initialCode?: string;
}) => {
  const [code, setCode] = useState(() => cleanLobbyCode(initialCode));
  const name = Str.trim(useAtomValue(playerNameAtom));
  const snapshot = useAtomValue(lobbyStateAtom);
  const send = useAtomSet(sendLobbyEventAtom);
  const navigate = useNavigate();
  const joining = Option.exists(snapshot, (current) =>
    connectingFor(current, code),
  );
  const failure = Option.filter(
    Option.flatMap(snapshot, (current) => failureFor(current, code)),
    (failed) => failed.request === 'Join',
  );
  const ready = name.length > 0 && isCompleteLobbyCode(code);

  return (
    <form
      className='flex flex-col gap-2'
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        send(LobbyEvents.Join({ code, name }));
        void navigate({ to: '/lobby/$code', params: { code } });
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
            disabled={!ready || joining}
          >
            {joining ? 'Joining…' : 'Join'}
          </button>
        </div>
      </label>
      {name.length === 0 && (
        <p className='text-sm text-slate-500'>Enter your name to join.</p>
      )}
      {Option.isSome(failure) && (
        <p className='text-sm text-red-600'>
          {failureMessage(failure.value.reason)}
        </p>
      )}
    </form>
  );
};
