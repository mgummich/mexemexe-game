import { describe, expect, it } from 'vitest';
import {
  AVATARS,
  CARD_BACKS,
  cosmeticTextureKey,
  DEFAULT_AVATAR,
  DEFAULT_CARD_BACK,
  DEFAULT_TABLE_THEME,
  resolveCosmeticId,
  TABLE_THEMES,
} from '../src/cosmetics';

describe('cosmetics registry', () => {
  it('has the expected catalog sizes', () => {
    expect(TABLE_THEMES).toHaveLength(4);
    expect(CARD_BACKS).toHaveLength(5);
    expect(AVATARS).toHaveLength(9);
  });

  it('resolves each new avatar id and falls back to default for an unknown id', () => {
    for (const id of ['rosa', 'tuca', 'nina', 'ivo']) {
      expect(AVATARS.some((o) => o.id === id)).toBe(true);
      expect(resolveCosmeticId(AVATARS, id, DEFAULT_AVATAR)).toBe(id);
    }
    expect(resolveCosmeticId(AVATARS, 'avatar-that-does-not-exist', DEFAULT_AVATAR)).toBe(DEFAULT_AVATAR);
  });

  it('default ids exist in their own catalog', () => {
    expect(TABLE_THEMES.some((o) => o.id === DEFAULT_TABLE_THEME)).toBe(true);
    expect(CARD_BACKS.some((o) => o.id === DEFAULT_CARD_BACK)).toBe(true);
    expect(AVATARS.some((o) => o.id === DEFAULT_AVATAR)).toBe(true);
  });
});

describe('resolveCosmeticId', () => {
  it('keeps a known id', () => {
    expect(resolveCosmeticId(TABLE_THEMES, 'quintal', DEFAULT_TABLE_THEME)).toBe('quintal');
  });

  it('falls back to default for an unknown/removed id', () => {
    expect(resolveCosmeticId(TABLE_THEMES, 'nonexistent-theme', DEFAULT_TABLE_THEME)).toBe(DEFAULT_TABLE_THEME);
    expect(resolveCosmeticId(AVATARS, 'avatar-that-was-removed', DEFAULT_AVATAR)).toBe(DEFAULT_AVATAR);
  });
});

describe('cosmeticTextureKey', () => {
  it('returns the chosen option texture when its art is present', () => {
    const key = cosmeticTextureKey(TABLE_THEMES, 'kitchen', DEFAULT_TABLE_THEME, []);
    expect(key).toBe('bg-kitchen');
  });

  it('degrades to the default option art when the chosen texture failed to load', () => {
    const key = cosmeticTextureKey(TABLE_THEMES, 'quintal', DEFAULT_TABLE_THEME, ['bg-quintal']);
    expect(key).toBe('bg-boteco');
  });

  it('degrades an unknown id straight to the default, ignoring missingAssets for it', () => {
    const key = cosmeticTextureKey(CARD_BACKS, 'back-99', DEFAULT_CARD_BACK, []);
    expect(key).toBe('card-back-0');
  });

  it('still degrades when both the chosen and default textures are missing (no crash, returns default key)', () => {
    const key = cosmeticTextureKey(CARD_BACKS, 'back-4', DEFAULT_CARD_BACK, ['card-back-4', 'card-back-0']);
    expect(key).toBe('card-back-0');
  });
});
