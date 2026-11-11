#!/usr/bin/env bun
// Simplifies the US Census Bureau's state boundaries into the coverage
// regions src/coverage.ts reads, written to src/us-states.ts:
//
//   curl -o tmp/tl_2023_us_state.zip https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip
//   unzip -o -d tmp/tl_2023_us_state tmp/tl_2023_us_state.zip
//   bun run coverage:build
//
// TIGER/Line boundaries (public domain), unlike the cartographic boundary
// files, run 3 nautical miles out to sea, so barrier islands, sounds and the
// Great Lakes shore stay inside however the coast is simplified. Offshore
// water inside a region is harmless: it bakes as open water.
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Array as Arr,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Schema,
  String as Str,
} from 'effect';
import { Argument, Command } from 'effect/cli';

type Point = readonly [lon: number, lat: number];

// Census also files these territories as states; they are not.
const TERRITORIES = new Set(['AS', 'GU', 'MP', 'PR', 'VI']);

// Douglas–Peucker tolerance. Neighbouring states simplify their shared border
// once, as one arc, so simplifying never opens a gap between them.
const TOLERANCE_METRES = 500;

// Encoded vertices are whole 1e-4 degrees, about 11 m.
const PRECISION = 1e4;

class CoverageBuildError extends Schema.TaggedError<
  CoverageBuildError,
  { readonly brand: unique symbol }
>()('CoverageBuildError', { message: Schema.String }) {}

const decoder = new TextDecoder();

// dBASE III: a header of 32-byte field descriptors ending in 0x0d, then
// fixed-width, space-padded records.
const readDbf = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields: Array<{ name: string; offset: number; length: number }> = [];
  // Byte 0 of each record is its deletion flag.
  for (let at = 32, offset = 1; bytes[at] !== 0x0d; at += 32) {
    // Names are NUL-padded to 11 bytes.
    const raw = bytes.subarray(at, at + 11);
    const nul = raw.indexOf(0);
    const name = decoder.decode(nul === -1 ? raw : raw.subarray(0, nul));
    const length = bytes[at + 16] ?? 0;
    fields.push({ name, offset, length });
    offset += length;
  }
  return Array.from({ length: count }, (_, index) => {
    const start = headerLength + index * recordLength;
    return new Map(
      Arr.map(fields, ({ name, offset, length }) => [
        name,
        Str.trim(
          decoder.decode(
            bytes.subarray(start + offset, start + offset + length),
          ),
        ),
      ]),
    );
  });
};

// ESRI shapefile polygons (shape type 5) as rings without their closing
// vertex, one entry per record; null shapes have no rings.
const readShp = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: Array<Array<Array<Point>>> = [];
  for (let at = 100; at < bytes.byteLength;) {
    const content = at + 8;
    const next = content + view.getInt32(at + 4) * 2;
    const rings: Array<Array<Point>> = [];
    if (view.getInt32(content, true) === 5) {
      const partCount = view.getInt32(content + 36, true);
      const pointCount = view.getInt32(content + 40, true);
      const points = content + 44 + 4 * partCount;
      for (let part = 0; part < partCount; part++) {
        const start = view.getInt32(content + 44 + 4 * part, true);
        const end =
          part + 1 < partCount
            ? view.getInt32(content + 48 + 4 * part, true)
            : pointCount;
        rings.push(
          Array.from({ length: end - start - 1 }, (_, index) => {
            const offset = points + 16 * (start + index);
            return [
              view.getFloat64(offset, true),
              view.getFloat64(offset + 8, true),
            ] as const;
          }),
        );
      }
    }
    records.push(rings);
    at = next;
  }
  return records;
};

const keyOf = ([lon, lat]: Point) => `${lon},${lat}`;

const douglasPeucker = (points: ReadonlyArray<Point>) => {
  const scale = Math.cos(((points[0]?.[1] ?? 0) * Math.PI) / 180);
  const metres = Arr.map(
    points,
    ([lon, lat]) => [lon * scale * 111_320, lat * 110_540] as const,
  );
  const kept = new Uint8Array(points.length);
  kept[0] = 1;
  kept[points.length - 1] = 1;
  const spans: Array<readonly [number, number]> = [[0, points.length - 1]];
  for (let span = spans.pop(); span !== undefined; span = spans.pop()) {
    const [from, to] = span;
    const [ax, ay] = metres[from] ?? [0, 0];
    const [bx, by] = metres[to] ?? [0, 0];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    let farthest = -1;
    let distance = 0;
    for (let index = from + 1; index < to; index++) {
      const [px, py] = metres[index] ?? [0, 0];
      const t =
        lengthSquared === 0
          ? 0
          : Math.min(
              1,
              Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
            );
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (distance > TOLERANCE_METRES) {
      kept[farthest] = 1;
      spans.push([from, farthest], [farthest, to]);
    }
  }
  return Arr.filter(points, (_, index) => kept[index] === 1);
};

// Splits every ring into arcs at its nodes, the vertices with other than two
// distinct neighbours across all rings: where a shared border starts, ends or
// meets a third state. An arc is simplified once whichever way round a ring
// runs it, so both sides of a border get the same vertices.
const simplifyRings = (rings: ReadonlyArray<ReadonlyArray<Point>>) => {
  const neighbours = new Map<string, Set<string>>();
  for (const ring of rings) {
    Arr.forEach(ring, (point, index) => {
      const set = neighbours.get(keyOf(point)) ?? new Set();
      set.add(keyOf(ring[(index + 1) % ring.length] ?? point));
      set.add(keyOf(ring.at(index - 1) ?? point));
      neighbours.set(keyOf(point), set);
    });
  }
  const isNode = (point: Point) => neighbours.get(keyOf(point))?.size !== 2;

  const arcs = new Map<string, ReadonlyArray<Point>>();
  const simplifyArc = (arc: ReadonlyArray<Point>) => {
    const reversed = Arr.reverse(arc);
    const ends = (points: ReadonlyArray<Point>) =>
      Arr.join(Arr.map(Arr.take(points, 2), keyOf), '|');
    const forward = ends(arc) < ends(reversed);
    const canonical = forward ? arc : reversed;
    const key = `${ends(canonical)}|${canonical.length}`;
    const simplified = arcs.get(key) ?? douglasPeucker(canonical);
    arcs.set(key, simplified);
    return forward ? simplified : Arr.reverse(simplified);
  };

  return (ring: ReadonlyArray<Point>) => {
    const start = Option.getOrElse(Arr.findFirstIndex(ring, isNode), () => 0);
    const rotated = [...ring.slice(start), ...ring.slice(0, start)];
    const closed = [...rotated, ...Arr.take(rotated, 1)];
    const simplified: Array<Point> = [];
    let from = 0;
    for (let index = 1; index < closed.length; index++) {
      const point = closed[index];
      if (index === closed.length - 1 || (point && isNode(point))) {
        simplified.push(
          ...Arr.dropRight(simplifyArc(closed.slice(from, index + 1)), 1),
        );
        from = index;
      }
    }
    return simplified;
  };
};

// Google's encoded polyline algorithm, over [lon, lat] pairs in 1e-4 degrees,
// with consecutive duplicates dropped; coverage.ts decodes it. A ring left
// with fewer than three vertices is dropped. Arithmetic stands in for the
// usual bit operations: zigzag signs, then 5-bit chunks, low first, each with
// 32 added while more follow.
const encodeRing = (ring: ReadonlyArray<Point>) => {
  let encoded = '';
  const put = (value: number) => {
    let rest = value < 0 ? -2 * value - 1 : 2 * value;
    for (; rest >= 32; rest = Math.floor(rest / 32)) {
      encoded += String.fromCodePoint((rest % 32) + 32 + 63);
    }
    encoded += String.fromCodePoint(rest + 63);
  };
  let previous: Point = [0, 0];
  let count = 0;
  for (const [lon, lat] of ring) {
    const x = Math.round(lon * PRECISION);
    const y = Math.round(lat * PRECISION);
    if (count > 0 && x === previous[0] && y === previous[1]) continue;
    put(x - previous[0]);
    put(y - previous[1]);
    previous = [x, y];
    count++;
  }
  return count >= 3 ? [encoded] : [];
};

const build = Effect.fn('buildCoverage')(function* ({
  shapefile,
}: {
  readonly shapefile: Option.Option<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageDir = path.resolve(
    path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
    '..',
  );
  const shp = Option.getOrElse(shapefile, () =>
    path.resolve(
      packageDir,
      '..',
      '..',
      'tmp',
      'tl_2023_us_state',
      'tl_2023_us_state.shp',
    ),
  );
  const attributes = readDbf(
    yield* fs.readFile(Str.replace(/\.shp$/, '.dbf')(shp)),
  );
  const shapes = readShp(yield* fs.readFile(shp));

  const states = Arr.flatMap(shapes, (rings, index) => {
    const usps = attributes[index]?.get('STUSPS') ?? '';
    const name = attributes[index]?.get('NAME') ?? '';
    // Alaska's Aleutians west of 180°, the Near and Rat Islands, are left
    // out: the bounding boxes in coverage.ts assume no region crosses it.
    const west = Arr.filter(rings, (ring) =>
      Arr.some(ring, ([lon]) => lon < 0),
    );
    return TERRITORIES.has(usps) || west.length === 0
      ? []
      : [{ id: `us-${Str.toLowerCase(usps)}`, name, rings: west }];
  });
  for (const { id, rings } of states) {
    if (Arr.some(rings, (ring) => Arr.some(ring, ([lon]) => lon > 0))) {
      return yield* CoverageBuildError.make({
        message: `${id} crosses the antimeridian`,
      });
    }
  }

  const simplify = simplifyRings(Arr.flatMap(states, ({ rings }) => rings));
  const regions = Arr.map(
    Arr.sort(
      states,
      Order.mapInput(Str.Order, ({ id }: { id: string }) => id),
    ),
    ({ id, name, rings }) => ({
      id,
      name,
      rings: Arr.flatMap(rings, (ring) => encodeRing(simplify(ring))),
    }),
  );

  // Laid out as oxfmt would, so the generated file passes its check.
  const quoted = (text: string) => `'${Str.replaceAll('\\', '\\\\')(text)}'`;
  const ringsLines = (rings: ReadonlyArray<string>) => {
    const [only] = rings;
    const inline = `    rings: [${quoted(only ?? '')}],`;
    return rings.length === 1 && inline.length <= 80
      ? [inline]
      : [
          '    rings: [',
          ...Arr.map(rings, (ring) => `      ${quoted(ring)},`),
          '    ],',
        ];
  };
  const source = Arr.join(
    [
      '// Generated by `bun run coverage:build` (scripts/build-coverage.ts) from',
      "// the US Census Bureau's TIGER/Line tl_2023_us_state; do not edit.",
      'export const usStates = [',
      ...Arr.flatMap(regions, ({ id, name, rings }) => [
        '  {',
        `    id: ${quoted(id)},`,
        `    name: ${quoted(name)},`,
        ...ringsLines(rings),
        '  },',
      ]),
      '];',
      '',
    ],
    '\n',
  );
  const out = path.join(packageDir, 'src', 'us-states.ts');
  yield* fs.writeFileString(out, source);
  yield* Effect.log(
    `Wrote ${regions.length} regions, ${Arr.reduce(regions, 0, (sum, { rings }) => sum + rings.length)} rings, ${(source.length / 1e3).toFixed(0)} KB to ${out}`,
  );
});

const command = Command.make(
  'build-coverage',
  {
    shapefile: Argument.String('shapefile').pipe(
      Argument.withDescription(
        'tl_2023_us_state.shp, its .dbf beside it (default <repo>/tmp/tl_2023_us_state/)',
      ),
      Argument.optional,
    ),
  },
  build,
);

Command.run(command, { version: '1.0.0' }).pipe(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the script's entry point
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
