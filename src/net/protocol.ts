/**
 * Shared wire protocol for online play. Pure module: no browser APIs, no
 * Node APIs — safe to import from both the client bundle and the server.
 * See docs/MULTIPLAYER_ARCHITECTURE.md for the design this implements.
 */
import type { Card, GameState, Meld, ReasonCode, RulesConfig } from '../rules/types';

export const PROTOCOL_VERSION = 3;

// ---------------------------------------------------------------------------
// Redacted view (docs/MULTIPLAYER_ARCHITECTURE.md §2)
// ---------------------------------------------------------------------------

/** One seat's entry in a GameView. `hand` is present only for the viewing seat. */
export interface PlayerView {
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
  /** Digest of the parts of the authoritative state every seat can see. A client recomputes it
   * from its own reconstruction and asks for a resync on mismatch (docs/PHASE7_AUDIT.md #3). */
  hash: string;
}

/** The seat-independent slice of a game that both sides can hash. Deliberately excludes card
 * identities in hands and the draw pile — those differ per view, so they cannot be compared. */
export interface StateDigestInput {
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
export function buildView(state: GameState, seat: number, rev: number): GameView {
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
    hash: '',
  };
  view.hash = stateHash(digestOfView(view));
  return view;
}

// ---------------------------------------------------------------------------
// Client -> server messages
// ---------------------------------------------------------------------------

export interface CreateRoomMsg {
  v: number;
  type: 'create_room';
  reqId: string;
  name: string;
}
export interface JoinRoomMsg {
  v: number;
  type: 'join_room';
  reqId: string;
  code: string;
  name: string;
}
export interface LeaveRoomMsg {
  v: number;
  type: 'leave_room';
  reqId: string;
}
export interface ReadyMsg {
  v: number;
  type: 'ready';
  reqId: string;
  ready: boolean;
}
/** Host-only explicit lobby start. Keeps 3P/4P lobbies open until all invited seats are ready. */
export interface StartGameMsg {
  v: number;
  type: 'start_game';
  reqId: string;
}
export interface SubmitTurnMeld {
  id: string;
  cardIds: string[];
}
export interface SubmitTurnMsg {
  v: number;
  type: 'submit_turn';
  reqId: string;
  rev: number;
  melds: SubmitTurnMeld[];
}
export interface DrawEndTurnMsg {
  v: number;
  type: 'draw_end_turn';
  reqId: string;
  rev: number;
}
export interface ReconnectMsg {
  v: number;
  type: 'reconnect';
  reqId: string;
  token: string;
}
export interface PingMsg {
  v: number;
  type: 'ping';
  reqId: string;
}
/** Client-initiated recovery: "I believe my state is wrong, send me the authoritative one."
 * Carries no state — the server never reconciles towards a client, it only re-sends. */
export interface ResyncMsg {
  v: number;
  type: 'resync';
  reqId: string;
}

export type ClientMessage =
  | CreateRoomMsg
  | JoinRoomMsg
  | LeaveRoomMsg
  | ReadyMsg
  | StartGameMsg
  | SubmitTurnMsg
  | DrawEndTurnMsg
  | ReconnectMsg
  | PingMsg
  | ResyncMsg;

// ---------------------------------------------------------------------------
// Server -> client messages
// ---------------------------------------------------------------------------

export interface RoomPlayerSummary {
  seat: number;
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface RoomJoinedMsg {
  v: number;
  type: 'room_joined';
  code: string;
  seat: number;
  token: string;
  players: RoomPlayerSummary[];
}
export interface RoomStateMsg {
  v: number;
  type: 'room_state';
  players: RoomPlayerSummary[];
}
/** Match start. Deliberately carries no shuffle seed: the seed reproduces both hands and the
 * whole draw pile through the shared deal functions, so it must never leave the server. */
export interface GameStartedMsg {
  v: number;
  type: 'game_started';
  view: GameView;
}
export interface StateSyncMsg {
  v: number;
  type: 'state_sync';
  view: GameView;
}
export interface ProposalRejectedMsg {
  v: number;
  type: 'proposal_rejected';
  reqId: string;
  reasons: ReasonCode[];
}
export interface PlayerDisconnectedMsg {
  v: number;
  type: 'player_disconnected';
  seat: number;
}
export interface PlayerReconnectedMsg {
  v: number;
  type: 'player_reconnected';
  seat: number;
}
export interface GameOverMsg {
  v: number;
  type: 'game_over';
  winnerId: string | null;
  stalemate: boolean;
  view: GameView;
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
export interface PongMsg {
  v: number;
  type: 'pong';
}

export type ServerMessage =
  | RoomJoinedMsg
  | RoomStateMsg
  | GameStartedMsg
  | StateSyncMsg
  | ProposalRejectedMsg
  | PlayerDisconnectedMsg
  | PlayerReconnectedMsg
  | GameOverMsg
  | ErrorMsg
  | PongMsg;

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
    default:
      return { error: 'unknown type' };
  }
}
