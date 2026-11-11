import { assert, describe, it } from '@effect/vitest';
import { Option, Record as Rec } from 'effect';

import { isCovered, regionAt, regions } from '../src/coverage.ts';

const inside = {
  'Raleigh, NC': [35.7796, -78.6382, 'us-nc'],
  'Asheville, NC': [35.5951, -82.5515, 'us-nc'],
  'Kill Devil Hills, NC': [36.0307, -75.676, 'us-nc'],
  'Ocracoke, NC': [35.1146, -75.9809, 'us-nc'],
  'Rock Hill, SC': [34.9249, -81.0251, 'us-sc'],
  'Virginia Beach, VA': [36.8529, -75.978, 'us-va'],
  'Knoxville, TN': [35.9606, -83.9207, 'us-tn'],
  'Washington, DC': [38.8977, -77.0365, 'us-dc'],
  'Key West, FL': [24.5551, -81.78, 'us-fl'],
  'Mackinac Island, MI': [45.8492, -84.6189, 'us-mi'],
  'Marquette, MI': [46.5436, -87.3954, 'us-mi'],
  'Nantucket, MA': [41.2835, -70.0995, 'us-ma'],
  'Brownsville, TX': [25.9017, -97.4975, 'us-tx'],
  'San Diego, CA': [32.7157, -117.1611, 'us-ca'],
  'Seattle, WA': [47.6062, -122.3321, 'us-wa'],
  'Honolulu, HI': [21.3069, -157.8583, 'us-hi'],
  'Hilo, HI': [19.7241, -155.0868, 'us-hi'],
  'Anchorage, AK': [61.2181, -149.9003, 'us-ak'],
  'Utqiagvik, AK': [71.2906, -156.7886, 'us-ak'],
  'Unalaska, AK': [53.8738, -166.5366, 'us-ak'],
  'Juneau, AK': [58.3019, -134.4197, 'us-ak'],
} as const;

const outside = {
  'Windsor, ON': [42.3149, -83.0364],
  'Vancouver, BC': [49.2827, -123.1207],
  'Tijuana, MX': [32.5149, -117.0382],
  'Ciudad Juárez, MX': [31.6904, -106.4245],
  'San Juan, PR': [18.4655, -66.1057],
  Bermuda: [32.3078, -64.7505],
  'Mid-Atlantic': [36, -70],
  London: [51.5074, -0.1278],
} as const;

describe('coverage', () => {
  it('has the 50 states and DC', () => {
    assert.strictEqual(regions.length, 51);
  });

  for (const [name, [lat, lon, id]] of Rec.toEntries(inside)) {
    it(`covers ${name}`, () => {
      assert.strictEqual(Option.getOrUndefined(regionAt(lat, lon))?.id, id);
    });
  }

  for (const [name, [lat, lon]] of Rec.toEntries(outside)) {
    it(`does not cover ${name}`, () => {
      assert.isFalse(isCovered(lat, lon));
    });
  }

  it('keeps every region east of the antimeridian', () => {
    for (const { bbox } of regions) assert.isBelow(bbox[2], 0);
  });
});
