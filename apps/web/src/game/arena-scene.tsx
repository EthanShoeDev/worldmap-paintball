import '@tanstack/react-start/client-only';
import { useAtomValue } from '@effect/atom-react';
import { useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr, Record } from 'effect';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  type InstancedMesh,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';

import { arenaGeometries } from './arena-meshes.ts';
import { paintGround } from './ground-texture.ts';
import { imageryAtom, photoOf } from './imagery.ts';
import { heightRange } from './terrain.ts';
import { scatterTrees, type Tree } from './trees.ts';

const wallHeight = 40;

const Boundary = ({ arena }: { readonly arena: Arena }) => {
  const { halfSize } = arena;
  const { lowest, highest } = heightRange(arena);
  const bottom = lowest - 2;
  const wallHalf = (highest + wallHeight - bottom) / 2;
  const wallY = bottom + wallHalf;
  const offset = halfSize + 0.5;
  return (
    <RigidBody type='fixed' colliders={false}>
      {/* The ground never dips below its lowest node, so a floor there backs
      it up without poking through. */}
      <CuboidCollider
        args={[halfSize, 1, halfSize]}
        position={[0, lowest - 1, 0]}
      />
      <CuboidCollider
        args={[0.5, wallHalf, halfSize]}
        position={[offset, wallY, 0]}
      />
      <CuboidCollider
        args={[0.5, wallHalf, halfSize]}
        position={[-offset, wallY, 0]}
      />
      <CuboidCollider
        args={[halfSize, wallHalf, 0.5]}
        position={[0, wallY, offset]}
      />
      <CuboidCollider
        args={[halfSize, wallHalf, 0.5]}
        position={[0, wallY, -offset]}
      />
    </RigidBody>
  );
};

const useGroundTexture = (arena: Arena) => {
  const photo = useAtomValue(imageryAtom(arena), photoOf);
  const anisotropy = useThree((state) =>
    state.gl.capabilities.getMaxAnisotropy(),
  );
  const texture = useMemo(() => {
    const map = new CanvasTexture(paintGround(arena, photo));
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = anisotropy;
    return map;
  }, [arena, photo, anisotropy]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
};

export const ArenaScene = ({ arena }: { readonly arena: Arena }) => {
  const geometries = useMemo(() => arenaGeometries(arena), [arena]);
  useEffect(
    () => () => {
      for (const geometry of Record.values(geometries)) geometry?.dispose();
    },
    [geometries],
  );
  const texture = useGroundTexture(arena);
  const size = arena.halfSize * 2;

  return (
    <>
      <Boundary arena={arena} />
      <RigidBody type='fixed' colliders='trimesh'>
        <mesh geometry={geometries.ground} receiveShadow>
          <meshStandardMaterial map={texture} />
        </mesh>
      </RigidBody>
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={heightRange(arena).lowest - 0.05}
      >
        <planeGeometry args={[size * 4, size * 4]} />
        <meshStandardMaterial color='#7d8a6c' />
      </mesh>
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

// A tree one metre tall, standing on the origin; instances scale it up. The
// trunk starts a little underground so slopes never show its base.
const trunk = new CylinderGeometry(0.025, 0.035, 0.4, 5).translate(0, 0.18, 0);
const coniferCrown = new ConeGeometry(0.22, 0.75, 7).translate(0, 0.625, 0);
const broadleafCrown = new IcosahedronGeometry(0.3, 0).translate(0, 0.65, 0);

const treeMatrix = ({ position, height, yaw }: Tree) =>
  new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(0, yaw, 0)),
    new Vector3(height, height, height),
  );

const Instances = ({
  geometry,
  color,
  matrices,
}: {
  readonly geometry: BufferGeometry;
  readonly color: string;
  readonly matrices: ReadonlyArray<Matrix4>;
}) => {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    for (const [index, matrix] of matrices.entries()) {
      instances.setMatrixAt(index, matrix);
    }
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
  }, [matrices]);
  return matrices.length > 0 ? (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, matrices.length]}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} flatShading />
    </instancedMesh>
  ) : null;
};

// Outside the raycast group: shots and sight lines pass through trees, as
// bodies do.
export const ArenaTrees = ({ arena }: { readonly arena: Arena }) => {
  const { trunks, conifers, broadleaves } = useMemo(() => {
    const trees = scatterTrees(arena);
    return {
      trunks: Arr.map(trees, treeMatrix),
      conifers: Arr.map(
        Arr.filter(trees, (tree) => tree.conifer),
        treeMatrix,
      ),
      broadleaves: Arr.map(
        Arr.filter(trees, (tree) => !tree.conifer),
        treeMatrix,
      ),
    };
  }, [arena]);
  return (
    <>
      <Instances geometry={trunk} color='#6b4f36' matrices={trunks} />
      <Instances geometry={coniferCrown} color='#2f5a32' matrices={conifers} />
      <Instances
        geometry={broadleafCrown}
        color='#4c7a3a'
        matrices={broadleaves}
      />
    </>
  );
};
