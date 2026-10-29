import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { String as Str } from 'effect';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // The API dev server (`bun run --cwd apps/api dev`) serves routes at its root.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Lobbies are WebSockets at /api/lobbies/<code>/ws.
        ws: true,
        rewrite: Str.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
