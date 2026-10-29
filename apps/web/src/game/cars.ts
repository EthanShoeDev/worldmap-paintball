import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Euler,
  Quaternion,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { insideRing, spawnPoints } from './arena-meshes.ts';
import { nextRandom } from './bot-brain.ts';
import { padsOf } from './powerups.ts';
import { rampsOf } from './ramps.ts';
import { heightAt, inArena } from './terrain.ts';

type Point = readonly [number, number];

export const carKinds = ['sedan', 'suv', 'pickup'] as const;
export type CarKind = (typeof carKinds)[number];

// Length, width and height in metres.
export const carSizes: Record<CarKind, readonly [number, number, number]> = {
  sedan: [4.5, 1.8, 1.45],
  suv: [4.7, 1.9, 1.8],
  pickup: [5.3, 1.95, 1.85],
};

const paints = [
  '#b91c1c',
  '#1d4ed8',
  '#e5e7eb',
  '#1f2937',
  '#6b7280',
  '#15803d',
  '#ca8a04',
  '#0e7490',
  '#f8fafc',
];

export interface Car {
  readonly kind: CarKind;
  // The middle of the car's box, which is tilted to follow the road's slope.
  readonly centre: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly paint: string;
}

const carTuning = {
  // Narrower ways are footpaths and service lanes.
  minRoadWidth: 5,
  // Kerb per car slot, and the most cars a slot is given at.
  slot: 7,
  maxShare: 0.35,
  // At most this many cars per metre of half size: 50, 75 and 112.
  perHalfSize: 0.5,
  kerbGap: 0.3,
  // Kept off spawns and power-up pads.
  openClearance: 4,
};
// Fixed, so every peer parks the same cars.
const carSeed = 48_271;

const across = ([x, z]: Point): Point => [-z, x];

const distanceToPath = ([x, z]: Point, path: ReadonlyArray<Point>) =>
  Math.min(
    Infinity,
    ...Arr.flatMap(path, ([ax, az], index) => {
      const to = path[index + 1];
      if (!to) return [];
      const [dx, dz] = [to[0] - ax, to[1] - az];
      const length = dx * dx + dz * dz;
      const t =
        length > 0
          ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length))
          : 0;
      return [Math.hypot(x - (ax + t * dx), z - (az + t * dz))];
    }),
  );

interface Slot {
  readonly road: number;
  readonly width: number;
  readonly at: Point;
  readonly along: Point;
}

// Evenly spaced points along each street wide enough to park on, each slot
// wholly within one straight piece of its road.
const kerbSlots = (roads: Arena['roads']) =>
  Arr.flatMap(roads, ({ path, width }, road) =>
    width < carTuning.minRoadWidth
      ? []
      : Arr.flatMap(path, (from, index) => {
          const to = path[index + 1];
          if (!to) return [];
          const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
          const along = [
            (to[0] - from[0]) / length,
            (to[1] - from[1]) / length,
          ] as const;
          const count = Math.floor(length / carTuning.slot);
          return Arr.makeBy(count, (slot): Slot => {
            const distance = (slot + 0.5) * carTuning.slot;
            return {
              road,
              width,
              at: [
                from[0] + along[0] * distance,
                from[1] + along[1] * distance,
              ],
              along,
            };
          });
        }),
  );

// Cars parked along the kerbs, derived from the arena alone so every peer
// parks the same ones. They keep off junctions, buildings, ramps, water,
// spawns and power-up pads.
export const parkedCars = (arena: Arena) => {
  const slots = kerbSlots(arena.roads);
  const limit = Math.round(arena.halfSize * carTuning.perHalfSize);
  const share = Math.min(carTuning.maxShare, limit / (slots.length || 1));
  const keepClear = [
    ...spawnPoints(arena),
    ...Arr.map(padsOf(arena), ({ position }) => position),
  ];
  const ramps = rampsOf(arena);
  const water = Arr.filter(arena.areas, ({ kind }) => kind === 'water');
  let seed = nextRandom(carSeed)[1];
  const roll = () => {
    const [value, next] = nextRandom(seed);
    seed = next;
    return value;
  };

  const fits = (
    centre: Point,
    corners: ReadonlyArray<Point>,
    road: number,
    length: number,
  ) =>
    Arr.every(corners, ([x, z]) => inArena(arena, x, z, 1)) &&
    Arr.every(
      keepClear,
      ([x, z]) =>
        Math.hypot(centre[0] - x, centre[1] - z) > carTuning.openClearance,
    ) &&
    Arr.every(
      arena.roads,
      ({ path, width }, other) =>
        other === road || distanceToPath(centre, path) > width / 2 + length / 2,
    ) &&
    Arr.every(
      arena.buildings,
      ({ footprint }) =>
        !Arr.some([centre, ...corners], (point) =>
          insideRing(point, footprint),
        ),
    ) &&
    Arr.every(
      ramps,
      ({ position: [x, , z], halfExtents: [reach] }) =>
        Math.hypot(centre[0] - x, centre[1] - z) > reach + length / 2,
    ) &&
    Arr.every(water, ({ outline }) => !insideRing(centre, outline));

  const cars: Array<Car> = [];
  for (const { road, width, at, along } of slots) {
    if (cars.length >= limit) break;
    if (roll() >= share) continue;
    const kind = carKinds[Math.floor(roll() * carKinds.length)] ?? 'sedan';
    const paint = paints[Math.floor(roll() * paints.length)] ?? '#e5e7eb';
    const side = roll() < 0.5 ? -1 : 1;
    // Facing with the traffic or against it.
    const facing = roll() < 0.5 ? 1 : -1;
    const [length, carWidth, height] = carSizes[kind];
    const offset = side * (width / 2 - carWidth / 2 - carTuning.kerbGap);
    const sideways = across(along);
    const centre = [
      at[0] + sideways[0] * offset,
      at[1] + sideways[1] * offset,
    ] as const;
    const corner = (forward: number, out: number): Point => [
      centre[0] + along[0] * forward + sideways[0] * out,
      centre[1] + along[1] * forward + sideways[1] * out,
    ];
    const corners = Arr.flatMap([-length / 2, length / 2], (forward) =>
      Arr.map([-carWidth / 2, carWidth / 2], (out) => corner(forward, out)),
    );
    if (!fits(centre, corners, road, length)) continue;
    // The car's +z end, with its height there and at the other end.
    const back = [along[0] * facing, along[1] * facing] as const;
    const rear = heightAt(
      arena,
      centre[0] + (back[0] * length) / 2,
      centre[1] + (back[1] * length) / 2,
    );
    const front = heightAt(
      arena,
      centre[0] - (back[0] * length) / 2,
      centre[1] - (back[1] * length) / 2,
    );
    const pitch = -Math.atan2(rear - front, length);
    const rotation = new Quaternion().setFromEuler(
      new Euler(pitch, Math.atan2(back[0], back[1]), 0, 'YXZ'),
    );
    cars.push({
      kind,
      centre: [centre[0], (rear + front) / 2 + height / 2, centre[1]],
      quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
      paint,
    });
  }
  return cars;
};

// How each kind is shaped: where the body gives way to the cabin, and the
// cabin's length and how far back of the middle it sits. The front is -z.
const carShapes: Record<
  CarKind,
  { readonly waist: number; readonly cabin: number; readonly back: number }
> = {
  sedan: { waist: 0.95, cabin: 2.3, back: 0.25 },
  suv: { waist: 1.1, cabin: 3.1, back: 0.55 },
  pickup: { waist: 1.05, cabin: 1.9, back: -0.9 },
};
const ride = 0.28;
const wheelRadius = 0.34;

const box = (
  [width, height, length]: readonly [number, number, number],
  [x, y, z]: readonly [number, number, number],
) => new BoxGeometry(width, height, length).translate(x, y, z);

const merge = (geometries: ReadonlyArray<BufferGeometry>) => {
  const merged = mergeGeometries([...geometries]);
  for (const geometry of geometries) geometry.dispose();
  return merged;
};

// One car's paintwork, windows and wheels, centred on its box like `Car`.
export const carGeometry = (kind: CarKind) => {
  const [length, width, height] = carSizes[kind];
  const { waist, cabin, back } = carShapes[kind];
  const body = [
    box([width, waist - ride, length], [0, (ride + waist) / 2, 0]),
    box([width - 0.16, height - waist, cabin], [0, (waist + height) / 2, back]),
  ];
  if (kind === 'pickup') {
    // The bed's sides and tailgate, behind the cabin.
    const bedFront = back + cabin / 2;
    const bed = length / 2 - bedFront;
    const rail = (x: number) =>
      box([0.08, 0.3, bed], [x, waist + 0.15, bedFront + bed / 2]);
    body.push(
      rail(width / 2 - 0.04),
      rail(-width / 2 + 0.04),
      box([width, 0.3, 0.08], [0, waist + 0.15, length / 2 - 0.04]),
    );
  }
  // A band a little proud of the cabin, so it shows as windows all round.
  const glassBottom = waist + 0.06;
  const glassTop = height - 0.1;
  const glass = [
    box(
      [width - 0.14, glassTop - glassBottom, cabin + 0.02],
      [0, (glassBottom + glassTop) / 2, back],
    ),
  ];
  const wheels = Arr.flatMap([-1, 1], (x) =>
    Arr.map([-1, 1], (z) =>
      new CylinderGeometry(wheelRadius, wheelRadius, 0.26, 12)
        .rotateZ(Math.PI / 2)
        .translate(x * (width / 2 - 0.12), wheelRadius, z * (length / 2 - 0.9)),
    ),
  );
  const centred = (parts: ReadonlyArray<BufferGeometry>) =>
    merge(parts).translate(0, -height / 2, 0);
  return {
    body: centred(body),
    glass: centred(glass),
    wheels: centred(wheels),
  };
};
