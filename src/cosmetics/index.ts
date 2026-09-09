/**
 * Local-only cosmetics catalog: table theme, card back, avatar. Plain data — no
 * classes/factories. Persistence lives in core/persistence.ts; UI in ui/cosmetics-panel.ts.
 */

export interface CosmeticOption {
  id: string;
  /** Phaser texture key this option renders (matches assets/manifest.ts keys). */
  textureKey: string;
  /** i18n key for the display name. */
  labelKey: string;
}

export const TABLE_THEMES: CosmeticOption[] = [
  { id: 'boteco', textureKey: 'bg-boteco', labelKey: 'cosmetics.table.boteco' },
  { id: 'kitchen', textureKey: 'bg-kitchen', labelKey: 'cosmetics.table.kitchen' },
  { id: 'quintal', textureKey: 'bg-quintal', labelKey: 'cosmetics.table.quintal' },
  { id: 'feira', textureKey: 'bg-feira', labelKey: 'cosmetics.table.feira' },
];

export const CARD_BACKS: CosmeticOption[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `back-${i}`,
  textureKey: `card-back-${i}`,
  labelKey: `cosmetics.back.${i}`,
}));

export const AVATARS: CosmeticOption[] = [
  { id: 'player', textureKey: 'avatar-player', labelKey: 'cosmetics.avatar.player' },
  { id: 'cida', textureKey: 'avatar-cida', labelKey: 'cosmetics.avatar.cida' },
  { id: 'juninho', textureKey: 'avatar-juninho', labelKey: 'cosmetics.avatar.juninho' },
  { id: 'bia', textureKey: 'avatar-bia', labelKey: 'cosmetics.avatar.bia' },
  { id: 'ze', textureKey: 'avatar-ze', labelKey: 'cosmetics.avatar.ze' },
  { id: 'rosa', textureKey: 'avatar-rosa', labelKey: 'cosmetics.avatar.rosa' },
  { id: 'tuca', textureKey: 'avatar-tuca', labelKey: 'cosmetics.avatar.tuca' },
  { id: 'nina', textureKey: 'avatar-nina', labelKey: 'cosmetics.avatar.nina' },
  { id: 'ivo', textureKey: 'avatar-ivo', labelKey: 'cosmetics.avatar.ivo' },
];

export const DEFAULT_TABLE_THEME = 'boteco';
export const DEFAULT_CARD_BACK = 'back-0';
export const DEFAULT_AVATAR = 'player';

/** Unknown/removed ids (stale save, deleted catalog entry) fall back to `fallback` instead of crashing. */
export function resolveCosmeticId(list: readonly CosmeticOption[], id: string, fallback: string): string {
  return list.some((o) => o.id === id) ? id : fallback;
}

function findOption(list: readonly CosmeticOption[], id: string, fallback: string): CosmeticOption {
  return list.find((o) => o.id === id) ?? list.find((o) => o.id === fallback)!;
}

/**
 * Texture key for a selected cosmetic id, degrading to the default option's texture when the
 * chosen option's real art failed to load (present in `missingAssets`, e.g. an asset the
 * generator hasn't shipped yet). Never returns a blank/broken key.
 */
export function cosmeticTextureKey(
  list: readonly CosmeticOption[],
  id: string,
  defaultId: string,
  missingAssets: readonly string[],
): string {
  const chosen = findOption(list, resolveCosmeticId(list, id, defaultId), defaultId);
  if (!missingAssets.includes(chosen.textureKey)) return chosen.textureKey;
  const fallback = findOption(list, defaultId, defaultId);
  return fallback.textureKey;
}
