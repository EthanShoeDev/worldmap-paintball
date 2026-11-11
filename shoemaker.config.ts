import { defineConfig } from 'shoemaker/config';

export default defineConfig({
  name: 'worldmap-paintball',
  scope: 'worldmap-paintball',
  description: '',
  apps: [
    {
      name: 'web',
      kind: 'tanstack-start',
      api: 'api',
    },
    {
      name: 'api',
      kind: 'effect-api',
    },
  ],
  packages: [],
  taskRunner: 'turbo',
  secrets: 'varlock',
  infra: {
    kind: 'alchemy',
    deploy: 'cloudflare',
    state: 'cloudflare',
  },
  ci: 'github',
  features: {
    changesets: true,
    agents: true,
    vscode: true,
  },
  nixPackages: [],
  unmanaged: [
    // knip.ts adds the Worker entry alchemy names as a string, which
    // shoemaker's generated entries can't express.
    'knip.ts',
    // The API's dev server runs under varlock for FOOTPRINTS_DIR.
    'apps/api/package.json',
    // Both packages typecheck their scripts/ build tools.
    'apps/api/tsconfig.json',
    'packages/api-contract/tsconfig.json',
    // Alchemy dev stubs, the lobby socket proxy and import protection rules.
    'apps/web/vite.config.ts',
  ],
});
