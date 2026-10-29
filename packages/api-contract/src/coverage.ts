import { Array as Arr, Option } from 'effect';

// [lon, lat] in degrees, GeoJSON order.
export type LonLat = readonly [lon: number, lat: number];

export interface Region {
  readonly id: string;
  readonly name: string;
  // [west, south, east, north], the order MapLibre's `maxBounds` takes.
  readonly bbox: readonly [number, number, number, number];
  // An implicitly closed ring.
  readonly boundary: ReadonlyArray<LonLat>;
}

const region = (
  id: string,
  name: string,
  boundary: ReadonlyArray<LonLat>,
): Region => {
  const lons = Arr.map(boundary, ([lon]) => lon);
  const lats = Arr.map(boundary, ([, lat]) => lat);
  return {
    id,
    name,
    bbox: [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ],
    boundary,
  };
};

// US Census Bureau cartographic boundary file cb_2023_us_state_500k (public
// domain): the convex hull of North Carolina minus SC, GA, TN and VA, so the
// sounds and the Outer Banks are inside, then Douglas-Peucker simplified to
// within about 0.7 km of the land borders. Offshore water inside the hull is
// harmless: it bakes as open water.
const northCarolina = region('us-nc', 'North Carolina', [
  [-84.3219, 34.9884],
  [-83.62, 34.9866],
  [-83.1096, 35.0012],
  [-82.7879, 35.085],
  [-82.7764, 35.0813],
  [-82.7774, 35.0641],
  [-82.7577, 35.068],
  [-82.727, 35.0941],
  [-82.6977, 35.0957],
  [-82.6814, 35.1279],
  [-82.6624, 35.1181],
  [-82.641, 35.1323],
  [-82.629, 35.1262],
  [-82.6124, 35.1382],
  [-82.5699, 35.1453],
  [-82.5464, 35.1637],
  [-82.53, 35.1556],
  [-82.4601, 35.1781],
  [-82.4516, 35.1727],
  [-82.4571, 35.164],
  [-82.4396, 35.1659],
  [-82.4197, 35.1986],
  [-82.3929, 35.2154],
  [-82.3713, 35.1814],
  [-82.3615, 35.1908],
  [-82.3233, 35.1848],
  [-82.2749, 35.2001],
  [-81.0436, 35.1499],
  [-81.051, 35.1317],
  [-81.039, 35.1263],
  [-81.0328, 35.108],
  [-81.0521, 35.0963],
  [-81.058, 35.0732],
  [-81.0415, 35.0447],
  [-80.9349, 35.1074],
  [-80.782, 34.9358],
  [-80.7975, 34.8198],
  [-79.6753, 34.8047],
  [-79.3583, 34.5454],
  [-78.5505, 33.8547],
  [-77.9628, 33.8423],
  [-76.5355, 34.5916],
  [-75.5278, 35.2277],
  [-75.4858, 35.4007],
  [-75.4606, 35.577],
  [-75.4928, 35.7176],
  [-75.8676, 36.5504],
  [-80.1222, 36.5426],
  [-81.6775, 36.5881],
  [-81.677, 36.5707],
  [-81.6902, 36.5687],
  [-81.69, 36.5522],
  [-81.708, 36.5362],
  [-81.6953, 36.4679],
  [-81.7149, 36.4572],
  [-81.7207, 36.4225],
  [-81.742, 36.411],
  [-81.7387, 36.3948],
  [-81.7286, 36.3912],
  [-81.7346, 36.3796],
  [-81.7074, 36.3352],
  [-81.7649, 36.3387],
  [-81.7894, 36.3482],
  [-81.7936, 36.3622],
  [-81.9081, 36.302],
  [-82.0331, 36.1204],
  [-82.0541, 36.1268],
  [-82.0801, 36.1057],
  [-82.1271, 36.1044],
  [-82.1479, 36.1495],
  [-82.1768, 36.1422],
  [-82.2139, 36.1591],
  [-82.2475, 36.1309],
  [-82.2687, 36.127],
  [-82.2895, 36.1357],
  [-82.3552, 36.1156],
  [-82.4095, 36.0834],
  [-82.4607, 36.0078],
  [-82.5579, 35.9539],
  [-82.6109, 35.9674],
  [-82.6042, 35.9873],
  [-82.6144, 36.0035],
  [-82.591, 36.0336],
  [-82.6372, 36.0658],
  [-82.776, 36.0001],
  [-82.7856, 35.9778],
  [-82.7749, 35.972],
  [-82.8059, 35.9379],
  [-82.805, 35.9272],
  [-82.8219, 35.9218],
  [-82.8498, 35.9478],
  [-82.8742, 35.9527],
  [-82.8985, 35.9451],
  [-82.9016, 35.9274],
  [-82.92, 35.9284],
  [-82.8973, 35.8779],
  [-82.9206, 35.8685],
  [-82.9166, 35.8414],
  [-82.9455, 35.8247],
  [-82.9641, 35.79],
  [-82.9921, 35.7739],
  [-83.074, 35.79],
  [-83.1202, 35.7662],
  [-83.1592, 35.7649],
  [-83.1857, 35.7299],
  [-83.2512, 35.7199],
  [-83.2581, 35.6919],
  [-83.2892, 35.6745],
  [-83.2972, 35.6578],
  [-83.335, 35.6655],
  [-83.3516, 35.6599],
  [-83.3669, 35.6387],
  [-83.3966, 35.6227],
  [-83.4458, 35.6118],
  [-83.4983, 35.563],
  [-83.5856, 35.5629],
  [-83.6089, 35.5795],
  [-83.6405, 35.5661],
  [-83.7717, 35.5621],
  [-83.8256, 35.5238],
  [-83.8801, 35.5187],
  [-83.9118, 35.476],
  [-83.9611, 35.4641],
  [-84.023, 35.4117],
  [-84.0082, 35.3904],
  [-84.0076, 35.3717],
  [-84.0383, 35.3478],
  [-84.0294, 35.3332],
  [-84.0357, 35.3129],
  [-84.0214, 35.3014],
  [-84.0526, 35.27],
  [-84.0981, 35.2472],
  [-84.1189, 35.2523],
  [-84.1279, 35.2411],
  [-84.1884, 35.24],
  [-84.2237, 35.2691],
  [-84.2902, 35.2256],
]);

export const regions: ReadonlyArray<Region> = [northCarolina];

export const coverageNames = Arr.join(
  Arr.map(regions, ({ name }) => name),
  ', ',
);

export const outsideCoverageMessage = `Only ${coverageNames} for now`;

const inBbox = (
  { bbox: [west, south, east, north] }: Region,
  lon: number,
  lat: number,
) => lon >= west && lon <= east && lat >= south && lat <= north;

// Even-odd ray casting on raw lon/lat, which the boundary was simplified for.
const inBoundary = ({ boundary }: Region, lon: number, lat: number) => {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [xi, yi] = boundary[i] ?? [0, 0];
    const [xj, yj] = boundary[j] ?? [0, 0];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
};

export const regionAt = (lat: number, lon: number) =>
  Arr.findFirst(
    regions,
    (candidate) =>
      inBbox(candidate, lon, lat) && inBoundary(candidate, lon, lat),
  );

export const isCovered = (lat: number, lon: number) =>
  Option.isSome(regionAt(lat, lon));
