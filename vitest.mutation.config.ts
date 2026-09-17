/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * The test set mutation testing runs against (`npm run test:mutation`).
 *
 * Not the whole suite on purpose. Stryker re-runs these tests once per mutant, so the only tests
 * worth including are the ones that can *observe* a mutated gameplay module: the rules, the draft
 * editor, the action layer, the replay reader and the generative properties. Suites that scan the
 * source tree or drive a socket cost minutes per run and can never kill a mutant in
 * `src/rules/rules.ts`.
 *
 * Coverage is off here — Stryker measures which tests touch which mutant itself.
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('mutation') },
  test: {
    include: [
      'tests/rules.test.ts',
      'tests/actions.test.ts',
      'tests/draft.test.ts',
      'tests/match.test.ts',
      'tests/replay.test.ts',
      'tests/probes.test.ts',
      'tests/ai.test.ts',
      'tests/property/*.test.ts',
    ],
    environment: 'node',
  },
});
