import '@tanstack/react-start/client-only';
import { Array as Arr } from 'effect';
import { Atom } from 'effect/reactivity';
import { Quaternion, Vector3 } from 'three';

const maxSplats = 300;
const palette = ['#ff3b6b', '#ffd23f', '#3bceac', '#5b8cff', '#ff8c42'];
const facing = new Vector3(0, 0, 1);

export interface Hit {
  readonly point: Vector3;
  readonly normal: Vector3;
}

export interface Splat {
  readonly id: number;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly color: string;
  readonly size: number;
}

export const splatsAtom = Atom.make<ReadonlyArray<Splat>>([]);

// Solo practice cycles this palette, shot by shot; a match paints in the
// shooter's colour.
export const soloPaint = (shot: number) =>
  palette[shot % palette.length] ?? '#ff3b6b';

export const appendSplat = (
  splats: ReadonlyArray<Splat>,
  { point, normal }: Hit,
  color: string,
  scale = 1,
) => {
  const id = (splats.at(-1)?.id ?? -1) + 1;
  const splat: Splat = {
    id,
    // Lift off the surface so the decal doesn't z-fight with it.
    position: point.clone().addScaledVector(normal, 0.02),
    rotation: new Quaternion().setFromUnitVectors(facing, normal),
    color,
    size: (0.2 + (id % 3) * 0.06) * scale,
  };
  return Arr.append(Arr.takeRight(splats, maxSplats - 1), splat);
};
