/**
 * Shared wire protocol for online play. Pure module: no browser APIs, no
 * Node APIs — safe to import from both the client bundle and the server.
 * See docs/MULTIPLAYER.md for the design this implements.
 */
import type { Card, GameState, Meld, ReasonCode, RulesConfig } from '../rules/types';

export const PROTOCOL_VERSION = 4;

// ---------------------------------------------------------------------------
// Room settings (docs/MULTIPLAYER.md §7)
// ---------------------------------------------------------------------------

export type TimerMode = 'off' | 'casual' | 'fast' | 'custom';

/**
 * Fairness-affecting room configuration. Chosen by the host in the lobby and frozen the moment
 * the match starts — every value here changes what a turn is worth, so a mid-match change would
 * be a change to the rules one seat is playing under.
 *
 * The server owns every one of these. A client renders them and proposes new ones in the lobby;
 * it never applies a value itself, and no client message can extend a running timer.
 */
export interface RoomSettings {
  timerMode: TimerMode;
  /** Turn budget in ms. 0 means no timer at all (`timerMode: 'off'`). */
  turnMs: number;
  /** One-off extension granted when the active seat opens Mexe Mode, once per turn. */
  mexeBonusMs: number;
  /** How long before expiry the client shows its warning state. */
  warnMs: number;
  /** How long a disconnected seat's turn is held before the server plays it for them. */
  reconnectGraceMs: number;
  /** Consecutive turns a seat may lose to the timer before the match is ended. */
  missedTurnLimit: number;
}

export const TIMER_PRESETS: Record<'off' | 'casual' | 'fast', RoomSettings> = {
  off: { timerMode: 'off', turnMs: 0, mexeBonusMs: 0, warnMs: 0, reconnectGraceMs: 60_000, missedTurnLimit: 2 },
  casual: { timerMode: 'casual', turnMs: 90_000, mexeBonusMs: 45_000, warnMs: 10_000, reconnectGraceMs: 60_000, missedTurnLimit: 2 },
  fast: { timerMode: 'fast', turnMs: 45_000, mexeBonusMs: 20_000, warnMs: 10_000, reconnectGraceMs: 30_000, missedTurnLimit: 2 },
};

export const DEFAULT_ROOM_SETTINGS: RoomSettings = TIMER_PRESETS.casual;

/**
 * The complete set of things one player can say to another online. A fixed preset list instead
 * of free text: nothing here can carry an insult, a link or a real name, so no moderation
 * surface is created. The server validates against this exact list and rate-limits per seat.
 */
export const REACTIONS = ['nice', 'oops', 'hurry', 'wow'] as const;
export type ReactionId = (typeof REACTIONS)[number];

/** Minimum gap between two reactions from the same seat. Enforced by the server — a client-side
 * cooldown alone would be one `devtools` call away from a spam channel. */
export const REACTION_COOLDOWN_MS = 3_000;

/** Inclusive bounds for a `custom` timer. A value outside its range is clamped, not rejected —
 * a hostile payload must not be able to create a 1 ms turn or a room that never times out.
 * Exported so the lobby's custom controls stop at the same numbers the server enforces, rather
 * than keeping a second copy that can drift out of agreement with this one. */
export const CUSTOM_BOUNDS = {
  turnMs: [15_000, 600_000],
  mexeBonusMs: [0, 300_000],
  warnMs: [0, 60_000],
  reconnectGraceMs: [10_000, 300_000],
  missedTurnLimit: [1, 10],
} as const;

function clampInt(value: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/**
 * The only way untrusted input becomes a `RoomSettings`. A named preset ignores whatever else
 * the payload carried; `custom` is clamped field by field. Anything unrecognizable falls back to
 * the default preset rather than throwing, so a bad lobby payload cannot break a room.
 */
export function normalizeRoomSettings(raw: unknown): RoomSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ROOM_SETTINGS };
  const o = raw as Record<string, unknown>;
  const mode = o.timerMode;
  if (mode === 'off' || mode === 'casual' || mode === 'fast') return { ...TIMER_PRESETS[mode] };
  if (mode !== 'custom') return { ...DEFAULT_ROOM_SETTINGS };
  const turnMs = clampInt(o.turnMs, CUSTOM_BOUNDS.turnMs, DEFAULT_ROOM_SETTINGS.turnMs);
  return {
    timerMode: 'custom',
    turnMs,
    mexeBonusMs: clampInt(o.mexeBonusMs, CUSTOM_BOUNDS.mexeBonusMs, DEFAULT_ROOM_SETTINGS.mexeBonusMs),
    // A warning longer than the turn itself would render the turn as "warning" from its first
    // frame, so it is capped by the budget it warns about as well as by its own bound.
    warnMs: Math.min(turnMs, clampInt(o.warnMs, CUSTOM_BOUNDS.warnMs, DEFAULT_ROOM_SETTINGS.warnMs)),
    reconnectGraceMs: clampInt(o.reconnectGraceMs, CUSTOM_BOUNDS.reconnectGraceMs, DEFAULT_ROOM_SETTINGS.reconnectGraceMs),
    missedTurnLimit: clampInt(o.missedTurnLimit, CUSTOM_BOUNDS.missedTurnLimit, DEFAULT_ROOM_SETTINGS.missedTurnLimit),
  };
}

// ---------------------------------------------------------------------------
// Redacted view (docs/MULTIPLAYER.md §2)
// ---------------------------------------------------------------------------

/** One seat's entry in a GameView. `hand` is present only for the viewing seat. */
interface PlayerView {
  seat: number;
  id: string;
  name: string;
  handCount: number;
  hand?: Card[];
}

/** Redacted, per-viewer projection of GameState. Never carries opponent card ids or draw-pile order. */
export interface GameView {
  /** Seat this view was built for. */
  seat: number;
  players: PlayerView[];
  table: Meld[];
  drawCount: number;
  activeSeat: number;
  turn: number;
  rev: number;
  phase: 'playing' | 'finished';
  winnerId: string | null;
  config: RulesConfig;
  /** The room's frozen settings, so a client can render the clock and the warning threshold
   * without a separate request (and a reconnecting client gets them with its first view). */
  settings: RoomSettings;
  /** Milliseconds left on the active seat's turn when this view was built, or null when the room
   * has no timer. Display only: the client counts down from it, and the server alone decides
   * when a turn has actually expired. A client's own countdown reaching zero changes nothing. */
  turnMsLeft: number | null;
  /**
   * Consecutive turns each seat has let expire. Public by nature — every seat watched the clock
   * run out — and the client needs it to warn that a match is about to end on `missedTurnLimit`
   * rather than having it end without explanation. Never part of the hash: it is presentation
   * state the server owns, not something a client reconstructs.
   */
  missedTurns: number[];
  /** Whether the active seat has already claimed this turn's one-off Mexe extension. Public
   * (every seat can see the clock move) and presentation state like `missedTurns` — the client
   * uses the false->true edge to show a one-time "extension granted" notice, never part of the
   * hash. Resets to false at the start of each turn. */
  mexeBonusClaimed: boolean;
  /** Digest of the parts of the authoritative state every seat can see. A client recomputes it
   * from its own reconstruction and asks for a resync on mismatch. */
  hash: string;
}

/** The seat-independent slice of a game that both sides can hash. Deliberately excludes card
 * identities in hands and the draw pile — those differ per view, so they cannot be compared. */
interface StateDigestInput {
  rev: number;
  activeSeat: number;
  turn: number;
  phase: string;
  handCounts: number[];
  drawCount: number;
  table: { id: string; cardIds: string[] }[];
}

/** FNV-1a over a canonical rendering of the digest input. Not cryptographic: this detects
 * divergence between two honest peers, it is not a tamper check (the server never trusts a
 * client-supplied hash — it only ever sends its own). */
export function stateHash(input: StateDigestInput): string {
  const canonical = [
    input.rev,
    input.activeSeat,
    input.turn,
    input.phase,
    input.handCounts.join(','),
    input.drawCount,
    input.table.map((m) => `${m.id}:${m.cardIds.join('.')}`).join('|'),
  ].join(';');
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Digest input for a redacted view, as a client sees it. */
export function digestOfView(view: GameView): StateDigestInput {
  return {
    rev: view.rev,
    activeSeat: view.activeSeat,
    turn: view.turn,
    phase: view.phase,
    handCounts: view.players.map((p) => p.handCount),
    drawCount: view.drawCount,
    table: view.table.map((m) => ({ id: m.id, cardIds: m.cards.map((c) => c.id) })),
  };
}

/** Digest input for a full or reconstructed `GameState` at revision `rev`. Uses only fields a
 * client can know, so a client's reconstruction hashes to the server's value when in sync. */
export function digestOfState(state: GameState, rev: number): StateDigestInput {
  return {
    rev,
    activeSeat: state.activePlayerIndex,
    turn: state.turn,
    phase: state.phase,
    handCounts: state.players.map((p) => p.hand.length),
    drawCount: state.drawPile.length,
    table: state.table.map((m) => ({ id: m.id, cardIds: m.cards.map((c) => c.id) })),
  };
}

/** Pure: build the redacted view for `seat` from the authoritative state at revision `rev`. */
export function buildView(
  state: GameState,
  seat: number,
  rev: number,
  settings: RoomSettings = DEFAULT_ROOM_SETTINGS,
  turnMsLeft: number | null = null,
  missedTurns: number[] = [],
  mexeBonusClaimed = false,
): GameView {
  const view: GameView = {
    seat,
    players: state.players.map((p, i) => ({
      seat: i,
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      ...(i === seat ? { hand: p.hand.map((c) => ({ ...c })) } : {}),
    })),
    table: state.table.map((m) => ({ id: m.id, cards: m.cards.map((c) => ({ ...c })) })),
    drawCount: state.drawPile.length,
    activeSeat: state.activePlayerIndex,
    turn: state.turn,
    rev,
    phase: state.phase,
    winnerId: state.winnerId,
    config: state.config,
    settings,
    turnMsLeft,
    missedTurns: state.players.map((_, i) => missedTurns[i] ?? 0),
    mexeBonusClaimed,
    hash: '',
  };
  view.hash = stateHash(digestOfView(view));
  return view;
}

// ---------------------------------------------------------------------------
// Client -> server messages
// ---------------------------------------------------------------------------

interface CreateRoomMsg {
  v: number;
  type: 'create_room';
  reqId: string;
  name: string;
}
interface JoinRoomMsg {
  v: number;
  type: 'join_room';
  reqId: string;
  code: string;
  name: string;
}
interface LeaveRoomMsg {
  v: number;
  type: 'leave_room';
  reqId: string;
}
interface ReadyMsg {
  v: number;
  type: 'ready';
  reqId: string;
  ready: boolean;
}
/** Host-only explicit lobby start. Keeps 3P/4P lobbies open until all invited seats are ready. */
interface StartGameMsg {
  v: number;
  type: 'start_game';
  reqId: string;
}
/** Host-only, lobby-only proposal for the room's settings. The server normalizes and applies —
 * it never echoes the payload back unvalidated. */
interface SetRoomSettingsMsg {
  v: number;
  type: 'set_room_settings';
  reqId: string;
  settings: RoomSettings;
}
/** "I opened Mexe Mode": claims the one-off turn extension. Honoured at most once per turn, for
 * the active seat only, so it cannot be spammed to hold a turn open. */
interface MexeStartedMsg {
  v: number;
  type: 'mexe_started';
  reqId: string;
}
export interface SubmitTurnMeld {
  id: string;
  cardIds: string[];
}
interface SubmitTurnMsg {
  v: number;
  type: 'submit_turn';
  reqId: string;
  rev: number;
  melds: SubmitTurnMeld[];
}
interface DrawEndTurnMsg {
  v: number;
  type: 'draw_end_turn';
  reqId: string;
  rev: number;
}
interface ReconnectMsg {
  v: number;
  type: 'reconnect';
  reqId: string;
  token: string;
}
interface PingMsg {
  v: number;
  type: 'ping';
  reqId: string;
}
/** Client-initiated recovery: "I believe my state is wrong, send me the authoritative one."
 * Carries no state — the server never reconciles towards a client, it only re-sends. */
interface ResyncMsg {
  v: number;
  type: 'resync';
  reqId: string;
}

/** One preset reaction, addressed to the room. Carries no text: `reaction` must be one of
 * REACTIONS, and the server drops anything else plus anything inside the per-seat cooldown. */
interface ReactionMsg {
  v: number;
  type: 'reaction';
  reqId: string;
  reaction: ReactionId;
}

export type ClientMessage =
  | CreateRoomMsg
  | JoinRoomMsg
  | LeaveRoomMsg
  | ReadyMsg
  | SetRoomSettingsMsg
  | MexeStartedMsg
  | StartGameMsg
  | SubmitTurnMsg
  | DrawEndTurnMsg
  | ReconnectMsg
  | PingMsg
  | ResyncMsg
  | ReactionMsg;

// ---------------------------------------------------------------------------
// Server -> client messages
// ---------------------------------------------------------------------------

export interface RoomPlayerSummary {
  seat: number;
  name: string;
  ready: boolean;
  connected: boolean;
}

interface RoomJoinedMsg {
  v: number;
  type: 'room_joined';
  code: string;
  seat: number;
  token: string;
  players: RoomPlayerSummary[];
  settings: RoomSettings;
  /** The current host seat: the only seat whose settings proposals and start are accepted.
   * Starts as seat 0 (the creator) but moves to the next-lowest occupied seat if seat 0 leaves
   * (D15) — never assume it is 0. */
  hostSeat: number;
}
interface RoomStateMsg {
  v: number;
  type: 'room_state';
  players: RoomPlayerSummary[];
  settings: RoomSettings;
  hostSeat: number;
  /** True once the match has started — settings are frozen from this point. */
  locked: boolean;
}
/** Match start. Deliberately carries no shuffle seed: the seed reproduces both hands and the
 * whole draw pile through the shared deal functions, so it must never leave the server. */
interface GameStartedMsg {
  v: number;
  type: 'game_started';
  view: GameView;
}
interface StateSyncMsg {
  v: number;
  type: 'state_sync';
  view: GameView;
}
interface ProposalRejectedMsg {
  v: number;
  type: 'proposal_rejected';
  reqId: string;
  reasons: ReasonCode[];
}
/** The server ended `seat`'s turn for them: the clock ran out, or they were gone past the
 * reconnect grace. Purely a notice — the authoritative result already arrived as a state_sync. */
interface TurnTimeoutMsg {
  v: number;
  type: 'turn_timeout';
  seat: number;
}
interface PlayerDisconnectedMsg {
  v: number;
  type: 'player_disconnected';
  seat: number;
}
interface PlayerReconnectedMsg {
  v: number;
  type: 'player_reconnected';
  seat: number;
}
/** How the winner actually finished, in public terms only: which seat, and how many cards they
 * put down on that last turn. Hand *counts* are already public in every GameView, so this
 * discloses nothing new — deliberately no card identities, which would leak the winner's hand. */
export interface WinningMove {
  seat: number;
  cardsPlayed: number;
}
export interface GameOverMsg {
  v: number;
  type: 'game_over';
  winnerId: string | null;
  stalemate: boolean;
  view: GameView;
  /** Null on a stalemate, or when the match ended on a move the server did not attribute. */
  winningMove: WinningMove | null;
}
/** A preset reaction relayed from `seat` to the rest of the room. The server re-emits its own
 * validated value — a client's payload is never echoed through. */
interface PlayerReactionMsg {
  v: number;
  type: 'player_reaction';
  seat: number;
  reaction: ReactionId;
}
export interface ErrorMsg {
  v: number;
  type: 'error';
  code: string;
  message: string;
  /** Echoes the request that failed, when the failure was caused by one. Absent for
   * server-initiated errors such as `room_closed`. */
  reqId?: string;
}
interface PongMsg {
  v: number;
  type: 'pong';
}

export type ServerMessage =
  | RoomJoinedMsg
  | RoomStateMsg
  | GameStartedMsg
  | StateSyncMsg
  | ProposalRejectedMsg
  | TurnTimeoutMsg
  | PlayerDisconnectedMsg
  | PlayerReconnectedMsg
  | GameOverMsg
  | ErrorMsg
  | PongMsg
  | PlayerReactionMsg;

// ---------------------------------------------------------------------------
// Boundary validator — the only place untrusted socket text becomes a typed
// message. Never throws. Bounds every array/string so a hostile payload
// cannot exhaust memory or crash a downstream handler.
// ---------------------------------------------------------------------------

const MAX_STR = 64;
const MAX_MELDS = 60;
const MAX_CARDS_PER_MELD = 60;
/** A proposal carries the whole draft table plus the hand cards being played, so it is bounded
 * by the deck, not by a hand: DEFAULT_RULES deals 2 x (52 + 2) = 108 cards. A late-game
 * rearrangement of a large table legitimately exceeds any smaller cap, and rejecting it here
 * surfaces as a generic `bad_message` instead of a proposal result, so FEITO looks dead.
 * Kept a round 120 — comfortably above every legal proposal, far below anything that hurts. */
const MAX_TOTAL_CARDS = 120;

function isStr(v: unknown, maxLen = MAX_STR): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

function isRev(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

export function parseClientMessage(raw: string): ClientMessage | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'invalid json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'not an object' };
  }
  const o = parsed as Record<string, unknown>;
  if (o.v !== PROTOCOL_VERSION) return { error: 'unsupported protocol version' };
  if (!isStr(o.type, 32)) return { error: 'missing type' };
  if (!isStr(o.reqId)) return { error: 'missing reqId' };
  const reqId = o.reqId;

  switch (o.type) {
    case 'create_room': {
      if (!isStr(o.name)) return { error: 'bad name' };
      return { v: PROTOCOL_VERSION, type: 'create_room', reqId, name: o.name };
    }
    case 'join_room': {
      // Real codes are 5 chars (server/rooms.ts CODE_LENGTH); anything much longer is garbage
      // or a probe and gets rejected before it reaches the room manager.
      if (!isStr(o.code) || o.code.length === 0 || o.code.length > 16 || !isStr(o.name)) {
        return { error: 'bad join_room payload' };
      }
      return { v: PROTOCOL_VERSION, type: 'join_room', reqId, code: o.code, name: o.name };
    }
    case 'leave_room':
      return { v: PROTOCOL_VERSION, type: 'leave_room', reqId };
    case 'ready': {
      if (typeof o.ready !== 'boolean') return { error: 'bad ready payload' };
      return { v: PROTOCOL_VERSION, type: 'ready', reqId, ready: o.ready };
    }
    case 'set_room_settings':
      // Normalizing here means the room manager can never be handed an out-of-range value, and
      // an omitted/garbage payload becomes the default preset instead of a parse failure.
      return { v: PROTOCOL_VERSION, type: 'set_room_settings', reqId, settings: normalizeRoomSettings(o.settings) };
    case 'mexe_started':
      return { v: PROTOCOL_VERSION, type: 'mexe_started', reqId };
    case 'start_game':
      return { v: PROTOCOL_VERSION, type: 'start_game', reqId };
    case 'submit_turn': {
      if (!isRev(o.rev)) return { error: 'bad rev' };
      if (!Array.isArray(o.melds) || o.melds.length > MAX_MELDS) return { error: 'bad melds' };
      const melds: SubmitTurnMeld[] = [];
      let totalCards = 0;
      for (const raw of o.melds) {
        if (!raw || typeof raw !== 'object') return { error: 'bad meld' };
        const m = raw as Record<string, unknown>;
        if (!isStr(m.id)) return { error: 'bad meld id' };
        if (!Array.isArray(m.cardIds) || m.cardIds.length > MAX_CARDS_PER_MELD) {
          return { error: 'bad cardIds' };
        }
        const cardIds: string[] = [];
        for (const c of m.cardIds) {
          if (!isStr(c)) return { error: 'bad card id' };
          totalCards++;
          if (totalCards > MAX_TOTAL_CARDS) return { error: 'too many cards' };
          cardIds.push(c);
        }
        melds.push({ id: m.id, cardIds });
      }
      return { v: PROTOCOL_VERSION, type: 'submit_turn', reqId, rev: o.rev, melds };
    }
    case 'draw_end_turn': {
      if (!isRev(o.rev)) return { error: 'bad rev' };
      return { v: PROTOCOL_VERSION, type: 'draw_end_turn', reqId, rev: o.rev };
    }
    case 'reconnect': {
      if (!isStr(o.token)) return { error: 'bad token' };
      return { v: PROTOCOL_VERSION, type: 'reconnect', reqId, token: o.token };
    }
    case 'ping':
      return { v: PROTOCOL_VERSION, type: 'ping', reqId };
    case 'resync':
      return { v: PROTOCOL_VERSION, type: 'resync', reqId };
    case 'reaction': {
      // Membership of the preset list is the whole validation: an id that is not in it never
      // becomes a message, so nothing downstream has to re-check it.
      if (!isStr(o.reaction, 16) || !(REACTIONS as readonly string[]).includes(o.reaction)) {
        return { error: 'bad reaction' };
      }
      return { v: PROTOCOL_VERSION, type: 'reaction', reqId, reaction: o.reaction as ReactionId };
    }
    default:
      return { error: 'unknown type' };
  }
}
