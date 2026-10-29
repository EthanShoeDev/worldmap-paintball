import { assert, describe, it } from '@effect/vitest';
import { Option, Record as Rec } from 'effect';

import { isCovered, regionAt, regions } from '../src/coverage.ts';

const inside = {
  Raleigh: [35.7796, -78.6382],
  Charlotte: [35.2271, -80.8431],
  Asheville: [35.5951, -82.5515],
  Wilmington: [34.2257, -77.9447],
  'Kill Devil Hills': [36.0307, -75.676],
} as const;

const outside = {
  'Rock Hill, SC': [34.9249, -81.0251],
  'Virginia Beach, VA': [36.8529, -75.978],
  'Knoxville, TN': [35.9606, -83.9207],
  London: [51.5074, -0.1278],
} as const;

describe('coverage', () => {
  for (const [name, [lat, lon]] of Rec.toEntries(inside)) {
    it(`covers ${name}`, () => {
      const region = regionAt(lat, lon);
      assert.isTrue(Option.isSome(region));
      assert.strictEqual(Option.getOrUndefined(region)?.id, 'us-nc');
    });
  }

  for (const [name, [lat, lon]] of Rec.toEntries(outside)) {
    it(`does not cover ${name}`, () => {
      assert.isFalse(isCovered(lat, lon));
    });
  }

  it('keeps every boundary simplified', () => {
    for (const { boundary } of regions) assert.isAtMost(boundary.length, 150);
  });
});
