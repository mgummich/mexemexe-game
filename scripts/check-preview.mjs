// Production-build smoke gate: verifies the *built* client actually serves —
// base-path/asset resolution, boot-time asset presence, no leaked secrets in
// the emitted bundle. `npm run verify` never exercises `dist/`, so a
// production-only regression (bad `base`, dev-only import, missing dist asset)
// would otherwise ship green.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`check-preview: missing ${DIST}/index.html — run "npm run build" first`);
  process.exit(1);
}

// Boot-time assets the game fetches at runtime, not referenced from index.html.
const RUNTIME_ASSETS = ['assets/cards/back-0.png', 'assets/ui/emote-sleepy.png', 'assets/audio/click.wav'];
for (const rel of RUNTIME_ASSETS) {
  if (!fs.existsSync(path.join(DIST, rel))) {
    console.error(`check-preview: expected runtime asset missing from ${DIST}: ${rel}`);
    process.exit(1);
  }
}

// Secret scan of every emitted .js file. Patterns are credential-shaped, not
// generic words, to avoid false positives on minified game strings.
const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*['"][^'"]{8,}/i,
  /secret\s*[:=]\s*['"][^'"]{8,}/i,
  /password\s*[:=]\s*['"][^'"]{4,}/i,
  /Bearer [A-Za-z0-9._-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];
function walkJs(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const jsFiles = walkJs(DIST);
for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const pattern of SECRET_PATTERNS) {
    const match = src.match(pattern);
    if (match) {
      console.error(`check-preview: possible secret in ${file}: matched ${pattern} -> "${match[0]}"`);
      process.exit(1);
    }
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ORIGIN + '/');
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`preview server never became reachable at ${ORIGIN} within 15s`);
}

function extractAssetPaths(html) {
  const paths = new Set();
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (url.startsWith('http') || url.startsWith('//')) continue;
    paths.add(url);
  }
  return [...paths];
}

const child = spawn('npm', ['run', 'preview'], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});

let bundleName = '';
let assetCount = 0;
let failure = false;
try {
  await waitForServer();

  const res = await fetch(ORIGIN + '/');
  if (res.status !== 200) {
    throw new Error(`GET / returned ${res.status}, expected 200`);
  }
  const html = await res.text();
  const bundleMatch = html.match(/assets\/index-[^"']+\.js/);
  if (!bundleMatch) {
    throw new Error('index.html does not reference a hashed JS bundle');
  }
  bundleName = bundleMatch[0];

  const assetPaths = extractAssetPaths(html);
  for (const rel of assetPaths) {
    const url = new URL(rel, ORIGIN + '/').toString();
    const assetRes = await fetch(url);
    if (assetRes.status !== 200) {
      throw new Error(`asset ${rel} (from index.html) returned ${assetRes.status}`);
    }
  }
  assetCount = assetPaths.length;

  for (const rel of RUNTIME_ASSETS) {
    const assetRes = await fetch(ORIGIN + '/' + rel);
    if (assetRes.status !== 200) {
      throw new Error(`runtime asset ${rel} returned ${assetRes.status}`);
    }
    assetCount++;
  }
} catch (err) {
  console.error(`check-preview: ${err.message}`);
  failure = true;
} finally {
  // `process.exit` inside the try would skip this and strand the preview server on :4173
  // (--strictPort makes every later run fail), so failures throw and exit down here.
  child.kill();
}
if (failure) process.exit(1);

console.log(
  `check-preview: bundle=${bundleName} assetsChecked=${assetCount} jsFilesScanned=${jsFiles.length} port=${PORT}`,
);
console.log('check-preview: OK');
