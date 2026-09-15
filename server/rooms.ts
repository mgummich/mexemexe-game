/**
 * Authoritative room manager. Pure-ish: no sockets, no timers started by
 * itself (the caller drives `sweep`). Unit-testable in isolation.
 *
 * Uses the shared rules functions directly (`applyConfirmedTurn`,
 * `drawAndEndTurn`, `canConfirmTurn`) instead of `GameStore` — a room is one
 * of potentially many in a single process, and `GameStore` emits on a global
 * event bus, which would cross-talk between rooms.
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
import { timerExpireTurn } from '../src/rules/rules';
import {
  buildView, DEFAULT_ROOM_SETTINGS, MAX_ACTIVITY, MAX_MATCH_HISTORY, normalizeRoomSettings,
  REACTION_COOLDOWN_MS,
  type ActivityEvent, type ActivityKind, type GameView, type MatchSummary, type PartyState,
  type ReactionId, type RoomPlayerSummary, type RoomSettings, type SubmitTurnMeld, type WinningMove,
} from '../src/net/protocol';

// No vowels, no 0/O/1/I/L — unambiguous when read aloud or typed.
const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 5;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_ROOMS = 500;
const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** A fresh room's host is seat 0 (its creator). Host authority is otherwise tracked per-room in
 * `RoomInternal.hostSeat` and moves to the next-occupied seat if the current host leaves (D15) —
 * this constant is only the fallback for a nonexistent room. */
const HOST_SEAT = 0;

interface RoomManagerDeps {
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
  /** Consecutive turns this seat has lost to the timer or to being absent. Reset by any turn the
   * seat actually takes; `settings.missedTurnLimit` of them ends the match. */
  missedTurns: number;
  /** When this seat's last accepted reaction was relayed, for the server-side cooldown. */
  lastReactionAt: number;
  /** Matches this seat has won since it sat down. Survives a rematch, dies with the seat — a new
   * player who takes a vacated chair starts at 0 and inherits nothing from its last occupant. */
  wins: number;
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
  /** The seat with host authority (settings + start). Seat 0 at creation; reassigned to the
   * next-lowest occupied seat only when the CURRENT host leaves (D15) — filling a vacated seat
   * never hands authority to the newcomer. */
  hostSeat: number;
  /** Host-chosen, frozen at `startGame`. The server is the only writer. */
  settings: RoomSettings;
  /** When the current turn's clock started. null while the room has no running turn. */
  turnStartedAt: number | null;
  /** The current turn's budget: `settings.turnMs`, plus the Mexe bonus once claimed. */
  turnBudgetMs: number;
  /** Whether this turn's one-off Mexe extension has already been granted. */
  mexeBonusClaimed: boolean;
  /** Public summary of the play that ended the match, set the moment it finishes. Read once by
   * the game_over broadcast and cleared when the room is recycled for a rematch. */
  winningMove: WinningMove | null;
  /** Identifies the match currently in progress; null in a lobby. A rematch gets a fresh one, so
   * "the room played again" is distinguishable from "the room re-sent the same match". */
  matchId: string | null;
  /** How many matches this room has started. The nth match's summary carries `seq: n`. */
  matchSeq: number;
  /** When the current match started, for the history entry's duration. */
  matchStartedAt: number;
  /** Bounded public history of finished matches, oldest first. */
  history: MatchSummary[];
  /** Bounded public event feed, oldest first. */
  activity: ActivityEvent[];
  /** Next activity sequence number. Monotonic for the life of the room. */
  activitySeq: number;
  /** True once the current match's result has been recorded. The single guard that makes a
   * duplicate finish — a second broadcast, a retried tick — unable to award a second win. */
  resultRecorded: boolean;
}

type CreateRoomResult =
  | { ok: true; code: string; seat: number; token: string }
  | { ok: false; error: 'room_limit' };

type JoinRoomResult =
  | { ok: true; seat: number; token: string; players: RoomPlayerSummary[] }
  | { ok: false; error: 'room_not_found' | 'room_full' | 'game_started' };

type ReconnectResult =
  | { ok: true; code: string; seat: number; view: GameView | null; players: RoomPlayerSummary[] }
  | { ok: false; error: 'invalid_token' };

type ReadyResult =
  | { ok: true; started: boolean; players: RoomPlayerSummary[] }
  | { ok: false; error: 'room_not_found' | 'not_member' | 'game_started' };

type StartResult =
  | { ok: true; started: true; players: RoomPlayerSummary[] }
  | { ok: false; error: 'room_not_found' | 'not_host' | 'not_ready' | 'seat_gap' | 'game_started' };

type RoomSettingsResult =
  | { ok: true; settings: RoomSettings; changed: boolean }
  | { ok: false; error: 'room_not_found' | 'not_host' | 'game_started' };

type TurnResult =
  | { ok: true; gameOver: boolean }
  | { ok: false; reasons: ReasonCode[] };

/** Field-by-field equality for a room's fairness terms. Every field of RoomSettings changes what
 * a turn is worth, so any difference is a real change (see setRoomSettings / ON-09). */
function sameSettings(a: RoomSettings, b: RoomSettings): boolean {
  return (
    a.timerMode === b.timerMode &&
    a.turnMs === b.turnMs &&
    a.mexeBonusMs === b.mexeBonusMs &&
    a.warnMs === b.warnMs &&
    a.reconnectGraceMs === b.reconnectGraceMs &&
    a.missedTurnLimit === b.missedTurnLimit
  );
}

function idOf(seat: number): string {
  return `p${seat}`;
}

function displayName(name: string, seat: number): string {
  const trimmed = name.trim().slice(0, 64);
  return trimmed || `Player ${seat + 1}`;
}

/** A seat as it starts life, however it was filled. One place, so a newcomer taking a vacated
 * chair can never inherit a leftover win count, ready bit or reaction cooldown from its previous
 * occupant — the object is new, not reset. */
function newSeat(seat: number, name: string, token: string): Seat {
  return {
    seat,
    id: idOf(seat),
    name: displayName(name, seat),
    token,
    ready: false,
    connected: true,
    disconnectedAt: null,
    missedTurns: 0,
    lastReactionAt: 0,
    wins: 0,
  };
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

  /**
   * Append one public event to the room's feed, oldest dropped past MAX_ACTIVITY.
   *
   * Everything here is already public in a room payload — a seat, a display name, a preset
   * reaction id. Nothing that identifies a card, a hand, a token or a connection is representable
   * in an `ActivityEvent` at all, which is the point of the type being closed: privacy is a
   * property of the shape, not of every call site remembering to be careful.
   */
  private note(room: RoomInternal, kind: ActivityKind, seat: Seat | null, reaction?: ReactionId): void {
    const event: ActivityEvent = {
      seq: ++room.activitySeq,
      kind,
      ...(seat ? { seat: seat.seat, name: seat.name } : {}),
      ...(reaction ? { reaction } : {}),
    };
    room.activity.push(event);
    if (room.activity.length > MAX_ACTIVITY) room.activity.splice(0, room.activity.length - MAX_ACTIVITY);
  }

  /**
   * Record the finished match exactly once: one session win for the winner, one history entry,
   * one feed line. `resultRecorded` is the whole guard — a second game_over broadcast, a retried
   * tick, or a caller that recycles twice all find it already set and change nothing.
   *
   * A win goes to the seat that holds the winning player id *now*. A winner who left between the
   * final turn and this call simply scores nothing; the history entry still names them, because
   * the match still happened.
   */
  private recordResult(room: RoomInternal): void {
    const state = room.state;
    if (room.resultRecorded || !state || state.phase !== 'finished') return;
    room.resultRecorded = true;
    // Same definition the game_over broadcast uses: nobody emptied a hand, so the draw pile ran
    // out and the fewest-cards rule picked the winner.
    const stalemate = !state.players.some((p) => p.hand.length === 0);
    const winnerIndex = state.players.findIndex((p) => p.id === state.winnerId);
    const winnerSeat = winnerIndex === -1 ? null : winnerIndex;
    const winner = winnerSeat === null ? null : room.seats[winnerSeat];
    if (winner) winner.wins += 1;
    room.history.push({
      matchId: room.matchId ?? '',
      seq: room.matchSeq,
      winnerSeat,
      winnerName: winner?.name ?? state.players[winnerIndex]?.name ?? null,
      stalemate,
      durationSec: Math.max(0, Math.round((this.now() - room.matchStartedAt) / 1000)),
    });
    if (room.history.length > MAX_MATCH_HISTORY) {
      room.history.splice(0, room.history.length - MAX_MATCH_HISTORY);
    }
    this.note(room, stalemate ? 'stalemate' : 'won', winner ?? null);
  }

  /** The room's memory across matches, for the lobby payloads. Copies, so a caller cannot splice
   * the room's own bounded lists. */
  getParty(code: string): PartyState {
    const room = this.rooms.get(code);
    if (!room) return { matches: [], activity: [] };
    return { matches: [...room.history], activity: [...room.activity] };
  }

  /** Public host lookup for the socket layer's `hostSeat` broadcasts. */
  getHostSeat(code: string): number {
    const room = this.rooms.get(code);
    return room ? room.hostSeat : HOST_SEAT;
  }

  createRoom(name: string): CreateRoomResult {
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'room_limit' };
    let code = this.genCode();
    while (this.rooms.has(code)) code = this.genCode(); // extremely unlikely, cheap to guard
    const token = this.genToken();
    const seat = newSeat(0, name, token);
    const room: RoomInternal = {
      code,
      seats: [seat, ...Array<Seat | null>(MAX_PLAYERS - 1).fill(null)],
      state: null,
      rev: 0,
      processing: false,
      createdAt: this.now(),
      lastActivityAt: this.now(),
      hostSeat: 0,
      // Reconnect grace starts at the deployment's configured value; picking a timer preset in
      // the lobby replaces it with that preset's own grace.
      settings: { ...DEFAULT_ROOM_SETTINGS, reconnectGraceMs: this.disconnectGraceMs },
      turnStartedAt: null,
      turnBudgetMs: 0,
      mexeBonusClaimed: false,
      winningMove: null,
      matchId: null,
      matchSeq: 0,
      matchStartedAt: 0,
      history: [],
      activity: [],
      activitySeq: 0,
      resultRecorded: false,
    };
    this.rooms.set(code, room);
    this.note(room, 'joined', seat);
    return { ok: true, code, seat: 0, token };
  }

  /**
   * Fill the lowest free seat. A room between matches is an ordinary lobby (`state === null`), so
   * this is also the join-before-the-next-match path — the newcomer gets a brand-new seat object
   * with zero wins and no rematch vote, never the departed player's.
   */
  joinRoom(code: string, name: string): JoinRoomResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    const freeSeat = room.seats.findIndex((s) => s === null);
    if (freeSeat === -1) return { ok: false, error: 'room_full' };
    const token = this.genToken();
    const seat = newSeat(freeSeat, name, token);
    room.seats[freeSeat] = seat;
    room.lastActivityAt = this.now();
    this.note(room, 'joined', seat);
    return { ok: true, seat: freeSeat, token, players: this.summarize(room) };
  }

  /** Leaving during an active game ends the match for the survivor too — there is no one left
   * to play against, so the room is torn down rather than left sitting on a dead board (S2). */
  leaveRoom(code: string, seat: number): { roomClosed: boolean } {
    const room = this.rooms.get(code);
    if (!room) return { roomClosed: false };
    const wasActive = room.state !== null;
    const leaving = room.seats[seat];
    // Noted before the seat is cleared: the feed line needs the name, and the seat object is the
    // only place it lives. Clearing the seat is also what retires that player's rematch vote —
    // there is no separate vote to clean up, because the ready bit went with the chair.
    if (leaving) this.note(room, 'left', leaving);
    room.seats[seat] = null;
    room.lastActivityAt = this.now();
    const allGone = room.seats.every((s) => s === null);
    if (wasActive || allGone) {
      this.rooms.delete(code);
      return { roomClosed: true };
    }
    // D15: the host left a recycled post-match lobby with a survivor still seated — hand host
    // authority to the next occupied seat instead of leaving it pointed at an empty chair
    // nobody can ever fill back into (seats never move once assigned).
    if (seat === room.hostSeat) {
      const next = room.seats.findIndex((s) => s !== null);
      if (next !== -1) room.hostSeat = next;
    }
    return { roomClosed: false };
  }

  setReady(code: string, seat: number, ready: boolean): ReadyResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    const s = room.seats[seat];
    if (!s) return { ok: false, error: 'not_member' };
    // Only the rising edge is an event. A re-send of the same bit is idempotent here and must not
    // be able to fill the feed with repeats of one player tapping READY.
    if (ready && !s.ready) this.note(room, 'ready', s);
    s.ready = ready;
    room.lastActivityAt = this.now();
    return { ok: true, started: false, players: this.summarize(room) };
  }

  /**
   * Host-only, lobby-only. Once `room.state` exists the settings are frozen: they are the terms
   * every seat agreed to when they pressed Ready, so a mid-match change is refused outright
   * rather than applied to the turn in progress.
   *
   * ON-09: a ready bit is agreement to the terms that were on screen when it was pressed. When
   * the host actually changes them, every ready bit stops meaning anything, so they are all
   * cleared and each seat has to agree again. An idempotent re-send of the same settings is not
   * a change and leaves the lobby alone.
   */
  setRoomSettings(code: string, seat: number, proposed: RoomSettings): RoomSettingsResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    if (seat !== room.hostSeat) return { ok: false, error: 'not_host' };
    // Normalized again here: `setRoomSettings` is a public manager entry point, not only the
    // socket path, so it must not depend on the caller having gone through the wire parser.
    const next = normalizeRoomSettings(proposed);
    const changed = !sameSettings(room.settings, next);
    room.settings = next;
    if (changed) {
      for (const s of room.seats) if (s) s.ready = false;
      this.note(room, 'settings', room.seats[seat] ?? null);
    }
    room.lastActivityAt = this.now();
    return { ok: true, settings: room.settings, changed };
  }

  /** Start (or restart) the active seat's clock. A turn with no timer keeps a null start, and so
   * does a match that just ended: a finished game has no turn to time, and a clock left running
   * would keep counting down to a red 0:00 behind the results screen. */
  private startTurnClock(room: RoomInternal): void {
    room.mexeBonusClaimed = false;
    if (room.settings.turnMs <= 0 || room.state?.phase !== 'playing') {
      room.turnStartedAt = null;
      room.turnBudgetMs = 0;
      return;
    }
    room.turnStartedAt = this.now();
    room.turnBudgetMs = room.settings.turnMs;
  }

  /** ms left on the active seat's turn, or null when this room has no timer. Never negative. */
  private msLeft(room: RoomInternal): number | null {
    if (room.turnStartedAt === null) return null;
    return Math.max(0, room.turnStartedAt + room.turnBudgetMs - this.now());
  }

  /**
   * Grant this turn's one-off Mexe extension. Active seat only, once per turn, and only while a
   * timer is actually running — so a client cannot hold its turn open by re-sending the claim,
   * and a seat that is not on the clock gains nothing by sending it at all.
   */
  claimMexeBonus(code: string, seat: number): { ok: boolean; msLeft: number | null } {
    const room = this.rooms.get(code);
    if (!room || !room.state || room.state.activePlayerIndex !== seat) return { ok: false, msLeft: null };
    if (room.turnStartedAt === null || room.mexeBonusClaimed || room.settings.mexeBonusMs <= 0) {
      return { ok: false, msLeft: this.msLeft(room) };
    }
    room.mexeBonusClaimed = true;
    room.turnBudgetMs += room.settings.mexeBonusMs;
    return { ok: true, msLeft: this.msLeft(room) };
  }

  /** The host seat starts only a full-ready 2–4P lobby. Seats never move, so turn order is
   * stable; the host authority itself can move, to the next occupied seat, if the host leaves
   * (see leaveRoom). */
  startGame(code: string, seat: number): StartResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    if (seat !== room.hostSeat) return { ok: false, error: 'not_host' };
    const occupied = room.seats.filter((s): s is Seat => s !== null);
    // A ready bit survives a transient socket close so a reconnect can resume a lobby, but it
    // must not let the host start a game with an absent seat. That would immediately create a
    // stalled turn and leave the disconnected player without the game_started message.
    if (occupied.length < MIN_PLAYERS || occupied.some((s) => !s.ready || !s.connected)) {
      return { ok: false, error: 'not_ready' };
    }
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
    // A fresh match identity, so every client can tell this deal from the one it replaced, and a
    // fresh result guard, so this match's finish is recordable exactly once.
    room.matchId = this.genToken();
    room.matchSeq += 1;
    room.matchStartedAt = this.now();
    room.resultRecorded = false;
    for (const s of occupied) s.missedTurns = 0;
    // A ready bit means "these terms, this deal". The deal it agreed to has just been made, so it
    // stops meaning anything — clearing it here is what stops a stale vote from counting towards
    // the *next* match's start (the rematch votes start empty, every time).
    for (const s of occupied) s.ready = false;
    this.startTurnClock(room);
    this.note(room, 'match_started', room.seats[seat] ?? null);
    return { ok: true, started: true, players: this.summarize(room) };
  }

  /**
   * The preconditions every turn action shares: the room exists and is mid-match, no other action
   * for it is already in flight, and the caller is the active seat at the revision it believes in.
   * A caller that gets `ok` must set `room.processing` and clear it in a `finally`.
   */
  private claimTurn(code: string, seat: number, rev: number): { ok: true; room: RoomInternal; state: GameState } | { ok: false; reasons: ReasonCode[] } {
    const room = this.rooms.get(code);
    if (!room || !room.state) return { ok: false, reasons: ['reason.notYourTurn'] };
    if (room.processing) return { ok: false, reasons: ['reason.alreadySubmitted'] };
    const state = room.state;
    if (state.phase !== 'playing') return { ok: false, reasons: ['reason.notYourTurn'] };
    if (state.activePlayerIndex !== seat) return { ok: false, reasons: ['reason.notYourTurn'] };
    if (rev !== room.rev) return { ok: false, reasons: ['reason.staleRevision'] };
    return { ok: true, room, state };
  }

  /**
   * Publishes the state a turn action produced. Card conservation is checked before anything is
   * stored, so a rules bug can never be broadcast as authoritative. A turn actually taken clears
   * the seat's missed-turn streak, so the limit only fires on *consecutive* misses.
   */
  private commitTurn(room: RoomInternal, seat: number, next: GameState): TurnResult {
    assertConservation(next);
    const before = room.state;
    room.state = next;
    room.rev += 1;
    room.lastActivityAt = this.now();
    room.seats[seat]!.missedTurns = 0;
    this.startTurnClock(room);
    this.noteCardCounts(room, before, next);
    if (next.phase === 'finished') this.recordResult(room);
    return { ok: true, gameOver: next.phase === 'finished' };
  }

  /** "X has one card left", on the turn it becomes true. A hand *count* is public in every view,
   * so this discloses nothing new — it just makes the most consequential count in the game
   * impossible to miss. Only the falling edge into 1 is an event; a seat that sits on one card
   * does not re-announce every turn. */
  private noteCardCounts(room: RoomInternal, before: GameState | null, after: GameState): void {
    after.players.forEach((p, i) => {
      if (p.hand.length !== 1) return;
      if ((before?.players[i]?.hand.length ?? 1) === 1) return;
      const seat = room.seats[i];
      if (seat) this.note(room, 'last_card', seat);
    });
  }

  /** Full validation path per docs/MULTIPLAYER.md §5. */
  submitTurn(code: string, seat: number, rev: number, melds: SubmitTurnMeld[]): TurnResult {
    const claim = this.claimTurn(code, seat, rev);
    if (!claim.ok) return claim;
    const { room, state } = claim;

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
      // Hand counts are public in every view, so their difference is public too — this is the
      // whole "how did they finish" summary, with no card identity in it.
      if (next.phase === 'finished') {
        room.winningMove = { seat, cardsPlayed: state.players[seat]!.hand.length - next.players[seat]!.hand.length };
      }
      return this.commitTurn(room, seat, next);
    } finally {
      room.processing = false;
    }
  }

  drawEndTurn(code: string, seat: number, rev: number): TurnResult {
    const claim = this.claimTurn(code, seat, rev);
    if (!claim.ok) return claim;
    const { room, state } = claim;

    room.processing = true;
    try {
      const next = drawAndEndTurn(state);
      return this.commitTurn(room, seat, next);
    } finally {
      room.processing = false;
    }
  }

  /**
   * The server's turn clock, driven by the caller on an interval. Two things end a turn the
   * active seat did not: the room's turn timer running out, and the seat having been gone past
   * the room's reconnect grace. Both resolve to the same
   * always-legal move — `timerExpireTurn`, i.e. discard whatever draft the client had, draw one
   * card and pass.
   *
   * That is the whole reason a timeout can never confirm an illegal table: a draft never leaves
   * the client until FEITO, so the server's turn-start state *is* the table it falls back to.
   * There is nothing here that could commit a half-finished rearrangement.
   *
   * Neither path fires while the room has nobody else connected — an empty room is the sweep's
   * job. A seat that loses `settings.missedTurnLimit` turns in a row ends the match, so a player
   * who has walked away cannot keep the others on a board that only ever advances by draw.
   */
  advanceStalledTurns(): { code: string; gameOver: boolean; crashed?: boolean; closed?: boolean; timedOut?: number }[] {
    const t = this.now();
    const advanced: { code: string; gameOver: boolean; crashed?: boolean; closed?: boolean; timedOut?: number }[] = [];
    for (const [code, room] of this.rooms) {
      const state = room.state;
      if (!state || state.phase !== 'playing') continue;
      const active = room.seats[state.activePlayerIndex];
      if (!active) continue;
      if (!room.seats.some((s) => s !== null && s.connected)) continue;

      const absentTooLong =
        !active.connected && active.disconnectedAt !== null && t - active.disconnectedAt > room.settings.reconnectGraceMs;
      const timedOut = room.turnStartedAt !== null && t - room.turnStartedAt >= room.turnBudgetMs;
      if (!absentTooLong && !timedOut) continue;

      // Per-room isolation: one room whose state can no longer advance legally must not stop
      // every other stalled room from advancing, or throw out of the caller's interval forever.
      // Crash policy: such a room is corrupt — drop it and report it so the caller can notify
      // its sockets, instead of retrying the same throw every tick.
      try {
        const next = timerExpireTurn(state);
        assertConservation(next);
        room.state = next;
        room.rev += 1;
        room.lastActivityAt = t;
        active.missedTurns += 1;
        this.startTurnClock(room);
        this.noteCardCounts(room, state, next);
        if (next.phase === 'finished') this.recordResult(room);
        const seat = active.seat;
        if (active.missedTurns >= room.settings.missedTurnLimit) {
          this.rooms.delete(code);
          advanced.push({ code, gameOver: false, closed: true, timedOut: seat });
          continue;
        }
        advanced.push({ code, gameOver: next.phase === 'finished', timedOut: seat });
      } catch {
        this.rooms.delete(code);
        advanced.push({ code, gameOver: false, crashed: true });
      }
    }
    return advanced;
  }

  /** The public summary of the move that ended `code`'s match, or null (stalemate, or a match
   * that ended by timeout rather than by a play). */
  getWinningMove(code: string): WinningMove | null {
    return this.rooms.get(code)?.winningMove ?? null;
  }

  /**
   * ONLINE-23/24: a finished match returns its room to the lobby instead of deleting it, so the
   * same group can play again on the same code without anyone re-creating and re-sharing a room.
   * Everything match-scoped is cleared — state, revision, clocks, missed-turn streaks — and every
   * seat goes back to not-ready, which is what makes the next start an explicit, agreed one
   * rather than an instant re-deal. The room is still subject to the normal sweep, so an
   * abandoned table is reaped exactly as before.
   *
   * Party state is deliberately NOT cleared: session wins, the match history and the activity feed
   * are the room's memory of the evening, and the whole point of keeping the room is keeping them.
   * Everything match-scoped goes, including the match id — the next start mints a new one.
   */
  recycleForRematch(code: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    // The result is recorded when the match finishes, not here, so a caller that recycles twice
    // (or recycles a room that never finished) cannot award anything. This is belt-and-braces:
    // if the match did finish and nobody recorded it yet, it is recorded now, exactly once.
    this.recordResult(room);
    room.state = null;
    room.rev = 0;
    room.matchId = null;
    room.winningMove = null;
    room.turnStartedAt = null;
    room.turnBudgetMs = 0;
    room.mexeBonusClaimed = false;
    room.lastActivityAt = this.now();
    for (const s of room.seats) {
      if (!s) continue;
      s.ready = false;
      s.missedTurns = 0;
    }
    return true;
  }

  /**
   * Server-side reaction cooldown. The only gate on the relay: a seat that reacted less than
   * REACTION_COOLDOWN_MS ago is refused, whatever its client believes its own cooldown to be.
   */
  claimReaction(code: string, seat: number, reaction?: ReactionId): boolean {
    const room = this.rooms.get(code);
    const s = room?.seats[seat];
    const t = this.now();
    if (!room || !s || t - s.lastReactionAt < REACTION_COOLDOWN_MS) return false;
    s.lastReactionAt = t;
    if (reaction) this.note(room, 'reaction', s, reaction);
    return true;
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
        // A reconnecting seat receives the *current* remaining time, not a fresh budget: the
        // clock kept running while it was away, which is what stops a reconnect loop from
        // extending a turn indefinitely.
        const view = room.state ? this.viewFor(room, seat.seat) : null;
        return { ok: true, code: room.code, seat: seat.seat, view, players: this.summarize(room) };
      }
    }
    return { ok: false, error: 'invalid_token' };
  }

  getView(code: string, seat: number): GameView | null {
    const room = this.rooms.get(code);
    if (!room || !room.state) return null;
    return this.viewFor(room, seat);
  }

  /** One place that turns a live room into a redacted view, so the reconnect path and the normal
   * broadcast path can never drift apart on what a seat is told. */
  private viewFor(room: RoomInternal, seat: number): GameView {
    return buildView(
      room.state!, seat, room.rev, room.settings, this.msLeft(room),
      room.seats.map((s) => s?.missedTurns ?? 0), room.mexeBonusClaimed, room.matchId ?? '',
    );
  }

  getPlayers(code: string): RoomPlayerSummary[] | null {
    const room = this.rooms.get(code);
    return room ? this.summarize(room) : null;
  }

  /** Everything a lobby renders: who is in, the agreed settings, whether they are frozen, and the
   * room's memory across matches. */
  getRoomInfo(code: string): { players: RoomPlayerSummary[]; settings: RoomSettings; locked: boolean; party: PartyState } | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    return {
      players: this.summarize(room),
      settings: room.settings,
      locked: room.state !== null,
      party: this.getParty(code),
    };
  }

  /** Drop a room outright (finished match, corrupt state). The caller detaches its sockets. */
  deleteRoom(code: string): void {
    this.rooms.delete(code);
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
      .map((s, i) => (s ? { seat: i, name: s.name, ready: s.ready, connected: s.connected, wins: s.wins } : null))
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
