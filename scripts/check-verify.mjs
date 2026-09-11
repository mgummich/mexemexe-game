// Final verify gate: merges e2e/screenshot.spec.ts's per-worker shards, writes the merged result
// back to verify-log.json (so the CI artifact upload and doc consumers keep finding it there),
// then inspects it for errors.
import fs from 'node:fs';
import path from 'node:path';

const LOG = 'docs/screenshots/verify-log.json';
const PARTS_DIR = 'docs/screenshots/verify-log-parts';
if (!fs.existsSync(PARTS_DIR)) {
  console.error('verify: missing', PARTS_DIR);
  process.exit(1);
}
const partFiles = fs.readdirSync(PARTS_DIR).filter((f) => f.endsWith('.json')).sort();
if (partFiles.length === 0) {
  console.error('verify: no shards in', PARTS_DIR);
  process.exit(1);
}
// Later shard wins for a duplicate shot name — sorted filenames give a stable, arbitrary-but-
// deterministic order; nothing here depends on which shard "wins" for a given name in practice
// (each test name is only ever captured by one worker per pass).
const merged = new Map();
for (const f of partFiles) {
  const part = JSON.parse(fs.readFileSync(path.join(PARTS_DIR, f), 'utf8'));
  for (const s of part.shots) merged.set(s.name, s);
}
const shots = [...merged.values()];
fs.writeFileSync(LOG, JSON.stringify({ generatedAt: new Date().toISOString(), shots }, null, 2) + '\n');
let failed = false;
for (const s of shots) {
  const errs = [...s.consoleErrors, ...s.pageErrors];
  if (errs.length) {
    failed = true;
    console.error(`verify: ${s.name} has errors:`, errs);
  }
  if (!fs.existsSync(s.screenshot)) {
    failed = true;
    console.error(`verify: missing screenshot ${s.screenshot}`);
  }
  // fps under parallel workers measures runner load, not the game, so the floor is enforced
  // only for shots captured by the serial @perf pass (fpsGated === true, which also holds the
  // three explicit measured floors of 50/30/20 in e2e/screenshot.spec.ts); every other shot's
  // fps is printed below for visibility but never gates the build.
  const fpsNote = s.fpsGated ? `fps=${s.fps}` : `fps=${s.fps} (ungated)`;
  if (s.scene === 'game' && s.fpsGated && s.fps < 30) {
    failed = true;
    console.error(`verify: ${s.name} fps too low: ${s.fps} (scene=game requires >= 30)`);
  }
  const vp = s.viewport ? `${s.viewport.width}x${s.viewport.height}` : 'unknown';
  console.log(`verify: ${s.name} scene=${s.scene} seed=${s.seed} ${fpsNote} viewport=${vp} missingAssets=${s.missingAssets.length}`);
}
// Phase 8 Wave D: public-demo coverage must actually run, not just exist as source — fail loud
// if any of these named captures never made it into the log (e.g. a test silently skipped).
const EXPECTED_SHOTS = [
  'tutorial-trinca',
  'tutorial-joker',
  'tutorial-complete',
  'feito-invalid-explained',
  'feito-invalid-explained-en',
  // Phase 9: cosmetics + a11y coverage.
  'game-theme-boteco',
  'game-theme-kitchen',
  'game-theme-quintal',
  'game-theme-feira',
  'cosmetics-panel',
  'a11y-reduced-motion',
  // Phase 12: smart drag/snap helpers.
  'snap-targets-legal',
  'snap-target-illegal',
  'snap-preview-valid',
  'snap-preview-invalid',
  'snap-preview-joker',
  'snap-reason-tapped',
  'snap-preview-en',
  // Phase 13: mobile layout + tap-first controls.
  'mobile-portrait-menu',
  'mobile-portrait-game',
  'mobile-landscape-game',
  'mobile-tap-select',
  'mobile-tap-move-valid',
  'mobile-tap-move-invalid',
  'mobile-feito-blocked',
  'mobile-badge-reason',
  'mobile-portrait-en',
  // Phase 14 Wave B: helper modes.
  'helper-beginner-destinations',
  'helper-standard-feedback',
  'helper-expert-minimal',
  'invalid-reason-badge',
  // Phase 14 Wave C: focused Mexe editor.
  'mobile-mexe-editor',
  'editor-valid-final',
  'editor-invalid-draft',
  'editor-move',
  'pan-perf',
  // Phase 14 Wave D: table zoom/pan + meld focus.
  'table-zoomed',
  'meld-focus',
  'meld-focus-dismissed',
  'zoom-buttons',
  'zoom-buttons-reachable',
  'zoom-card-drag-precedence',
  // Phase 14 Wave E: helper-mode settings row + tutorial/help coverage.
  'settings',
  // Phase 14 regression fix: tutorial step panel was rendering off-screen in portrait.
  'tutorial-portrait',
];
const shotNames = new Set(shots.map((s) => s.name));
for (const name of EXPECTED_SHOTS) {
  if (!shotNames.has(name)) {
    failed = true;
    console.error(`verify: missing expected public-demo screenshot: ${name}`);
  }
}

if (failed) process.exit(1);
console.log('verify: OK');

// Merge perf/coverage metrics into docs/STATUS.json (never clobber other keys).
const STATUS = 'docs/STATUS.json';
if (fs.existsSync(STATUS)) {
  const status = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
  const viewports = [...new Set(shots.map((s) => (s.viewport ? `${s.viewport.width}x${s.viewport.height}` : 'unknown')))];
  status.metrics = {
    generatedAt: new Date().toISOString(),
    perShotFps: Object.fromEntries(shots.map((s) => [s.name, s.fps])),
    viewports,
    unitTests: status.tests?.unit ?? null,
    // Screenshot captures, not the e2e test count — a spec file can assert without capturing.
    e2eScreenshots: shots.length,
  };
  fs.writeFileSync(STATUS, JSON.stringify(status, null, 2) + '\n');
  console.log('verify: wrote metrics to', STATUS);
}
