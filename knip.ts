import { defineKnipConfig } from 'shoemaker-knip-config';

export default defineKnipConfig({
  ignore: ['apps/web/src/routeTree.gen.ts'],
  // Used outside what knip can trace: bun-types only through the shared
  // tsconfig's `types`, the task runner only through `bunx`, and
  // `cloudflare:workers` is workerd's built-in module, not a package.
  ignoreDependencies: ['bun-types', 'turbo', 'cloudflare'],
  workspaces: {
    '.': { entry: ['*.ts'] },
    'apps/web': {
      entry: [
        'src/router.tsx',
        'src/routes/**/*.{ts,tsx}',
        'src/server.ts',
        // The Worker's entry, named only as a string in worker.server.ts.
        'src/worker-entry.server.ts',
      ],
    },
    'apps/api': {
      entry: ['src/main.ts', 'src/server.ts'],
    },
  },
});
