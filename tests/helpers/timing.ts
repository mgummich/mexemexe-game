import { expect } from 'vitest';

/**
 * A wall-clock budget assertion that opts out of the mutation runner.
 *
 * Under `npm run test` this is an ordinary `expect(elapsed).toBeLessThan(budget)` and means what
 * it says: the search returned in time, the turn did not hang (INV-A4).
 *
 * Under `npm run test:mutation` it is a no-op, because there the assertion measures the machine
 * rather than the code. Stryker runs six vitest sandboxes at once and treats any non-zero exit as
 * a killed mutant, so a timing assertion that fails for lack of CPU reports a mutant as killed
 * that no test actually detected — a *false kill*, which inflates the score in exactly the
 * direction nobody checks. That is not hypothetical: the first protocol.ts run scored 72.9% while
 * `verify:multiplayer` was running beside it, and 61.8% alone. `EMPTY_PARTY` (which no suite in
 * the mutation runner asserts at all) was reported killed in the loaded run and survives in the
 * quiet one.
 *
 * Termination itself is still covered while mutating: Stryker's own `timeoutMS` catches a mutant
 * that stops a loop terminating, which is what these budgets were really guarding against.
 */
export function expectWithinMs(elapsedMs: number, budgetMs: number): void {
  if (process.env.MEXE_MUTATION) return;
  expect(elapsedMs).toBeLessThan(budgetMs);
}
