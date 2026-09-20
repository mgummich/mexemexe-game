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
import {
  applyConfirmedTurn,
  canConfirmTurn,
  cardsConserved,
  createNewGame,
  draftFromCardIds,
  drawAndEndTurn,
  timerExpireTurn,
} from '../src/rules/rules';
import type { GameState, ReasonCode } from '../src/rules/types';
import {
  IDLE_CLOCK, assistStateFor, borrowTime, enterLastBreath, expired, grantBonus, msLeft, startTurn,
  useFreeze, usePanic, type AssistState, type TurnClock,
} from '../src/game-state/timing';
import { assistsOf, chargeSeat, creditSeat, isTimeAttack, turnBudgetMs } from './speed-rules';
import { DEFAULT_RULES, RulesError } from '../src/rules/types';
import {
  buildView, DEFAULT_ROOM_SETTINGS, DEFAULT_ROOM_VISIBILITY, MAX_ACTIVITY, MAX_MATCH_HISTORY,
  MAX_ROOM_LISTINGS, MAX_SEATS, normalizeRoomSettings, REACTION_COOLDOWN_MS, ROOM_CODE_LENGTH, TIMER_PRESETS,
  type ActivityEvent, type ActivityKind, type GameView, type MatchSummary, type PartyState,
  type ReactionId, type RoomListing, type RoomPlayerSummary, type RoomSettings, type RoomVisibility,
  type SubmitTurnMeld, type WinningMove,
} from '../src/net/protocol';

// No vowels, no 0/O/1/I/L — unambiguous when read aloud or typed.
const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';
/**
 * Fallbacks for the tuning knobs `server/config.ts` exposes to the environment. Owned here
 * because they are this aggregate's own defaults; `loadConfig` imports them so a deployment and
 * a bare `new RoomManager()` (tests) can never drift to different numbers.
 */
export const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_MAX_ROOMS = 500;
/** Smallest table the rules will deal (`createNewGame` refuses fewer). The largest is MAX_SEATS,
 * which is the wire contract both runtimes share. */
const MIN_PLAYERS = 2;
/** A fresh room's host is seat 0 (its creator). Host authority is otherwise tracked per-room in
 * `RoomInternal.hostSeat` and moves to the next-occupied seat if the current host leaves (D15) —
 * this constant is only the fallback for a nonexistent room. */
const HOST_SEAT = 0;
/** The terms every matchmade table is played under. The casual preset, deliberately: it is the
 * room default friends already play, so a queued stranger meets nothing unfamiliar, and it is the
 * server's value rather than anyone's proposal — no seat in a matchmade room can change it. */
const MATCHMADE_SETTINGS = TIMER_PRESETS.casual;

/** One room's outcome from a turn-clock tick. `crashed` carries its `error` for the host to log. */
export interface StalledTurnResult {
  code: string;
  gameOver: boolean;
  crashed?: boolean;
  /** Present only with `crashed` — the thrown value, for `errorFields()` at the host. */
  error?: unknown;
  closed?: boolean;
  timedOut?: number;
  /** A seat whose clock ran out and was given its Last Breath instead of losing the turn. The
   * room advanced nothing — the caller still has to sync the longer clock out. */
  breath?: number;
}

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
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function defaultGenSeed(): number {
  return randomInt(0x7fffffff);
}

interface Seat {
  seat: number;
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
  seats: (Seat | null)[]; // length MAX_SEATS, index === stable clockwise seat
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
  /** Who may *find* this room. Always starts `private` — see setVisibility. */
  visibility: RoomVisibility;
  /** The active seat's turn clock. Idle while the room has no running turn. The arithmetic lives
   * in the shared timing domain, so the server and a client projection cannot drift. */
  clock: TurnClock;
  /** Time Attack only: each seat's personal clock in ms, by dense player index. Empty in every
   * other mode, which is also how `startTurnClock` knows which budget a turn gets. */
  seatClocks: number[];
  /** Panic Buttons each seat has left, by dense player index. Empty when the room grants none. */
  panic: AssistState[];
  /** Public summary of the play that ended the match, set the moment it finishes. Read once by
   * the game_over broadcast and cleared when the room is recycled for a rematch. */
  winningMove: WinningMove | null;
  /** Identifies the match currently in progress; null in a lobby. A rematch gets a fresh one, so
   * "the room played again" is distinguishable from "the room re-sent the same match". */
  matchId: string | null;
  /** Room seat of each player in the running match, by `GameState` player index — the one place
   * the two numbering schemes are related. They are equal only when the occupied seats happen to
   * be 0..n-1: `GameState` is a dense, turn-ordered array (the rules engine rotates an index),
   * while a room seat is a stable chair that survives its occupant leaving. Empty in a lobby.
   *
   * Before this existed the two were assumed identical and a lobby with a gap (seats 0, 2, 3
   * after seat 1 walked out between matches) was refused a start outright, which left the room
   * permanently unable to play again. */
  matchSeats: number[];
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
  /** True for a room the matchmaking queue allocated. Its terms are the server's canonical
   * casual preset and nothing in the room may change them — there is no host settings step for
   * players who never agreed to one with each other (§3e). */
  matchmade: boolean;
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
  | { ok: false; error: 'room_not_found' | 'not_host' | 'not_ready' | 'game_started' };

type RoomSettingsResult =
  | { ok: true; settings: RoomSettings; changed: boolean }
  | { ok: false; error: 'room_not_found' | 'not_host' | 'game_started' };

type VisibilityResult =
  | { ok: true; visibility: RoomVisibility; changed: boolean }
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
    const winnerSeat = winnerIndex === -1 ? null : room.matchSeats[winnerIndex] ?? null;
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

  /** @param token pre-issued session token for seat 0. Only the matchmaking handoff passes one:
   * a queued player already holds a token, and reusing it is what makes their reconnect land on
   * the seat the queue became instead of on a second identity. */
  createRoom(name: string, token = this.genToken()): CreateRoomResult {
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'room_limit' };
    let code = this.genCode();
    while (this.rooms.has(code)) code = this.genCode(); // extremely unlikely, cheap to guard
    const seat = newSeat(0, name, token);
    const room: RoomInternal = {
      code,
      seats: [seat, ...Array<Seat | null>(MAX_SEATS - 1).fill(null)],
      state: null,
      rev: 0,
      processing: false,
      createdAt: this.now(),
      lastActivityAt: this.now(),
      hostSeat: 0,
      // Reconnect grace starts at the deployment's configured value; picking a timer preset in
      // the lobby replaces it with that preset's own grace.
      settings: { ...DEFAULT_ROOM_SETTINGS, reconnectGraceMs: this.disconnectGraceMs },
      // OD-01: private, always. There is no create-time option and no migration path that can
      // produce anything else — a room becomes discoverable only by its host saying so later.
      visibility: DEFAULT_ROOM_VISIBILITY,
      clock: IDLE_CLOCK,
      seatClocks: [],
      panic: [],
      winningMove: null,
      matchId: null,
      matchSeq: 0,
      matchStartedAt: 0,
      history: [],
      activity: [],
      activitySeq: 0,
      matchmade: false,
      resultRecorded: false,
      matchSeats: [],
    };
    this.rooms.set(code, room);
    this.note(room, 'joined', seat);
    return { ok: true, code, seat: 0, token };
  }

  /**
   * The queue handoff, as one operation: a private room with the canonical casual terms, one
   * seat per matched player in the order they were selected, and the match already dealt.
   *
   * Everything here is deliberately made of parts that already existed. The seats are ordinary
   * `newSeat`s carrying the tokens the queue issued; the deal is the ordinary `startGame`, so
   * capacity, seat gaps, turn order and the match id come from the one place that has always
   * decided them. Nothing about a matchmade match is a second lifecycle — only its *allocation*
   * is different, and that difference ends here.
   *
   * All or nothing: a room that cannot be dealt is deleted rather than left half-built, so the
   * caller's only recovery is to put the group back in the queue.
   */
  createMatchRoom(players: { name: string; token: string }[]): CreateRoomResult {
    if (players.length < MIN_PLAYERS || players.length > MAX_SEATS) return { ok: false, error: 'room_limit' };
    const first = players[0]!;
    const created = this.createRoom(first.name, first.token);
    if (!created.ok) return created;
    const room = this.rooms.get(created.code)!;
    room.matchmade = true;
    // Server-defined terms, identical for every matchmade table. Not negotiable before the match
    // (nobody is in a lobby) and not changeable after it (see setRoomSettings).
    room.settings = { ...MATCHMADE_SETTINGS };
    players.slice(1).forEach((p, i) => {
      const seat = newSeat(i + 1, p.name, p.token);
      room.seats[i + 1] = seat;
      this.note(room, 'joined', seat);
    });
    // Auto-ready: being matched *is* the agreement. Quick Match that made you press READY with
    // three strangers would be neither quick nor a match.
    for (const s of room.seats) if (s) s.ready = true;
    const started = this.startGame(created.code, room.hostSeat);
    if (!started.ok) {
      this.rooms.delete(created.code);
      return { ok: false, error: 'room_limit' };
    }
    return created;
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
    // Nobody holds fairness authority in a matchmade room, host seat included: its terms are the
    // ones every queued player was matched under, and no seat agreed to let another change them.
    if (room.matchmade || seat !== room.hostSeat) return { ok: false, error: 'not_host' };
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

  /**
   * Host-only, lobby-only change to who can find this room.
   *
   * Lobby-only for the same reason settings are: a room whose match is running has nothing to
   * offer a browser anyway, and refusing outright is one rule instead of two. Unlike settings
   * this does NOT clear ready bits — visibility changes nothing about the terms a seat agreed
   * to play under, so resetting the lobby over it would be friction with no fairness behind it
   * (ON-09 applies to fairness-sensitive changes only).
   */
  setVisibility(code: string, seat: number, visibility: RoomVisibility): VisibilityResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.state) return { ok: false, error: 'game_started' };
    // A matchmade room belongs to the players the server put in it. Letting a seat list it would
    // hand a stranger's table to the room browser (§3e).
    if (room.matchmade || seat !== room.hostSeat) return { ok: false, error: 'not_host' };
    const changed = room.visibility !== visibility;
    room.visibility = visibility;
    room.lastActivityAt = this.now();
    return { ok: true, visibility: room.visibility, changed };
  }

  getVisibility(code: string): RoomVisibility {
    return this.rooms.get(code)?.visibility ?? DEFAULT_ROOM_VISIBILITY;
  }

  /**
   * The discovery projection: every room that is *currently* eligible to be found, as the small
   * public shape in protocol.ts and nothing else.
   *
   * Eligibility is recomputed from the live room on every call — there is no listing index to go
   * stale, which is what makes an expired, closed or newly-private room disappear the moment it
   * stops qualifying (OD-18) instead of when some cache notices. A room with a match in progress
   * is omitted rather than shown as non-joinable: it cannot seat anyone until that match ends,
   * and a card offering a seat that does not exist is worse than no card.
   *
   * Full lobbies are kept, marked `full`, so "the room I was about to tap just filled up" reads
   * as a fact on screen rather than as a rejection after a tap.
   */
  listRooms(limit = MAX_ROOM_LISTINGS): RoomListing[] {
    const out: RoomListing[] = [];
    for (const room of this.rooms.values()) {
      if (out.length >= limit) break;
      if (room.visibility !== 'listed' || room.state !== null) continue;
      const occupied = room.seats.filter((s): s is Seat => s !== null);
      if (occupied.length === 0) continue;
      const host = room.seats[room.hostSeat] ?? occupied[0]!;
      out.push({
        code: room.code,
        hostName: host.name,
        players: occupied.length,
        capacity: MAX_SEATS,
        status: occupied.length >= MAX_SEATS ? 'full' : 'waiting',
        timerMode: room.settings.timerMode,
      });
    }
    return out;
  }

  /** Start (or restart) the active seat's clock. A turn with no timer keeps a null start, and so
   * does a match that just ended: a finished game has no turn to time, and a clock left running
   * would keep counting down to a red 0:00 behind the results screen. */
  private startTurnClock(room: RoomInternal): void {
    if (room.state?.phase !== 'playing') {
      room.clock = IDLE_CLOCK;
      return;
    }
    room.clock = startTurn(this.now(), turnBudgetMs(room.settings, room.seatClocks, room.state.activePlayerIndex));
  }

  /** ms left on the active seat's turn, or null when this room has no timer. Never negative. */
  private msLeft(room: RoomInternal): number | null {
    return msLeft(room.clock, this.now());
  }

  /**
   * Charge the seat that just moved for the time its turn took, and pay it the increment. Called
   * once per completed turn, before the next turn's clock starts, so a seat is billed exactly the
   * authoritative interval between its turn starting and its move landing.
   */
  private chargeClock(room: RoomInternal, playerIndex: number): void {
    if (room.clock.startedAt === null) return;
    const state = room.panic[playerIndex];
    const debt = chargeSeat(room.settings, room.seatClocks, playerIndex, this.now() - room.clock.startedAt, state?.debtMs ?? 0);
    if (state) room.panic[playerIndex] = { ...state, debtMs: debt };
  }

  /**
   * Grant this turn's one-off Mexe extension. Active seat only, once per turn, and only while a
   * timer is actually running — so a client cannot hold its turn open by re-sending the claim,
   * and a seat that is not on the clock gains nothing by sending it at all.
   */
  claimMexeBonus(code: string, seat: number): { ok: boolean; msLeft: number | null } {
    const room = this.rooms.get(code);
    // Seat number, not player index: in a room with a seat gap the two differ, and comparing them
    // directly refused the bonus to every chair after the gap (the same translation `claimTurn`
    // does).
    if (!room || !room.state || room.state.activePlayerIndex !== this.playerIndex(room, seat)) {
      return { ok: false, msLeft: null };
    }
    const { clock, granted } = grantBonus(room.clock, room.settings.mexeBonusMs);
    room.clock = clock;
    return { ok: granted, msLeft: this.msLeft(room) };
  }

  /**
   * Spend one of the active seat's time powers. Both work the same way and refuse the same way —
   * wrong seat, no turn running, spent budget or a room that grants none — and both credit the
   * personal clock, because the seat is charged for the whole turn either way. A double press is
   * free: the domain grants at most one.
   */
  private spendTimePower(code: string, seat: number, kind: 'panic' | 'freeze'): { ok: boolean; msLeft: number | null } {
    const room = this.rooms.get(code);
    const index = room ? this.playerIndex(room, seat) : -1;
    if (!room || !room.state || room.state.activePlayerIndex !== index) return { ok: false, msLeft: null };
    const state = room.panic[index];
    if (!state) return { ok: false, msLeft: this.msLeft(room) };
    const assists = assistsOf(room.settings);
    const spend = kind === 'panic' ? usePanic : useFreeze;
    const result = spend(room.clock, state, assists);
    if (!result.granted) return { ok: false, msLeft: this.msLeft(room) };
    room.clock = result.clock;
    room.panic[index] = result.state;
    creditSeat(room.settings, room.seatClocks, index, kind === 'panic' ? assists.panicMs : assists.freezeMs);
    return { ok: true, msLeft: this.msLeft(room) };
  }

  usePanicButton(code: string, seat: number): { ok: boolean; msLeft: number | null } {
    return this.spendTimePower(code, seat, 'panic');
  }

  useFreezeButton(code: string, seat: number): { ok: boolean; msLeft: number | null } {
    return this.spendTimePower(code, seat, 'freeze');
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
    // A lobby gap (e.g. seats 0, 2 and 3) is dealt, not refused: `matchSeats` records which room
    // seat each dense player index belongs to, and every seat-taking entry point below translates
    // through it. Seats themselves are never compacted — they are the stable chairs reconnect,
    // turn order and the score are keyed on.
    room.matchSeats = occupied.map((s) => s.seat);

    const seed = this.genSeed();
    // Same deal function the offline client uses, so one seed means one game on both sides.
    room.state = createNewGame(
      seed,
      occupied.map((seatData) => ({ name: seatData.name, isAi: false })),
      DEFAULT_RULES,
    );
    room.rev = 1;
    room.lastActivityAt = this.now();
    // A fresh match identity, so every client can tell this deal from the one it replaced, and a
    // fresh result guard, so this match's finish is recordable exactly once.
    room.matchId = this.genToken();
    room.matchSeq += 1;
    room.matchStartedAt = this.now();
    room.resultRecorded = false;
    // Personal clocks are dealt with the match, from the settings frozen a moment ago — so a
    // rematch always starts on full clocks and never inherits the last match's.
    room.seatClocks = isTimeAttack(room.settings) ? occupied.map(() => room.settings.startClockMs) : [];
    // Assistance is dealt with the match too, so a rematch never inherits a spent Panic Button.
    room.panic = occupied.map(() => assistStateFor(assistsOf(room.settings)));
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
    if (state.activePlayerIndex !== this.playerIndex(room, seat)) return { ok: false, reasons: ['reason.notYourTurn'] };
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
    // Billed against the state that is ending, so the charge lands on the seat that spent the
    // time rather than on whoever is about to move.
    if (before) this.chargeClock(room, before.activePlayerIndex);
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
      // No `?? i` fallback: `matchSeats` is built from the same seat list the match was dealt
      // from, so a missing entry is a broken invariant, and guessing that the player index is
      // also the chair number would announce the wrong player's last card.
      const seat = room.seats[room.matchSeats[i] ?? -1];
      if (seat) this.note(room, 'last_card', seat);
    });
  }

  /** Room seat -> dense `GameState` player index for the running match, or -1 off the table. */
  private playerIndex(room: RoomInternal, seat: number): number {
    return room.matchSeats.indexOf(seat);
  }

  /** Full validation path per docs/MULTIPLAYER.md §5. */
  submitTurn(code: string, seat: number, rev: number, melds: SubmitTurnMeld[]): TurnResult {
    const claim = this.claimTurn(code, seat, rev);
    if (!claim.ok) return claim;
    const { room, state } = claim;

    room.processing = true;
    try {
      // Card identity comes from server state, never from the client: the wire carries ids only
      // and `draftFromCardIds` (src/rules) refuses an id that is not on the table or in this
      // seat's own hand, so an opponent-hand or draw-pile id is `reason.unknownCard` here rather
      // than relying on the downstream `foreignCard` check (S6).
      const me = this.playerIndex(room, seat);
      const draft = draftFromCardIds(state, me, melds);
      if (!draft) return { ok: false, reasons: ['reason.unknownCard'] };

      const check = canConfirmTurn(state, draft);
      if (!check.ok) return { ok: false, reasons: check.reasons };

      const next = applyConfirmedTurn(state, draft);
      // Hand counts are public in every view, so their difference is public too — this is the
      // whole "how did they finish" summary, with no card identity in it.
      if (next.phase === 'finished') {
        room.winningMove = { seat, cardsPlayed: state.players[me]!.hand.length - next.players[me]!.hand.length };
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
  advanceStalledTurns(): StalledTurnResult[] {
    const t = this.now();
    const advanced: StalledTurnResult[] = [];
    for (const [code, room] of this.rooms) {
      const state = room.state;
      if (!state || state.phase !== 'playing') continue;
      // Same rule as `noteCardCounts`: a missing mapping skips this room rather than timing out
      // whichever chair happens to share the active player's index.
      const active = room.seats[room.matchSeats[state.activePlayerIndex] ?? -1];
      if (!active) continue;
      if (!room.seats.some((s) => s !== null && s.connected)) continue;

      const absentTooLong =
        !active.connected && active.disconnectedAt !== null && t - active.disconnectedAt > room.settings.reconnectGraceMs;
      const timedOut = expired(room.clock, t);
      if (!absentTooLong && !timedOut) continue;

      // Last Breath before the turn is taken away: one extra window per turn, granted by the
      // authority rather than asked for, and impossible to chain because the used flag rides on
      // the clock that `startTurnClock` replaces. An absent seat gets none — a breath is for a
      // player who is there and out of time, not for a seat nobody is sitting in.
      if (timedOut && !absentTooLong && active.connected) {
        const breath = enterLastBreath(room.clock, assistsOf(room.settings));
        if (breath.entered) {
          room.clock = breath.clock;
          creditSeat(room.settings, room.seatClocks, state.activePlayerIndex, room.settings.lastBreathMs);
          advanced.push({ code, gameOver: false, breath: active.seat });
          continue;
        }
        // Time Debt: rather than lose the match here, a seat may borrow against its own future
        // increments — bounded by `maxDebtMs`, recorded explicitly, and repaid before its clock
        // grows again. Off unless the room granted it, and never a surprise deduction.
        const index = state.activePlayerIndex;
        const assistState = room.panic[index];
        if (assistState && isTimeAttack(room.settings)) {
          const borrowed = borrowTime(room.seatClocks[index] ?? 0, assistState, assistsOf(room.settings));
          if (borrowed.borrowedMs > 0) {
            room.seatClocks[index] = borrowed.clockMs;
            room.panic[index] = borrowed.state;
            room.clock = { ...room.clock, budgetMs: room.clock.budgetMs + borrowed.borrowedMs };
            advanced.push({ code, gameOver: false, breath: active.seat });
            continue;
          }
        }
      }

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
        // Time Attack: the clock that ran out *is* the seat's own, so record it as spent. It is
        // zeroed only for a real expiry — a seat timed out for being absent still has whatever
        // time it had left, and would get it back on reconnect if the room survived.
        if (timedOut && isTimeAttack(room.settings)) room.seatClocks[state.activePlayerIndex] = 0;
        this.startTurnClock(room);
        this.noteCardCounts(room, state, next);
        const finished = next.phase === 'finished';
        if (finished) this.recordResult(room);
        const seat = active.seat;
        // A finish wins over the missed-turn limit. The limit exists to stop a walked-away seat
        // holding the others on a board that only ever advances by draw — a board that just
        // ended is not that board, and closing the room here would replace a result screen with
        // "a player missed too many turns" and throw away the rematch lobby.
        if (!finished && active.missedTurns >= room.settings.missedTurnLimit) {
          this.rooms.delete(code);
          advanced.push({ code, gameOver: false, closed: true, timedOut: seat });
          continue;
        }
        advanced.push({ code, gameOver: finished, timedOut: seat });
      } catch (err) {
        // Reaching here means a server invariant did not hold (assertConservation) or a rules
        // transition threw on state this process built — a bug, never player input. The room is
        // dropped so nothing keeps playing on it, and `error` is handed to the caller so the
        // failure is logged rather than disappearing into a `crashed` boolean.
        this.rooms.delete(code);
        advanced.push({ code, gameOver: false, crashed: true, error: err });
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
    room.matchSeats = [];
    room.winningMove = null;
    room.clock = IDLE_CLOCK;
    room.seatClocks = [];
    room.panic = [];
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
      room.state!, this.playerIndex(room, seat), room.rev, room.settings, this.msLeft(room),
      // Both arrays are indexed by dense player index, like everything else inside a view.
      room.matchSeats.map((s) => room.seats[s]?.missedTurns ?? 0), room.clock.bonusClaimed,
      room.matchId ?? '', room.matchSeats, room.seatClocks, room.panic.map((p) => p.panicLeft),
      room.panic.map((p) => p.freezeLeft), room.panic.map((p) => p.debtMs),
    );
  }

  getPlayers(code: string): RoomPlayerSummary[] | null {
    const room = this.rooms.get(code);
    return room ? this.summarize(room) : null;
  }

  /** Everything a lobby renders: who is in, the agreed settings, whether they are frozen, and the
   * room's memory across matches. */
  getRoomInfo(code: string): { players: RoomPlayerSummary[]; settings: RoomSettings; locked: boolean; party: PartyState; visibility: RoomVisibility } | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    return {
      players: this.summarize(room),
      settings: room.settings,
      locked: room.state !== null,
      party: this.getParty(code),
      visibility: room.visibility,
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

  /**
   * Test seam only. `GameState` is readonly (ARCH-005), so a fixture that needs a particular deal
   * builds the whole state and hands it over here; production code moves a room's state only
   * through `submitTurn`, `drawEndTurn` and the stalled-turn clock, which validate and conserve.
   */
  setStateForTest(code: string, state: GameState): void {
    const room = this.rooms.get(code);
    if (room) room.state = state;
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
      // The room's own window, not the deployment default: `disconnectGraceMs` only seeds a fresh
      // room's settings (createRoom), after which a preset or a custom screen may have widened it.
      // Reaping on the default would delete a room inside the grace it promised its players —
      // every matchmade room runs the casual preset's 60s against a 30s default.
      const grace = room.settings.reconnectGraceMs;
      const allGone = room.seats.every(
        (s) => s === null || (!s.connected && s.disconnectedAt !== null && t - s.disconnectedAt > grace),
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
  if (!cardsConserved(state)) {
    throw new RulesError('server invariant violated: card conservation', 'corruptState');
  }
}
