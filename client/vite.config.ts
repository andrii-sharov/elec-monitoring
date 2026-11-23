import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
    conditions: ['source', ...defaultClientConditions],
  },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    server: { deps: { inline: [/@elec\/shared/] } },
  },
});
