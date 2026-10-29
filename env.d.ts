// varlock type generation isn't enabled in .env.schema yet, so the variables
// read through `ENV` are declared here by hand.
import 'varlock/env';

declare module 'varlock/env' {
  interface TypedEnvSchema {
    readonly ALCHEMY_PROFILE?: string;
    // Read by apps/api/src/footprints-upload.ts, which alchemy.run.ts runs.
    readonly FOOTPRINTS_DIR?: string;
  }
}
