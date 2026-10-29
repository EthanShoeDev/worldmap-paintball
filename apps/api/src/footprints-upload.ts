import * as Cloudflare from '@alchemy.run/cloudflare';
import { regions } from '@worldmap-paintball/api-contract/coverage';
import * as Alchemy from 'alchemy';
import { Array as Arr, Effect, FileSystem, Path, Schema } from 'effect';
import { Hex } from 'effect/encoding';
import { ENV } from 'varlock/env';

import { FootprintsBucket } from './arena-baker.ts';
import {
  FootprintManifestJson,
  footprintsDir,
  manifestKey,
} from './footprints.ts';

const decodeManifest = Schema.decodeUnknownEffect(FootprintManifestJson);

// The manifest text of every coverage region built under `dir`.
const manifestTexts = Effect.fn('manifestTexts')(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const texts = yield* Effect.forEach(regions, ({ id }) => {
    const file = path.join(dir, manifestKey(id));
    return fs
      .exists(file)
      .pipe(
        Effect.flatMap((exists) =>
          exists ? fs.readFileString(file) : Effect.succeed(''),
        ),
      );
  });
  return Arr.filter(texts, (text) => text !== '');
});

const sha256 = (text: string) =>
  Effect.promise(() =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  ).pipe(Effect.map((digest) => Hex.encode(new Uint8Array(digest))));

const Upload = Alchemy.Action(
  'UploadFootprints',
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.WriteBucket(yield* FootprintsBucket);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return Effect.fn(function* ({ dir }: { dir: string; digest: string }) {
      const texts = yield* manifestTexts(dir);
      const manifests = yield* Effect.forEach(texts, (text) =>
        decodeManifest(text),
      );
      const packs = Arr.flatMap(manifests, ({ packs }) => packs);
      yield* Effect.log(`Uploading ${packs.length} footprint packs`);
      yield* Effect.forEach(
        packs,
        ({ key }, index) =>
          fs.readFile(path.join(dir, key)).pipe(
            Effect.flatMap((bytes) =>
              bucket.put(key, bytes, {
                httpMetadata: { contentType: 'application/octet-stream' },
              }),
            ),
            Effect.tap(() =>
              Effect.log(`Uploaded ${index + 1}/${packs.length}: ${key}`),
            ),
          ),
        { concurrency: 4, discard: true },
      );
      return { packs: packs.length };
    });
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- an Action's init is an entry point; alchemy's docs provide its bucket binding here
    Effect.provide(Cloudflare.R2.WriteBucketLocal),
  ),
);

// Uploads the packs `bun run footprints:build` wrote to FOOTPRINTS_DIR (or
// the default directory) to the BuildingFootprints bucket. Its input is a
// digest of the manifests, so a deploy uploads only after a rebuild, one PUT
// (Class A operation) per pack; with nothing built, it uploads nothing.
export const UploadFootprints = Effect.gen(function* () {
  const dir = yield* footprintsDir(ENV.FOOTPRINTS_DIR);
  // A Stack body may fail only with ConfigError, and a manifest that cannot
  // be read should stop the deploy anyway.
  const texts = yield* manifestTexts(dir).pipe(Effect.orDie);
  const digest = yield* sha256(Arr.join(texts, '\n'));
  return yield* Upload({ dir, digest });
});
