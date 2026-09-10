import { describe, expect, it } from 'vitest';
import { LANDSCAPE_MAX_W, pickProfile, profileChanged } from '../src/ui/viewport';

describe('pickProfile', () => {
  it('1280x720 fine pointer -> 480x270 landscape, no touch', () => {
    expect(pickProfile(1280, 720, false)).toEqual({ w: 480, h: 270, portrait: false, touch: false });
  });

  it('1920x1080 -> landscape', () => {
    expect(pickProfile(1920, 1080, false)).toEqual({ w: 480, h: 270, portrait: false, touch: false });
  });

  it('390x844 coarse -> 270x480 portrait, touch', () => {
    expect(pickProfile(390, 844, true)).toEqual({ w: 270, h: 480, portrait: true, touch: true });
  });

  it('844x390 coarse -> landscape, touch, world widened to the tablet aspect', () => {
    expect(pickProfile(844, 390, true)).toEqual({ w: 582, h: 270, portrait: false, touch: true });
  });

  it('a 19.5:9 phone in landscape widens the world instead of letterboxing it', () => {
    // 844x390 is an iPhone 14 Pro rotated; 270 * 844/390 = 584.3, quantised down to 582.
    const p = pickProfile(844, 390, true);
    expect(p.w / p.h).toBeCloseTo(844 / 390, 1);
  });

  it('16:10 and other sub-16:9 windows never narrow below the authored 480 grid', () => {
    expect(pickProfile(1920, 1200, false).w).toBe(480);
    expect(pickProfile(1024, 768, false).w).toBe(480);
  });

  it('an ultra-wide window is capped at LANDSCAPE_MAX_W', () => {
    expect(pickProfile(5120, 1440, false).w).toBe(LANDSCAPE_MAX_W);
  });

  it('near-square 500x510 stays landscape (1.05 margin)', () => {
    expect(pickProfile(500, 510, false).portrait).toBe(false);
  });

  it('500x600 flips to portrait', () => {
    expect(pickProfile(500, 600, false).portrait).toBe(true);
  });
});

describe('profileChanged', () => {
  it('true when portrait differs', () => {
    const a = pickProfile(1280, 720, false);
    const b = pickProfile(390, 844, false);
    expect(profileChanged(a, b)).toBe(true);
  });

  it('true when touch differs', () => {
    const a = pickProfile(1280, 720, false);
    const b = pickProfile(1280, 720, true);
    expect(profileChanged(a, b)).toBe(true);
  });

  it('true when only the world width differs (a landscape aspect change)', () => {
    expect(profileChanged(pickProfile(1280, 720, false), pickProfile(844, 390, false))).toBe(true);
  });

  it('false for identical profiles', () => {
    const a = pickProfile(1280, 720, false);
    const b = pickProfile(1920, 1080, false);
    expect(profileChanged(a, b)).toBe(false);
  });
});
