import { describe, expect, it } from 'vitest';
import {
  buildView,
  DEFAULT_ROOM_SETTINGS,
  digestOfView,
  normalizeRoomSettings,
  parseClientMessage,
  PROTOCOL_VERSION,
  stateHash,
  TIMER_PRESETS,
} from '../../src/net/protocol';
import { createDeck, dealInitialHands, shuffleDeck } from '../../src/rules/rules';
import { createRng } from '../../src/core/rng';
import { DEFAULT_RULES, type GameState } from '../../src/rules/types';

function twoSeatState(): GameState {
  const deck = shuffleDeck(createDeck(DEFAULT_RULES), createRng(9));
  const { hands, drawPile } = dealInitialHands(deck, 2, DEFAULT_RULES.handSize);
  return {
    seed: 9,
    players: [
      { id: 'p0', name: 'A', isAi: false, hand: hands[0]! },
      { id: 'p1', name: 'B', isAi: false, hand: hands[1]! },
    ],
    activePlayerIndex: 0,
    table: [],
    drawPile,
    turn: 1,
    winnerId: null,
    phase: 'playing',
    config: DEFAULT_RULES,
  };
}

describe('normalizeRoomSettings', () => {
  it('defaults to the Casual preset', () => {
    expect(DEFAULT_ROOM_SETTINGS).toEqual(TIMER_PRESETS.casual);
    expect(DEFAULT_ROOM_SETTINGS.turnMs).toBe(90_000);
    expect(DEFAULT_ROOM_SETTINGS.mexeBonusMs).toBe(45_000);
    expect(DEFAULT_ROOM_SETTINGS.warnMs).toBe(10_000);
    expect(DEFAULT_ROOM_SETTINGS.reconnectGraceMs).toBe(60_000);
    expect(DEFAULT_ROOM_SETTINGS.missedTurnLimit).toBe(2);
  });

  it('a named preset ignores every other field in the payload', () => {
    const out = normalizeRoomSettings({ timerMode: 'fast', turnMs: 1, missedTurnLimit: 999 });
    expect(out).toEqual(TIMER_PRESETS.fast);
  });

  it('the Off preset has no turn budget but still has a reconnect grace', () => {
    const out = normalizeRoomSettings({ timerMode: 'off' });
    expect(out.turnMs).toBe(0);
    expect(out.reconnectGraceMs).toBeGreaterThan(0);
  });

  it('clamps a custom timer into its bounds instead of rejecting it', () => {
    const out = normalizeRoomSettings({
      timerMode: 'custom', turnMs: 1, mexeBonusMs: -5, warnMs: 999_999, reconnectGraceMs: 1, missedTurnLimit: 0,
    });
    expect(out.turnMs).toBe(15_000);
    expect(out.mexeBonusMs).toBe(0);
    expect(out.reconnectGraceMs).toBe(10_000);
    expect(out.missedTurnLimit).toBe(1);
  });

  it('never lets the warning outlast the turn it warns about', () => {
    const out = normalizeRoomSettings({ timerMode: 'custom', turnMs: 15_000, warnMs: 60_000 });
    expect(out.warnMs).toBeLessThanOrEqual(out.turnMs);
  });

  it('falls back to the default preset on garbage, null and unknown modes', () => {
    for (const raw of [null, undefined, 42, 'casual', [], { timerMode: 'turbo' }, {}]) {
      expect(normalizeRoomSettings(raw)).toEqual(DEFAULT_ROOM_SETTINGS);
    }
  });

  it('non-numeric custom fields fall back per field rather than throwing', () => {
    const out = normalizeRoomSettings({ timerMode: 'custom', turnMs: 'lots', mexeBonusMs: NaN });
    expect(out.turnMs).toBe(DEFAULT_ROOM_SETTINGS.turnMs);
    expect(out.mexeBonusMs).toBe(DEFAULT_ROOM_SETTINGS.mexeBonusMs);
  });
});

describe('set_room_settings on the wire', () => {
  it('is normalized by the parser, so the room manager never sees an out-of-range value', () => {
    const msg = parseClientMessage(
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'set_room_settings', reqId: 'r1', settings: { timerMode: 'custom', turnMs: 5 } }),
    );
    expect('error' in msg).toBe(false);
    if ('error' in msg || msg.type !== 'set_room_settings') throw new Error('unreachable');
    expect(msg.settings.turnMs).toBe(15_000);
  });

  it('a missing settings payload becomes the default preset, not a parse error', () => {
    const msg = parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'set_room_settings', reqId: 'r1' }));
    if ('error' in msg || msg.type !== 'set_room_settings') throw new Error('unreachable');
    expect(msg.settings).toEqual(DEFAULT_ROOM_SETTINGS);
  });

  it('accepts mexe_started', () => {
    const msg = parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'mexe_started', reqId: 'r2' }));
    expect('error' in msg).toBe(false);
  });
});

describe('GameView timer fields', () => {
  it('carries the room settings and the remaining time', () => {
    const view = buildView(twoSeatState(), 0, 3, TIMER_PRESETS.fast, 12_345);
    expect(view.settings).toEqual(TIMER_PRESETS.fast);
    expect(view.turnMsLeft).toBe(12_345);
  });

  it('defaults to no clock, so an untimed room renders exactly as before', () => {
    expect(buildView(twoSeatState(), 0, 3).turnMsLeft).toBeNull();
  });

  it('the remaining time is outside the state digest — a ticking clock is not a desync', () => {
    const state = twoSeatState();
    const a = buildView(state, 0, 3, TIMER_PRESETS.casual, 90_000);
    const b = buildView(state, 0, 3, TIMER_PRESETS.casual, 1_000);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(stateHash(digestOfView(b)));
  });
});
