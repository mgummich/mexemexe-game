import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION, CONTROL_H, controlH, FOCUS, STATE_FILL, SURFACE, TEXT, toInt } from '../src/ui/tokens';

/** Every .ts under a directory, non-recursively — src/ui and src/scenes are both flat. */
function files(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f));
}

/**
 * Everything the token layer is responsible for: the Phaser UI and scenes, plus the two modules
 * that draw the DOM chrome over the canvas (the banners, the portrait hint, the error toast and
 * the Phaser canvas' own ground colour). The DOM half is the corner a re-point of `SURFACE`/`TEXT`
 * would otherwise have missed — it has no stylesheet and spelled the same panel fill and accent
 * gold out four times.
 */
function guarded(): string[] {
  return [...files('src/ui'), ...files('src/scenes'), 'src/main.ts', 'src/core/pwa.ts'];
}

describe('DS-01 semantic colours have one definition', () => {
  /**
   * The problem the token layer was introduced for: the same warm grey shipped as `#c0b8a8`,
   * `#b8b0a0`, `#b8ac98`, `#b8ab94`, `#a89e8c` and `#c9bda6` across six screens, with no rule for
   * which one a new label should pick. A raw text colour in a UI module means that decision is
   * being made locally again — name the role in src/ui/tokens.ts instead.
   *
   * Scoped to text colours (the `'#rrggbb'` string form). Integer fills are deliberately not
   * covered: gameplay owns real per-card and per-seat colours that are not chrome.
   */
  it('no UI module hardcodes a text colour', () => {
    const offenders: string[] = [];
    for (const file of guarded()) {
      if (file.endsWith('tokens.ts')) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/'#[0-9a-fA-F]{6}'/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Integer fills get a weaker rule than text colours, because some of them genuinely are content:
   * per-seat identity, the board's felt, a mask's coverage value. The rule is that none of them may
   * be an anonymous number *inline* — it is either a token or a named module constant whose doc
   * comment says why it is not one. That is what makes the next one-off visible in review instead
   * of arriving as `0x4a3a28` in the middle of an expression.
   */
  it('no UI module uses an inline integer colour', () => {
    const named = /^(export )?const [A-Z][A-Z0-9_]* (: [^=]+ )?=/;
    const offenders: string[] = [];
    for (const file of guarded()) {
      if (file.endsWith('tokens.ts')) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/0x[0-9a-fA-F]{6}/.test(line)) return;
        if (named.test(line.trim())) return; // a named constant, documented at its declaration
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return; // prose
        offenders.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('a colour that exists as both text and fill is defined once', () => {
    expect(SURFACE.accent).toBe(toInt(TEXT.accent));
    expect(SURFACE.base).toBe(toInt(TEXT.onAccent));
    expect(toInt('#ff7a68')).toBe(ACTION.danger);
  });

  it('focus rings use no gameplay-status colour', () => {
    const statusColours = [SURFACE.accent, STATE_FILL.error, STATE_FILL.success];
    for (const ring of Object.values(FOCUS)) expect(statusColours).not.toContain(ring);
  });

  it('every text role is visually distinct', () => {
    const values = Object.values(TEXT);
    expect(new Set(values).size).toBe(values.length);
  });

  it('control priorities are distinct tints', () => {
    const values = Object.values(ACTION);
    expect(new Set(values).size).toBe(values.length);
  });

  it('the app ground colour matches index.html and the PWA theme colour', () => {
    const html = readFileSync('index.html', 'utf8');
    const hex = `#${SURFACE.base.toString(16).padStart(6, '0')}`;
    expect(html).toContain(`name="theme-color" content="${hex}"`);
    expect(html).toContain(`background: ${hex}`);
  });
});

describe('DS-02 a coarse pointer gets a bigger control', () => {
  it('touch heights are larger than fine-pointer ones, for every control kind', () => {
    for (const kind of Object.keys(CONTROL_H) as (keyof typeof CONTROL_H)[]) {
      expect(controlH(kind, true)).toBeGreaterThan(controlH(kind, false));
      // 24 units is the smallest target the panels ship; below it a finger starts missing rows.
      expect(controlH(kind, true)).toBeGreaterThanOrEqual(24);
    }
  });
});
