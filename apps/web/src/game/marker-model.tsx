import '@tanstack/react-start/client-only';
import { Array as Arr } from 'effect';
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { markerTuning, type WeaponId } from './tuning.ts';

type Vec = readonly [number, number, number];

const part = (
  geometry: BufferGeometry,
  position: Vec,
  rotation: Vec = [0, 0, 0],
  scale: Vec = [1, 1, 1],
) =>
  geometry.applyMatrix4(
    new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromEuler(new Euler(...rotation)),
      new Vector3(...scale),
    ),
  );

const along = Math.PI / 2;

// A barrel ending at `muzzle`, with a ring at its tip.
const barrel = (
  [, y, z]: Vec,
  length: number,
  radius: number,
  ring: number,
) => [
  part(
    new CylinderGeometry(radius, radius, length, 10),
    [0, y, z + length / 2],
    [along, 0, 0],
  ),
  part(
    new CylinderGeometry(ring, ring, 0.03, 10),
    [0, y, z + 0.015],
    [along, 0, 0],
  ),
];

const receiver = () => part(new BoxGeometry(0.045, 0.075, 0.24), [0, 0, 0]);
const triggerGuard = () => [
  // Half a ring, turned to hang below the receiver in its plane.
  part(
    new TorusGeometry(0.028, 0.005, 6, 12, Math.PI),
    [0, -0.0375, -0.025],
    [0, along, Math.PI],
  ),
  part(new BoxGeometry(0.008, 0.03, 0.008), [0, -0.05, -0.02], [0.3, 0, 0]),
];
const grip = () =>
  part(new BoxGeometry(0.036, 0.11, 0.05), [0, -0.085, 0.06], [-0.25, 0, 0]);
// The air tank, angled down and back behind the grip like a stock.
const tankStock = () =>
  part(
    new CapsuleGeometry(0.032, 0.16, 4, 10),
    [0, -0.075, 0.2],
    [along + 0.3, 0, 0],
  );
const stripe = () =>
  part(new BoxGeometry(0.047, 0.012, 0.2), [0, 0.012, -0.01]);

type Parts = Record<
  'body' | 'metal' | 'grip' | 'tank' | 'tint',
  ReadonlyArray<BufferGeometry>
>;

const merged = (parts: Parts) => ({
  body: mergeGeometries([...parts.body]),
  metal: mergeGeometries([...parts.metal]),
  grip: mergeGeometries([...parts.grip]),
  tank: mergeGeometries([...parts.tank]),
  tint: mergeGeometries([...parts.tint]),
});

const { muzzle } = markerTuning;

// One merged geometry per material, so a marker costs five draw calls and
// every player shares them.
const geometries = {
  // A mid-length barrel under a big hopper.
  assault: merged({
    body: [
      receiver(),
      part(new CylinderGeometry(0.016, 0.016, 0.04, 8), [0, 0.055, -0.04]),
      part(
        new CapsuleGeometry(0.02, 0.025, 2, 8),
        [0, -0.035, 0.1],
        [along + 0.3, 0, 0],
      ),
    ],
    metal: [...barrel(muzzle.assault, 0.32, 0.013, 0.018), ...triggerGuard()],
    grip: [grip()],
    tank: [tankStock()],
    tint: [
      part(
        new SphereGeometry(0.075, 12, 10),
        [0, 0.125, -0.02],
        [0, 0, 0],
        [0.85, 0.8, 1.25],
      ),
      stripe(),
    ],
  }),
  // A long barrel under a scope, a shoulder stock, a short bolt handle on the
  // right, and a magazine instead of a hopper.
  sniper: merged({
    body: [
      receiver(),
      part(
        new CylinderGeometry(0.018, 0.018, 0.2, 12),
        [0, 0.078, 0],
        [along, 0, 0],
      ),
      part(
        new CylinderGeometry(0.018, 0.026, 0.05, 12),
        [0, 0.078, -0.12],
        [along, 0, 0],
      ),
      part(
        new CylinderGeometry(0.022, 0.018, 0.03, 12),
        [0, 0.078, 0.11],
        [along, 0, 0],
      ),
      part(new BoxGeometry(0.034, 0.055, 0.26), [0, -0.03, 0.24], [0.12, 0, 0]),
    ],
    metal: [
      ...barrel(muzzle.sniper, 0.6, 0.011, 0.017),
      ...triggerGuard(),
      part(new BoxGeometry(0.014, 0.03, 0.016), [0, 0.05, -0.06]),
      part(new BoxGeometry(0.014, 0.03, 0.016), [0, 0.05, 0.06]),
      part(
        new CylinderGeometry(0.004, 0.004, 0.035, 6),
        [0.038, 0.012, 0.05],
        [0, 0, along - 0.35],
      ),
      part(new SphereGeometry(0.009, 8, 6), [0.054, 0.006, 0.05]),
    ],
    grip: [
      grip(),
      part(new BoxGeometry(0.04, 0.1, 0.022), [0, -0.05, 0.38], [0.12, 0, 0]),
    ],
    tank: [
      part(
        new CapsuleGeometry(0.018, 0.1, 4, 10),
        [0, -0.05, -0.2],
        [along, 0, 0],
      ),
    ],
    tint: [
      part(
        new BoxGeometry(0.026, 0.075, 0.04),
        [0, -0.07, -0.085],
        [-0.15, 0, 0],
      ),
      stripe(),
    ],
  }),
  // A short, wide barrel over a tube magazine with a pump grip, and spare
  // shells on the right of the receiver.
  shotgun: merged({
    body: [receiver()],
    metal: [
      ...barrel(muzzle.shotgun, 0.24, 0.02, 0.024),
      ...triggerGuard(),
      part(
        new CylinderGeometry(0.012, 0.012, 0.22, 10),
        [0, -0.024, -0.23],
        [along, 0, 0],
      ),
    ],
    grip: [
      grip(),
      part(
        new CylinderGeometry(0.022, 0.022, 0.11, 10),
        [0, -0.026, -0.25],
        [along, 0, 0],
      ),
    ],
    tank: [tankStock()],
    tint: [
      ...Arr.makeBy(4, (index) =>
        part(new CylinderGeometry(0.009, 0.009, 0.04, 8), [
          0.03,
          0,
          -0.06 + index * 0.025,
        ]),
      ),
      stripe(),
    ],
  }),
  // A fat tube on the shoulder, painted in the player's colour, with a
  // front grip and a flip-up sight.
  launcher: merged({
    body: [
      receiver(),
      part(new BoxGeometry(0.012, 0.045, 0.012), [0, 0.1, -0.22]),
    ],
    metal: [
      ...triggerGuard(),
      part(
        new CylinderGeometry(0.052, 0.052, 0.04, 14),
        [0, muzzle.launcher[1], muzzle.launcher[2] + 0.02],
        [along, 0, 0],
      ),
      part(
        new CylinderGeometry(0.05, 0.05, 0.04, 14),
        [0, muzzle.launcher[1], 0.23],
        [along, 0, 0],
      ),
    ],
    grip: [
      grip(),
      part(new BoxGeometry(0.03, 0.09, 0.035), [0, -0.06, -0.24], [0.2, 0, 0]),
    ],
    tank: [
      part(new BoxGeometry(0.03, 0.03, 0.08), [0.06, 0.03, 0.02], [0, 0, 0]),
    ],
    tint: [
      part(
        new CylinderGeometry(0.045, 0.045, 0.75, 14),
        [0, muzzle.launcher[1], muzzle.launcher[2] + 0.375],
        [along, 0, 0],
      ),
    ],
  }),
};

const materials = {
  body: new MeshStandardMaterial({
    color: '#2a2e35',
    metalness: 0.4,
    roughness: 0.5,
  }),
  metal: new MeshStandardMaterial({
    color: '#6b7280',
    metalness: 0.7,
    roughness: 0.35,
  }),
  grip: new MeshStandardMaterial({ color: '#111111', roughness: 0.9 }),
  tank: new MeshStandardMaterial({
    color: '#c0c6cf',
    metalness: 0.6,
    roughness: 0.3,
  }),
};

const tints = new Map<string, MeshStandardMaterial>();
const tintOf = (color: string) => {
  const known = tints.get(color);
  if (known) return known;
  const material = new MeshStandardMaterial({ color, roughness: 0.4 });
  tints.set(color, material);
  return material;
};

const shared = ['body', 'metal', 'grip', 'tank'] as const;

// A low-poly paintball marker; the feed and a stripe take `color`.
export const MarkerModel = ({
  weapon,
  color,
  castShadow = false,
}: {
  readonly weapon: WeaponId;
  readonly color: string;
  readonly castShadow?: boolean;
}) => (
  <>
    {Arr.map(shared, (key) => (
      <mesh
        key={key}
        geometry={geometries[weapon][key]}
        material={materials[key]}
        castShadow={castShadow}
      />
    ))}
    <mesh
      geometry={geometries[weapon].tint}
      material={tintOf(color)}
      castShadow={castShadow}
    />
  </>
);
