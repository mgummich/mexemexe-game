/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // chunkSizeWarningLimit: Phaser alone is ~1.2MB minified; a single-vendor
  // chunk is expected for a game this size and not worth code-splitting.
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
