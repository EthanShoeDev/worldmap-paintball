import '@tanstack/react-start/client-only';
import { useAtomValue } from '@effect/atom-react';
import { useFrame } from '@react-three/fiber';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';
import { type RefObject, useMemo } from 'react';

import { paintGround, paintPlan } from './ground-texture.ts';
import { imageryAtom, photoOf } from './imagery.ts';
import { padsOf, powerUpLooks } from './powerups.ts';

const minimapPixels = 320;

// Reports the camera every frame. The first-person camera's yaw is its Y
// rotation (Euler order YXZ), and yaw 0 faces north, the map's top.
export const MinimapTracker = ({
  onMove,
}: {
  readonly onMove: (x: number, z: number, yaw: number) => void;
}) => {
  useFrame(({ camera }) => {
    onMove(camera.position.x, camera.position.z, camera.rotation.y);
  });
  return null;
};

const percent = (halfSize: number, value: number) =>
  `${((value + halfSize) / (2 * halfSize)) * 100}%`;

// Only you and the power-up pads, unless the match reveals everyone: showing
// opponents gives their positions away.
export const Minimap = ({
  arena,
  marker,
  dots,
}: {
  readonly arena: Arena;
  readonly marker: RefObject<HTMLDivElement | null>;
  // Filled only under the reveal mutator.
  readonly dots: RefObject<HTMLDivElement | null>;
}) => {
  const photo = useAtomValue(imageryAtom(arena), photoOf);
  const pads = useMemo(() => padsOf(arena), [arena]);
  const plan = useMemo(
    () =>
      paintPlan(arena, paintGround(arena, photo), minimapPixels).toDataURL(),
    [arena, photo],
  );
  return (
    <div
      className={`absolute bottom-16 left-3 size-36 overflow-hidden border-2 border-white/70 shadow-lg sm:size-44 ${arena.round === true ? 'rounded-full' : 'rounded'}`}
    >
      <img src={plan} alt='' className='size-full' />
      {Arr.map(pads, ({ kind, position: [x, z] }) => (
        <div
          key={`${x},${z}`}
          className='absolute size-2 -translate-1/2 rotate-45'
          style={{
            left: percent(arena.halfSize, x),
            top: percent(arena.halfSize, z),
            backgroundColor: powerUpLooks[kind].color,
          }}
        />
      ))}
      <div ref={dots} className='absolute inset-0' />
      <div
        ref={marker}
        className='absolute size-0 border-x-[6px] border-b-[14px] border-x-transparent border-b-rose-500'
      />
    </div>
  );
};
