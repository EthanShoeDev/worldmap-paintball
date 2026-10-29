import '@tanstack/react-start/client-only';
import { useAtomValue } from '@effect/atom-react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';
import { useRef } from 'react';
import type { Group, Object3D } from 'three';

import { MarkerModel } from './marker-model.tsx';
import { colorOf, matchViewAtom, type NetGame } from './net/net-game.ts';
import {
  bodyHalfHeight,
  bodyRadius,
  eyeOffset,
  markerTuning,
  type WeaponId,
  weaponIds,
} from './tuning.ts';

type Net = NetGame['Service'];

const { held } = markerTuning;

interface AvatarParts {
  readonly body: Group;
  readonly aim: Object3D;
  readonly models: ReadonlyArray<readonly [WeaponId, Object3D]>;
}

const Avatar = ({
  name,
  color,
  ref,
}: {
  readonly name: string;
  readonly color: string;
  readonly ref: (group: Group | null) => () => void;
}) => (
  <group ref={ref} visible={false}>
    <mesh castShadow>
      <capsuleGeometry args={[bodyRadius, bodyHalfHeight * 2, 4, 12]} />
      <meshStandardMaterial color={color} />
    </mesh>
    <mesh position-y={eyeOffset + 0.05} castShadow>
      <sphereGeometry args={[0.22, 16, 12]} />
      <meshStandardMaterial color='#f1d3b3' />
    </mesh>
    {/* Goggles face -z, the camera's forward at zero yaw. */}
    <mesh position={[0, eyeOffset + 0.08, -0.18]}>
      <boxGeometry args={[0.32, 0.08, 0.1]} />
      <meshStandardMaterial color='#111827' />
    </mesh>
    {/* Same transforms as heldMuzzle. */}
    <group name='aim' position={[...held.pivot]}>
      <group position={[...held.position]} scale={held.scale}>
        {Arr.map(weaponIds, (weapon) => (
          <group key={weapon} name={weapon} visible={false}>
            <MarkerModel weapon={weapon} color={color} castShadow />
          </group>
        ))}
      </group>
    </group>
    <Html position-y={eyeOffset + 0.55} center distanceFactor={10}>
      <span
        className='pointer-events-none rounded px-1.5 py-0.5 text-sm font-semibold whitespace-nowrap text-white select-none'
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </Html>
  </group>
);

// Remote players drawn at their interpolated poses, ~100 ms in the past.
export const RemotePlayers = ({ net }: { readonly net: Net }) => {
  const present = new Set(useAtomValue(matchViewAtom).present);
  const avatars = useRef(new Map<PlayerId, AvatarParts>());
  const others = Arr.filter(
    net.roster,
    (player) => player.id !== net.you && present.has(player.id),
  );

  useFrame(() => {
    const poses = net.updateRemotes();
    for (const [id, { body, aim, models }] of avatars.current) {
      const pose = poses.get(id);
      body.visible = pose !== undefined;
      if (!pose) continue;
      body.position.set(...pose.position);
      body.rotation.set(0, pose.yaw, 0);
      aim.rotation.set(pose.pitch, 0, 0);
      for (const [weapon, model] of models) {
        model.visible = weapon === pose.weapon;
      }
    }
  });

  return Arr.map(others, (player) => (
    <Avatar
      key={player.id}
      name={player.name}
      color={colorOf(net, player.id)}
      ref={(group) => {
        const aim = group?.getObjectByName('aim');
        if (group && aim) {
          const models = Arr.flatMap(weaponIds, (weapon) => {
            const model = aim.getObjectByName(weapon);
            return model ? [[weapon, model] as const] : [];
          });
          avatars.current.set(player.id, { body: group, aim, models });
        }
        return () => {
          avatars.current.delete(player.id);
        };
      }}
    />
  ));
};
