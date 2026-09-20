import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Canonical docs are only authoritative if they still describe the code (`WORKFLOW.md` §15). This
 * catches the drift classes that are mechanical — a command that no longer exists, a path that
 * moved, a version constant quoted with the wrong number — which is most of the drift actually
 * found while working through the roadmap: a `VERSION` const in `public/sw.js` the build had
 * replaced, a `SAVE` artifact described as restoring a match nothing restores, "no online rematch"
 * in a guide written before online rematch shipped.
 *
 * What it deliberately does not do: judge prose. A sentence can be stale in ways no test sees, and
 * pretending otherwise is how a drift check becomes noise nobody reads.
 */
const ROOT = process.cwd();

/** Markdown outside node_modules/dist. */
function markdown(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'coverage' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) markdown(full, out);
    else if (e.name.endsWith('.md')) out.push(path.relative(ROOT, full));
  }
  return out;
}

const DOCS = markdown(ROOT);

/**
 * Referenced on purpose while absent. Each entry is a doc saying "this does not exist" — a
 * suggestion not built, or a directory created on demand — so the reference is the point.
 */
const KNOWN_ABSENT = new Set([
  'scripts/run-check.mjs', // WORKFLOW.md §13 / OUTPUT_MODES.md: a proposed wrapper, explicitly not built
  'docs/specs/', // AGENTS.md / WORKFLOW.md §14: created on demand, empty today
  'monitoring/metrics_token', // created by the operator, git-ignored (OBSERVABILITY_PRIVACY.md)
  'monitoring/grafana_password', // same
]);

/**
 * The changelog and the architecture audit are *records*: they describe the repository as it was
 * when a finding was written, so `src/core/rng` in a resolved ARCH-010 entry is the point rather
 * than drift. Both still have to pass the command and version checks below.
 */
const HISTORICAL = new Set([path.join('docs', 'CHANGELOG.md'), 'CHANGELOG.md', path.join('docs', 'ARCHITECTURE_AUDIT.md')]);

const TOP_LEVEL = /^(src|server|tests|e2e|e2e-cross|e2e-multiplayer|e2e-pwa|scripts|public|monitoring|theme|music|docs)\//;

/**
 * A path reference resolves if the file exists, or the module/test file the docs habitually name
 * without its extension does (`tests/probes`, `server/lobby-soak`, `src/core/settings`).
 */
function resolves(p: string): boolean {
  const candidates = [p, `${p}.ts`, `${p}.mjs`, `${p}.test.ts`, path.join(p, 'index.ts'), path.join('tests', `${p}.test.ts`)];
  return candidates.some((c) => fs.existsSync(path.join(ROOT, c)));
}

describe('canonical docs still describe the code', () => {
  const scripts = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>));

  it('every `npm run …` a doc tells you to run exists', () => {
    const missing: string[] = [];
    for (const doc of DOCS) {
      const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
      for (const m of text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) {
        if (!scripts.has(m[1]!)) missing.push(`${doc}: npm run ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every repo path a doc names in backticks exists', () => {
    const missing: string[] = [];
    for (const doc of DOCS.filter((d) => !HISTORICAL.has(d))) {
      const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
      for (const m of text.matchAll(/`([^`\s]+)`/g)) {
        // `file.ts:184` and `file.ts:symbol` are locations, not paths — keep the file half.
        const raw = m[1]!.replace(/[.,;:)]+$/, '').split('#')[0]!.replace(/\.ts:.*$/, '.ts');
        if (!TOP_LEVEL.test(raw) || KNOWN_ABSENT.has(raw)) continue;
        if (/[*<>{}|]|\.\.\./.test(raw)) continue; // a glob or a placeholder, not a path
        if (!resolves(raw)) missing.push(`${doc}: ${raw}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every version constant a doc quotes matches the source', () => {
    const sources: Record<string, string> = {
      PROTOCOL_VERSION: fs.readFileSync(path.join(ROOT, 'src/net/protocol.ts'), 'utf8'),
      GAME_STATE_VERSION: fs.readFileSync(path.join(ROOT, 'src/rules/rules.ts'), 'utf8'),
      REPLAY_VERSION: fs.readFileSync(path.join(ROOT, 'src/game-state/replay.ts'), 'utf8'),
    };
    const actual = Object.fromEntries(
      Object.entries(sources).map(([name, code]) => [name, code.match(new RegExp(`export const ${name} = (\\d+)`))?.[1] ?? null]),
    );
    for (const [name, value] of Object.entries(actual)) expect(value, `${name} in its own module`).not.toBeNull();

    const wrong: string[] = [];
    for (const doc of DOCS) {
      const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
      for (const name of Object.keys(sources)) {
        for (const m of text.matchAll(new RegExp(`${name} = (\\d+)`, 'g'))) {
          if (m[1] !== actual[name]) wrong.push(`${doc}: ${name} = ${m[1]}, source says ${actual[name]}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('every canonical doc AGENTS.md routes to exists', () => {
    const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
    const table = agents.slice(agents.indexOf('| Concern |'), agents.indexOf('## Priority'));
    const missing: string[] = [];
    for (const m of table.matchAll(/`([^`]+\.md)`/g)) {
      if (!fs.existsSync(path.join(ROOT, m[1]!))) missing.push(m[1]!);
    }
    expect(missing).toEqual([]);
  });
});
