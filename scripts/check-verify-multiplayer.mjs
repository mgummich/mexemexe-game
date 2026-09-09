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

console.log(`verify:multiplayer: room=${log.roomCode} seed=${log.seed} revisions=${JSON.stringify(log.revisionsObserved)}`);
console.log(`verify:multiplayer: screenshots=${(log.screenshots ?? []).length}`);

if (failed) process.exit(1);
console.log('verify:multiplayer: OK');
