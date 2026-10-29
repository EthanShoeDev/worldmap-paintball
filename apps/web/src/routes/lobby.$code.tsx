import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  type Lobby,
  MAX_PLAYERS,
  type PlayerId,
} from '@worldmap-paintball/api/lobby/protocol';
import { Array as Arr } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useState } from 'react';

import { JoinLobbyForm } from '../components/join-lobby-form.tsx';
import {
  canStartMatch,
  cleanLobbyCode,
  lobbyErrorMessage,
  rejectionMessage,
  toLobbyLocation,
} from '../components/lobby-helpers.ts';
import { OsmAttribution } from '../components/osm-attribution.tsx';
import { PlayerNameInput } from '../components/player-name.tsx';
import {
  leaveLobbyAtom,
  lobbyMessages,
  lobbySessionAtom,
  sendLobbyAtom,
} from '../lobby/lobby-atoms.ts';
import { selectionAtom, warmArenaAtom } from '../location/location-atoms.ts';
import { LocationMap, LocationPreview } from '../location/location-map.tsx';
import { LocationSearch } from '../location/location-search.tsx';

const useLeave = () => {
  const leave = useAtomSet(leaveLobbyAtom, { mode: 'promise' });
  const navigate = useNavigate();
  return () => {
    void leave().then(() => navigate({ to: '/' }));
  };
};

const CopyButton = ({ text }: { readonly text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className='rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100'
      type='button'
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const Badge = ({
  className,
  children,
}: {
  readonly className: string;
  readonly children: string;
}) => (
  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${className}`}>
    {children}
  </span>
);

const PlayerList = ({
  lobby,
  you,
}: {
  readonly lobby: Lobby;
  readonly you: PlayerId | undefined;
}) => (
  <ul className='flex flex-col divide-y divide-slate-100 rounded border border-slate-200'>
    {Arr.map(lobby.players, (player) => (
      <li className='flex items-center gap-2 px-3 py-2' key={player.id}>
        <span className='flex-1 truncate'>
          {player.name}
          {player.id === you && <span className='text-slate-400'> (you)</span>}
        </span>
        {player.id === lobby.hostId ? (
          <Badge className='bg-rose-100 text-rose-700'>Host</Badge>
        ) : player.ready ? (
          <Badge className='bg-emerald-100 text-emerald-700'>Ready</Badge>
        ) : (
          <Badge className='bg-slate-100 text-slate-500'>Not ready</Badge>
        )}
      </li>
    ))}
  </ul>
);

const LocationEditor = ({ onDone }: { readonly onDone: () => void }) => {
  const selection = useAtomValue(selectionAtom);
  const send = useAtomSet(sendLobbyAtom);
  const warmArena = useAtomSet(warmArenaAtom);
  return (
    <div className='flex flex-col gap-3'>
      <LocationSearch />
      <div className='h-72 overflow-hidden rounded border border-slate-200'>
        <LocationMap />
      </div>
      <div className='flex gap-2'>
        <button
          className='flex-1 rounded bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-50'
          type='button'
          disabled={!selection}
          onClick={() => {
            if (!selection) return;
            const location = toLobbyLocation(selection);
            warmArena(location);
            send(lobbyMessages.setLocation(location));
            onDone();
          }}
        >
          Use this location
        </button>
        <button
          className='rounded border border-slate-300 px-4 py-2'
          type='button'
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
      <p className='text-xs text-slate-500'>
        Changing the location clears everyone&apos;s ready flag.
      </p>
    </div>
  );
};

const LobbyLocation = ({
  lobby,
  isHost,
}: {
  readonly lobby: Lobby;
  readonly isHost: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const select = useAtomSet(selectionAtom);
  const { location } = lobby;
  return (
    <section className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <h2 className='font-semibold'>Arena</h2>
        {isHost && !editing && lobby.phase === 'waiting' && (
          <button
            className='text-sm text-rose-700 underline'
            type='button'
            onClick={() => {
              select({
                ...location,
                label: location.label ?? 'Lobby location',
                flyTo: false,
              });
              setEditing(true);
            }}
          >
            Change location
          </button>
        )}
      </div>
      <p className='text-sm'>
        <span className='font-medium'>{location.label ?? 'Dropped pin'}</span>
        <br />
        <span className='text-slate-500'>
          {location.lat}, {location.lon}
        </span>
      </p>
      {editing ? (
        <LocationEditor onDone={() => setEditing(false)} />
      ) : (
        <div className='h-48 overflow-hidden rounded border border-slate-200'>
          <LocationPreview location={location} />
        </div>
      )}
    </section>
  );
};

const MatchControls = ({
  lobby,
  you,
}: {
  readonly lobby: Lobby;
  readonly you: PlayerId | undefined;
}) => {
  const send = useAtomSet(sendLobbyAtom);
  if (you === lobby.hostId) {
    const waitingFor = Arr.filter(
      lobby.players,
      (player) => player.id !== lobby.hostId && !player.ready,
    ).length;
    return (
      <div className='flex flex-col gap-1'>
        <button
          className='rounded bg-rose-600 px-4 py-2 font-semibold text-white disabled:opacity-50'
          type='button'
          disabled={!canStartMatch(lobby)}
          onClick={() => send(lobbyMessages.startMatch())}
        >
          Start match
        </button>
        <p className='text-sm text-slate-500'>
          {waitingFor > 0
            ? `Waiting for ${waitingFor} ${waitingFor === 1 ? 'player' : 'players'} to ready up.`
            : lobby.players.length === 1
              ? 'Share the code, or start a solo match.'
              : 'Everyone is ready.'}
        </p>
      </div>
    );
  }
  const ready = Arr.some(
    lobby.players,
    (player) => player.id === you && player.ready,
  );
  return (
    <button
      className={`rounded px-4 py-2 font-semibold ${ready ? 'bg-emerald-600 text-white' : 'border border-slate-300'}`}
      type='button'
      aria-pressed={ready}
      onClick={() => send(lobbyMessages.setReady(!ready))}
    >
      {ready ? 'Ready ✓ (click to unready)' : "I'm ready"}
    </button>
  );
};

const Notice = ({
  children,
  action,
}: {
  readonly children: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) => (
  <div className='flex items-center gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
    <p className='flex-1'>{children}</p>
    {action && (
      <button className='underline' type='button' onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

const LobbyRoom = ({ code }: { readonly code: string }) => {
  const session = useAtomValue(lobbySessionAtom);
  const sendResult = useAtomValue(sendLobbyAtom);
  const leave = useLeave();
  const { lobby, you } = session;
  if (lobby === undefined) return null;
  const shareUrl = `${globalThis.location.origin}/lobby/${code}`;

  return (
    <div className='flex flex-col gap-5'>
      <section className='flex flex-col gap-2'>
        <p className='text-sm text-slate-500'>Lobby code</p>
        <div className='flex items-center gap-3'>
          <span className='font-mono text-3xl font-bold tracking-widest'>
            {code}
          </span>
          <CopyButton text={code} />
        </div>
        <div className='flex items-center gap-2'>
          <input
            className='min-w-0 flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-600'
            aria-label='Invite link'
            readOnly
            value={shareUrl}
            onFocus={(event) => event.target.select()}
          />
          <CopyButton text={shareUrl} />
        </div>
      </section>
      {session.status === 'disconnected' && (
        <Notice action={{ label: 'Leave', onClick: leave }}>
          Lost the connection to the lobby.
        </Notice>
      )}
      {session.rejection !== undefined && (
        <Notice>{rejectionMessage(session.rejection)}</Notice>
      )}
      {AsyncResult.isFailure(sendResult) && !sendResult.waiting && (
        <Notice>{lobbyErrorMessage(sendResult.cause)}</Notice>
      )}
      <section className='flex flex-col gap-2'>
        <h2 className='font-semibold'>
          Players ({lobby.players.length}/{MAX_PLAYERS})
        </h2>
        <PlayerList lobby={lobby} you={you} />
      </section>
      <MatchControls lobby={lobby} you={you} />
      <LobbyLocation lobby={lobby} isHost={you === lobby.hostId} />
      <button
        className='self-start text-sm text-slate-500 underline'
        type='button'
        onClick={leave}
      >
        Leave lobby
      </button>
    </div>
  );
};

const LobbyContent = ({ code }: { readonly code: string }) => {
  const session = useAtomValue(lobbySessionAtom);
  const leave = useLeave();
  const here = session.code === code;
  if (here && session.closed === 'HostLeft') {
    return (
      <Notice action={{ label: 'Back to start', onClick: leave }}>
        The host left, so the lobby closed.
      </Notice>
    );
  }
  if (here && session.lobby !== undefined) return <LobbyRoom code={code} />;
  if (here && session.status === 'connecting') {
    return <p className='text-slate-500'>Connecting…</p>;
  }
  return (
    <div className='flex flex-col gap-4'>
      <p className='text-sm text-slate-600'>
        You have been invited to lobby{' '}
        <span className='font-mono font-semibold'>{code}</span>.
      </p>
      <PlayerNameInput />
      <JoinLobbyForm initialCode={code} />
    </div>
  );
};

// Every member follows the lobby into the match; `/play` reads the session
// itself to tell a networked match from solo practice.
const useFollowMatch = (code: string) => {
  const { code: sessionCode, lobby } = useAtomValue(lobbySessionAtom);
  const navigate = useNavigate();
  const target =
    sessionCode === code && lobby?.phase === 'playing'
      ? lobby.location
      : undefined;
  const lat = target?.lat;
  const lon = target?.lon;
  useEffect(() => {
    if (lat !== undefined && lon !== undefined) {
      void navigate({ to: '/play', search: { lat, lon } });
    }
  }, [lat, lon, navigate]);
};

const LobbyPage = () => {
  const { code } = Route.useParams();
  useFollowMatch(code);
  return (
    <main className='mx-auto flex min-h-screen max-w-lg flex-col gap-5 p-6'>
      <Link className='text-2xl font-bold' to='/'>
        Worldmap Paintball
      </Link>
      <LobbyContent code={code} />
      <OsmAttribution className='mt-auto text-slate-500' />
    </main>
  );
};

export const Route = createFileRoute('/lobby/$code')({
  ssr: false,
  params: {
    parse: ({ code }) => ({ code: cleanLobbyCode(code) }),
    stringify: ({ code }) => ({ code }),
  },
  component: LobbyPage,
});
