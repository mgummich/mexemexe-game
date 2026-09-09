// Final gate for verify:multiplayer: inspects the multiplayer Playwright log and fails on any
// client console error, any server error/crash, any missing screenshot, or any illegal
// proposal that was accepted. Mirrors scripts/check-verify.mjs.
import fs from 'node:fs';

const LOG = 'docs/screenshots/verify-multiplayer-log.json';
if (!fs.existsSync(LOG)) {
  console.error('verify:multiplayer: missing', LOG);
  process.exit(1);
}
const log = JSON.parse(fs.readFileSync(LOG, 'utf8'));
let failed = false;

for (const [name, client] of Object.entries(log.clients ?? {})) {
  const errs = [...(client.consoleErrors ?? []), ...(client.pageErrors ?? [])];
  if (errs.length) {
    failed = true;
    console.error(`verify:multiplayer: client ${name} has errors:`, errs);
  }
}

const serverErrLines = (log.server?.stderr ?? []).filter((l) => l.trim().length > 0);
if (serverErrLines.length) {
  failed = true;
  console.error('verify:multiplayer: server stderr is non-empty:', serverErrLines);
}

for (const shot of log.screenshots ?? []) {
  if (!fs.existsSync(shot)) {
    failed = true;
    console.error(`verify:multiplayer: missing screenshot ${shot}`);
  }
}

if (log.illegalProposal?.accepted) {
  failed = true;
  console.error('verify:multiplayer: illegal proposal was accepted (rev changed)', log.illegalProposal);
}
if (!log.illegalProposal?.reasons?.length) {
  failed = true;
  console.error('verify:multiplayer: illegal proposal produced no rejection reason');
}

if (!log.roomCode || typeof log.seed !== 'number' || !Array.isArray(log.revisionsObserved) || log.revisionsObserved.length < 2) {
  failed = true;
  console.error('verify:multiplayer: log missing roomCode/seed/revisionsObserved');
}

const rc = log.reconnect;
if (
  !rc ||
  typeof rc.revisionBefore !== 'number' ||
  typeof rc.revisionAfter !== 'number' ||
  rc.revisionAfter !== rc.revisionBefore ||
  !rc.noticeObserved
) {
  failed = true;
  console.error('verify:multiplayer: reconnect did not resync to the expected revision', rc);
}

for (const count of [3, 4]) {
  const run = log.playerCountRuns?.[count];
  const expectedSeats = Array.from({ length: count }, (_, i) => i);
  if (!run || JSON.stringify(run.seats) !== JSON.stringify(expectedSeats) || !run.screenshot || !fs.existsSync(run.screenshot)) {
    failed = true;
    console.error(`verify:multiplayer: missing ${count}P stable-seat/rotation evidence`, run);
  }
}

const kj = log.keyboardJoin;
if (!kj?.code || !kj.screenshot || !fs.existsSync(kj.screenshot)) {
  failed = true;
  console.error('verify:multiplayer: missing in-canvas join-code evidence', kj);
}

const privacy = log.handPrivacy;
if (!privacy?.ownRealCards || !privacy.opponentAllPlaceholders || !privacy.drawPileAllPlaceholders) {
  failed = true;
  console.error('verify:multiplayer: hand privacy not proven for the observing client', privacy);
}

const rs = log.resync;
if (!rs || rs.revisionAfter !== rs.revisionBefore || rs.desyncs?.host !== 0 || rs.desyncs?.guest !== 0) {
  failed = true;
  console.error('verify:multiplayer: resync round-trip or state-hash agreement failed', rs);
}

// Phase 8 Wave D: public-demo tester-risk coverage (server-unavailable, bad room code, room
// full) — fail loud if any of these named captures never made it to disk.
const EXPECTED_DEMO_SHOTS = [
  'docs/screenshots/mp-unreachable.png',
  'docs/screenshots/mp-room-not-found.png',
  'docs/screenshots/mp-room-full.png',
];
for (const shot of EXPECTED_DEMO_SHOTS) {
  if (!fs.existsSync(shot)) {
    failed = true;
    console.error(`verify:multiplayer: missing public-demo screenshot ${shot}`);
  }
}

console.log(`verify:multiplayer: room=${log.roomCode} seed=${log.seed} revisions=${JSON.stringify(log.revisionsObserved)}`);
console.log(`verify:multiplayer: screenshots=${(log.screenshots ?? []).length}`);

if (failed) process.exit(1);
console.log('verify:multiplayer: OK');
