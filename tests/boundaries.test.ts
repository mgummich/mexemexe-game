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
  /^\.\.\/rules\/(rules|types|rng)$/,
  /^\.\.\/core\/events$/, // GameStore only; announcement, never turn application (ARCH-004)
];

/** DOMAIN plus the pure layout maths: no browser, no clock, no unseeded randomness. */
const EFFECT_FREE = [...DOMAIN, 'src/table'];

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
