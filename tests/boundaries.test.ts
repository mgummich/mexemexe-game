/**
 * Standing guard for the architecture boundaries documented in
 * `docs/ARCHITECTURE.md` (dependency rules + side-effect boundaries). Until this file existed,
 * every one of those rules was upheld by review alone (ARCHITECTURE_AUDIT.md ARCH-019), which is
 * exactly what regresses while ownership moves around.
 *
 * It scans source text, so it also catches an import that a type-only erasure would hide.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function tsFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(target, e.name);
    if (e.isDirectory()) return tsFiles(full);
    return e.name.endsWith('.ts') ? [full] : [];
  });
}

function imports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(/from\s+'([^']+)'|import\s*\(\s*'([^']+)'/g)].map((m) => m[1] ?? m[2]!);
}

const rel = (file: string) => path.relative(ROOT, file);

/**
 * The platform-free core: gameplay legality, the draft editor, the local store and the wire
 * contract. An allow-list, not a deny-list — a new upward import has to be argued for here rather
 * than sneaking in because nobody thought to forbid that particular directory.
 */
const DOMAIN = ['src/rules', 'src/mexe-mode', 'src/game-state', 'src/net/protocol.ts', 'src/net/viewToState.ts'];
const DOMAIN_ALLOWED_IMPORTS = [
  /^\.\/[\w./-]+$/, // within the module
  /^\.\.\/rules\/(rules|types|rng|hash)$/,
  // `LocalMatch` routes an AI decision to an action (ARCH-001). The AI engine is domain code —
  // it decides moves through `src/rules` and touches no platform — so this is sideways, not up.
  /^\.\.\/ai\/ai$/,
];

/**
 * Application orchestration extracted out of the scenes in Wave 2E. These are the contracts Wave 3
 * tests are meant to target, so the thing that must not regress is that they can be constructed
 * and driven without a browser: no Phaser, no scene, no DOM.
 */
const APPLICATION = ['src/game-state/match.ts', 'src/net/online-session.ts', 'src/net/lobby.ts'];

/**
 * DOMAIN plus the pure layout maths and the AI engine: no browser, no clock, no unseeded
 * randomness. The AI joined this list once its rearrange search stopped bounding itself with a
 * `performance.now()` deadline — that clock was inside move selection, so the same state could
 * produce a different move on a slower machine. The budget is a trial count now
 * (`SEARCH_BUDGET_TRIALS`), and this is the guard that keeps a clock from coming back: the
 * reproducibility tests in `ai.test.ts` can only observe that one machine agrees with itself.
 */
const EFFECT_FREE = [...DOMAIN, 'src/table', 'src/ai'];

describe('architecture boundaries', () => {
  it('the domain core imports only rules, the seeded rng and the bus', () => {
    for (const file of DOMAIN.flatMap(tsFiles)) {
      for (const spec of imports(file)) {
        const allowed = DOMAIN_ALLOWED_IMPORTS.some((re) => re.test(spec));
        expect(`${rel(file)} imports ${spec}: ${allowed}`).toBe(`${rel(file)} imports ${spec}: true`);
      }
    }
  });

  it('the domain core and the layout maths reach no platform, clock or unseeded randomness', () => {
    // Gameplay randomness flows through the state's seeded stream, so a seed replays exactly; a
    // wall clock or a DOM read in here would break determinism and node-only unit testing.
    const banned = /Math\.random|Date\.now|new Date\(|performance\.now|localStorage|sessionStorage|document\.|window\.|navigator\./;
    for (const file of EFFECT_FREE.flatMap(tsFiles)) {
      // Whole-line comments are skipped: prose is allowed to name what the code may not do.
      const code = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\/?\*)/.test(line));
      const hit = banned.exec(code.join('\n'));
      expect(`${rel(file)}: ${hit?.[0] ?? 'clean'}`).toBe(`${rel(file)}: clean`);
    }
  });

  it('extracted application orchestration reaches no scene, no Phaser and no DOM', () => {
    // ARCH-001/002/003: the whole point of these three modules is that the match, the online
    // session and the lobby can be driven from a node test. An import of a scene (or of Phaser)
    // would put them back behind the browser.
    const banned = /document\.|window\.|localStorage|sessionStorage|navigator\./;
    for (const file of APPLICATION.flatMap(tsFiles)) {
      for (const spec of imports(file)) {
        const reachesUi = /phaser/i.test(spec) || spec.includes('/scenes/') || spec.includes('/ui/');
        expect(`${rel(file)} imports ${spec}: ${reachesUi}`).toBe(`${rel(file)} imports ${spec}: false`);
      }
      const code = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\/?\*)/.test(line));
      const hit = banned.exec(code.join('\n'));
      expect(`${rel(file)}: ${hit?.[0] ?? 'clean'}`).toBe(`${rel(file)}: clean`);
    }
  });

  it('gameplay legality is decided in src/rules and nowhere else', () => {
    // ARCH-021 and the AGENTS.md invariant: the tutorial gate, the lobby machine, the online
    // session and the scenes may all refuse an action, but none of them may *define* legality.
    // `analyzeMeld`/`canConfirmTurn` exist once; anything else declaring one is a second authority.
    const authority = /(?:function|const)\s+(analyzeMeld|canConfirmTurn|applyConfirmedTurn|drawAndEndTurn|checkWinner)\b/;
    for (const file of tsFiles(path.join(ROOT, 'src'))) {
      if (rel(file).startsWith('src/rules')) continue;
      const hit = authority.exec(fs.readFileSync(file, 'utf8'));
      expect(`${rel(file)} declares ${hit?.[1] ?? 'no legality function'}`)
        .toBe(`${rel(file)} declares no legality function`);
    }
  });

  it('product code does not depend on the verification surface for its behaviour', () => {
    // ARCH-011: `debugApi` is a mirror, not a dependency. The modules below legitimately *write*
    // to it (that is what observation is), but no product module may import the debug adapters —
    // the surface is built from product contracts, never the other way round.
    for (const file of tsFiles(path.join(ROOT, 'src'))) {
      if (rel(file).startsWith('src/verification')) continue;
      for (const spec of imports(file)) {
        const isAdapter = spec.includes('verification/online-debug');
        const allowed = isAdapter && (rel(file) === 'src/scenes/GameScene.ts' || rel(file) === 'src/scenes/OnlineScene.ts');
        expect(`${rel(file)} imports ${spec}: ${isAdapter && !allowed}`)
          .toBe(`${rel(file)} imports ${spec}: false`);
      }
    }
  });

  it('the play log observes the game; it does not read the platform it runs on', () => {
    // ARCH-009/ARCH-016: an observability module that imports the viewport (or the DOM) cannot be
    // reused by a non-browser client and cannot be unit-tested without one. Its own relative
    // timeline (`performance.now`) is the one platform read it is allowed.
    const file = path.join(ROOT, 'src/core/playlog.ts');
    for (const spec of imports(file)) {
      // The one exception is type-only and erased: the match owns the shape of its own
      // notifications, and a second copy here would be a second owner of it (ARCH-007).
      const ok = spec.startsWith('./') || spec === '../game-state/match';
      expect(`playlog imports ${spec}: ${ok}`).toBe(`playlog imports ${spec}: true`);
    }
    const code = fs.readFileSync(file, 'utf8');
    expect(/document\.|window\.|localStorage|location\./.exec(code)?.[0] ?? 'clean').toBe('clean');
  });

  it('committed game state is readonly at the type level', () => {
    // ARCH-005: the store hands out the live object, so the barrier against a reader mutating
    // authoritative state is the type. A dropped `readonly` here removes it silently.
    const types = fs.readFileSync(path.join(ROOT, 'src/rules/types.ts'), 'utf8');
    const block = /export interface GameState \{([^}]*)\}/.exec(types)![1]!;
    const fields = block.split('\n').filter((line) => line.includes(':'));
    for (const line of fields) {
      expect(`GameState ${line.trim()}`).toContain('readonly');
    }
  });

  it('nothing outside the presentation layer imports Phaser', () => {
    // scenes/ui render it; assets/ and audio/ build textures and sound through its loader.
    const allowed = ['src/scenes', 'src/ui', 'src/assets', 'src/audio', 'src/main.ts'];
    for (const file of tsFiles(path.join(ROOT, 'src'))) {
      if (allowed.some((prefix) => rel(file).startsWith(prefix))) continue;
      const usesPhaser = imports(file).some((spec) => spec === 'phaser' || spec.startsWith('phaser/'));
      expect(`${rel(file)}: ${usesPhaser}`).toBe(`${rel(file)}: false`);
    }
  });

  /**
   * ARCH-009: `src/core` sits below everything by convention but imports upward out of four higher
   * modules. Reorganising it is Phase 4 work and churns every import; what is cheap today is to
   * stop it growing, which is the actual complaint in the register ("probably core" is why it
   * keeps growing). Every edge below was measured, not chosen. Deleting one is always fine;
   * adding one means arguing here that `core` is still the right owner.
   */
  const CORE_UPWARD = [
    'src/core/intensity.ts -> ../rules/types',
    'src/core/objective.ts -> ../localization/i18n',
    'src/core/persistence.ts -> ../ai/ai',
    'src/core/persistence.ts -> ../cosmetics',
    'src/core/persistence.ts -> ../localization/i18n',
    'src/core/playlog.ts -> ../game-state/match',
    'src/core/pwa.ts -> ../localization/i18n',
    'src/core/pwa.ts -> ../ui/tokens',
    'src/core/results-summary.ts -> ../localization/i18n',
    'src/core/results-summary.ts -> ../rules/types',
    'src/core/settings.ts -> ../ui/helpers',
  ];

  it('src/core grows no new upward dependency', () => {
    const found = tsFiles(path.join(ROOT, 'src/core'))
      .flatMap((file) => imports(file).filter((spec) => spec.startsWith('../')).map((spec) => `${rel(file)} -> ${spec}`))
      .sort();
    expect(found).toEqual([...CORE_UPWARD].sort());
  });

  /**
   * ARCH-012 was two type-only cycles. Type-only means no runtime cycle and no bundling effect, so
   * nothing but this test can notice one coming back — and the ones that existed were symptoms of
   * ARCH-009 rather than independent bugs, which is exactly the class that regrows quietly.
   */
  it('no module in src imports itself back, even through a type', () => {
    const resolve = (from: string, spec: string): string | null => {
      if (!spec.startsWith('.')) return null;
      const base = path.resolve(path.dirname(from), spec);
      for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    };
    const cycles: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const walk = (file: string, stack: string[]): void => {
      if (state.get(file) === 'done') return;
      if (state.get(file) === 'visiting') {
        cycles.push([...stack.slice(stack.indexOf(file)), file].map(rel).join(' -> '));
        return;
      }
      state.set(file, 'visiting');
      for (const spec of imports(file)) {
        const target = resolve(file, spec);
        if (target) walk(target, [...stack, file]);
      }
      state.set(file, 'done');
    };
    for (const file of tsFiles(path.join(ROOT, 'src'))) walk(file, []);
    expect(cycles).toEqual([]);
  });

  /**
   * ARCH-014: `RoomManager`'s cohesion was confirmed by the audit — it owns one thing, rooms — and
   * the finding was only "watch its growth". This is that watch: a ceiling near the measured size
   * so the next few hundred lines of room policy have to be a decision instead of an accident.
   */
  it('RoomManager stays the size the audit confirmed as cohesive', () => {
    const lines = fs.readFileSync(path.join(ROOT, 'server/rooms.ts'), 'utf8').split('\n').length;
    expect(`server/rooms.ts is ${lines <= 1050 ? 'within' : 'over'} its ceiling`).toBe('server/rooms.ts is within its ceiling');
  });

  it('the server imports the shared rules and protocol, never the client presentation layer', () => {
    for (const file of tsFiles(path.join(ROOT, 'server'))) {
      for (const spec of imports(file)) {
        if (!spec.startsWith('../src/')) continue;
        const shared = /^\.\.\/src\/(rules\/|net\/protocol)/.test(spec);
        expect(`${rel(file)} imports ${spec}: ${shared}`).toBe(`${rel(file)} imports ${spec}: true`);
      }
    }
  });
});
