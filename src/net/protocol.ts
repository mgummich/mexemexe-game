/**
 * Shared wire protocol for online play. Pure module: no browser APIs, no
 * Node APIs — safe to import from both the client bundle and the server.
 * See docs/MULTIPLAYER.md for the design this implements.
 */
import { fnv1a } from '../rules/hash';
import type { Card, GameState, Meld, ReasonCode, RulesConfig } from '../rules/types';

/** Bumped to 8 for the casual matchmaking queue: the client gained `join_queue`/`cancel_queue`
 * and the server gained `queue_state`. A v7 client cannot queue at all, so it must not be left
 * believing it can. (7 was the public-room reaction set: `hurry` left `REACTIONS` and `gg` took
 * its place, so a v6 client's reaction id is no longer one this server will relay.) */
export const PROTOCOL_VERSION = 9;

// ---------------------------------------------------------------------------
// Shared room shape (one owner for facts both runtimes state)
// ---------------------------------------------------------------------------

/** Characters in a room code. The server generates them (`server/rooms.ts`) and the client
 * renders/parses input against the same length — one contract, stated once. */
export const ROOM_CODE_LENGTH = 5;

/** Seats a room has, and therefore the largest match. Player *count* legality for a deal is the
 * rules' own (`createNewGame` refuses outside 2-4); this is the table's size. */
export const MAX_SEATS = 4;

// ---------------------------------------------------------------------------
// Error codes (docs/MULTIPLAYER.md §5)
// ---------------------------------------------------------------------------

/**
 * Every `code` an `ErrorMsg` can carry. The wire contract, so the server cannot invent a code the
 * client has no copy for: `sendError` takes this union, and `src/net/errors.ts` maps each entry to
 * player-facing copy (its test walks this list). Codes are stable, presentation-neutral and
 * never localized — the translated sentence is the client's, the code is the protocol's.
 *
 * All of these are *expected* refusals. An unexpected server-side failure is `internal_error`,
 * whose detail stays in the server log and never reaches a client.
 */
export const SERVER_ERROR_CODES = [
  'room_full',
  'room_not_found',
  'game_started',
  'room_limit',
  'room_create_limit',
  'already_in_room',
  'no_room',
  'not_member',
  'not_host',
  'not_ready',
  'invalid_token',
  'room_closed',
  'server_shutdown',
  'rate_limited',
  'already_in_match',
  'queue_busy',
  'bad_message',
  'unsupported_version',
  'internal_error',
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

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
 *
 * Every entry has to stay benign when the other seats are strangers, not friends. That is why
 * there is no "hurry up": among friends it is a joke, and in a public room it is a nag one tap
 * away from being spammed at whoever is thinking. `gg` replaced it — the one thing a stranger
 * most wants to be able to say, and the hardest one to weaponize.
 */
export const REACTIONS = ['nice', 'gg', 'oops', 'wow'] as const;
export type ReactionId = (typeof REACTIONS)[number];

/** Minimum gap between two reactions from the same seat. Enforced by the server — a client-side
 * cooldown alone would be one `devtools` call away from a spam channel. */
export const REACTION_COOLDOWN_MS = 3_000;

// ---------------------------------------------------------------------------
// Room visibility and discovery (docs/MULTIPLAYER.md §3d)
// ---------------------------------------------------------------------------

/**
 * Who is allowed to find a room, as opposed to who is allowed to join it.
 *
 * `private` is the only default there will ever be: a fresh room is reachable by its invite link
 * or its code and by nothing else. `listed` is an explicit host decision to also appear in the
 * room browser, and it changes discovery only — lifecycle, capacity and seat ownership decide
 * joining either way, exactly as they did before discovery existed.
 */
export type RoomVisibility = 'private' | 'listed';

export const DEFAULT_ROOM_VISIBILITY: RoomVisibility = 'private';

export function isRoomVisibility(v: unknown): v is RoomVisibility {
  return v === 'private' || v === 'listed';
}

/** What a browser card says about a room it is offering. Derived from the room, never stored. */
export type RoomListingStatus = 'waiting' | 'full';

/**
 * The entire public face of a listed room — a deliberately separate, tiny projection rather than
 * a trimmed `RoomStateMsg`. Nothing here is a secret, and nothing here is *derivable* from a
 * secret: no token, no seat id, no hand, no revision, no activity, no party history. A room that
 * is not `listed` never becomes one of these at all.
 *
 * The code is in here on purpose: it is a locator, not a credential, and a browser card the
 * player cannot act on would be pointless. Guess-rate protection (server/connections.ts) is what
 * makes the code safe to publish, not its obscurity.
 */
export interface RoomListing {
  code: string;
  /** The host seat's display name — already public to anyone holding the code. */
  hostName: string;
  players: number;
  capacity: number;
  status: RoomListingStatus;
  /** Enough for "Casual / Fast / no clock" on a card; not the six-field settings object. */
  timerMode: TimerMode;
}

/** Hard cap on one `room_list` answer. Bounded so enumeration cannot be turned into a scrape,
 * and so a busy server's answer stays one small frame. Well above what a browser screen shows. */
export const MAX_ROOM_LISTINGS = 20;

// ---------------------------------------------------------------------------
// Casual matchmaking queue (docs/MULTIPLAYER.md §3e)
// ---------------------------------------------------------------------------

/**
 * How many players the queued person wants at the table. `'any'` is the default and means
 * "whoever is waiting, 2 to 4" — it is the only preference that can be honoured immediately at
 * any queue size, which is why it is what Quick Match asks for unless the player says otherwise.
 *
 * Deliberately the whole preference model: nothing about skill, region, language or device is
 * representable here, so none of it can quietly become a matching dimension later.
 */
export const QUEUE_TARGETS = [2, 3, 4, 'any'] as const;
export type QueueTarget = (typeof QUEUE_TARGETS)[number];
export const DEFAULT_QUEUE_TARGET: QueueTarget = 'any';

export function isQueueTarget(v: unknown): v is QueueTarget {
  return v === 2 || v === 3 || v === 4 || v === 'any';
}

/**
 * The entire queue state a client is ever told about, and all of it is about the caller:
 *
 * - `idle` — not queued (also the answer to a cancel, however it raced).
 * - `queued` — waiting. `token` is the session key for this entry; the seat the entry eventually
 *   becomes is issued the *same* token, which is what makes a reconnect land on the queue before
 *   a match and on the match after it, with no second recovery path.
 * - `matched` — a room exists and this player has a seat in it. `players` is its size, for the
 *   MATCH FOUND line. The `room_joined`/`game_started` pair follows immediately.
 * - `expired` — waited past the server's queue lifetime without a match.
 *
 * There is deliberately no queue size, no position, no ETA and no list of who else is waiting:
 * the queue is not a lobby, and a stranger's presence is not the caller's business until a room
 * actually exists.
 */
export type QueueStatus = 'idle' | 'queued' | 'matched' | 'expired';

export interface QueueStateMsg {
  v: number;
  type: 'queue_state';
  /** Echoes the request that produced this state, absent when the server pushed it. */
  reqId?: string;
  status: QueueStatus;
  target: QueueTarget;
  /** Present only while `queued`: the reconnect key for this entry. */
  token?: string;
  /** Present only on `matched`: how many players the formed room seats. */
  players?: number;
}

// ---------------------------------------------------------------------------
// Party session (docs/MULTIPLAYER.md §3c)
// ---------------------------------------------------------------------------

/**
 * The public things that can happen in a room. Structured, never prose: the server sends a kind
 * plus the public facts, and the client localizes. That is what keeps a client from authoring a
 * feed line, and what keeps a translation from having to come off the wire.
 */
export const ACTIVITY_KINDS = [
  'joined', 'left', 'ready', 'settings', 'match_started', 'last_card', 'won', 'stalemate', 'reaction',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
  /** Monotonic within the room. Ordering without a clock, and a stable key for the renderer. */
  seq: number;
  kind: ActivityKind;
  /** Public seat reference. Absent for room-level events with no actor. */
  seat?: number;
  /** The actor's display name *when the event happened*, so a line still reads after they leave.
   * A name is already public in every room payload — this copies it, it does not disclose it. */
  name?: string;
  reaction?: ReactionId;
}

/** One finished match, in public terms only. Deliberately no hands, no seed, no revision. */
export interface MatchSummary {
  matchId: string;
  /** 1-based position in this room's own sequence of matches. */
  seq: number;
  /** Winning seat, or null if the winner had already left the room by the time it was recorded. */
  winnerSeat: number | null;
  winnerName: string | null;
  /** True when the draw pile ran out and the fewest-cards rule picked the winner. */
  stalemate: boolean;
  durationSec: number;
}

/** What a room carries across matches beyond its seats. Both lists are bounded on the server. */
export interface PartyState {
  matches: MatchSummary[];
  activity: ActivityEvent[];
}

/** Bounds on the two party collections. Small on purpose: this is a room's short-term memory, not
 * an account history, and an unbounded list would grow with every turn of a long session. */
export const MAX_MATCH_HISTORY = 10;
export const MAX_ACTIVITY = 25;

/** Placeholder for a client that has not been told about a room's party state yet. */
export const EMPTY_PARTY: PartyState = { matches: [], activity: [] };

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
  /** Identifies the match this view belongs to. A rematch in the same room gets a new one, which
   * is how a client tells "the room played again" from "the room re-sent the same match". Opaque
   * and server-chosen; it is not a credential and carries nothing about the deal. */
  matchId: string;
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
  /** Room seat of each player in this match, by player index. A match is dealt into a dense,
   * turn-ordered array while a room seat is a stable chair, so the two only coincide when the
   * occupied seats happen to be 0..n-1 — a lobby that lost a middle seat between matches plays
   * on with a gap. Every other number in this view (`seat`, `activeSeat`, `players[].seat`) is a
   * player index; this is the one place the room's own numbering appears, and it is what lets a
   * client translate the room-seat carried by `turn_timeout`/`player_disconnected`/`winningMove`.
   */
  seats: number[];
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

/** FNV-1a (`src/rules/hash.ts`) over a canonical rendering of the digest input. Detects
 * divergence between two honest peers; it is not a tamper check (the server never trusts a
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
  return fnv1a(canonical);
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
  matchId = '',
  seats: number[] = [],
): GameView {
  const view: GameView = {
    seat,
    matchId,
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
    // Defaults to the identity mapping, which is what a gapless room (and every local/offline
    // caller that builds a view without a room behind it) already has.
    seats: state.players.map((_, i) => seats[i] ?? i),
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

/** "Put me in the casual queue." Carries the display name for the seat it will become and the
 * only preference the matcher honours. Idempotent: a second one from a session that is already
 * queued is answered with its current entry, never a second one. */
interface JoinQueueMsg {
  v: number;
  type: 'join_queue';
  reqId: string;
  target: QueueTarget;
  name: string;
}

/** "Take me out of the queue." Idempotent, and answered with the caller's authoritative queue
 * state rather than with a success flag — a cancel that raced a match is told `matched`. */
interface CancelQueueMsg {
  v: number;
  type: 'cancel_queue';
  reqId: string;
}

/** Host-only, lobby-only: change who can *find* this room. Never changes who may join it. */
interface SetRoomVisibilityMsg {
  v: number;
  type: 'set_room_visibility';
  reqId: string;
  visibility: RoomVisibility;
}

/** "What listed rooms can I join right now?" Carries no filters: the server decides eligibility
 * and the answer is already bounded, so there is nothing for a client to widen. */
interface ListRoomsMsg {
  v: number;
  type: 'list_rooms';
  reqId: string;
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
  | ReactionMsg
  | SetRoomVisibilityMsg
  | ListRoomsMsg
  | JoinQueueMsg
  | CancelQueueMsg;

// ---------------------------------------------------------------------------
// Server -> client messages
// ---------------------------------------------------------------------------

export interface RoomPlayerSummary {
  seat: number;
  name: string;
  /** In a lobby this is "I am ready to play"; in the lobby a finished match recycled into, the
   * same bit *is* the rematch vote. One flag, because they are the same agreement — see
   * docs/MULTIPLAYER.md §3c. Cleared for everyone when a match starts or the settings change. */
  ready: boolean;
  connected: boolean;
  /** Matches this seat has won since it sat down. Room-session only: it is not persisted, not an
   * account stat, and it leaves with the seat (a new player in the same chair starts at 0). */
  wins: number;
}

export interface RoomJoinedMsg {
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
  party: PartyState;
  visibility: RoomVisibility;
}
export interface RoomStateMsg {
  v: number;
  type: 'room_state';
  players: RoomPlayerSummary[];
  settings: RoomSettings;
  hostSeat: number;
  /** True once the match has started — settings are frozen from this point. */
  locked: boolean;
  /** The room's memory across matches: session wins live on `players`, the rest lives here. */
  party: PartyState;
  /** Server-owned. A client renders this and may propose a change; it never applies one. */
  visibility: RoomVisibility;
}

/** Answer to `list_rooms`. Bounded by MAX_ROOM_LISTINGS and built from the listing projection
 * only — a full room snapshot is never sent for a room the caller has not joined. */
export interface RoomListMsg {
  v: number;
  type: 'room_list';
  reqId: string;
  rooms: RoomListing[];
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
  code: ServerErrorCode;
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
  | PlayerReactionMsg
  | RoomListMsg
  | QueueStateMsg;

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

/**
 * A parse failure carries a `code` only when the failure has a cause the *player* can act on.
 * A version mismatch does: the client is older or newer than this server, which is what a stale
 * PWA cache looks like from the wire, and "reload to update" is a useful thing to say. Every
 * other refusal is a developer detail and stays a generic `bad_message`.
 */
export function parseClientMessage(raw: string): ClientMessage | { error: string; code?: ServerErrorCode } {
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
  if (o.v !== PROTOCOL_VERSION) return { error: 'unsupported protocol version', code: 'unsupported_version' };
  if (!isStr(o.type, 32)) return { error: 'missing type' };
  if (!isStr(o.reqId)) return { error: 'missing reqId' };
  const reqId = o.reqId;

  switch (o.type) {
    case 'create_room': {
      if (!isStr(o.name)) return { error: 'bad name' };
      return { v: PROTOCOL_VERSION, type: 'create_room', reqId, name: o.name };
    }
    case 'join_room': {
      // Real codes are ROOM_CODE_LENGTH chars; the wire cap is deliberately looser (a probe is
      // rejected here, an almost-right code is refused by the room manager with `room_not_found`,
      // which is the honest answer to give a typo).
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
    case 'set_room_visibility': {
      if (!isRoomVisibility(o.visibility)) return { error: 'bad visibility' };
      return { v: PROTOCOL_VERSION, type: 'set_room_visibility', reqId, visibility: o.visibility };
    }
    case 'join_queue': {
      // An unrecognized target is refused rather than coerced to the default: a client that
      // asked for something this server does not do must not be quietly given a different table.
      if (!isQueueTarget(o.target) || !isStr(o.name)) return { error: 'bad join_queue payload' };
      return { v: PROTOCOL_VERSION, type: 'join_queue', reqId, target: o.target, name: o.name };
    }
    case 'cancel_queue':
      return { v: PROTOCOL_VERSION, type: 'cancel_queue', reqId };
    case 'list_rooms':
      // No filters on the wire: an oversized or hostile filter payload is not rejected, it is
      // simply not representable.
      return { v: PROTOCOL_VERSION, type: 'list_rooms', reqId };
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
