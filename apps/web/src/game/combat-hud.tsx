import '@tanstack/react-start/client-only';
import { useAtomValue } from '@effect/atom-react';
import { Array as Arr, Option } from 'effect';

import { combatViewAtom, hitMarkerAtom, powerUpViewAtom } from './hud-atoms.ts';
import { screenShare } from './loadout.ts';
import { matchViewAtom } from './net/net-game.ts';
import { powerUpLooks } from './powerups.ts';
import { allWeaponIds, type WeaponId, weaponIds, weapons } from './tuning.ts';

const names: Record<WeaponId, string> = {
  assault: 'Assault',
  sniper: 'Sniper',
  shotgun: 'Shotgun',
  launcher: 'Launcher',
};

const centre = 'absolute top-1/2 left-1/2 -translate-1/2';
const line = 'absolute bg-white/90 shadow';

const Cross = () => (
  <div className={`${centre} size-5`}>
    <span className={`${line} top-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2`} />
    <span
      className={`${line} bottom-0 left-1/2 h-1.5 w-0.5 -translate-x-1/2`}
    />
    <span className={`${line} top-1/2 left-0 h-0.5 w-1.5 -translate-y-1/2`} />
    <span className={`${line} top-1/2 right-0 h-0.5 w-1.5 -translate-y-1/2`} />
  </div>
);

const Dot = ({ size }: { readonly size: string }) => (
  <div className={`${centre} ${size} rounded-full bg-white/90 shadow`} />
);

// The shotgun's ring is as wide on screen as its pellets' cone.
const spreadRing = `${200 * screenShare(weapons.shotgun.spread)}vh`;

const Scope = () => (
  <div
    className='absolute inset-0'
    style={{
      background:
        'radial-gradient(circle at center, transparent min(40vh, 40vw), rgb(0 0 0 / 0.92) calc(min(40vh, 40vw) + 2px))',
    }}
  >
    <span className={`${centre} h-[80vmin] w-px bg-black/70`} />
    <span className={`${centre} h-px w-[80vmin] bg-black/70`} />
    <div className={`${centre} size-1 rounded-full bg-rose-500`} />
  </div>
);

const Crosshair = ({
  weapon,
  zoomed,
}: {
  readonly weapon: WeaponId;
  readonly zoomed: boolean;
}) => {
  if (zoomed) return <Scope />;
  switch (weapon) {
    case 'assault': {
      return <Cross />;
    }
    case 'sniper': {
      return <Dot size='size-1' />;
    }
    case 'launcher': {
      return (
        <div
          className={`${centre} size-10 rounded-full border-2 border-dashed border-amber-300/90 shadow`}
        >
          <Dot size='size-1' />
        </div>
      );
    }
    case 'shotgun': {
      return (
        <>
          <div
            className={`${centre} rounded-full border-2 border-white/80 shadow`}
            style={{ width: spreadRing, height: spreadRing }}
          />
          <Dot size='size-1' />
        </>
      );
    }
  }
};

// An X around the crosshair; remounted by its key, so each hit replays it.
const HitMarker = () => (
  <svg
    className={`${centre} size-8 animate-hit-marker drop-shadow`}
    viewBox='-16 -16 32 32'
    stroke='white'
    strokeWidth='2.5'
    strokeLinecap='round'
  >
    <path d='M-11-11L-5-5M11-11L5-5M-11 11L-5 5M11 11L5 5' />
  </svg>
);

// The running power-up above the weapon panel; x-ray also tints the edges
// of the screen.
const PowerUpHud = () => {
  const power = useAtomValue(powerUpViewAtom);
  if (!power) return null;
  const { label, hint, color } = powerUpLooks[power.kind];
  return (
    <>
      {power.kind === 'xray' && (
        <div
          className='absolute inset-0'
          style={{ boxShadow: `inset 0 0 120px ${color}66` }}
        />
      )}
      <div
        className='absolute right-2 bottom-36 w-64 rounded bg-black/50 px-3 py-2'
        style={{ borderLeft: `4px solid ${color}` }}
      >
        <p className='flex items-baseline justify-between'>
          <span className='font-semibold' style={{ color }}>
            {label}
          </span>
          <span className='font-bold tabular-nums'>{power.seconds}s</span>
        </p>
        <p className='text-xs text-white/70'>{hint}</p>
        {power.kind === 'jetpack' && (
          <div className='mt-1 h-1.5 overflow-hidden rounded bg-white/20'>
            <div
              className='h-full'
              style={{ width: `${power.fuel * 100}%`, backgroundColor: color }}
            />
          </div>
        )}
      </div>
    </>
  );
};

// Weapon, slots, ammo and reload, bottom right above the attribution; the
// crosshair for the weapon in hand; and flashes for hits and eliminations.
export const CombatHud = () => {
  const { weapon, ammo, reload, zoomed, launcher } =
    useAtomValue(combatViewAtom);
  const slots = launcher > 0 ? allWeaponIds : weaponIds;
  const hits = useAtomValue(hitMarkerAtom);
  const view = useAtomValue(matchViewAtom);
  const { magazine } = weapons[weapon];
  const confirmed = Option.getOrUndefined(
    Arr.findLast(view.feed, (entry) => entry.shooter === view.you),
  );
  const target = confirmed
    ? Option.getOrUndefined(
        Arr.findFirst(view.roster, (player) => player.id === confirmed.target),
      )
    : undefined;
  return (
    <>
      <Crosshair weapon={weapon} zoomed={zoomed} />
      <PowerUpHud />
      {hits > 0 && <HitMarker key={hits} />}
      {confirmed && (
        <p
          key={confirmed.id}
          className='absolute inset-x-0 top-[58%] animate-confirm text-center font-bold text-rose-300 drop-shadow'
        >
          Splatted {target?.name ?? 'someone'}
        </p>
      )}
      <div className='absolute right-2 bottom-8 w-64 rounded bg-black/50 px-3 py-2'>
        <ol className='flex gap-1 text-xs'>
          {Arr.map(slots, (id, index) => (
            <li
              key={id}
              className={`flex-1 rounded px-1.5 py-0.5 text-center ${
                id === weapon
                  ? 'bg-white font-semibold text-black'
                  : 'bg-white/15 text-white/70'
              }`}
            >
              {index + 1} {names[id]}
            </li>
          ))}
        </ol>
        <p className='mt-1 flex items-baseline justify-between'>
          <span className='font-semibold'>{names[weapon]}</span>
          <span
            className={`text-lg font-bold tabular-nums ${
              ammo < magazine * 0.25 ? 'text-red-400' : ''
            }`}
          >
            {ammo} / {magazine}
          </span>
        </p>
        {reload !== undefined && (
          <div className='mt-1 h-1.5 overflow-hidden rounded bg-white/20'>
            <div
              className='h-full bg-amber-300'
              style={{ width: `${reload * 100}%` }}
            />
          </div>
        )}
      </div>
    </>
  );
};
