import type { Arena } from '@worldmap-paintball/api-contract';
import { Array as Arr } from 'effect';
import { BoxGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { type Ground, groundBelow, heightAt } from './terrain.ts';

type Point = readonly [number, number];

// Some houses get a ramp up to their flat roof, out from the middle of their
// longest wall. Whether a house gets one, and where, comes from its outline
// alone, so every browser builds the same ramps without telling the others.
const rampShare = 0.35;
// Shallow enough for a running character to climb.
const rampSlope = (30 * Math.PI) / 180;
const rampWidth = 1.6;
const rampThickness = 0.3;
const roofHeights = { min: 2.5, max: 15 };

export interface Ramp {
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  // Half extents along the ramp, through it, and across it.
  readonly halfExtents: readonly [number, number, number];
}

// A stable pseudo-random number in [0, 1) for a house.
const houseRoll = ([x, z]: Point) => {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43_758.5453;
  return value - Math.floor(value);
};

const longestEdge = (ring: ReadonlyArray<Point>) => {
  let best: readonly [Point, Point] | undefined;
  let bestLength = 0;
  for (const [index, from] of ring.entries()) {
    const to = ring[(index + 1) % ring.length];
    if (!to) continue;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length > bestLength) [best, bestLength] = [[from, to], length];
  }
  return best && { from: best[0], to: best[1], length: bestLength };
};

const rampOf = (
  ground: Ground,
  footprint: ReadonlyArray<Point>,
  height: number,
): Ramp | undefined => {
  const [first] = footprint;
  if (!first || height < roofHeights.min || height > roofHeights.max) {
    return undefined;
  }
  if (houseRoll(first) >= rampShare) return undefined;
  const edge = longestEdge(footprint);
  if (!edge || edge.length < rampWidth + 1) return undefined;
  const along = [
    (edge.to[0] - edge.from[0]) / edge.length,
    (edge.to[1] - edge.from[1]) / edge.length,
  ] as const;
  const middle = [
    (edge.from[0] + edge.to[0]) / 2,
    (edge.from[1] + edge.to[1]) / 2,
  ] as const;
  // Outward: away from the footprint's average vertex.
  const centre = [
    Arr.reduce(footprint, 0, (sum, [x]) => sum + x) / footprint.length,
    Arr.reduce(footprint, 0, (sum, [, z]) => sum + z) / footprint.length,
  ];
  let out = [-along[1], along[0]] as const;
  if (
    (middle[0] - (centre[0] ?? 0)) * out[0] +
      (middle[1] - (centre[1] ?? 0)) * out[1] <
    0
  ) {
    out = [-out[0], -out[1]];
  }
  const roof = groundBelow(ground, footprint) + height;
  // Run until the ramp would rise to the roof, measured from the ground
  // where it starts.
  let run = height / Math.tan(rampSlope);
  let foot: Point = [middle[0] + out[0] * run, middle[1] + out[1] * run];
  run = (roof - heightAt(ground, ...foot)) / Math.tan(rampSlope);
  if (run <= 0) return undefined;
  foot = [middle[0] + out[0] * run, middle[1] + out[1] * run];
  const limit = ground.halfSize - 1;
  if (Math.abs(foot[0]) > limit || Math.abs(foot[1]) > limit) return undefined;
  const bottom = new Vector3(foot[0], heightAt(ground, ...foot), foot[1]);
  const top = new Vector3(middle[0], roof, middle[1]);
  const up = top.clone().sub(bottom);
  const length = up.length();
  const x = up.clone().normalize();
  const z = new Vector3(along[0], 0, along[1]);
  const y = z.clone().cross(x).normalize();
  if (y.y < 0) {
    y.negate();
    z.negate();
  }
  const rotation = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, z),
  );
  // The walking surface runs from foot to roof edge; the slab hangs below.
  const centreOf = bottom
    .clone()
    .add(top)
    .multiplyScalar(0.5)
    .addScaledVector(y, -rampThickness / 2);
  return {
    position: [centreOf.x, centreOf.y, centreOf.z],
    quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
    halfExtents: [length / 2, rampThickness / 2, rampWidth / 2],
  };
};

export const rampsOf = ({
  buildings,
  ...ground
}: Ground & Pick<Arena, 'buildings'>) =>
  Arr.flatMap(buildings, ({ footprint, height }) => {
    const ramp = rampOf(ground, footprint, height);
    return ramp ? [ramp] : [];
  });

export const rampsGeometry = (ramps: ReadonlyArray<Ramp>) => {
  if (ramps.length === 0) return undefined;
  const boxes = Arr.map(ramps, ({ position, quaternion, halfExtents }) =>
    new BoxGeometry(
      halfExtents[0] * 2,
      halfExtents[1] * 2,
      halfExtents[2] * 2,
    ).applyMatrix4(
      new Matrix4().compose(
        new Vector3(...position),
        new Quaternion(...quaternion),
        new Vector3(1, 1, 1),
      ),
    ),
  );
  const merged = mergeGeometries(boxes);
  for (const box of boxes) box.dispose();
  return merged ?? undefined;
};
