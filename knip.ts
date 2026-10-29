import { defineKnipConfig } from 'shoemaker-knip-config';

export default defineKnipConfig({
  // shoemaker:begin workspaces
  ignore: ['apps/web/src/routeTree.gen.ts'],
  // Used outside what knip can trace: bun-types only through the shared
  // tsconfig's `types`, the task runner only through `bunx`.
  ignoreDependencies: ['bun-types', 'turbo'],
  workspaces: {
    '.': { entry: ['*.ts'] },
    'apps/web': {
      entry: ['src/router.tsx', 'src/routes/**/*.{ts,tsx}', 'src/server.ts'],
    },
    'apps/api': {
      entry: ['src/main.ts', 'src/server.ts'],
    },
  },
  // shoemaker:end workspaces
});
