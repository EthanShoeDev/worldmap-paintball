import type { Arena } from '@worldmap-paintball/api-contract';
import type {
  MapSettings,
  MatchRules,
} from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';

import { arenaAtom } from '../api-client.ts';
import type { Coordinates } from '../location/coordinates.ts';
import { inArena } from './terrain.ts';

type Point = readonly [number, number];

// Where segment a-b runs inside the circle of `radius` about the centre, as
// a range of t from a (0) to b (1).
const spanInside = (a: Point, b: Point, radius: number) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const qa = dx * dx + dz * dz;
  const qb = 2 * (a[0] * dx + a[1] * dz);
  const qc = a[0] * a[0] + a[1] * a[1] - radius * radius;
  if (qa === 0) return qc <= 0 ? ([0, 1] as const) : undefined;
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return undefined;
  const root = Math.sqrt(discriminant);
  const from = Math.max(0, (-qb - root) / (2 * qa));
  const to = Math.min(1, (-qb + root) / (2 * qa));
  return from < to ? ([from, to] as const) : undefined;
};

const lerp = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

// The runs of a road inside a round arena, cut where it meets the wall, so
// bots never path out past it.
export const clipToCircle = (path: ReadonlyArray<Point>, radius: number) => {
  const runs: Array<Array<Point>> = [];
  let open = false;
  for (const [index, a] of path.entries()) {
    const b = path[index + 1];
    if (!b) break;
    const span = spanInside(a, b, radius);
    if (!span) {
      open = false;
      continue;
    }
    const [from, to] = span;
    if (!open || from > 0) runs.push([lerp(a, b, from)]);
    runs.at(-1)?.push(lerp(a, b, to));
    open = to === 1;
  }
  return runs;
};

// The host's settings on top of the baked arena. Buildings already stand on
// the lowest ground under them, so they follow the scaled terrain. A round
// arena drops what crosses its wall.
export const customizeArena = (
  baked: Arena,
  { elevationScale, buildings, shape }: MapSettings,
): Arena => {
  const arena: Arena = shape === 'circle' ? { ...baked, round: true } : baked;
  const inside = ([x, z]: Point) => inArena(arena, x, z);
  const fits = ({ footprint }: { readonly footprint: ReadonlyArray<Point> }) =>
    Arr.every(footprint, inside);
  return {
    ...arena,
    // Houses drawn on a larger arena may fall outside a smaller one.
    buildings: [
      ...(arena.round === true
        ? Arr.filter(arena.buildings, fits)
        : arena.buildings),
      ...Arr.filter(buildings, fits),
    ],
    roads:
      arena.round === true
        ? Arr.flatMap(arena.roads, (road) =>
            Arr.map(clipToCircle(road.path, arena.halfSize), (path) => ({
              ...road,
              path,
            })),
          )
        : arena.roads,
    ...(arena.terrain && {
      terrain: {
        ...arena.terrain,
        heights: Arr.map(
          arena.terrain.heights,
          (height) => height * elevationScale,
        ),
      },
    }),
  };
};

export interface ArenaKey extends Coordinates {
  readonly map: MapSettings;
  readonly bake?: string;
}

// A match also needs its rules: they shape ball flight and hit checks.
export interface MatchKey extends ArenaKey {
  readonly rules: MatchRules;
}

// Keyed structurally, so every reader of the same settings shares one arena
// object and its meshes.
export const customArenaAtom = Atom.family(({ map, ...query }: ArenaKey) =>
  Atom.map(
    arenaAtom({ ...query, size: map.size }),
    AsyncResult.map((arena) => customizeArena(arena, map)),
  ),
);
