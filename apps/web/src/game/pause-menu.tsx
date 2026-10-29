import '@tanstack/react-start/client-only';
import { useAtom, useAtomValue } from '@effect/atom-react';
import { Array as Arr } from 'effect';

import { gamepadNamesAtom, pointerLockedAtom } from './hud-atoms.ts';
import { renderScaleLabel, renderScales } from './render-scale.ts';
import { renderScaleAtom } from './render-settings.ts';

const controls = [
  ['Move', 'WASD'],
  ['Sprint', 'Shift'],
  ['Jump', 'Space'],
  ['Fire', 'Left click'],
  ['Zoom (sniper)', 'Right click'],
  ['Reload', 'R'],
  ['Switch weapon', '1 / 2 / 3 or wheel'],
  ['Menu', 'Esc'],
  ['Gamepad combat', 'RT fire · LT zoom · X reload'],
  ['Gamepad other', 'LB / RB or d-pad switch · A jump · L3 sprint'],
] as const;

// Shown whenever the mouse isn't captured, which is also how play starts.
// The game keeps running underneath: matches are live, so nothing pauses.
export const PauseMenu = ({
  dpr,
  onResume,
}: {
  readonly dpr: number;
  readonly onResume: () => void;
}) => {
  const locked = useAtomValue(pointerLockedAtom);
  const gamepads = useAtomValue(gamepadNamesAtom);
  const [scale, setScale] = useAtom(renderScaleAtom);
  if (locked) return null;
  // Gamepad players never capture the mouse; a modal would never close.
  if (gamepads.length > 0) {
    return (
      <p className='absolute inset-x-0 top-6 mx-auto w-fit rounded bg-black/60 px-4 py-2 text-sm'>
        Playing with {Arr.join(gamepads, ', ')} · click to use mouse and
        keyboard
      </p>
    );
  }
  return (
    <div className='pointer-events-auto absolute top-1/2 left-1/2 w-80 -translate-1/2 rounded-lg bg-slate-900/90 p-5 shadow-xl'>
      <h2 className='text-lg font-semibold'>Menu</h2>
      <button
        type='button'
        className='mt-3 w-full rounded bg-emerald-600 px-3 py-2 font-semibold hover:bg-emerald-500'
        onClick={onResume}
      >
        Play
      </button>
      <fieldset className='mt-4'>
        <legend className='text-sm font-medium'>Resolution</legend>
        <div className='mt-1 flex gap-1'>
          {Arr.map(renderScales, (option) => (
            <button
              key={option}
              type='button'
              aria-pressed={option === scale}
              className={`flex-1 rounded px-1 py-1 text-xs ${option === scale ? 'bg-white text-slate-900' : 'bg-white/10 hover:bg-white/20'}`}
              onClick={() => setScale(option)}
            >
              {renderScaleLabel(option)}
            </button>
          ))}
        </div>
        <p className='mt-1 text-xs text-white/70'>
          Rendering {Math.round(window.innerWidth * dpr)} ×{' '}
          {Math.round(window.innerHeight * dpr)}
          {scale === 'auto' && ', adjusting to hold the frame rate'}
        </p>
      </fieldset>
      <dl className='mt-4 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs'>
        {Arr.map(controls, ([action, keys]) => (
          <div key={action} className='contents'>
            <dt className='text-white/70'>{action}</dt>
            <dd>{keys}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
