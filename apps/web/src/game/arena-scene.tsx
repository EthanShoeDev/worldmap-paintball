import '@tanstack/react-start/client-only';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Record } from 'effect';
import { useEffect, useMemo } from 'react';
import type { BufferGeometry } from 'three';

import { arenaGeometries } from './arena-meshes.ts';

const wallHeight = 40;

const Surface = ({
  geometry,
  color,
}: {
  readonly geometry: BufferGeometry | undefined;
  readonly color: string;
}) =>
  geometry ? (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        color={color}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  ) : null;

const Boundary = ({ halfSize }: { readonly halfSize: number }) => {
  const offset = halfSize + 0.5;
  return (
    <RigidBody type='fixed' colliders={false}>
      <CuboidCollider args={[halfSize, 1, halfSize]} position={[0, -1, 0]} />
      <CuboidCollider
        args={[0.5, wallHeight, halfSize]}
        position={[offset, wallHeight, 0]}
      />
      <CuboidCollider
        args={[0.5, wallHeight, halfSize]}
        position={[-offset, wallHeight, 0]}
      />
      <CuboidCollider
        args={[halfSize, wallHeight, 0.5]}
        position={[0, wallHeight, offset]}
      />
      <CuboidCollider
        args={[halfSize, wallHeight, 0.5]}
        position={[0, wallHeight, -offset]}
      />
    </RigidBody>
  );
};

export const ArenaScene = ({ arena }: { readonly arena: Arena }) => {
  const geometries = useMemo(() => arenaGeometries(arena), [arena]);
  useEffect(
    () => () => {
      for (const geometry of Record.values(geometries)) geometry?.dispose();
    },
    [geometries],
  );
  const size = arena.halfSize * 2;

  return (
    <>
      <Boundary halfSize={arena.halfSize} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color='#b9b09a' />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05}>
        <planeGeometry args={[size * 4, size * 4]} />
        <meshStandardMaterial color='#7d8a6c' />
      </mesh>
      <Surface geometry={geometries.parks} color='#6fa35a' />
      <Surface geometry={geometries.water} color='#4f86c6' />
      <Surface geometry={geometries.roads} color='#55575c' />
      {geometries.buildings && (
        <RigidBody type='fixed' colliders='trimesh'>
          <mesh geometry={geometries.buildings} castShadow receiveShadow>
            <meshStandardMaterial color='#d8d2c8' />
          </mesh>
        </RigidBody>
      )}
    </>
  );
};
