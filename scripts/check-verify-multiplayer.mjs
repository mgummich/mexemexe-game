// Final gate for verify:multiplayer: merges multiplayer.spec.ts's per-worker evidence shards,
// writes the merged result back to verify-multiplayer-log.json (so the CI artifact upload and
// doc consumers keep finding it there), then fails on any client console error, any server
// error/crash, any missing screenshot, or any illegal proposal that was accepted. Mirrors
// scripts/check-verify.mjs.
import fs from 'node:fs';
import path from 'node:path';

const LOG = 'docs/screenshots/verify-multiplayer-log.json';
const PARTS_DIR = 'docs/screenshots/verify-multiplayer-log-parts';
if (!fs.existsSync(PARTS_DIR)) {
  console.error('verify:multiplayer: missing', PARTS_DIR);
  process.exit(1);
}
const partFiles = fs.readdirSync(PARTS_DIR).filter((f) => f.endsWith('.json')).sort();
if (partFiles.length === 0) {
  console.error('verify:multiplayer: no shards in', PARTS_DIR);
  process.exit(1);
}
// Screenshots and server output are the union of every shard — each worker ran its own server,
// and one crashed server anywhere has to fail the gate. Every other key is written by exactly
// one test, so a plain assign is enough; sorted filenames keep the order deterministic.
const log = { server: { stdout: [], stderr: [] }, screenshots: [] };
for (const f of partFiles) {
  const part = JSON.parse(fs.readFileSync(path.join(PARTS_DIR, f), 'utf8'));
  for (const [k, v] of Object.entries(part)) {
    if (k === 'screenshots') log.screenshots.push(...v);
    else if (k === 'server') {
      log.server.stdout.push(...(v.stdout ?? []));
      log.server.stderr.push(...(v.stderr ?? []));
    } else log[k] = v;
  }
}
fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
let failed = false;

// Which engines must have lobby evidence is a CI-schedule decision, not a property of the run:
// the PR gate runs chromium only (Firefox/WebKit lobby coverage runs nightly, where the extra
// ~15 minutes is free), so the caller passes --engines=. Default is all three, which is what
// `npm run verify:multiplayer` runs locally and nightly.
const ENGINE_FLAG = '--engines=';
const ENGINES = (process.argv.find((a) => a.startsWith(ENGINE_FLAG))?.slice(ENGINE_FLAG.length) ?? 'chromium,firefox,webkit')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

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

// Quick Match: one room and one seat per player at every supported table size, under the
// server's canonical casual terms. A duplicate seat or a second room here is the failure the
// whole queue phase exists to make impossible.
for (const size of [2, 3, 4]) {
  const run = log.queueRuns?.[size];
  const expectedSeats = Array.from({ length: size }, (_, i) => i);
  const seats = run ? [...run.seats].sort((a, b) => a - b) : null;
  if (
    !run ||
    JSON.stringify(seats) !== JSON.stringify(expectedSeats) ||
    new Set(run.codes ?? []).size !== 1 ||
    run.timerMode !== 'casual'
  ) {
    failed = true;
    console.error(`verify:multiplayer: missing or wrong ${size}P Quick Match evidence`, run);
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

// Lobby state-machine gate (e2e-multiplayer/lobby.spec.ts), one entry per browser engine that
// this run was asked to cover. A Chrome pass is not evidence for Firefox or WebKit, which is why
// the nightly matrix still demands all three.
const LOBBY_LOG = 'docs/screenshots/verify-lobby-log.json';
const LOBBY_PARTS_DIR = 'docs/screenshots/verify-lobby-log-parts';
if (!fs.existsSync(LOBBY_PARTS_DIR)) {
  failed = true;
  console.error('verify:multiplayer: missing', LOBBY_PARTS_DIR);
} else {
  // lobby.spec.ts runs parallel, so each engine's evidence arrives in as many shards as there
  // were workers. Merge per engine — screenshots and server stderr are the union, every other
  // key is written by exactly one test — then write the merged result back to verify-lobby-log
  // .json for the artifact upload and doc consumers.
  const lobby = {};
  for (const f of fs.readdirSync(LOBBY_PARTS_DIR).filter((n) => n.endsWith('.json')).sort()) {
    const { engine, screenshots = [], serverStderr = [], ...rest } = JSON.parse(fs.readFileSync(path.join(LOBBY_PARTS_DIR, f), 'utf8'));
    const run = (lobby[engine] ??= { screenshots: [], serverStderr: [] });
    run.screenshots.push(...screenshots);
    run.serverStderr.push(...serverStderr);
    Object.assign(run, rest);
  }
  fs.writeFileSync(LOBBY_LOG, JSON.stringify(lobby, null, 2) + '\n');
  for (const engine of ENGINES) {
    const run = lobby[engine];
    if (!run) {
      failed = true;
      console.error(`verify:multiplayer: no lobby evidence for ${engine}`);
      continue;
    }
    if ((run.serverStderr ?? []).length) {
      failed = true;
      console.error(`verify:multiplayer: lobby server stderr (${engine}):`, run.serverStderr);
    }
    // The seat-gap invariant, as RENDERED: seat 3 keeps its occupant with seats 1 and 2 empty.
    const gaps = run.seatGaps ?? [];
    const occupied = gaps.filter((r) => r.status !== 'empty').map((r) => r.seat);
    if (JSON.stringify(gaps.map((r) => r.seat)) !== '[0,1,2,3]' || JSON.stringify(occupied) !== '[0,3]') {
      failed = true;
      console.error(`verify:multiplayer: lobby seat-gap evidence wrong (${engine})`, gaps);
    }
    // Three matches on one room code, each with its own match id.
    const end = run.endurance;
    if (!end || new Set(end.matchIds ?? []).size !== 3 || !end.code) {
      failed = true;
      console.error(`verify:multiplayer: 3-match endurance evidence missing (${engine})`, end);
    }
    for (const shot of run.screenshots ?? []) {
      if (!fs.existsSync(shot)) {
        failed = true;
        console.error(`verify:multiplayer: missing lobby screenshot ${shot}`);
      }
    }
  }
}

// iOS-viewport WebKit gate (e2e-multiplayer/ios-lobby.spec.ts) — only WebKit produces it.
const IOS_LOG = 'docs/screenshots/verify-lobby-ios-log.json';
if (!ENGINES.includes('webkit')) {
  console.log('verify:multiplayer: skipping the iOS WebKit gate (engines:', ENGINES.join(','), ')');
} else if (!fs.existsSync(IOS_LOG)) {
  failed = true;
  console.error('verify:multiplayer: missing', IOS_LOG);
} else {
  const ios = JSON.parse(fs.readFileSync(IOS_LOG, 'utf8'));
  if ((ios.serverStderr ?? []).length) {
    failed = true;
    console.error('verify:multiplayer: iOS lobby server stderr:', ios.serverStderr);
  }
  if (ios.rotate?.seat !== 1) {
    failed = true;
    console.error('verify:multiplayer: orientation change did not preserve the seat', ios.rotate);
  }
  if (!ios.webkitMatch?.firstId || ios.webkitMatch.firstId === ios.webkitMatch.secondId) {
    failed = true;
    console.error('verify:multiplayer: WebKit rematch did not mint a fresh matchId', ios.webkitMatch);
  }
  for (const shot of ios.screenshots ?? []) {
    if (!fs.existsSync(shot)) {
      failed = true;
      console.error(`verify:multiplayer: missing iOS lobby screenshot ${shot}`);
    }
  }
}

console.log(`verify:multiplayer: room=${log.roomCode} seed=${log.seed} revisions=${JSON.stringify(log.revisionsObserved)}`);
console.log(`verify:multiplayer: screenshots=${(log.screenshots ?? []).length}`);

if (failed) process.exit(1);
console.log('verify:multiplayer: OK');
