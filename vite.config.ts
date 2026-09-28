import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // Separate dependency-optimiser caches let several dev servers run side by side (VITE_CACHE_DIR=node_modules/.vite-name).
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: false, hmr: process.env.VITE_NO_HMR === '1' ? false : undefined },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
