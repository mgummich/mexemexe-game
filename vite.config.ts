/// <reference types="vitest/config" />
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Stamps dist/sw.js's cache-key VERSION with package.json's version at build time, so the
// two can't drift out of lockstep by hand-editing. Throws if it can't substitute rather than
// silently shipping the dev placeholder as the real cache key.
function swVersionPlugin(): Plugin {
  return {
    name: 'mexe-sw-version',
    apply: 'build',
    closeBundle() {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as {
        version: string;
      };

      const swPath = path.resolve(__dirname, 'dist/sw.js');
      const sw = fs.readFileSync(swPath, 'utf-8');

      const placeholder = '__BUILD_VERSION__';
      if (!sw.includes(placeholder)) {
        throw new Error(`mexe-sw-version: placeholder ${placeholder} not found in dist/sw.js — refusing silent no-op`);
      }
      fs.writeFileSync(swPath, sw.replace(placeholder, pkg.version));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [swVersionPlugin()],
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
