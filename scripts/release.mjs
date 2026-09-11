#!/usr/bin/env node
// Cuts a release: bumps package.json, stamps the accumulated `## Unreleased`
// sections in CHANGELOG.md into one version heading, commits and tags.
// Pushing the tag is left to you; .github/workflows/release.yml turns the tag
// into a GitHub Release whose body is that CHANGELOG section verbatim.
//
// Usage:
//   node scripts/release.mjs patch|minor|major|X.Y.Z   cut a release
//   node scripts/release.mjs --notes X.Y.Z             print one section (CI uses this)
//   node scripts/release.mjs --selfcheck               run the built-in asserts
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(root, 'package.json');
const LOG = path.join(root, 'CHANGELOG.md');

/** `1.6.0` + `minor` -> `1.7.0`. An explicit `X.Y.Z` passes through. */
export function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [maj, min, pat] = current.split('.').map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`unknown bump "${bump}" — use major, minor, patch or X.Y.Z`);
}

/**
 * Rewrites the leading run of `## Unreleased — <title>` sections into a single
 * `## X.Y.Z — <date>` section, each old heading demoted to an `### <title>`
 * subhead. Throws if there is nothing unreleased to cut.
 */
export function stampChangelog(text, version, date) {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l.startsWith('## '));
  if (first === -1 || !/^## Unreleased\b/.test(lines[first])) {
    throw new Error('CHANGELOG.md: no leading `## Unreleased` section to release');
  }
  const out = [...lines];
  for (let i = first; i < out.length; i++) {
    if (!out[i].startsWith('## ')) continue;
    const m = /^## Unreleased(?:\s+[—-]\s+(.*))?$/.exec(out[i]);
    if (!m) break; // reached an already-released section
    out[i] = `### ${m[1] ?? 'Changes'}`;
  }
  out.splice(first, 0, `## ${version} — ${date}`, '');
  return out.join('\n');
}

/** Body of one `## <version> ...` section, without its heading. */
export function extractNotes(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l.trim() === `## ${version}`);
  if (start === -1) throw new Error(`CHANGELOG.md: no section for ${version}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function selfcheck() {
  assert.equal(nextVersion('1.6.0', 'minor'), '1.7.0');
  assert.equal(nextVersion('1.6.3', 'patch'), '1.6.4');
  assert.equal(nextVersion('1.6.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.6.3', '9.9.9'), '9.9.9');
  assert.throws(() => nextVersion('1.6.3', 'huge'));

  const sample = [
    '# Changelog', '',
    '## Unreleased — Phase 2 (b)', '', '- two', '',
    '## Unreleased — Phase 1 (a)', '', '- one', '',
    '## 1.0.0 — 2020-01-01', '', '- zero', '',
  ].join('\n');
  const stamped = stampChangelog(sample, '1.1.0', '2020-02-02');
  assert.match(stamped, /## 1\.1\.0 — 2020-02-02/);
  assert.match(stamped, /### Phase 2 \(b\)/);
  assert.match(stamped, /### Phase 1 \(a\)/);
  assert.ok(!stamped.includes('Unreleased'), 'every leading Unreleased heading is demoted');
  assert.match(stamped, /## 1\.0\.0 — 2020-01-01/, 'released sections are untouched');
  assert.equal(extractNotes(stamped, '1.1.0'), '### Phase 2 (b)\n\n- two\n\n### Phase 1 (a)\n\n- one');
  assert.equal(extractNotes(stamped, '1.0.0'), '- zero');
  assert.throws(() => stampChangelog(stamped, '1.2.0', '2020-03-03'), /no leading/);
  assert.throws(() => extractNotes(stamped, '5.0.0'), /no section/);
  console.log('release.mjs selfcheck ok');
}

function main(argv) {
  const [arg, value] = argv;
  if (arg === '--selfcheck') return selfcheck();
  if (arg === '--notes') {
    process.stdout.write(extractNotes(fs.readFileSync(LOG, 'utf8'), value) + '\n');
    return;
  }
  if (!arg) throw new Error('usage: node scripts/release.mjs patch|minor|major|X.Y.Z');

  if (git('status', '--porcelain')) throw new Error('working tree is dirty — commit or stash first');
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') throw new Error('releases are cut from main');

  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const version = nextVersion(pkg.version, arg);
  const tag = `v${version}`;
  if (git('tag', '--list', tag)) throw new Error(`${tag} already exists`);

  const date = new Date().toISOString().slice(0, 10);
  const changelog = stampChangelog(fs.readFileSync(LOG, 'utf8'), version, date);

  pkg.version = version;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(LOG, changelog);

  git('add', 'package.json', 'CHANGELOG.md');
  git('commit', '-m', `chore(release): ${tag}`);
  git('tag', '-a', tag, '-m', `${tag}\n\n${extractNotes(changelog, version)}`);

  console.log(`Cut ${tag}. Review, then publish with:\n\n  git push origin main --follow-tags\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`release: ${err.message}`);
    process.exit(1);
  }
}
