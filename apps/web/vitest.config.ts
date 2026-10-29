import { defineProject, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// A vitest.config replaces vite.config, so merge it: tests run with the same
// plugins as the build.
export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      include: ['test/**/*.test.{ts,tsx}'],
    },
  }),
);
