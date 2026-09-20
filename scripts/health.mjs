// Repository health, derived — never restated. Everything printed here is read from a file that
// already owns it (docs/ROADMAP_STATUS.json for phase and risk state), so this script cannot
// become a second source of truth. No score: an aggregate number hides which area is failing,
// which is the one thing a maintainer needs.
//
//   node scripts/health.mjs        (or: npm run health)
//
// Signals it cannot see are listed at the end with where to look instead.
import fs from 'node:fs';

const STATUS = 'docs/ROADMAP_STATUS.json';
const status = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
const phases = status.phases ?? [];

/** A phase is settled when it passed in one of the ways that ends a phase. */
const SETTLED = new Set(['PASS', 'PASS_WITH_DEFERRED_RISKS', 'NO_CHANGE_REQUIRED']);
const phaseNumber = (label) => Number.parseInt(String(label).match(/\d+/)?.[0] ?? '0', 10);

const settledNumbers = new Set(phases.filter((p) => SETTLED.has(p.status)).map((p) => phaseNumber(p.phase)));
const resolved = new Set(phases.flatMap((p) => (p.resolvedRisks ?? []).map((r) => r.id)));

const open = [];
for (const phase of phases) {
  for (const risk of phase.deferredRisks ?? []) {
    if (resolved.has(risk.id)) continue;
    // An owner without a phase number is a *standing* owner — a recurring control rather than a
    // one-off phase. That is where a risk goes when the roadmap ends and the control does not.
    const owner = phaseNumber(risk.owner);
    const standing = owner === 0;
    open.push({ ...risk, ownerLabel: risk.owner, from: phaseNumber(phase.phase), owner, standing, overdue: !standing && settledNumbers.has(owner) });
  }
}

const bySeverity = (a, b) => a.id.localeCompare(b.id);
const overdue = open.filter((r) => r.overdue).sort(bySeverity);
const ahead = open.filter((r) => !r.overdue && !r.standing).sort((a, b) => a.owner - b.owner || bySeverity(a, b));
const standing = open.filter((r) => r.standing).sort(bySeverity);
const blocked = phases.filter((p) => p.status === 'BLOCKED');

const counts = phases.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});

console.log(`MEXE! repository health — ${STATUS} @ ${status.updated ?? 'no date'}`);
console.log(`current: wave ${status.current?.wave} phase ${status.current?.phase} (${status.current?.status})`);
console.log(`phases:  ${phases.length} recorded — ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);

if (blocked.length > 0) {
  console.log(`\nBLOCKED (${blocked.length}) — nothing downstream should assume these:`);
  for (const p of blocked) console.log(`  ${p.phase}: ${p.result ?? ''}`.slice(0, 160));
}

console.log(`\nRISKS DEFERRED TO A PHASE THAT HAS ALREADY PASSED (${overdue.length}) — these are the actionable ones:`);
if (overdue.length === 0) console.log('  none');
for (const r of overdue) console.log(`  ${r.id}  (from phase ${r.from}, owner phase ${r.owner})\n      ${r.note}`);

console.log(`\nRISKS WAITING ON A PHASE STILL AHEAD (${ahead.length}):`);
if (ahead.length === 0) console.log('  none');
for (const r of ahead) console.log(`  phase ${r.owner}: ${r.id} (from phase ${r.from})`);

console.log(`\nRISKS A STANDING CONTROL OWNS (${standing.length}) — no phase will close these; the control reports them:`);
if (standing.length === 0) console.log('  none');
for (const r of standing) console.log(`  ${r.id}  (from phase ${r.from}, owned by ${r.ownerLabel})\n      ${r.note}`);

console.log(`
NOT VISIBLE FROM HERE — read these directly:
  gate status          GitHub Actions: CI (per PR), Nightly (04:00 UTC), Mutation (weekly)
  flaky signal         nightly no-retry twins of the screenshot and multiplayer suites
  architecture         npx vitest run tests/boundaries.test.ts
  docs drift           npx vitest run tests/docs-drift.test.ts
  deployment config    npx vitest run tests/deployment.test.ts
  security             docs/THREAT_MODEL.md — any row whose Status is not "mitigated" or "accepted"
  performance          docs/PERFORMANCE.md — budgets, and how to re-measure them
  architecture debt    docs/ARCHITECTURE_AUDIT.md §11 risk register
`);

if (overdue.length > 0) process.exitCode = 0; // reporting, never a gate
