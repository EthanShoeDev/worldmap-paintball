import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { Array, Predicate, String } from 'effect';
import { defineConfig, type Plugin, type PluginOption } from 'vite';

// Under `alchemy dev` the server environments run in workerd, and dev never
// tree-shakes, so loading `@alchemy.run/cloudflare` (which Worker and Durable
// Object classes need) loads alchemy's local dev tooling too, and these
// modules throw in workerd as soon as they load (`require.resolve`,
// `import.meta.resolve`). The deployed Worker never calls them, so dev loads
// empty modules in their place, in both the dependency pre-bundle and the
// module runner. The pre-bundle's stub is CommonJS so that every named import
// of it still links, to undefined.
const alchemyLocalTooling = [
  /\/@alchemy\.run\/cloudflare-runtime\//,
  /\/@alchemy\.run\/cloudflare\/(?:src|lib)\/LocalRuntime\.[jt]s$/,
  /\/alchemy\/(?:src|lib)\/Local\/RpcProviderProxy\.[jt]s$/,
];
const isAlchemyLocalTooling = (id: string) =>
  Array.some(alchemyLocalTooling, (pattern) =>
    pattern.test(String.split(id, '?')[0]),
  );

const stubAlchemyLocalTooling = (): Plugin => ({
  name: 'stub-alchemy-local-tooling',
  apply: 'serve',
  applyToEnvironment: (environment) => environment.name !== 'client',
  configEnvironment: (name) =>
    name === 'client'
      ? undefined
      : {
          optimizeDeps: {
            rolldownOptions: {
              plugins: [
                {
                  name: 'stub-alchemy-local-tooling',
                  load: (id) =>
                    isAlchemyLocalTooling(id)
                      ? 'module.exports = {};'
                      : undefined,
                },
              ],
            },
          },
        },
  load: (id) => (isAlchemyLocalTooling(id) ? 'export {};' : undefined),
});

const pluginNames = (plugins: PluginOption): ReadonlyArray<string> =>
  Array.isArray(plugins)
    ? Array.flatMap(plugins, pluginNames)
    : Predicate.isObject(plugins) && 'name' in plugins
      ? [plugins.name]
      : [];

// Under plain `vite dev`, Start serves /api in-process, but Vite's Node server
// cannot hand a WebSocket to the API's lobby rooms, so lobby sockets go to the
// API's Bun server (`bun run --cwd apps/api dev`), which also serves /api.
// Under `alchemy dev` the Worker hosts the rooms itself, and a proxy would
// take the upgrade before the Worker sees it.
const lobbySocketProxy = (): Plugin => ({
  name: 'lobby-socket-proxy',
  config: (config) =>
    pluginNames(config.plugins).includes('vite-plugin-cloudflare:alchemy')
      ? undefined
      : {
          server: {
            proxy: {
              '/api/lobbies': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                ws: true,
              },
            },
          },
        },
});

export default defineConfig({
  plugins: [
    lobbySocketProxy(),
    stubAlchemyLocalTooling(),
    tailwindcss(),
    tanstackStart({
      importProtection: {
        // In dev too: mock mode only warns, and parallel agents miss warnings.
        behavior: 'error',
        // Added to the defaults (*.server.* files, Start's server module).
        client: {
          specifiers: [
            // The browser talks to the API only through @worldmap-paintball/api-contract.
            '@worldmap-paintball/api',
            '@worldmap-paintball/api/**',
            '@alchemy.run/cloudflare',
            'alchemy',
            '@effect/platform-bun',
            '@effect/platform-node',
          ],
        },
        // Browser-only (WebGL, WebRTC, DOM); *.client.* files stay denied.
        server: {
          specifiers: [
            'maplibre-gl',
            'react-map-gl',
            'react-map-gl/maplibre',
            '@react-three/rapier',
            '@effect/platform-browser',
            '@geckos.io/snapshot-interpolation',
          ],
        },
      },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
