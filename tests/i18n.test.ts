import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localeKeys, setLocale, t } from '../src/localization/i18n';
import type { ReasonCode } from '../src/rules/types';

const LOCALES = ['pt', 'en'] as const;

describe('i18n key parity', () => {
  it('pt and en define exactly the same key set', () => {
    const pt = new Set(localeKeys('pt'));
    const en = new Set(localeKeys('en'));
    const missingInEn = [...pt].filter((k) => !en.has(k));
    const missingInPt = [...en].filter((k) => !pt.has(k));
    expect(missingInEn, 'keys present in pt but missing from en').toEqual([]);
    expect(missingInPt, 'keys present in en but missing from pt').toEqual([]);
  });
});

const REASON_CODES: ReasonCode[] = [
  'reason.meldTooSmall',
  'reason.notAMeld',
  'reason.runSuitMismatch',
  'reason.runGap',
  'reason.noHandCard',
  'reason.cardMissing',
  'reason.duplicateCard',
  'reason.foreignCard',
  'reason.groupTooLarge',
  'reason.groupDuplicateSuit',
  'reason.groupAllJokers',
  'reason.jokerUnassignable',
  'reason.tooManyJokers',
  'reason.runWrap',
  'reason.notYourTurn',
  'reason.staleRevision',
  'reason.alreadySubmitted',
  'reason.unknownCard',
];

describe('i18n', () => {
  it('every reason code resolves to non-empty copy in both locales', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const code of REASON_CODES) {
        const text = t(code);
        expect(text, `${locale}/${code}`).not.toBe('');
        expect(text, `${locale}/${code}`).not.toBe(code); // not a raw fallback-to-key miss
      }
    }
  });

  // Exhaustive, not a hand-maintained sample: parity only proves both locales declare the same
  // keys, so a key defined as '' or left as its own name still ships a blank/raw string to a
  // player. GQA-19.
  it('every declared key resolves to non-empty copy that is not the key itself, in both locales', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const key of localeKeys(locale)) {
        const text = t(key);
        expect(text, `${locale}/${key} is blank`).not.toBe('');
        expect(text, `${locale}/${key} fell back to the raw key`).not.toBe(key);
      }
    }
  });

  // The other direction: a t('...') call site whose key was never declared renders the raw key
  // on screen. Literal call sites only — dynamically built keys are covered by the reason-code
  // and parity checks above.
  it('every t() string literal in src/ is a declared key', () => {
    const declared = new Set(localeKeys('pt'));
    const used = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          for (const m of readFileSync(full, 'utf8').matchAll(/\bt\('([a-zA-Z0-9._]+)'/g)) used.add(m[1]!);
        }
      }
    };
    walk('src');
    expect(used.size).toBeGreaterThan(100); // the walk actually found call sites
    expect([...used].filter((k) => !declared.has(k)), 'keys used in src/ but never declared').toEqual([]);
  });

  it('interpolates {params} into the returned string', () => {
    setLocale('en');
    expect(t('win.statLine', { name: 'Bia', turns: 3, cards: 5, draws: 1 })).toBe('Bia: 3 turns · 5 cards played · 1 draws');
  });

  setLocale('pt'); // restore the app default for any test file that runs after this one
});
