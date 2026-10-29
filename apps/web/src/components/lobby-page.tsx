import '@tanstack/react-start/client-only';
import { useAtom, useAtomSet, useAtomValue } from '@effect/atom-react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  isCovered,
  outsideCoverageMessage,
} from '@worldmap-paintball/api-contract/coverage';
import {
  defaultMatchRules,
  type Lobby,
  MAX_BOTS,
  MAX_PLAYERS,
  type MatchRules,
  type PlayerId,
} from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr, Equal, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react';

import { botPlayers } from '../game/net/bots.ts';
import {
  lobbyMessages,
  lobbyNoticeAtom,
  lobbyStateAtom,
  sendLobbyAtom,
  sendLobbyEventAtom,
} from '../lobby/lobby-atoms.ts';
import { LobbyEvents, LobbyStates } from '../lobby/lobby-machine.ts';
import {
  connectingFor,
  endedFor,
  failureFor,
  inLobbyFor,
} from '../lobby/lobby-view.ts';
import { selectionAtom, warmArenaAtom } from '../location/location-atoms.ts';
import { LocationMap } from '../location/location-map.tsx';
import { LocationSearch } from '../location/location-search.tsx';
import { recentPlacesAtom, rememberPlace } from '../location/saved-atoms.ts';
import { JoinLobbyForm } from './join-lobby-form.tsx';
import {
  canStartMatch,
  failureMessage,
  rejectionMessage,
  sendErrorMessage,
  toLobbyLocation,
} from './lobby-helpers.ts';
import { Logo } from './logo.tsx';
import { OsmAttribution } from './osm-attribution.tsx';
import { PlayerNameInput } from './player-name.tsx';

const LobbyMap = lazy(() =>
  // dynamic-import -- the 3D preview loads three.js only when shown.
  import('../game/map-editor.tsx').then((module) => ({
    default: module.LobbyMap,
  })),
);

const Card = ({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) => (
  <section className='flex flex-col gap-3 rounded-2xl border border-line bg-panel p-5 shadow-xl shadow-black/30'>
    <div className='flex items-center justify-between gap-2'>
      <h2 className='font-display text-sm tracking-wider uppercase'>{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

// Practice runs on this machine, on the lobby's map with its bots; the lobby
// keeps your place, and a match that starts meanwhile pulls you in.
const WarmUp = ({ lobby }: { readonly lobby: Lobby }) => {
  const { lat, lon } = lobby.location;
  return (
    <div className='flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2'>
      <p className='flex-1 text-xs text-muted'>
        Warm up here while you wait. You&apos;re pulled into the match when it
        starts.
      </p>
      <Link
        className='button-ghost px-3 py-1 text-sm whitespace-nowrap'
        to='/play'
        search={lobby.bots > 0 ? { lat, lon, bots: lobby.bots } : { lat, lon }}
      >
        Warm up
      </Link>
    </div>
  );
};

const ruleSliders = [
  { key: 'moveSpeed', label: 'Move speed', max: 2.5 },
  { key: 'jumpHeight', label: 'Jump height', max: 4 },
  { key: 'paintballSpeed', label: 'Paintball speed', max: 2.5 },
] as const;

// The host edits; everyone else sees what the match will play by.
const RulesCard = ({
  lobby,
  isHost,
}: {
  readonly lobby: Lobby;
  readonly isHost: boolean;
}) => {
  const send = useAtomSet(sendLobbyAtom);
  const { rules } = lobby;
  const editable = isHost && lobby.phase === 'waiting';
  const set = (next: MatchRules) => send(lobbyMessages.setRules(next));
  return (
    <Card
      title='Mutators'
      aside={
        editable &&
        !Equal.equals(rules, defaultMatchRules) && (
          <button
            className='text-sm text-rose-300 underline'
            type='button'
            onClick={() => set(defaultMatchRules)}
          >
            Reset
          </button>
        )
      }
    >
      {Arr.map(ruleSliders, ({ key, label, max }) => (
        <label key={key} className='flex flex-col gap-1 text-sm'>
          <span className='flex justify-between'>
            {label}
            <span className={rules[key] === 1 ? 'text-muted' : 'text-lime-300'}>
              ×{rules[key]}
            </span>
          </span>
          <input
            type='range'
            min={0.5}
            max={max}
            step={0.25}
            value={rules[key]}
            disabled={!editable}
            onChange={(event) =>
              set({ ...rules, [key]: Number(event.target.value) })
            }
          />
        </label>
      ))}
      <label className='flex items-center gap-2 text-sm'>
        <input
          type='checkbox'
          checked={rules.revealPlayers}
          disabled={!editable}
          onChange={(event) =>
            set({ ...rules, revealPlayers: event.target.checked })
          }
        />
        Everyone on the minimap
      </label>
    </Card>
  );
};

const BotStepper = ({ lobby }: { readonly lobby: Lobby }) => {
  const send = useAtomSet(sendLobbyAtom);
  const step = (bots: number) => send(lobbyMessages.setBots(bots));
  return (
    <div className='flex items-center gap-2 text-sm'>
      <span className='text-muted'>Bots</span>
      <button
        className='size-7 button-ghost'
        type='button'
        aria-label='Remove a bot'
        disabled={lobby.bots === 0}
        onClick={() => step(lobby.bots - 1)}
      >
        −
      </button>
      <span className='w-4 text-center font-display'>{lobby.bots}</span>
      <button
        className='size-7 button-ghost'
        type='button'
        aria-label='Add a bot'
        disabled={lobby.bots >= MAX_BOTS}
        onClick={() => step(lobby.bots + 1)}
      >
        +
      </button>
    </div>
  );
};

const useLeave = () => {
  const send = useAtomSet(sendLobbyEventAtom);
  const navigate = useNavigate();
  return () => {
    send(LobbyEvents.Leave());
    void navigate({ to: '/' });
  };
};

const CopyButton = ({ text }: { readonly text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className='button-ghost px-3 py-1 text-sm'
      type='button'
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
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
  readonly you: PlayerId;
}) => (
  <ul className='flex flex-col divide-y divide-line rounded-xl border border-line bg-white/5'>
    {Arr.map(lobby.players, (player) => (
      <li className='flex items-center gap-2 px-3 py-2' key={player.id}>
        <span className='flex-1 truncate'>
          {player.name}
          {player.id === you && <span className='text-muted'> (you)</span>}
        </span>
        {player.id === lobby.hostId ? (
          <Badge className='bg-rose-500/20 text-rose-300'>Host</Badge>
        ) : player.ready ? (
          <Badge className='bg-lime-400/20 text-lime-300'>Ready</Badge>
        ) : (
          <Badge className='bg-white/10 text-muted'>Not ready</Badge>
        )}
      </li>
    ))}
    {Arr.map(botPlayers(lobby.bots), (bot) => (
      <li className='flex items-center gap-2 px-3 py-2' key={bot.id}>
        <span className='flex-1 truncate text-muted'>{bot.name}</span>
        <Badge className='bg-sky-400/20 text-sky-300'>Bot</Badge>
      </li>
    ))}
  </ul>
);

const LocationEditor = ({ onDone }: { readonly onDone: () => void }) => {
  const selection = useAtomValue(selectionAtom);
  const send = useAtomSet(sendLobbyAtom);
  const warmArena = useAtomSet(warmArenaAtom);
  const [recent, setRecent] = useAtom(recentPlacesAtom);
  const covered =
    selection !== undefined && isCovered(selection.lat, selection.lon);
  return (
    <div className='flex flex-col gap-3'>
      <LocationSearch />
      <div className='h-72 overflow-hidden rounded-xl border border-line'>
        <LocationMap />
      </div>
      <div className='flex gap-2'>
        <button
          className='flex-1 button-ghost px-4 py-2 font-semibold'
          type='button'
          disabled={!covered}
          onClick={() => {
            if (!selection || !covered) return;
            const location = toLobbyLocation(selection);
            warmArena(location);
            setRecent(rememberPlace(recent, location));
            send(lobbyMessages.setLocation(location));
            onDone();
          }}
        >
          Use this location
        </button>
        <button
          className='button-ghost px-4 py-2'
          type='button'
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
      {selection && !covered && (
        <p className='text-sm text-red-400'>{outsideCoverageMessage}</p>
      )}
      <p className='text-xs text-muted'>
        Changing the location clears everyone&apos;s ready flag.
      </p>
    </div>
  );
};

const ArenaCard = ({
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
    <Card
      title='Arena'
      aside={
        isHost &&
        !editing &&
        lobby.phase === 'waiting' && (
          <button
            className='text-sm text-rose-300 underline'
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
        )
      }
    >
      <p className='text-sm'>
        <span className='font-medium'>{location.label ?? 'Dropped pin'}</span>
        <span className='ml-2 text-xs text-muted'>
          {location.lat}, {location.lon}
        </span>
      </p>
      {editing ? (
        <LocationEditor onDone={() => setEditing(false)} />
      ) : (
        <Suspense>
          <LobbyMap lobby={lobby} isHost={isHost} />
        </Suspense>
      )}
    </Card>
  );
};

const MatchControls = ({
  lobby,
  you,
}: {
  readonly lobby: Lobby;
  readonly you: PlayerId;
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
          className='button-paint px-4 py-3 text-lg'
          type='button'
          disabled={!canStartMatch(lobby)}
          onClick={() => send(lobbyMessages.startMatch())}
        >
          Start match
        </button>
        <p className='text-sm text-muted'>
          {waitingFor > 0
            ? `Waiting for ${waitingFor} ${waitingFor === 1 ? 'player' : 'players'} to ready up.`
            : lobby.players.length === 1 && lobby.bots === 0
              ? 'Share the code, add some bots, or start on your own.'
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
      className={`rounded-xl px-4 py-3 text-lg ${ready ? 'bg-lime-400 font-display text-night' : 'button-paint'}`}
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
  <div className='flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200'>
    <p className='flex-1'>{children}</p>
    {action && (
      <button className='underline' type='button' onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

const LobbyNotice = () => {
  const notice = AsyncResult.getOrElse(
    useAtomValue(lobbyNoticeAtom),
    Option.none,
  );
  return Option.isSome(notice) ? (
    <Notice>{rejectionMessage(notice.value)}</Notice>
  ) : null;
};

const LobbyRoom = ({
  code,
  you,
  lobby,
}: {
  readonly code: string;
  readonly you: PlayerId;
  readonly lobby: Lobby;
}) => {
  const sendResult = useAtomValue(sendLobbyAtom);
  const leave = useLeave();
  const shareUrl = `${globalThis.location.origin}/lobby/${code}`;

  const isHost = you === lobby.hostId;

  return (
    <div className='grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'>
      <div className='flex flex-col gap-6'>
        <Card title='Invite'>
          <div className='flex items-center gap-3'>
            <span className='font-display text-4xl tracking-widest text-lime-300'>
              {code}
            </span>
            <CopyButton text={code} />
          </div>
          <div className='flex items-center gap-2'>
            <input
              className='min-w-0 flex-1 field px-2 py-1 text-sm text-muted'
              aria-label='Invite link'
              readOnly
              value={shareUrl}
              onFocus={(event) => event.target.select()}
            />
            <CopyButton text={shareUrl} />
          </div>
        </Card>
        <LobbyNotice />
        {AsyncResult.isFailure(sendResult) && !sendResult.waiting && (
          <Notice>{sendErrorMessage(sendResult.cause)}</Notice>
        )}
        <Card
          title={`Squad ${lobby.players.length}/${MAX_PLAYERS}`}
          aside={
            isHost && lobby.phase === 'waiting' && <BotStepper lobby={lobby} />
          }
        >
          <PlayerList lobby={lobby} you={you} />
        </Card>
        <Card title='Match'>
          <MatchControls lobby={lobby} you={you} />
          <WarmUp lobby={lobby} />
        </Card>
        <RulesCard lobby={lobby} isHost={isHost} />
        <button
          className='self-start text-sm text-muted underline'
          type='button'
          onClick={leave}
        >
          Leave lobby
        </button>
      </div>
      <ArenaCard lobby={lobby} isHost={isHost} />
    </div>
  );
};

const Invite = ({ code }: { readonly code: string }) => (
  <div className='flex flex-col gap-4'>
    <p className='text-sm text-muted'>
      You have been invited to lobby{' '}
      <span className='font-mono font-semibold'>{code}</span>.
    </p>
    <PlayerNameInput />
    <JoinLobbyForm initialCode={code} />
  </div>
);

const LobbyContent = ({ code }: { readonly code: string }) => {
  const snapshot = useAtomValue(lobbyStateAtom);
  const leave = useLeave();
  if (Option.isNone(snapshot)) return null;
  const current = snapshot.value;
  if (connectingFor(current, code)) {
    return <p className='text-muted'>Connecting…</p>;
  }
  const inLobby = inLobbyFor(current, code);
  if (Option.isSome(inLobby)) {
    return (
      <LobbyRoom
        code={code}
        you={inLobby.value.you}
        lobby={inLobby.value.lobby}
      />
    );
  }
  if (!endedFor(current, code)) return <Invite code={code} />;
  const failed = failureFor(current, code);
  // A failed join gets the form again, which shows the reason.
  if (Option.isSome(failed) && failed.value.request === 'Join') {
    return <Invite code={code} />;
  }
  return (
    <Notice action={{ label: 'Back to start', onClick: leave }}>
      {Option.isSome(failed)
        ? failureMessage(failed.value.reason)
        : LobbyStates.matches(current, 'Ended.Closed')
          ? 'The host left, so the lobby closed.'
          : 'Lost the connection to the lobby.'}
    </Notice>
  );
};

// Every member follows the lobby into the match; `/play` reads the session
// itself to tell a networked match from solo practice.
const useFollowMatch = (code: string) => {
  const snapshot = useAtomValue(lobbyStateAtom);
  const navigate = useNavigate();
  const target = Option.flatMap(snapshot, (current) =>
    LobbyStates.matches(current, 'Session.InLobby.Playing')
      ? inLobbyFor(current, code)
      : Option.none(),
  );
  const lat = Option.getOrUndefined(target)?.lobby.location.lat;
  const lon = Option.getOrUndefined(target)?.lobby.location.lon;
  useEffect(() => {
    if (lat !== undefined && lon !== undefined) {
      void navigate({ to: '/play', search: { lat, lon } });
    }
  }, [lat, lon, navigate]);
};

export const LobbyPage = ({ code }: { readonly code: string }) => {
  useFollowMatch(code);
  return (
    <main className='mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-8'>
      <Logo size='small' />
      <LobbyContent code={code} />
      <OsmAttribution className='mt-auto text-muted' />
    </main>
  );
};
