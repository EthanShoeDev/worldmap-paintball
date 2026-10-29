import '@tanstack/react-start/client-only';
import { useAtomValue } from '@effect/atom-react';
import { Array as Arr } from 'effect';

import { splatsAtom } from './splats.ts';

// Overlapping splats share a depth, so instead of depth-testing each other
// they skip depth writes and draw oldest first: the newest lands on top.
export const SplatDecals = () => {
  const splats = useAtomValue(splatsAtom);
  return Arr.map(splats, (splat, index) => (
    <mesh
      key={splat.id}
      position={splat.position}
      quaternion={splat.rotation}
      renderOrder={index + 1}
    >
      <circleGeometry args={[splat.size, 12]} />
      <meshStandardMaterial
        color={splat.color}
        polygonOffset
        polygonOffsetFactor={-2}
        depthWrite={false}
      />
    </mesh>
  ));
};
