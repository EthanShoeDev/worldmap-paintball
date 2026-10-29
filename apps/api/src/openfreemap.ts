import { VectorTile } from '@mapbox/vector-tile';
import { Array as Arr, Option, Record as Rec, Schema } from 'effect';
import { PbfReader } from 'pbf';

import { DEFAULT_BUILDING_HEIGHT, type MapFeature, roadWidth } from './bake.ts';
import { type TileId, tileLatLon } from './tiles.ts';

// TileJSON whose `tiles[0]` names the current planet build, so tile URLs
// change with every weekly import.
export const OPENFREEMAP_URL = 'https://tiles.openfreemap.org/planet';

// The highest zoom OpenMapTiles builds, and the only one with every feature.
export const OPENFREEMAP_ZOOM = 14;

export const TileJson = Schema.Struct({
  tiles: Schema.NonEmptyArray(Schema.String),
});

// The OpenMapTiles fields baking reads; other fields (names, ranks) drop.
export const TileProperties = Schema.Struct({
  class: Schema.optional(Schema.String),
  subclass: Schema.optional(Schema.String),
  brunnel: Schema.optional(Schema.String),
  render_height: Schema.optional(Schema.Finite),
  render_min_height: Schema.optional(Schema.Finite),
  hide_3d: Schema.optional(Schema.Boolean),
});

const decodeProperties = Schema.decodeUnknownOption(TileProperties);

const LAYERS = new Set([
  'building',
  'transportation',
  'water',
  'park',
  'landcover',
]);

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

// One decoded vector tile feature, in tile coordinates from 0 to `extent`.
export interface TileFeature {
  readonly layer: string;
  readonly extent: number;
  readonly type: number;
  readonly properties: typeof TileProperties.Type;
  readonly geometry: ReadonlyArray<ReadonlyArray<TilePoint>>;
}

const LINE = 2;
const POLYGON = 3;

export const decodeTile = (data: Uint8Array) => {
  const tile = new VectorTile(new PbfReader(data));
  const features: Array<TileFeature> = [];
  for (const layer of Rec.values(tile.layers)) {
    if (!LAYERS.has(layer.name)) continue;
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      const properties = decodeProperties(feature.properties);
      if (Option.isNone(properties)) continue;
      features.push({
        layer: layer.name,
        extent: layer.extent,
        type: feature.type,
        properties: properties.value,
        geometry: feature.loadGeometry(),
      });
    }
  }
  return features;
};

const lerp = (a: TilePoint, b: TilePoint, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const sides = (extent: number) =>
  [
    { axis: 'x', inside: (v: number) => v >= 0, edge: 0 },
    { axis: 'x', inside: (v: number) => v <= extent, edge: extent },
    { axis: 'y', inside: (v: number) => v >= 0, edge: 0 },
    { axis: 'y', inside: (v: number) => v <= extent, edge: extent },
  ] as const;

// Sutherland–Hodgman against the tile square. Tiles repeat geometry in a
// buffer past their edges, so clipping each tile to its own square keeps
// neighbouring tiles from contributing the same building twice.
export const clipRing = (ring: ReadonlyArray<TilePoint>, extent: number) => {
  const first = ring[0];
  const last = ring.at(-1);
  let points =
    first && last && first.x === last.x && first.y === last.y
      ? ring.slice(0, -1)
      : ring;
  for (const { axis, inside, edge } of sides(extent)) {
    const input = points;
    const output: Array<TilePoint> = [];
    Arr.forEach(input, (current, index) => {
      const previous = input.at(index - 1) ?? current;
      const crossing = () =>
        lerp(
          previous,
          current,
          (edge - previous[axis]) / (current[axis] - previous[axis]),
        );
      if (inside(current[axis])) {
        if (!inside(previous[axis])) output.push(crossing());
        output.push(current);
      } else if (inside(previous[axis])) {
        output.push(crossing());
      }
    });
    points = output;
  }
  return points;
};

// Liang–Barsky: the part of segment a→b inside the tile square, reusing the
// endpoints that need no clipping.
const clipSegment = (a: TilePoint, b: TilePoint, extent: number) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let start = 0;
  let end = 1;
  for (const [p, q] of [
    [-dx, a.x],
    [dx, extent - a.x],
    [-dy, a.y],
    [dy, extent - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined;
    } else if (p < 0) {
      start = Math.max(start, q / p);
    } else {
      end = Math.min(end, q / p);
    }
  }
  if (start >= end) return undefined;
  return [
    start === 0 ? a : lerp(a, b, start),
    end === 1 ? b : lerp(a, b, end),
  ] as const;
};

// A line leaving and re-entering the tile splits into several pieces.
export const clipLine = (line: ReadonlyArray<TilePoint>, extent: number) => {
  const pieces: Array<Array<TilePoint>> = [];
  let piece: Array<TilePoint> = [];
  for (let index = 1; index < line.length; index++) {
    const a = line[index - 1];
    const b = line[index];
    const segment = a && b ? clipSegment(a, b, extent) : undefined;
    if (segment === undefined) continue;
    const [start, end] = segment;
    if (start !== a || piece.length === 0) {
      if (piece.length >= 2) pieces.push(piece);
      piece = [start];
    }
    piece.push(end);
    if (end !== b) {
      pieces.push(piece);
      piece = [];
    }
  }
  if (piece.length >= 2) pieces.push(piece);
  return pieces;
};

const signedArea = (ring: ReadonlyArray<TilePoint>) =>
  Arr.reduce(ring, 0, (sum, current, index) => {
    const previous = ring.at(index - 1) ?? current;
    return sum + (previous.x * current.y - current.x * previous.y);
  });

// Polygons are outer rings each followed by their holes, which wind the
// other way. Arenas have no holes, so only outer rings are kept.
const outerRings = (rings: TileFeature['geometry']) => {
  const first = rings[0];
  if (first === undefined) return [];
  const outer = Math.sign(signedArea(first));
  return Arr.filter(rings, (ring) => Math.sign(signedArea(ring)) === outer);
};

const areaKind = ({ layer, properties }: TileFeature) => {
  if (layer === 'water') return 'water' as const;
  if (layer === 'park' && properties.class === 'park') return 'park' as const;
  if (layer === 'landcover' && properties.class === 'wood') {
    return 'wood' as const;
  }
  if (layer === 'landcover' && properties.class === 'grass') {
    return 'grass' as const;
  }
  return undefined;
};

// OpenMapTiles folds residential, unclassified and living streets into
// `minor`, and footways, cycleways and steps into `path` (named by subclass).
const transportationWidth = ({
  properties: { class: type, subclass, brunnel },
}: TileFeature) => {
  if (brunnel === 'tunnel' || type === undefined) return undefined;
  if (type === 'path') {
    return subclass === undefined ? undefined : roadWidth(subclass);
  }
  return roadWidth(type === 'minor' ? 'residential' : type);
};

const buildingHeight = ({ properties: { render_height } }: TileFeature) =>
  render_height !== undefined && render_height > 0
    ? render_height
    : DEFAULT_BUILDING_HEIGHT;

// Outlines marked `hide_3d` are drawn by their building parts instead, and
// parts that start above the ground (skyways, overhangs) would become walls.
const isGroundBuilding = ({
  properties: { hide_3d, render_min_height = 0 },
}: TileFeature) => hide_3d !== true && render_min_height <= 0;

export const tileFeatures = (tile: TileId, features: Iterable<TileFeature>) => {
  const result: Array<MapFeature> = [];
  for (const feature of features) {
    const { extent } = feature;
    const toLatLon = (points: ReadonlyArray<TilePoint>) =>
      Arr.map(points, ({ x, y }) => tileLatLon(tile, [x / extent, y / extent]));
    const rings = () =>
      feature.type === POLYGON
        ? Arr.flatMap(outerRings(feature.geometry), (ring) => {
            const clipped = clipRing(ring, extent);
            return clipped.length >= 3 ? [toLatLon(clipped)] : [];
          })
        : [];

    if (feature.layer === 'building') {
      if (!isGroundBuilding(feature)) continue;
      const height = buildingHeight(feature);
      for (const outline of rings()) {
        result.push({ type: 'building', outline, height });
      }
    } else if (feature.layer === 'transportation') {
      const width = transportationWidth(feature);
      if (width === undefined || feature.type !== LINE) continue;
      for (const line of feature.geometry) {
        for (const piece of clipLine(line, extent)) {
          result.push({ type: 'road', path: toLatLon(piece), width });
        }
      }
    } else {
      const kind = areaKind(feature);
      if (kind === undefined) continue;
      for (const outline of rings()) {
        result.push({ type: 'area', kind, outline });
      }
    }
  }
  return result;
};

export const decodeTileFeatures = (tile: TileId) => (data: Uint8Array) =>
  tileFeatures(tile, decodeTile(data));
