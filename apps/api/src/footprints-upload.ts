import * as Cloudflare from '@alchemy.run/cloudflare';
import { regions } from '@worldmap-paintball/api-contract/coverage';
import * as Alchemy from 'alchemy';
import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from 'effect';
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

// The REST API allows 1200 requests per 5 minutes: three uploads at a time,
// each holding its slot for at least a second, stay under it.
const UPLOAD_CONCURRENCY = 3;

const Upload = Alchemy.Action(
  'UploadFootprints',
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(
      yield* FootprintsBucket,
    );
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // The packs uploaded with the manifest last put for `region`, as
    // `key sha256`; none when it is missing or unreadable.
    const uploadedPacks = Effect.fn('uploadedPacks')(function* (
      region: string,
    ) {
      const object = yield* bucket.get(manifestKey(region));
      if (object === null) return new Set<string>();
      const manifest = yield* object
        .text()
        .pipe(Effect.flatMap(decodeManifest), Effect.option);
      return new Set(
        Option.match(manifest, {
          onNone: () => [],
          onSome: ({ packs }) =>
            Arr.map(packs, ({ key, sha256 }) => `${key} ${sha256}`),
        }),
      );
    });

    return Effect.fn(function* ({ dir }: { dir: string; digest: string }) {
      const texts = yield* manifestTexts(dir);
      let uploaded = 0;
      for (const text of texts) {
        const manifest = yield* decodeManifest(text);
        const previous = yield* uploadedPacks(manifest.region);
        const changed = Arr.filter(
          manifest.packs,
          ({ key, sha256 }) => !previous.has(`${key} ${sha256}`),
        );
        yield* Effect.log(
          `${manifest.region}: uploading ${changed.length} of ${manifest.packs.length} footprint packs`,
        );
        yield* Effect.forEach(
          changed,
          ({ key }, index) =>
            fs.readFile(path.join(dir, key)).pipe(
              Effect.flatMap((bytes) =>
                bucket.put(key, bytes, {
                  httpMetadata: { contentType: 'application/octet-stream' },
                }),
              ),
              Effect.tap(() =>
                Effect.log(`Uploaded ${index + 1}/${changed.length}: ${key}`),
              ),
              Effect.zip(Effect.sleep('1 second'), { concurrent: true }),
            ),
          { concurrency: UPLOAD_CONCURRENCY, discard: true },
        );
        // Last, so packs that failed to upload are retried next deploy.
        yield* bucket.put(manifestKey(manifest.region), text, {
          httpMetadata: { contentType: 'application/json' },
        });
        uploaded += changed.length;
      }
      return { packs: uploaded };
    });
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- an Action's init is an entry point; alchemy's docs provide its bucket binding here
    Effect.provide(Cloudflare.R2.ReadWriteBucketLocal),
  ),
);

// Uploads the packs `bun run footprints:build` wrote to FOOTPRINTS_DIR (or
// the default directory) to the BuildingFootprints bucket. Its input is a
// digest of the manifests, so it runs only after a rebuild, and then uploads
// only the packs whose hash differs from the region's manifest in the bucket,
// one PUT (Class A operation) each; with nothing built, it uploads nothing.
export const UploadFootprints = Effect.gen(function* () {
  const dir = yield* footprintsDir(ENV.FOOTPRINTS_DIR);
  // A Stack body may fail only with ConfigError, and a manifest that cannot
  // be read should stop the deploy anyway.
  const texts = yield* manifestTexts(dir).pipe(Effect.orDie);
  const digest = yield* sha256(Arr.join(texts, '\n'));
  return yield* Upload({ dir, digest });
});
