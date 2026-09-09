import { afterEach, describe, expect, it } from 'vitest';
import { cx, cy, panelW, vx, vy } from '../src/ui/menu-layout';
import { LANDSCAPE_H, LANDSCAPE_W, pickProfile, setProfileForTest } from '../src/ui/viewport';

const LANDSCAPE = pickProfile(1280, 720, false);
const PORTRAIT = pickProfile(390, 844, true);

afterEach(() => {
  // every other test file lays out against the landscape default — never leak the portrait
  // profile set here into them.
  setProfileForTest(LANDSCAPE);
});

describe('menu-layout landscape (identity)', () => {
  it('vy/vx are the identity', () => {
    setProfileForTest(LANDSCAPE);
    for (const n of [0, 26, 110, 145, 207, 245, LANDSCAPE_W, LANDSCAPE_H]) {
      expect(vy(n)).toBeCloseTo(n);
      expect(vx(n)).toBeCloseTo(n);
    }
  });

  it('cx/cy are the landscape centre', () => {
    setProfileForTest(LANDSCAPE);
    expect(cx()).toBe(240);
    expect(cy()).toBe(135);
  });

  it('panelW is a no-op under the world width', () => {
    setProfileForTest(LANDSCAPE);
    expect(panelW(280)).toBe(280);
  });
});

describe('menu-layout portrait (270x480)', () => {
  it('cx/cy are the portrait centre', () => {
    setProfileForTest(PORTRAIT);
    expect(cx()).toBe(135);
    expect(cy()).toBe(240);
  });

  it('vy rescales onto the 480-tall world', () => {
    setProfileForTest(PORTRAIT);
    expect(vy(270)).toBe(480);
    expect(vy(135)).toBe(240);
  });

  it('vx rescales onto the 270-wide world', () => {
    setProfileForTest(PORTRAIT);
    expect(vx(480)).toBe(270);
  });

  it('panelW clamps to the narrower world with a margin', () => {
    setProfileForTest(PORTRAIT);
    expect(panelW(280)).toBe(258);
  });
});
