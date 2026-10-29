import { defineConfig } from 'vitest/config';

// `bun run test` at the root runs every package as one Vitest Projects run.
// The task runner's per-package `test` tasks, which CI
// runs, run the same projects one package at a time, cached.
export default defineConfig({
  test: {
    projects: ['apps/web', 'apps/api'],
  },
});
