import { defineConfig } from 'vitest/config';

// `bun run test` at the root runs every package as one Vitest Projects run;
// CI's per-package `test` tasks run the same projects one at a time.
export default defineConfig({
  test: {
    projects: ['apps/web', 'apps/api'],
  },
});
