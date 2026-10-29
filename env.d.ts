// varlock type generation isn't enabled in .env.schema yet, so the variables
// read through `ENV` are declared here by hand.
import 'varlock/env';

declare module 'varlock/env' {
  interface TypedEnvSchema {
    readonly ALCHEMY_PROFILE?: string;
  }
}
