import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Start serves /api in-process, but Vite's Node server cannot hand a
      // WebSocket to the API's lobby rooms, so lobby sockets go to the API's
      // Bun server (`bun run --cwd apps/api dev`), which also serves /api.
      '/api/lobbies': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      importProtection: {
        // In dev too: mock mode only warns, and parallel agents miss warnings.
        behavior: 'error',
        // Added to the defaults (*.server.* files, Start's server module).
        client: {
          specifiers: [
            '@worldmap-paintball/api/handlers',
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
