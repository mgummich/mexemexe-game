import { describe, expect, it } from 'vitest';
import { errorMessage, SERVER_ERROR_CODES } from '../../src/net/errors';
import { getLocale, setLocale, t } from '../../src/localization/i18n';

describe('online error mapper', () => {
  it('has a PT and EN online.err.<code> key for every server error code', () => {
    const original = getLocale();
    try {
      for (const code of SERVER_ERROR_CODES) {
        setLocale('pt');
        const pt = t(`online.err.${code}`);
        setLocale('en');
        const en = t(`online.err.${code}`);
        // `t()` falls back to the key itself when a dictionary entry is missing — catch that.
        expect(pt).not.toBe(`online.err.${code}`);
        expect(en).not.toBe(`online.err.${code}`);
        expect(pt.length).toBeGreaterThan(0);
        expect(en.length).toBeGreaterThan(0);
      }
    } finally {
      setLocale(original);
    }
  });

  it('falls back to the generic message for an unrecognised code, never the raw code/message', () => {
    setLocale('en');
    expect(errorMessage('totally_made_up_code')).toBe(t('online.err.unknown'));
    expect(errorMessage('totally_made_up_code')).not.toBe('totally_made_up_code');
  });

  it('maps every known code to its own dedicated string, not the generic fallback', () => {
    setLocale('en');
    const unknown = t('online.err.unknown');
    for (const code of SERVER_ERROR_CODES) {
      expect(errorMessage(code)).not.toBe(unknown);
    }
  });
});
