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
  allWeaponIds,
  bodyHalfHeight,
  bodyRadius,
  eyeOffset,
  markerTuning,
  type WeaponId,
} from './tuning.ts';

type Net = NetGame['Service'];

const { held } = markerTuning;

interface AvatarParts {
  readonly body: Group;
  readonly aim: Object3D;
  readonly ghost: Object3D;
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
    {/* X-ray: drawn last and over everything, walls included. */}
    <mesh name='ghost' renderOrder={10} visible={false}>
      <capsuleGeometry
        args={[bodyRadius + 0.05, bodyHalfHeight * 2 + 0.3, 4, 12]}
      />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.55}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
    {/* Same transforms as heldMuzzle. */}
    <group name='aim' position={[...held.pivot]}>
      <group position={[...held.position]} scale={held.scale}>
        {Arr.map(allWeaponIds, (weapon) => (
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
// While `xray` says so, each also shows through walls.
export const RemotePlayers = ({
  net,
  xray,
}: {
  readonly net: Net;
  readonly xray: () => boolean;
}) => {
  const present = new Set(useAtomValue(matchViewAtom).present);
  const avatars = useRef(new Map<PlayerId, AvatarParts>());
  const others = Arr.filter(
    net.roster,
    (player) => player.id !== net.you && present.has(player.id),
  );

  useFrame(() => {
    const poses = net.updateRemotes();
    const seeThrough = xray();
    for (const [id, { body, aim, ghost, models }] of avatars.current) {
      const pose = poses.get(id);
      body.visible = pose !== undefined;
      if (!pose) continue;
      ghost.visible = seeThrough;
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
        const ghost = group?.getObjectByName('ghost');
        if (group && aim && ghost) {
          const models = Arr.flatMap(allWeaponIds, (weapon) => {
            const model = aim.getObjectByName(weapon);
            return model ? [[weapon, model] as const] : [];
          });
          avatars.current.set(player.id, { body: group, aim, ghost, models });
        }
        return () => {
          avatars.current.delete(player.id);
        };
      }}
    />
  ));
};
