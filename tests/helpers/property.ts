/**
 * Seeded property runner — the generative counterpart to the example fixtures in
 * `scenarios.ts`. A property states something that must hold for *every* generated input; the
 * runner's whole job is to make a failure reproducible and small.
 *
 * Why no property-testing library: the inputs worth generating here are domain states (a deal, a
 * legal action sequence, a meld built to be valid), not arbitrary JSON, so a library's arbitraries
 * would be hand-written anyway — and shrinking a match means "the same seed with fewer actions",
 * which is one number. That number is `size`, and minimization below is exact rather than
 * heuristic: the smallest size that still fails is found, not approximated. The randomness source
 * is the game's own seeded RNG (INV-R1), so CI never sees a different input than a developer does.
 *
 * On failure the runner prints the property, the reproduction seed, the minimized size, the
 * counterexample and the exact command that replays it alone.
 */
import { createRng, type Rng } from '../../src/rules/rng';

/**
 * Fast is what `npm run test` runs and what a PR gates on; extended is `npm run test:property`,
 * i.e. manual or scheduled. Iteration counts live at the call site as `runs(fast, extended)` so
 * the cost of each property is readable next to the property itself.
 */
export const EXTENDED = process.env.MEXE_FUZZ === 'extended';

export function runs(fast: number, extended: number): number {
  return EXTENDED ? extended : fast;
}

export interface PropertyConfig<T> {
  /** Iterations. Use `runs(fast, extended)`. */
  runs: number;
  /** Base seed. Iteration i uses `seed + i`; changing this changes the whole corpus. */
  seed?: number;
  /** Generator size — action count, meld length, whatever the generator reads it as. */
  size?: number;
  generate: (rng: Rng, size: number) => T;
  /** One line describing a counterexample. Keep it small: a failing case is committed by hand. */
  describe?: (value: T) => string;
}

/** `MEXE_PROP_SEED=<n> [MEXE_PROP_SIZE=<n>]` runs exactly that case — the reproduction path. */
const PINNED_SEED = process.env.MEXE_PROP_SEED ? Number(process.env.MEXE_PROP_SEED) : null;
const PINNED_SIZE = process.env.MEXE_PROP_SIZE ? Number(process.env.MEXE_PROP_SIZE) : null;

function fails<T>(config: PropertyConfig<T>, check: (value: T) => void, seed: number, size: number): boolean {
  try {
    check(config.generate(createRng(seed), size));
    return false;
  } catch {
    return true;
  }
}

/**
 * Smallest size that still reproduces the failure at this seed. Sizes are scanned upwards from 0,
 * so the answer is exact, not a bisection guess; a property whose generator ignores `size` simply
 * returns the size it was given.
 */
function minimize<T>(config: PropertyConfig<T>, check: (value: T) => void, seed: number, size: number): number {
  for (let s = 0; s < size; s++) {
    if (fails(config, check, seed, s)) return s;
  }
  return size;
}

/**
 * Run `check` over generated values. Throws the original assertion error, with the reproduction
 * appended to its message — the assertion stays the headline, the seed is what you act on.
 */
export function forAll<T>(name: string, config: PropertyConfig<T>, check: (value: T) => void): void {
  const baseSeed = config.seed ?? 1;
  const size = PINNED_SIZE ?? config.size ?? 12;
  const seeds = PINNED_SEED !== null ? [PINNED_SEED] : Array.from({ length: config.runs }, (_, i) => baseSeed + i);

  for (const seed of seeds) {
    let value: T;
    try {
      value = config.generate(createRng(seed), size);
      check(value);
      continue;
    } catch (err) {
      const minSize = PINNED_SEED !== null ? size : minimize(config, check, seed, size);
      const minimal = config.generate(createRng(seed), minSize);
      const detail = config.describe ? config.describe(minimal) : JSON.stringify(minimal).slice(0, 400);
      const error = err instanceof Error ? err : new Error(String(err));
      error.message =
        `${error.message}\n\n` +
        `property: ${name}\n` +
        `seed: ${seed}  size: ${minSize}${minSize === size ? '' : ` (minimized from ${size})`}\n` +
        `counterexample: ${detail}\n` +
        `reproduce: MEXE_PROP_SEED=${seed} MEXE_PROP_SIZE=${minSize} npx vitest run -t ${JSON.stringify(name)}`;
      throw error;
    }
  }
}
