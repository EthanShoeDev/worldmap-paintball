import '@tanstack/react-start/client-only';
import { useAtomValue } from '@effect/atom-react';
import { useThree } from '@react-three/fiber';
import {
  CuboidCollider,
  CylinderCollider,
  RigidBody,
} from '@react-three/rapier';
import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr, Record } from 'effect';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  IcosahedronGeometry,
  type InstancedMesh,
  Matrix4,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';

import { arenaGeometries } from './arena-meshes.ts';
import { carGeometry, carKinds, carSizes, parkedCars } from './cars.ts';
import { paintGround } from './ground-texture.ts';
import { imageryAtom, photoOf } from './imagery.ts';
import { rampsOf } from './ramps.ts';
import { heightRange } from './terrain.ts';
import { canopyCover } from './tree-cover.ts';
import { scatterTrees, type Tree } from './trees.ts';

const passThrough = () => undefined;

const wallHeight = 40;
// Straight panels around a round arena, each overlapping the next a little.
const roundPanels = 72;

const Boundary = ({ arena }: { readonly arena: Arena }) => {
  const { halfSize } = arena;
  const { lowest, highest } = heightRange(arena);
  const bottom = lowest - 2;
  const wallHalf = (highest + wallHeight - bottom) / 2;
  const wallY = bottom + wallHalf;
  const offset = halfSize + 0.5;
  const panel = ((Math.PI * 2 * offset) / roundPanels) * 0.55;
  return (
    <RigidBody type='fixed' colliders={false}>
      {/* The ground never dips below its lowest node, so a floor there backs
      it up without poking through. */}
      <CuboidCollider
        args={[halfSize, 1, halfSize]}
        position={[0, lowest - 1, 0]}
      />
      {arena.round === true ? (
        Arr.makeBy(roundPanels, (index) => {
          const angle = (index / roundPanels) * Math.PI * 2;
          return (
            <CuboidCollider
              key={index}
              args={[0.5, wallHalf, panel]}
              position={[
                Math.cos(angle) * offset,
                wallY,
                Math.sin(angle) * offset,
              ]}
              rotation={[0, -angle, 0]}
            />
          );
        })
      ) : (
        <>
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
        </>
      )}
    </RigidBody>
  );
};

// A round arena's wall is shown, faintly: unlike the square's, it doesn't
// follow the edge of the ground.
const RoundWall = ({ arena }: { readonly arena: Arena }) => {
  const { lowest, highest } = heightRange(arena);
  const height = highest - lowest + 6;
  return (
    <mesh position-y={lowest + height / 2} raycast={passThrough}>
      <cylinderGeometry
        args={[arena.halfSize, arena.halfSize, height, 96, 1, true]}
      />
      <meshBasicMaterial
        color='#7dd3fc'
        transparent
        opacity={0.14}
        side={DoubleSide}
        depthWrite={false}
      />
    </mesh>
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
  const ramps = useMemo(() => rampsOf(arena), [arena]);
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
      {arena.round === true && <RoundWall arena={arena} />}
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
      {geometries.ramps && (
        // Boxes, not a trimesh: a thin slab as a trimesh lets a fast body
        // through.
        <RigidBody type='fixed' colliders={false}>
          {Arr.map(ramps, ({ position, quaternion, halfExtents }, index) => (
            <CuboidCollider
              key={index}
              args={[...halfExtents]}
              position={position}
              quaternion={quaternion}
            />
          ))}
          <mesh geometry={geometries.ramps} castShadow receiveShadow>
            <meshStandardMaterial color='#8a6a4a' />
          </mesh>
        </RigidBody>
      )}
      <ParkedCars arena={arena} />
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
  colors,
  solid = true,
}: {
  readonly geometry: BufferGeometry;
  readonly color: string;
  readonly matrices: ReadonlyArray<Matrix4>;
  // Each instance's colour, tinting `color`.
  readonly colors?: ReadonlyArray<Color>;
  // Whether shots and sight lines stop at it.
  readonly solid?: boolean;
}) => {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    for (const [index, matrix] of matrices.entries()) {
      instances.setMatrixAt(index, matrix);
      const tint = colors?.[index];
      if (tint) instances.setColorAt(index, tint);
    }
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
    instances.computeBoundingSphere();
  }, [matrices, colors]);
  return matrices.length > 0 ? (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, matrices.length]}
      {...(!solid && { raycast: passThrough })}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} flatShading />
    </instancedMesh>
  ) : null;
};

const canopyOf = (arena: Arena, photo: HTMLCanvasElement | undefined) => {
  const pixels = photo
    ?.getContext('2d')
    ?.getImageData(0, 0, photo.width, photo.height);
  return pixels && canopyCover(pixels, arena);
};

// The trunk geometry's radius and height for a tree one metre tall.
const trunkRadius = 0.03;
const trunkHeight = 0.4;

// Players can't walk through trunks; crowns stay passable.
const TrunkColliders = ({ trees }: { readonly trees: ReadonlyArray<Tree> }) => (
  <RigidBody type='fixed' colliders={false}>
    {Arr.map(trees, ({ position: [x, y, z], height }, index) => (
      <CylinderCollider
        key={index}
        args={[(trunkHeight * height) / 2, trunkRadius * height]}
        position={[x, y + (trunkHeight * height) / 2, z]}
      />
    ))}
  </RigidBody>
);

// Inside the raycast group: trunks stop shots and sight lines, as they stop
// bodies, while crowns let both through.
export const ArenaTrees = ({ arena }: { readonly arena: Arena }) => {
  const photo = useAtomValue(imageryAtom(arena), photoOf);
  const { trees, trunks, conifers, broadleaves } = useMemo(() => {
    const trees = scatterTrees(arena, canopyOf(arena, photo));
    return {
      trees,
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
  }, [arena, photo]);
  return (
    <>
      <TrunkColliders trees={trees} />
      <Instances geometry={trunk} color='#6b4f36' matrices={trunks} />
      <Instances
        geometry={coniferCrown}
        color='#2f5a32'
        matrices={conifers}
        solid={false}
      />
      <Instances
        geometry={broadleafCrown}
        color='#4c7a3a'
        matrices={broadleaves}
        solid={false}
      />
    </>
  );
};

const carModels = Record.map(carSizes, (_, kind) => carGeometry(kind));

// Parked cars: cover to duck behind and roofs to climb on.
const ParkedCars = ({ arena }: { readonly arena: Arena }) => {
  const cars = useMemo(() => parkedCars(arena), [arena]);
  const kinds = useMemo(
    () =>
      Arr.map(carKinds, (kind) => {
        const ofKind = Arr.filter(cars, (car) => car.kind === kind);
        return {
          kind,
          matrices: Arr.map(ofKind, ({ centre, quaternion }) =>
            new Matrix4().compose(
              new Vector3(...centre),
              new Quaternion(...quaternion),
              new Vector3(1, 1, 1),
            ),
          ),
          paints: Arr.map(ofKind, ({ paint }) => new Color(paint)),
        };
      }),
    [cars],
  );
  return (
    <>
      <RigidBody type='fixed' colliders={false}>
        {Arr.map(cars, ({ kind, centre, quaternion }, index) => {
          const [length, width, height] = carSizes[kind];
          return (
            <CuboidCollider
              key={index}
              args={[width / 2, height / 2, length / 2]}
              position={centre}
              quaternion={quaternion}
            />
          );
        })}
      </RigidBody>
      {Arr.map(kinds, ({ kind, matrices, paints }) => (
        <group key={kind}>
          <Instances
            geometry={carModels[kind].body}
            color='#ffffff'
            matrices={matrices}
            colors={paints}
          />
          <Instances
            geometry={carModels[kind].glass}
            color='#1e293b'
            matrices={matrices}
          />
          <Instances
            geometry={carModels[kind].wheels}
            color='#18181b'
            matrices={matrices}
          />
        </group>
      ))}
    </>
  );
};
