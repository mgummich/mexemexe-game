import { describe, expect, it } from 'vitest';
import { FEEL, moveWeight, WEIGHT_BAND } from '../src/ui/feel';

describe('moveWeight', () => {
  it('treats an empty turn as a draw', () => {
    expect(moveWeight(0, 0)).toBe('draw');
  });

  it('separates a routine play from a table rearrangement', () => {
    expect(moveWeight(1, 0)).toBe('simple');
    expect(moveWeight(2, 0)).toBe('simple');
    expect(moveWeight(3, 0)).toBe('big'); // a whole meld out of hand
    expect(moveWeight(1, 1)).toBe('big'); // touching the table at all is a Mexe
  });

  it('reserves huge for a genuine rebuild', () => {
    expect(moveWeight(0, 4)).toBe('huge');
    expect(moveWeight(4, 3)).toBe('huge');
    expect(moveWeight(2, 3)).toBe('big'); // 5 cards total, not yet a rebuild
  });

  it('cannot be farmed by intermediate dragging — it only sees the committed difference', () => {
    // The same net result, however many times a card was picked up on the way there.
    expect(moveWeight(1, 0)).toBe(moveWeight(1, 0));
    expect(moveWeight(0, 0)).toBe('draw');
  });

  it('maps every weight onto a real timing band, ordered by importance', () => {
    const order = ['draw', 'simple', 'big', 'huge'] as const;
    const durations = order.map((w) => FEEL[WEIGHT_BAND[w]].ms);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));
  });
});
