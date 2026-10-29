import '@tanstack/react-start/client-only';
import { useFrame } from '@react-three/fiber';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';
import { useRef } from 'react';
import { AdditiveBlending, type Group } from 'three';

import { type Pad, powerUpLooks, type PowerUpLink } from './powerups.ts';
import { heightAt } from './terrain.ts';
import type { PowerUpKind } from './tuning.ts';

const beamHeight = 14;
const hover = 1.3;

const Glow = ({ color }: { readonly color: string }) => (
  <meshStandardMaterial
    color={color}
    emissive={color}
    emissiveIntensity={1.4}
    roughness={0.3}
  />
);

const Icon = ({
  kind,
  color,
}: {
  readonly kind: PowerUpKind;
  readonly color: string;
}) => {
  switch (kind) {
    case 'jetpack': {
      return (
        <>
          {Arr.map([-0.14, 0.14], (x) => (
            <mesh key={x} position-x={x}>
              <capsuleGeometry args={[0.11, 0.3, 4, 10]} />
              <Glow color={color} />
            </mesh>
          ))}
        </>
      );
    }
    case 'launcher': {
      return (
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.13, 0.13, 0.7, 14]} />
          <Glow color={color} />
        </mesh>
      );
    }
    case 'xray': {
      return (
        <>
          <mesh>
            <torusGeometry args={[0.25, 0.05, 8, 24]} />
            <Glow color={color} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.11, 12, 10]} />
            <Glow color='#ffffff' />
          </mesh>
        </>
      );
    }
    case 'speed': {
      return (
        <mesh rotation-z={-Math.PI / 2}>
          <coneGeometry args={[0.2, 0.5, 4]} />
          <Glow color={color} />
        </mesh>
      );
    }
  }
};

const PadModel = ({
  pad,
  arena,
  ref,
}: {
  readonly pad: Pad;
  readonly arena: Arena;
  readonly ref: (group: Group | null) => void;
}) => {
  const [x, z] = pad.position;
  const { color } = powerUpLooks[pad.kind];
  return (
    <group position={[x, heightAt(arena, x, z), z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[1.1, 1.5, 32]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <group ref={ref}>
        <mesh position-y={beamHeight / 2}>
          <cylinderGeometry args={[0.6, 0.9, beamHeight, 16, 1, true]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.18}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <group name='icon' position-y={hover}>
          <Icon kind={pad.kind} color={color} />
        </group>
      </group>
    </group>
  );
};

// Every power-up pad: a ring on the ground, and while it is ready, a beam
// and its icon spinning above it.
export const PowerPads = ({
  arena,
  link,
}: {
  readonly arena: Arena;
  readonly link: PowerUpLink;
}) => {
  const live = useRef(new Map<number, Group>());
  useFrame(({ clock }) => {
    const ready = link.ready();
    const time = clock.elapsedTime;
    for (const [index, group] of live.current) {
      group.visible = ready[index] === true;
      const icon = group.getObjectByName('icon');
      if (!icon) continue;
      icon.rotation.y = time * 1.8;
      icon.position.y = hover + Math.sin(time * 2 + index) * 0.15;
    }
  });
  return Arr.map(link.pads, (pad, index) => (
    <PadModel
      key={index}
      pad={pad}
      arena={arena}
      ref={(group) => {
        if (group) live.current.set(index, group);
        else live.current.delete(index);
      }}
    />
  ));
};
