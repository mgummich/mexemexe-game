import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_ASSETS, buildManifest } from '../src/assets/manifest';

/**
 * Objective asset defects, caught before a browser sees them (Phase 32). Everything here is
 * structural — dimensions, presence, naming, transparency, orphans. Whether an asset *looks* right
 * stays a human judgement against the anchors in docs/ART_DIRECTION.md; a test that claimed
 * otherwise would be the "false confidence from structural checks" this is meant to avoid.
 */
const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');

/** The canvas renders RENDER_SCALE device pixels per world unit (src/main.ts). */
const RENDER_SCALE = 3;

/** Source ÷ drawn, per family, from docs/ART_DIRECTION.md §Resolution policy. */
const BACKGROUNDS = /assets\/tables\/(boteco|kitchen|quintal|feira|menu)(-portrait)?\.png$/;
const INHERITED_133 = /assets\/(ui\/suit-|effects\/sparkle)/;

function pngSize(file: string): { w: number; h: number } {
  const head = fs.readFileSync(file).subarray(0, 24);
  expect(head.subarray(1, 4).toString('ascii'), `${file} is a PNG`).toBe('PNG');
  return { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
}

const loadable = buildManifest().filter((a) => !a.composed);

describe('shipped assets', () => {
  it('every manifest entry has a file, and every file is in the manifest', () => {
    const missing = loadable.filter((a) => !fs.existsSync(path.join(PUBLIC, a.path))).map((a) => a.path);
    expect(missing, 'manifest entries with no file').toEqual([]);

    const referenced = new Set([...loadable.map((a) => a.path), ...AUDIO_ASSETS.map((a) => a.path)]);
    const orphans: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        const rel = path.relative(PUBLIC, full);
        // The five music tracks are streamed by src/audio/music.ts, deliberately outside the
        // Phaser loader (11 MB that must never be precached). font.ttf is loaded by the composer.
        if (rel.startsWith(path.join('assets', 'audio', 'music'))) continue;
        if (rel.endsWith('font.ttf')) continue;
        if (!referenced.has(rel)) orphans.push(rel);
      }
    };
    walk(path.join(PUBLIC, 'assets'));
    expect(orphans, 'files under public/assets that nothing loads').toEqual([]);
  });

  it('every sprite is authored at its drawn size, and every background at the documented third', () => {
    const wrong: string[] = [];
    for (const asset of loadable) {
      const file = path.join(PUBLIC, asset.path);
      if (!file.endsWith('.png')) continue;
      const { w, h } = pngSize(file);
      const ratio = w / (asset.w * RENDER_SCALE);
      const expected = BACKGROUNDS.test(asset.path) ? 1 / 3 : INHERITED_133.test(asset.path) ? 4 / 3 : 1;
      if (Math.abs(ratio - expected) > 0.01) {
        wrong.push(`${asset.path}: ${w}x${h} is ${ratio.toFixed(2)}x its drawn size, expected ${expected.toFixed(2)}x`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('names its files the way the families are named', () => {
    const bad = loadable.filter((a) => !/^assets\/[a-z]+\/[a-z0-9]+(-[a-z0-9]+)*\.(png|ttf)$/.test(a.path)).map((a) => a.path);
    expect(bad, 'lowercase, hyphenated, one family directory deep').toEqual([]);
  });

  it('ships a sound for every cue the code can play', () => {
    const missing = AUDIO_ASSETS.filter((a) => !fs.existsSync(path.join(PUBLIC, a.path))).map((a) => a.path);
    expect(missing).toEqual([]);
  });

  it('gives sprites an alpha channel and backgrounds a solid one', () => {
    // PNG colour type 6 is RGBA, 2 is RGB. A sprite without alpha would render its padding as a
    // box; a background with alpha is 33% more bytes for a frame that is always fully covered.
    const wrong: string[] = [];
    for (const asset of loadable) {
      const file = path.join(PUBLIC, asset.path);
      if (!file.endsWith('.png')) continue;
      const colourType = fs.readFileSync(file).subarray(0, 26).readUInt8(25);
      const isBackground = BACKGROUNDS.test(asset.path);
      const hasAlpha = colourType === 6 || colourType === 4;
      if (!isBackground && !hasAlpha) wrong.push(`${asset.path}: sprite without an alpha channel`);
    }
    expect(wrong).toEqual([]);
  });
});
