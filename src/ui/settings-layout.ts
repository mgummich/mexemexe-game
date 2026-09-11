/**
 * Row geometry for the settings panel (src/ui/settings-panel.ts), split into a Phaser-free module
 * so tests and e2e specs can import exact row y-coordinates instead of hardcoding a layout
 * snapshot that silently rots whenever a row is added or removed (settings-panel.ts itself
 * imports Phaser at module scope, which crashes outside a browser/canvas context).
 *
 * The panel is a short main menu plus one sub-panel per section (Game / Audio / Accessibility /
 * Cosmetics / Advanced). The previous single 14-row list was the whole settings surface at once —
 * audio sliders, accessibility toggles, a language switch and a COPY TEST LOG button stacked
 * together — which read as a debug screen and left no room for the panel to grow.
 */
import { settings } from '../core/settings';
import { cy } from './menu-layout';

/** Vertical pitch between settings rows. */
export const ROW_PITCH = 17;

/** Row order in the main settings panel. Keep in sync with settings-panel.ts's showMain. */
export enum SettingsRow {
  Mute = 0,
  Game = 1,
  Audio = 2,
  Access = 3,
  Cosmetics = 4,
  Advanced = 5,
  Close = 6,
}

/** Rows in the Game sub-panel. */
export enum GameRow {
  HelperMode = 0,
  Lang = 1,
  Back = 2,
}

/** Rows in the Audio sub-panel. */
export enum AudioRow {
  Sfx = 0,
  Music = 1,
  MusicEnabled = 2,
  MusicContext = 3,
  Back = 4,
}

/** Rows in the Accessibility sub-panel. */
export enum AccessRow {
  Motion = 0,
  BatterySaver = 1,
  LargeText = 2,
  Back = 3,
}

/** Rows in the Advanced sub-panel — testing/debug affordances, off the player's main path. */
export enum AdvancedRow {
  Export = 0,
  ResetData = 1,
  Version = 2,
  Back = 3,
}

/** First row's offset from a panel's own top edge — leaves room for the panel title. */
const FIRST_ROW_OFFSET = 22;
/** Slack under the last row so the frame doesn't crop it. */
const BOTTOM_PAD = 10;

/** Height of a panel holding `rows` rows. */
export function panelHForRows(rows: number): number {
  return FIRST_ROW_OFFSET + rows * ROW_PITCH + BOTTOM_PAD;
}

/** Offset of row `index` from its panel's own top edge — every panel lays rows out with this
 * exact call, so a panel and the y-coordinates tests click can never drift apart. */
export function rowOffset(index: number): number {
  return FIRST_ROW_OFFSET + index * ROW_PITCH;
}

/** Top edge of a panel holding `rows` rows — same formula buildOverlay uses (`cy() - h / 2`). */
export function panelTopForRows(rows: number): number {
  return cy() - panelHForRows(rows) / 2;
}

/** y of row `index` in a panel holding `rows` rows. */
export function subRowY(rows: number, index: number): number {
  return panelTopForRows(rows) + rowOffset(index);
}

/** Number of rows in each panel, for the sub-panel row helpers below. */
export const MAIN_ROWS = SettingsRow.Close + 1;
export const GAME_ROWS = GameRow.Back + 1;
export const AUDIO_ROWS = AudioRow.Back + 1;
export const ACCESS_ROWS = AccessRow.Back + 1;
export const ADVANCED_ROWS = AdvancedRow.Back + 1;

/** Main settings panel height — see settings-panel.ts's showMain `h`. */
export const SETTINGS_PANEL_H = panelHForRows(MAIN_ROWS);

/** Top edge of the main settings panel. */
export function settingsPanelTop(): number {
  return panelTopForRows(MAIN_ROWS);
}

/** Row offset from the main panel's own top edge. */
export function settingsRowOffset(row: SettingsRow): number {
  return rowOffset(row);
}

/** y of a main-panel row (see SettingsRow). */
export function settingsRowY(row: SettingsRow): number {
  return subRowY(MAIN_ROWS, row);
}

/** y of a Game sub-panel row. */
export function gameRowY(row: GameRow): number {
  return subRowY(GAME_ROWS, row);
}

/** y of an Audio sub-panel row. */
export function audioRowY(row: AudioRow): number {
  return subRowY(AUDIO_ROWS, row);
}

/** y of an Accessibility sub-panel row. */
export function accessRowY(row: AccessRow): number {
  return subRowY(ACCESS_ROWS, row);
}

/** y of an Advanced sub-panel row. */
export function advancedRowY(row: AdvancedRow): number {
  return subRowY(ADVANCED_ROWS, row);
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
 * same single-formula rule as rowOffset. */
export function cosmeticsRowOffset(index: number): number {
  return 32 + index * COSMETICS_ROW_PITCH;
}

/** y of cosmetics sub-panel row `index` (0 = table theme, 1 = card back, 2 = avatar). */
export function cosmeticsRowY(index: number): number {
  return cosmeticsPanelTop() + cosmeticsRowOffset(index);
}
