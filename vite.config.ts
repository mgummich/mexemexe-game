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
        // Phaser rarely changes between releases; splitting it out keeps a
        // game-code-only deploy from invalidating the browser's cached ~1.2MB chunk.
        // Function form: vite 8's rolldown bundler dropped the object shorthand.
        manualChunks: (id: string) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      // Only the modules the vitest suites actually import (see grep across tests/**).
      // src/scenes, src/ui, src/assets and main.ts are Phaser/browser glue exercised by
      // the Playwright suites instead; net/client.ts needs a real WebSocket/sessionStorage
      // and isn't imported by any vitest spec either.
      include: [
        'src/ai/**',
        'src/audio/**',
        'src/config.ts',
        'src/core/**',
        'src/cosmetics/**',
        'src/demo/**',
        'src/game-state/**',
        'src/localization/**',
        'src/mexe-mode/**',
        'src/net/errors.ts',
        'src/net/protocol.ts',
        'src/net/viewToState.ts',
        'src/rules/**',
        'src/table/**',
        'src/tutorial/**',
        'src/verification/**',
        'server/**',
      ],
      exclude: ['**/*.d.ts', 'server/index.ts'],
      // Global floor set a few points below the measured baseline (lines 88.10,
      // branches 82.60, funcs 83.84, stmts 86.52 as of 2026-09-11) so an unrelated
      // PR doesn't fail the gate; branches gets the tightest margin since it's the
      // metric this gate is meant to protect. The baseline dropped ~5 points when
      // vitest 5's v8 provider switched to AST-aware remapping — more accurate
      // numbers on unchanged source, not a coverage regression.
      thresholds: {
        statements: 84,
        lines: 85,
        branches: 80,
        functions: 78,
      },
    },
  },
});
