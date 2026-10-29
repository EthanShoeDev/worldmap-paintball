import { defineConfig } from 'shoemaker/config';

export default defineConfig({
  name: 'worldmap-paintball',
  scope: 'worldmap-paintball',
  description: '',
  apps: [
    {
      name: 'web',
      kind: 'tanstack-start',
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
  unmanaged: [],
});
