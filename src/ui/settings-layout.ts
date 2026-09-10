/**
 * Row geometry for the settings panel (src/ui/settings-panel.ts), split into a Phaser-free module
 * so tests and e2e specs can import exact row y-coordinates instead of hardcoding a layout
 * snapshot that silently rots whenever a row is added or removed (settings-panel.ts itself
 * imports Phaser at module scope, which crashes outside a browser/canvas context).
 */
import { settings } from '../core/settings';
import { cy } from './menu-layout';

/** Vertical pitch between settings rows — 14 rows must fit the 259-unit panel (landscape world is only 270 tall). */
export const ROW_PITCH = 17;

/** Main settings panel height — see settings-panel.ts's showMain `h`. */
export const SETTINGS_PANEL_H = 259;

/** Row order in the main settings panel — index into settingsRowY. Keep in sync with showMain. */
export enum SettingsRow {
  Mute = 0,
  Sfx = 1,
  Music = 2,
  MusicEnabled = 3,
  MusicContext = 4,
  Motion = 5,
  BatterySaver = 6,
  LargeText = 7,
  HelperMode = 8,
  Lang = 9,
  Export = 10,
  Cosmetics = 11,
  ResetData = 12,
  Close = 13,
}

/** Top edge of the main settings panel — same formula buildOverlay uses (`cy() - h / 2`). */
export function settingsPanelTop(): number {
  return cy() - SETTINGS_PANEL_H / 2;
}

/** Row offset from the panel's own top edge. showMain() lays its rows out with this exact call,
 * so the panel and `settingsRowY` below can never drift apart — there is only one formula. */
export function settingsRowOffset(row: SettingsRow): number {
  return 22 + row * ROW_PITCH;
}

/** y of a main-panel row (see SettingsRow), matching showMain's row walk. */
export function settingsRowY(row: SettingsRow): number {
  return settingsPanelTop() + settingsRowOffset(row);
}

/** Vertical pitch between rows in the cosmetics sub-panel (table theme / card back / avatar). */
export const COSMETICS_ROW_PITCH = 30;

/** Cosmetics sub-panel height — see settings-panel.ts's showCosmetics `h`. */
export function cosmeticsPanelH(): number {
  return Math.round(150 * settings.fontScale());
}

/** Top edge of the cosmetics sub-panel. */
export function cosmeticsPanelTop(): number {
  return cy() - cosmeticsPanelH() / 2;
}

/** Cosmetics row offset from that sub-panel's own top edge — showCosmetics() uses this directly,
 * same single-formula rule as settingsRowOffset. */
export function cosmeticsRowOffset(index: number): number {
  return 32 + index * COSMETICS_ROW_PITCH;
}

/** y of cosmetics sub-panel row `index` (0 = table theme, 1 = card back, 2 = avatar). */
export function cosmeticsRowY(index: number): number {
  return cosmeticsPanelTop() + cosmeticsRowOffset(index);
}
