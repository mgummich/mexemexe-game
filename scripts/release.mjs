#!/usr/bin/env node
// Cuts a release: bumps package.json, stamps the accumulated `## Unreleased`
// sections in CHANGELOG.md into one version heading, commits and tags.
// Pushing the tag is left to you; .github/workflows/release.yml turns the tag
// into a GitHub Release whose body is that CHANGELOG section verbatim.
//
// Usage:
//   node scripts/release.mjs patch|minor|major|X.Y.Z   cut a release
//   node scripts/release.mjs --notes X.Y.Z             render the release body (CI uses this)
//   node scripts/release.mjs --raw-notes X.Y.Z         print one CHANGELOG section verbatim
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

/** `## 1.6.0 — ...` heading that follows `version`'s section, if any. */
export function previousVersion(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l.trim() === `## ${version}`);
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^## (\d+\.\d+\.\d+)\b/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

/**
 * Splits a CHANGELOG section body into `{ phase, bullets }` groups. A bullet is
 * a top-level `- ` line plus its indented continuation lines, joined; `phase` is
 * the enclosing `### ` subhead, or null in older sections that have none.
 */
export function parseSection(body) {
  const groups = [];
  let current = { phase: null, bullets: [] };
  let bullet = null;
  const flush = () => { if (bullet) { current.bullets.push(bullet.join(' ').replace(/\s+/g, ' ').trim()); bullet = null; } };
  for (const line of body.split('\n')) {
    const head = /^### (?:Phase (\d+)\b[\s—-]*)?(.*)$/.exec(line);
    if (line.startsWith('### ') && head) {
      flush();
      if (current.bullets.length) groups.push(current);
      const label = head[1] ? `Phase ${head[1]}` : head[2].replace(/\s*\(.*\)\s*$/, '');
      current = { phase: label || null, bullets: [] };
      continue;
    }
    if (/^- /.test(line)) { flush(); bullet = [line.slice(2)]; continue; }
    if (bullet && /^\s+\S/.test(line)) { bullet.push(line.trim()); continue; }
    flush();
  }
  flush();
  if (current.bullets.length) groups.push(current);
  return groups;
}

const KINDS = [
  { key: 'Fixed', title: '🐛 Fixed', leads: ['fixed', 'fix'] },
  { key: 'Added', title: '✨ Added', leads: ['added', 'new'] },
  { key: 'Changed', title: '🔧 Changed', leads: ['changed', 'change'] },
  { key: 'Removed', title: '🗑️ Removed', leads: ['removed'] },
  { key: 'Docs', title: '📖 Docs', leads: ['docs', 'doc'] },
  { key: 'Other', title: '🧩 Also', leads: [] },
];

/**
 * A bullet's `{ kind, headline }`. Convention is a bold lead of the form
 * `**Fixed: what broke.** why and how`; the kind word is dropped from the
 * headline. Anything else keeps its full text and lands in `Other`.
 */
export function classifyBullet(text) {
  const bold = /^\*\*(.+?)\*\*/s.exec(text);
  let lead = bold ? bold[1] : text;
  const kinded = /^([A-Za-z]+):\s*(.+)$/s.exec(lead);
  const kind = kinded && KINDS.find((k) => k.leads.includes(kinded[1].toLowerCase()));
  if (kind) lead = kinded[2];
  // A lead that merely introduces the sentence after it ("Crash policy:") says
  // nothing on its own, so pull in the first sentence that follows the bold.
  if (bold) {
    const rest = text.slice(bold[0].length).replace(/^[\s—-]+/, '');
    if (/[:,]$/.test(lead.trim())) lead = `${lead.trim()} ${firstSentence(rest)}`;
    // A parenthetical right after the lead is the scope of the change
    // ("(2 tests, a fresh context each)") — short and worth keeping.
    else if (rest.startsWith('(')) {
      const paren = /^\(([^()]{0,120})\)/.exec(rest);
      if (paren) lead = `${lead.trim().replace(/\.$/, '')} (${paren[1]})`;
    }
  }
  return { kind: kind ? kind.key : 'Other', headline: lead.replace(/[.\s]+$/, '').trim() };
}

/** First sentence of `text`, or a hard-wrapped prefix if it runs long. */
function firstSentence(text) {
  const m = /^(.{0,200}?[.!?])(\s|$)/s.exec(text);
  if (m) return m[1];
  return text.length > 200 ? `${text.slice(0, 200).replace(/\s+\S*$/, '')}…` : text;
}

/** Owner/repo and the Pages URL, from CI's env or the git remote. */
function repoInfo() {
  let slug = process.env.GITHUB_REPOSITORY;
  if (!slug) {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
    slug = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1] ?? 'unknown/unknown';
  }
  const [owner, repo] = slug.split('/');
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  return { slug, url: `${server}/${slug}`, pages: `https://${owner}.github.io/${repo}/` };
}

/**
 * The GitHub Release body: a stat line, links, bullets grouped by kind with the
 * phase they came from, and the verbatim CHANGELOG section folded underneath so
 * the full prose is one click away rather than a wall of text.
 */
export function renderNotes(text, version, info) {
  const body = extractNotes(text, version);
  const groups = parseSection(body);
  const date = /^## .*?—\s*(\d{4}-\d{2}-\d{2})/m.exec(
    text.split('\n').find((l) => l.startsWith(`## ${version} `)) ?? '',
  )?.[1];

  const buckets = new Map(KINDS.map((k) => [k.key, []]));
  for (const { phase, bullets } of groups) {
    for (const raw of bullets) {
      const { kind, headline } = classifyBullet(raw);
      buckets.get(kind).push(phase ? `${headline} _(${phase})_` : headline);
    }
  }

  const phases = groups.filter((g) => g.phase).length;
  const stats = [
    phases ? `${phases} ${phases === 1 ? 'phase' : 'phases'}` : null,
    ...KINDS.map((k) => {
      const n = buckets.get(k.key).length;
      if (!n || k.key === 'Other') return null;
      const [one, many] = {
        Fixed: ['fix', 'fixes'],
        Added: ['addition', 'additions'],
        Changed: ['change', 'changes'],
        Removed: ['removal', 'removals'],
        Docs: ['doc update', 'doc updates'],
      }[k.key];
      return `${n} ${n === 1 ? one : many}`;
    }),
  ].filter(Boolean);

  // No title heading: the GitHub Release page already renders `MEXE! vX.Y.Z`.
  const out = [`_${[date ? `Released ${date}` : null, ...stats].filter(Boolean).join(' · ')}_`, ''];
  out.push(`▶ **[Play it](${info.pages})** · [Docs](${info.pages}docs/) · [Self-hosting](${info.url}/blob/main/SELF_HOSTING.md)`, '', '---', '');

  for (const kind of KINDS) {
    const items = buckets.get(kind.key);
    if (!items.length) continue;
    out.push(`### ${kind.title}`, '', ...items.map((i) => `- ${i}`), '');
  }

  out.push('<details>', '<summary><b>Full notes, phase by phase</b></summary>', '', body, '', '</details>', '', '---', '');
  const prev = previousVersion(text, version);
  out.push(
    prev
      ? `**Full changelog:** [v${prev}...v${version}](${info.url}/compare/v${prev}...v${version})`
      : `**Full changelog:** [CHANGELOG.md](${info.url}/blob/main/CHANGELOG.md)`,
  );
  return out.join('\n');
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
  assert.equal(previousVersion(stamped, '1.1.0'), '1.0.0');
  assert.equal(previousVersion(stamped, '1.0.0'), null);

  const groups = parseSection(extractNotes(stamped, '1.1.0'));
  assert.deepEqual(groups, [
    { phase: 'Phase 2', bullets: ['two'] },
    { phase: 'Phase 1', bullets: ['one'] },
  ]);
  assert.deepEqual(parseSection('- a\n  wrapped\n- b'), [{ phase: null, bullets: ['a wrapped', 'b'] }]);

  assert.deepEqual(classifyBullet('**Fixed: the banner stacked.** Because x.'),
    { kind: 'Fixed', headline: 'the banner stacked' });
  assert.deepEqual(classifyBullet('**Docs: `docs/SELF_HOSTING.md` grew a section**'),
    { kind: 'Docs', headline: '`docs/SELF_HOSTING.md` grew a section' });
  assert.deepEqual(classifyBullet('**Crash policy:** the process exits. More prose.'),
    { kind: 'Other', headline: 'Crash policy: the process exits' }, 'an introducer lead pulls in its sentence');
  assert.deepEqual(classifyBullet('**Added: a spec** (2 tests, fresh context) and prose.'),
    { kind: 'Added', headline: 'a spec (2 tests, fresh context)' }, 'a scope parenthetical is kept');
  assert.deepEqual(classifyBullet('plain bullet text'), { kind: 'Other', headline: 'plain bullet text' });

  const notes = renderNotes(stamped, '1.1.0', { url: 'https://ex.com/o/r', pages: 'https://o.github.io/r/' });
  assert.match(notes, /^_Released 2020-02-02 · 2 phases_/);
  assert.match(notes, /### 🧩 Also\n\n- two _\(Phase 2\)_\n- one _\(Phase 1\)_/);
  assert.match(notes, /compare\/v1\.0\.0\.\.\.v1\.1\.0/);
  assert.ok(notes.includes('<details>') && notes.includes('- two'), 'the verbatim section is folded in');
  assert.match(renderNotes(stamped, '1.0.0', { url: 'https://ex.com/o/r', pages: 'https://o.github.io/r/' }),
    /CHANGELOG\.md\)/, 'the oldest release links the file, not a compare');

  console.log('release.mjs selfcheck ok');
}

function main(argv) {
  const [arg, value] = argv;
  if (arg === '--selfcheck') return selfcheck();
  if (arg === '--raw-notes') {
    process.stdout.write(extractNotes(fs.readFileSync(LOG, 'utf8'), value) + '\n');
    return;
  }
  if (arg === '--notes') {
    process.stdout.write(renderNotes(fs.readFileSync(LOG, 'utf8'), value, repoInfo()) + '\n');
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
