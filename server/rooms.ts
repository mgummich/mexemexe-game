/**
 * Authoritative room manager. Pure-ish: no sockets, no timers started by
 * itself (the caller drives `sweep`). Unit-testable in isolation.
 *
 * Uses the shared rules functions directly (`applyConfirmedTurn`,
 * `drawAndEndTurn`, `canConfirmTurn`) instead of `GameStore` — a room is one
 * of potentially many in a single process, and `GameStore` emits on a global
 * event bus, which would cross-talk between rooms (see docs/PHASE5_AUDIT.md §4).
 */
import { randomInt, randomUUID } from 'node:crypto';
import { createRng } from '../src/core/rng';
import {
  applyConfirmedTurn,
  canConfirmTurn,
  createDeck,
  dealInitialHands,
  drawAndEndTurn,
  shuffleDeck,
} from '../src/rules/rules';
import type { Card, DraftState, GameState, Meld, PlayerState, ReasonCode } from '../src/rules/types';
import { DEFAULT_RULES, RulesError } from '../src/rules/types';
import { buildView, type GameView, type RoomPlayerSummary, type SubmitTurnMeld } from '../src/net/protocol';

// No vowels, no 0/O/1/I/L — unambiguous when read aloud or typed.
const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 5;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_ROOMS = 500;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export interface RoomManagerDeps {
  /** Injectable clock, for deterministic tests. */
  now?: () => number;
  /** Injectable room-code generator, for deterministic tests. */
  genCode?: () => string;
  /** Injectable session-token generator, for deterministic tests. */
  genToken?: () => string;
  /** Injectable deal seed source, for deterministic tests. Never client-chosen. */
  genSeed?: () => number;
  disconnectGraceMs?: number;
  idleTimeoutMs?: number;
  maxRooms?: number;
}

function defaultGenCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function defaultGenSeed(): number {
  return randomInt(0x7fffffff);
}

interface Seat {
  seat: number;
  id: string; // matches GameState.players[seat].id, e.g. "p0"
  name: string;
  token: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
}

interface RoomInternal {
  code: string;
  seats: (Seat | null)[]; // length MAX_PLAYERS, index === stable clockwise seat
  state: GameState | null;
  rev: number;
  // Defensive re-entrancy guard only: the manager is fully synchronous between the check and
  // the mutation in submitTurn/drawEndTurn, so `processing` can never actually be observed true.
  // Real double-submit protection comes from the revision check (`rev !== room.rev`), not this
  // flag (S8).
  processing: boolean;
  createdAt: number;
  lastActivityAt: number;
}

export type CreateRoomResult =
  | { ok: true; code: string; seat: number; token: string }
  | { ok: false; error: 'room_limit' };

export type JoinRoomResult =
  | { ok: true; seat: number; token: string; players: RoomPlayerSummary[] }
  | { ok: false; error: 'room_not_found' | 'room_full' | 'game_started' };

export type ReconnectResult =
  | { ok: true; code: string; seat: number; view: GameView | null; players: RoomPlayerSummary[] }
  | { ok: false; error: 'invalid_token' };

export type ReadyResult =
  | { ok: true; started: boolean; players: RoomPlayerSummary[] }
  | { ok: false; error: 'room_not_found' | 'not_member' | 'game_started' };

export type StartResult =
  | { ok: true; started: true; players: RoomPlayerSummary[] }
  | { ok: false; error: 'room_not_found' | 'not_host' | 'not_ready' | 'seat_gap' | 'game_started' };

export type TurnResult =
  | { ok: true; gameOver: boolean }
  | { ok: false; reasons: ReasonCode[] };

function idOf(seat: number): string {
  return `p${seat}`;
}

function displayName(name: string, seat: number): string {
  const trimmed = name.trim().slice(0, 64);
  return trimmed || `Player ${seat + 1}`;
}

export class RoomManager {
  private rooms = new Map<string, RoomInternal>();
  private readonly now: () => number;
  private readonly genCode: () => string;
  private readonly genToken: () => string;
  private readonly genSeed: () => number;
  private readonly disconnectGraceMs: number;
  private readonly idleTimeoutMs: number;
  private readonly maxRooms: number;

  constructor(deps: RoomManagerDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.genCode = deps.genCode ?? defaultGenCode;
    this.genToken = deps.genToken ?? randomUUID;
    this.genSeed = deps.genSeed ?? defaultGenSeed;
    this.disconnectGraceMs = deps.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.idleTimeoutMs = deps.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxRooms = deps.maxRooms ?? DEFAULT_MAX_ROOMS;
  }

  roomCount(): number {
    return this.rooms.size;
  }

  createRoom(name: string): CreateRoomResult {
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'room_limit' };
    let code = this.genCode();
    while (this.rooms.has(code)) code = this.genCode(); // extremely unlikely, cheap to guard
    const token = this.genToken();
    const seat: Seat = {
      seat: 0,
      id: idOf(0),
      name: displayName(name, 0),
      token,
      ready: false,
      connected: true,
      disconnectedAt: null,
    };
    const room: RoomInternal = {
      code,
      seats: [seat, ...Array<Seat | null>(MAX_PLAYERS - 1).fill(null)],
      state: null,
      rev: 0,
      processing: false,
      createdAt: this.now(),
      lastActivityAt: this.now(),
    };
    this.rooms.set(code, room);
    return { ok: true, code, seat: 0, token };
  }

  joinRoom(code: string, name: string): JoinRoomResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    const freeSeat = room.seats.findIndex((s) => s === null);
    if (freeSeat === -1) return { ok: false, error: 'room_full' };
    const token = this.genToken();
    room.seats[freeSeat] = {
      seat: freeSeat,
      id: idOf(freeSeat),
      name: displayName(name, freeSeat),
      token,
      ready: false,
      connected: true,
      disconnectedAt: null,
    };
    room.lastActivityAt = this.now();
    return { ok: true, seat: freeSeat, token, players: this.summarize(room) };
  }

  /** Leaving during an active game ends the match for the survivor too — there is no one left
   * to play against, so the room is torn down rather than left sitting on a dead board (S2). */
  leaveRoom(code: string, seat: number): { roomClosed: boolean } {
    const room = this.rooms.get(code);
    if (!room) return { roomClosed: false };
    const wasActive = room.state !== null;
    room.seats[seat] = null;
    room.lastActivityAt = this.now();
    const allGone = room.seats.every((s) => s === null);
    if (wasActive || allGone) {
      this.rooms.delete(code);
      return { roomClosed: true };
    }
    return { roomClosed: false };
  }

  setReady(code: string, seat: number, ready: boolean): ReadyResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    const s = room.seats[seat];
    if (!s) return { ok: false, error: 'not_member' };
    s.ready = ready;
    room.lastActivityAt = this.now();
    return { ok: true, started: false, players: this.summarize(room) };
  }

  /** Seat 0 starts only a full-ready 2–4P lobby. Seats never move, so turn order is stable. */
  startGame(code: string, seat: number): StartResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    if (seat !== 0) return { ok: false, error: 'not_host' };
    const occupied = room.seats.filter((s): s is Seat => s !== null);
    if (occupied.length < MIN_PLAYERS || occupied.some((s) => !s.ready)) return { ok: false, error: 'not_ready' };
    // GameState indexes players by turn seat. Never compact a lobby gap (e.g. seats 0 and 2),
    // because that would make socket seat 2 point at a nonexistent player after start.
    if (room.seats.slice(0, occupied.length).some((s) => s === null)) return { ok: false, error: 'seat_gap' };

    const seed = this.genSeed();
    const rng = createRng(seed);
    const deck = shuffleDeck(createDeck(DEFAULT_RULES), rng);
    const { hands, drawPile } = dealInitialHands(deck, occupied.length, DEFAULT_RULES.handSize);
    const players: PlayerState[] = occupied.map((seatData, i) => ({
      id: idOf(i), name: seatData.name, isAi: false, hand: hands[i]!,
    }));
    room.state = {
      seed, players, activePlayerIndex: 0, table: [], drawPile, turn: 1,
      winnerId: null, phase: 'playing', config: DEFAULT_RULES,
    };
    room.rev = 1;
    room.lastActivityAt = this.now();
    return { ok: true, started: true, players: this.summarize(room) };
  }

  /** Full validation path per docs/MULTIPLAYER_ARCHITECTURE.md §5. */
  submitTurn(code: string, seat: number, rev: number, melds: SubmitTurnMeld[]): TurnResult {
    const room = this.rooms.get(code);
    if (!room || !room.state) return { ok: false, reasons: ['reason.notYourTurn'] };
    if (room.processing) return { ok: false, reasons: ['reason.alreadySubmitted'] };
    const state = room.state;
    if (state.phase !== 'playing') return { ok: false, reasons: ['reason.notYourTurn'] };
    if (state.activePlayerIndex !== seat) return { ok: false, reasons: ['reason.notYourTurn'] };
    if (rev !== room.rev) return { ok: false, reasons: ['reason.staleRevision'] };

    room.processing = true;
    try {
      // Rehydrate every card from server state by id; client-supplied suit/rank
      // never reach this point (the wire protocol carries ids only), and any
      // id that isn't a real card in this game is rejected outright. Only the
      // committed table plus the active player's own hand are eligible — an
      // opponent-hand or draw-pile id is a foreign card, not a valid submission,
      // and this way it is correctly rejected as `reason.unknownCard` here
      // rather than relying on the downstream `foreignCard` check (S6).
      const byId = new Map<string, Card>();
      for (const c of state.players[seat]!.hand) byId.set(c.id, c);
      for (const m of state.table) for (const c of m.cards) byId.set(c.id, c);

      const draftMelds: Meld[] = [];
      for (const m of melds) {
        const cards: Card[] = [];
        for (const cid of m.cardIds) {
          const card = byId.get(cid);
          if (!card) return { ok: false, reasons: ['reason.unknownCard'] };
          cards.push(card);
        }
        draftMelds.push({ id: m.id, cards });
      }
      const draft: DraftState = { melds: draftMelds, handCardsPlayed: [] };

      const check = canConfirmTurn(state, draft);
      if (!check.ok) return { ok: false, reasons: check.reasons };

      const next = applyConfirmedTurn(state, draft);
      assertConservation(next);
      room.state = next;
      room.rev += 1;
      room.lastActivityAt = this.now();
      return { ok: true, gameOver: next.phase === 'finished' };
    } finally {
      room.processing = false;
    }
  }

  drawEndTurn(code: string, seat: number, rev: number): TurnResult {
    const room = this.rooms.get(code);
    if (!room || !room.state) return { ok: false, reasons: ['reason.notYourTurn'] };
    if (room.processing) return { ok: false, reasons: ['reason.alreadySubmitted'] };
    const state = room.state;
    if (state.phase !== 'playing') return { ok: false, reasons: ['reason.notYourTurn'] };
    if (state.activePlayerIndex !== seat) return { ok: false, reasons: ['reason.notYourTurn'] };
    if (rev !== room.rev) return { ok: false, reasons: ['reason.staleRevision'] };

    room.processing = true;
    try {
      const next = drawAndEndTurn(state);
      assertConservation(next);
      room.state = next;
      room.rev += 1;
      room.lastActivityAt = this.now();
      return { ok: true, gameOver: next.phase === 'finished' };
    } finally {
      room.processing = false;
    }
  }

  /** Keep a match moving when the seat whose turn it is has been gone past the disconnect grace:
   * the server plays that seat's always-legal move (draw and end turn) so the survivors are not
   * stuck on a board that can never advance (docs/PHASE7_AUDIT.md #4). Only fires while at least
   * one other seat is still connected — an empty room is the sweep's job, not this one. Returns
   * the rooms whose state advanced. */
  advanceStalledTurns(): { code: string; gameOver: boolean }[] {
    const t = this.now();
    const advanced: { code: string; gameOver: boolean }[] = [];
    for (const [code, room] of this.rooms) {
      const state = room.state;
      if (!state || state.phase !== 'playing') continue;
      const active = room.seats[state.activePlayerIndex];
      if (!active || active.connected || active.disconnectedAt === null) continue;
      if (t - active.disconnectedAt <= this.disconnectGraceMs) continue;
      if (!room.seats.some((s) => s !== null && s.connected)) continue;
      const next = drawAndEndTurn(state);
      assertConservation(next);
      room.state = next;
      room.rev += 1;
      room.lastActivityAt = t;
      advanced.push({ code, gameOver: next.phase === 'finished' });
    }
    return advanced;
  }

  disconnect(code: string, seat: number): void {
    const room = this.rooms.get(code);
    const s = room?.seats[seat];
    if (!s) return;
    s.connected = false;
    s.disconnectedAt = this.now();
  }

  reconnect(token: string): ReconnectResult {
    for (const room of this.rooms.values()) {
      const seat = room.seats.find((s) => s?.token === token);
      if (seat) {
        seat.connected = true;
        seat.disconnectedAt = null;
        room.lastActivityAt = this.now();
        const view = room.state ? buildView(room.state, seat.seat, room.rev) : null;
        return { ok: true, code: room.code, seat: seat.seat, view, players: this.summarize(room) };
      }
    }
    return { ok: false, error: 'invalid_token' };
  }

  getView(code: string, seat: number): GameView | null {
    const room = this.rooms.get(code);
    if (!room || !room.state) return null;
    return buildView(room.state, seat, room.rev);
  }

  getPlayers(code: string): RoomPlayerSummary[] | null {
    const room = this.rooms.get(code);
    return room ? this.summarize(room) : null;
  }

  getRoom(code: string): { rev: number; state: GameState | null } | null {
    const room = this.rooms.get(code);
    return room ? { rev: room.rev, state: room.state } : null;
  }

  /** Remove rooms with no seats, every seat disconnected past grace, or — only when nobody is
   * currently connected — idle past the absolute timeout backstop. A live lobby with connected
   * seats must never be reaped just because nobody has acted in a while (S3). Call on an
   * interval; the caller must notify/detach any sockets still attached to a returned code. */
  sweep(): string[] {
    const t = this.now();
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      const hasAnySeat = room.seats.some((s) => s !== null);
      const allGone = room.seats.every(
        (s) => s === null || (!s.connected && s.disconnectedAt !== null && t - s.disconnectedAt > this.disconnectGraceMs),
      );
      const anyConnected = room.seats.some((s) => s !== null && s.connected);
      const idleBackstop = !anyConnected && t - room.lastActivityAt > this.idleTimeoutMs;
      if (!hasAnySeat || allGone || idleBackstop) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  private summarize(room: RoomInternal): RoomPlayerSummary[] {
    return room.seats
      .map((s, i) => (s ? { seat: i, name: s.name, ready: s.ready, connected: s.connected } : null))
      .filter((s): s is RoomPlayerSummary => s !== null);
  }
}

function assertConservation(state: GameState): void {
  const all = [...state.players.flatMap((p) => p.hand), ...state.table.flatMap((m) => m.cards), ...state.drawPile];
  const ids = new Set(all.map((c) => c.id));
  const expected = state.config.deckCount * (52 + state.config.jokersPerDeck);
  if (all.length !== expected || ids.size !== expected) {
    throw new RulesError('server invariant violated: card conservation', 'corruptState');
  }
}
