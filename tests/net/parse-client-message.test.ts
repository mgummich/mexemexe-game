import { describe, expect, it } from 'vitest';
import { parseClientMessage, PROTOCOL_VERSION, REACTIONS, type ClientMessage } from '../../src/net/protocol';

/**
 * INV-N8 — the server-inbound wire boundary, tested as the pure function it is.
 *
 * `tests/server/rooms.test.ts` already proves the parser never throws on a spread of malformed
 * frames, and the socket suites prove a hostile client is answered rather than obeyed. What was
 * missing is the *per-case* half: each message type's own validation, and the size limits at their
 * exact edges. Mutation testing found the hole — removing the visibility, queue, meld-shape,
 * meld-id, card-id and reaction guards entirely, and turning every `>` limit into `>=`, changed no
 * test's answer (docs/TESTING.md, the protocol run of record).
 *
 * Both directions matter and both are real defects:
 *   - a guard that stops refusing lets a malformed value reach room logic
 *   - a limit that starts refusing one item early kills a *legal* maximum-size turn, which the
 *     `MAX_TOTAL_CARDS` comment in protocol.ts calls out by name — it surfaces as a generic
 *     `bad_message` rather than a proposal result, so FEITO looks dead to the player
 *
 * Wire limits are written as literals here, not imported: they are not exported (and should not be
 * widened to exports for a test's convenience), and a change to one is a wire-contract change that
 * ought to fail a test rather than slip through. Keep them in step with `src/net/protocol.ts`.
 */

const MAX_STR = 64;
const MAX_MELDS = 60;
const MAX_CARDS_PER_MELD = 60;
const MAX_TOTAL_CARDS = 120;
const MAX_CODE = 16;

const frame = (extra: Record<string, unknown>) => JSON.stringify({ v: PROTOCOL_VERSION, reqId: 'r1', ...extra });

function parse(extra: Record<string, unknown>): ClientMessage | { error: string } {
  return parseClientMessage(frame(extra));
}

const rejected = (extra: Record<string, unknown>) => 'error' in parse(extra);
const meld = (cards: number, id = 'm') => ({ id, cardIds: Array.from({ length: cards }, (_, i) => `c${i}`) });

describe('parseClientMessage — every type accepts its well-formed frame', () => {
  // Without these, a guard that rejects *everything* looks exactly like a working one: the
  // malformed-input tests still pass while the feature is dead on the wire.
  it.each([
    ['create_room', { type: 'create_room', name: 'A' }],
    ['join_room', { type: 'join_room', code: 'ABCDE', name: 'A' }],
    ['leave_room', { type: 'leave_room' }],
    ['ready', { type: 'ready', ready: true }],
    ['set_room_settings', { type: 'set_room_settings', settings: {} }],
    ['set_room_visibility', { type: 'set_room_visibility', visibility: 'listed' }],
    ['join_queue', { type: 'join_queue', target: 'any', name: 'A' }],
    ['cancel_queue', { type: 'cancel_queue' }],
    ['list_rooms', { type: 'list_rooms' }],
    ['mexe_started', { type: 'mexe_started' }],
    ['start_game', { type: 'start_game' }],
    ['submit_turn', { type: 'submit_turn', rev: 0, melds: [meld(1)] }],
    ['draw_end_turn', { type: 'draw_end_turn', rev: 3 }],
    ['reconnect', { type: 'reconnect', token: 't1' }],
    ['ping', { type: 'ping' }],
    ['resync', { type: 'resync' }],
    ['reaction', { type: 'reaction', reaction: 'nice' }],
  ])('accepts %s', (type, payload) => {
    const result = parse(payload);
    expect('error' in result ? result.error : result.type).toBe(type);
  });

  it('accepts every reaction in the preset list, and nothing else', () => {
    for (const reaction of REACTIONS) expect(rejected({ type: 'reaction', reaction })).toBe(false);
    for (const bogus of ['hurry', 'NICE', 'nice ', '', 'x'.repeat(17)]) {
      expect(rejected({ type: 'reaction', reaction: bogus })).toBe(true);
    }
  });

  it('accepts both room visibilities and both queue target forms', () => {
    for (const visibility of ['private', 'listed']) {
      expect(rejected({ type: 'set_room_visibility', visibility })).toBe(false);
    }
    for (const target of [2, 3, 4, 'any']) {
      expect(rejected({ type: 'join_queue', target, name: 'A' })).toBe(false);
    }
  });
});

describe('parseClientMessage — a malformed payload is refused, per type', () => {
  it.each([
    ['visibility that is not a known value', { type: 'set_room_visibility', visibility: 'public' }],
    ['visibility of the wrong type', { type: 'set_room_visibility', visibility: 1 }],
    ['queue target this server does not offer', { type: 'join_queue', target: 5, name: 'A' }],
    ['queue target of the wrong type', { type: 'join_queue', target: '2', name: 'A' }],
    ['queue entry with no name', { type: 'join_queue', target: 'any' }],
    ['ready that is not a boolean', { type: 'ready', ready: 'yes' }],
    ['create_room with no name', { type: 'create_room' }],
    ['join_room with an empty code', { type: 'join_room', code: '', name: 'A' }],
    ['reconnect with a non-string token', { type: 'reconnect', token: 7 }],
    ['draw_end_turn with a negative rev', { type: 'draw_end_turn', rev: -1 }],
    ['draw_end_turn with a fractional rev', { type: 'draw_end_turn', rev: 1.5 }],
    ['submit_turn with a meld that is not an object', { type: 'submit_turn', rev: 0, melds: ['nope'] }],
    ['submit_turn with a meld id that is not a string', { type: 'submit_turn', rev: 0, melds: [{ id: 7, cardIds: [] }] }],
    ['submit_turn with a card id that is not a string', { type: 'submit_turn', rev: 0, melds: [{ id: 'm', cardIds: [7] }] }],
    ['submit_turn with cardIds that is not an array', { type: 'submit_turn', rev: 0, melds: [{ id: 'm', cardIds: 'c1' }] }],
  ])('refuses %s', (_label, payload) => {
    expect(rejected(payload)).toBe(true);
  });

  // A null meld is the case that turns a refusal into a crash: `typeof null === 'object'`, so only
  // the `!raw` half of the guard stops the parser reading `.id` off it. The server answers a
  // hostile frame; it must not die on one.
  it('refuses a null meld without throwing', () => {
    expect(() => parse({ type: 'submit_turn', rev: 0, melds: [null] })).not.toThrow();
    expect(rejected({ type: 'submit_turn', rev: 0, melds: [null] })).toBe(true);
  });
});

describe('parseClientMessage — the size limits, at their exact edges', () => {
  // Each pair pins one boundary from both sides. The lower row of each pair is the one an
  // off-by-one breaks: a legal maximum-size turn that starts being refused.
  it('accepts a name of exactly MAX_STR and refuses one character more', () => {
    expect(rejected({ type: 'create_room', name: 'n'.repeat(MAX_STR) })).toBe(false);
    expect(rejected({ type: 'create_room', name: 'n'.repeat(MAX_STR + 1) })).toBe(true);
  });

  it('accepts a join code of exactly the wire cap and refuses one character more', () => {
    expect(rejected({ type: 'join_room', code: 'c'.repeat(MAX_CODE), name: 'A' })).toBe(false);
    expect(rejected({ type: 'join_room', code: 'c'.repeat(MAX_CODE + 1), name: 'A' })).toBe(true);
  });

  it('accepts exactly MAX_MELDS melds and refuses one more', () => {
    const melds = (n: number) => Array.from({ length: n }, (_, i) => meld(0, `m${i}`));
    expect(rejected({ type: 'submit_turn', rev: 0, melds: melds(MAX_MELDS) })).toBe(false);
    expect(rejected({ type: 'submit_turn', rev: 0, melds: melds(MAX_MELDS + 1) })).toBe(true);
  });

  it('accepts exactly MAX_CARDS_PER_MELD cards in a meld and refuses one more', () => {
    expect(rejected({ type: 'submit_turn', rev: 0, melds: [meld(MAX_CARDS_PER_MELD)] })).toBe(false);
    expect(rejected({ type: 'submit_turn', rev: 0, melds: [meld(MAX_CARDS_PER_MELD + 1)] })).toBe(true);
  });

  it('accepts exactly MAX_TOTAL_CARDS across melds and refuses one more', () => {
    const half = MAX_TOTAL_CARDS / 2;
    expect(rejected({ type: 'submit_turn', rev: 0, melds: [meld(half, 'a'), meld(half, 'b')] })).toBe(false);
    expect(rejected({ type: 'submit_turn', rev: 0, melds: [meld(half, 'a'), meld(half + 1, 'b')] })).toBe(true);
  });

  it('accepts rev 0, the first revision a room ever has', () => {
    expect(rejected({ type: 'draw_end_turn', rev: 0 })).toBe(false);
  });
});
