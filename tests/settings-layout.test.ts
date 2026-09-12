import { describe, expect, it } from 'vitest';
import {
  ACCESS_ROWS,
  ADVANCED_ROWS,
  AUDIO_ROWS,
  COSMETICS_ROW_PITCH,
  GAME_ROWS,
  MAIN_ROWS,
  panelHForRows,
  panelTopForRows,
  subRowY,
  cosmeticsPanelH,
  cosmeticsPanelTop,
  cosmeticsRowY,
  ROW_PITCH,
  rulesBox,
  rulesBtnH,
  SETTINGS_PANEL_H,
  settingsPanelTop,
  settingsRowY,
} from '../src/ui/settings-layout';

// Guards the regression fixed by this file: settings-panel.ts grew a 13th row (helper mode) and
// shrank ROW_PITCH to fit, which silently broke e2e clicks hardcoded at the old y-coordinates.
// This test would have failed the moment ROW_PITCH/row count changed without a matching panel
// height, or a new row overlapping an existing one. The panel is now a section menu plus one
// sub-panel per section, so the same two invariants are checked for every panel size in use.

describe('settings panel row geometry', () => {
  const rowCount = MAIN_ROWS; // Mute..Close, see SettingsRow

  it('every main-panel row lands inside the panel bounds', () => {
    const top = settingsPanelTop();
    for (let row = 0; row < rowCount; row++) {
      const y = settingsRowY(row);
      expect(y).toBeGreaterThan(top);
      expect(y).toBeLessThan(top + SETTINGS_PANEL_H);
    }
  });

  it('no two main-panel rows overlap (pitch clears a 16-tall button)', () => {
    expect(ROW_PITCH).toBeGreaterThanOrEqual(16);
    for (let row = 1; row < rowCount; row++) {
      expect(settingsRowY(row) - settingsRowY(row - 1)).toBe(ROW_PITCH);
    }
  });
});

describe.each([
  ['game', GAME_ROWS],
  ['audio', AUDIO_ROWS],
  ['accessibility', ACCESS_ROWS],
  ['advanced', ADVANCED_ROWS],
])('%s sub-panel row geometry', (_name, rows) => {
  it('every row lands inside its own panel bounds and rows never overlap', () => {
    const top = panelTopForRows(rows);
    for (let row = 0; row < rows; row++) {
      const y = subRowY(rows, row);
      expect(y).toBeGreaterThan(top);
      expect(y).toBeLessThan(top + panelHForRows(rows));
      if (row > 0) expect(y - subRowY(rows, row - 1)).toBe(ROW_PITCH);
    }
  });

  it('the panel fits the 270-unit landscape world', () => {
    expect(panelHForRows(rows)).toBeLessThanOrEqual(270);
  });
});

describe('cosmetics sub-panel row geometry', () => {
  const rowCount = 3; // table theme, card back, avatar

  it('every cosmetics row lands inside the panel bounds', () => {
    const top = cosmeticsPanelTop();
    for (let row = 0; row < rowCount; row++) {
      const y = cosmeticsRowY(row);
      expect(y).toBeGreaterThan(top);
      expect(y).toBeLessThan(top + cosmeticsPanelH());
    }
  });

  it('no two cosmetics rows overlap', () => {
    for (let row = 1; row < rowCount; row++) {
      expect(cosmeticsRowY(row) - cosmeticsRowY(row - 1)).toBe(COSMETICS_ROW_PITCH);
    }
  });
});

// The rules panel lays itself out from rulesBox() and the e2e clicks read the same formulas, so a
// drift here shows up as a click landing on nothing. Guard the invariants a reader of the panel
// assumes: every band sits inside the frame, the content area is real, and nothing overlaps the footer.
describe.each([[false], [true]])('rules panel geometry (secondary footer button: %s)', (hasSecondary) => {
  it('title, tabs, content and footer stack inside the panel without overlapping', () => {
    const b = rulesBox(hasSecondary);
    const btnH = rulesBtnH();
    expect(b.h).toBeLessThanOrEqual(270);
    expect(b.tabY).toBeGreaterThan(b.top);
    expect(b.contentTop).toBeGreaterThan(b.tabY);
    expect(b.contentAreaH).toBeGreaterThan(0);
    // the content area stops above the first footer button
    const firstFooterTop = (hasSecondary ? b.secondaryY : b.closeY) - btnH / 2;
    expect(b.contentTop + b.contentAreaH).toBeLessThanOrEqual(firstFooterTop + 0.5);
    if (hasSecondary) expect(b.closeY - b.secondaryY).toBeGreaterThanOrEqual(btnH);
    expect(b.closeY + btnH / 2).toBeLessThanOrEqual(b.top + b.h);
  });
});
