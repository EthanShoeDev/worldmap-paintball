import '@tanstack/react-start/client-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr, Option } from 'effect';
import { type RefObject, useRef } from 'react';
import type { Group, Object3D } from 'three';

import { inLobbyAtom } from '../lobby/lobby-atoms.ts';
import { colorOf, type NetGame } from './net/net-game.ts';
import { traceShot } from './shots.ts';
import { appendSplat, splatsAtom } from './splats.ts';
import { bodyHalfHeight, bodyRadius, eyeOffset } from './tuning.ts';

type Net = NetGame['Service'];

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
  const inLobby = useAtomValue(inLobbyAtom);
  const avatars = useRef(new Map<PlayerId, Group>());
  const present = new Set(
    Option.match(inLobby, {
      onNone: () => [],
      onSome: ({ lobby }) => Arr.map(lobby.players, (player) => player.id),
    }),
  );
  const others = Arr.filter(
    net.roster,
    (player) => player.id !== net.you && present.has(player.id),
  );

  useFrame(() => {
    const poses = net.updateRemotes();
    for (const [id, group] of avatars.current) {
      const pose = poses.get(id);
      group.visible = pose !== undefined;
      if (!pose) continue;
      group.position.set(...pose.position);
      group.rotation.set(0, pose.yaw, 0);
    }
  });

  return Arr.map(others, (player) => (
    <Avatar
      key={player.id}
      name={player.name}
      color={colorOf(net, player.id)}
      ref={(group) => {
        if (group) avatars.current.set(player.id, group);
        return () => {
          avatars.current.delete(player.id);
        };
      }}
    />
  ));
};

// Paints other players' shots: each is re-traced against this peer's arena
// and the players it can see, so a shot that hit someone leaves no splat.
export const RemoteShots = ({
  net,
  arena,
}: {
  readonly net: Net;
  readonly arena: RefObject<Object3D | null>;
}) => {
  const setSplats = useAtomSet(splatsAtom);

  useFrame(() => {
    for (const shot of net.takeShots()) {
      const { surface } = traceShot(
        arena.current,
        shot.origin,
        shot.dir,
        net.targets(shot.shooter),
      );
      if (surface) {
        setSplats((splats) =>
          appendSplat(splats, surface, colorOf(net, shot.shooter)),
        );
      }
    }
  });

  return null;
};
