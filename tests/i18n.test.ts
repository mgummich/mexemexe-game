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
  'reason.noHandCard',
  'reason.cardMissing',
  'reason.duplicateCard',
  'reason.foreignCard',
  'reason.groupTooLarge',
  'reason.groupDuplicateSuit',
  'reason.groupAllJokers',
  'reason.jokerUnassignable',
  'reason.runWrap',
  'reason.notYourTurn',
  'reason.staleRevision',
  'reason.alreadySubmitted',
  'reason.unknownCard',
];

// A representative sample of keys this Phase 9 pass added or reads from — not the whole ~300-key
// dictionary (that's what the parity check below is for), just a smoke test that both locales
// actually carry them.
const NEW_KEYS = [
  'objective.start',
  'objective.invalidEdit',
  'objective.readyToConfirm',
  'win.statLine',
  'game.onlineBadge',
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

  it('every new key resolves to non-empty, locale-specific copy', () => {
    for (const key of NEW_KEYS) {
      setLocale('pt');
      const pt = t(key);
      setLocale('en');
      const en = t(key);
      expect(pt, key).not.toBe('');
      expect(en, key).not.toBe('');
      expect(pt, key).not.toBe(key);
      expect(en, key).not.toBe(key);
    }
  });

  it('interpolates {params} into the returned string', () => {
    setLocale('en');
    expect(t('win.statLine', { name: 'Bia', turns: 3, cards: 5, draws: 1 })).toBe('Bia: 3 turns · 5 cards played · 1 draws');
  });

  setLocale('pt'); // restore the app default for any test file that runs after this one
});
