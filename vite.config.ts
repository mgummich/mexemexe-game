/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // chunkSizeWarningLimit: Phaser alone is ~1.2MB minified; a single-vendor
    // chunk is expected for a game this size and not worth code-splitting.
    chunkSizeWarningLimit: 1500,
    // No sourcemaps in prod on purpose — game source isn't published for debugging.
    rollupOptions: {
      output: {
        manualChunks: {
          // Phaser rarely changes between releases; splitting it out keeps a
          // game-code-only deploy from invalidating the browser's cached ~1.2MB chunk.
          phaser: ['phaser'],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
