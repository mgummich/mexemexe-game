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
      // The wire contract (`src/net/protocol.ts`, `src/net/viewToState.ts`) joined the mutation
      // scope, so the suites that can observe it join the runner: the view projection and its
      // seat validation, the session that adopts a frame, the settings normalizer and the
      // reconnect/error decoding. All four are pure — no socket is opened here.
      'tests/viewToState.test.ts',
      'tests/online-session.test.ts',
      'tests/net/*.test.ts',
      // Pure too, despite living under tests/server: it drives `RoomManager` in-process and holds
      // the direct `parseClientMessage` boundary cases. The socket-driven server suites
      // (hardening, the *.integration ones) stay out — minutes per mutant.
      'tests/server/rooms.test.ts',
    ],
    environment: 'node',
    // Tells `expectWithinMs` (tests/helpers/timing.ts) to stand down. Wall-clock budgets measure
    // the machine, and six concurrent sandboxes make them fail for lack of CPU — which Stryker
    // reads as a killed mutant and silently inflates the score. See that file for the evidence.
    env: { MEXE_MUTATION: '1' },
  },
});
