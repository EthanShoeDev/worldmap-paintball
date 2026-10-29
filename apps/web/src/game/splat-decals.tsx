import { useAtomValue } from '@effect/atom-react';
import { Array as Arr } from 'effect';

import { splatsAtom } from './splats.ts';

export const SplatDecals = () => {
  const splats = useAtomValue(splatsAtom);
  return Arr.map(splats, (splat) => (
    <mesh key={splat.id} position={splat.position} quaternion={splat.rotation}>
      <circleGeometry args={[splat.size, 12]} />
      <meshStandardMaterial
        color={splat.color}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  ));
};
