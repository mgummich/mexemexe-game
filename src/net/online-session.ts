import { GameStore } from '../game-state/store';
import type { GameState, ReasonCode } from '../rules/types';
import { digestOfState, stateHash, type GameView, type RoomSettings } from './protocol';
import { viewProjectionProblem, viewToState } from './viewToState';

/**
 * What one `state_sync` did to this session. The caller renders it and performs the effects it
 * names; every decision — is this frame stale, is this client out of sync, did the local draft
 * just die, was the Mexe bonus granted — is made here, not in a scene (ARCH-002).
 */
export type SyncResult =
  /** Out-of-order or duplicate delivery: older than the revision already applied. Nothing changed. */
  | { kind: 'stale' }
  /**
   * The view was applied, but the state rebuilt from it does not hash to what the server says it
   * should. This client can no longer be trusted to render or propose: lock input, say so, and ask
   * for a fresh snapshot. A second consecutive mismatch is accepted rather than looped on.
   */
  | { kind: 'desync'; rev: number; localHash: string; serverHash: string }
  /**
   * The frame could not be projected at all (`viewProjectionProblem`), so nothing was applied and
   * the previous state still stands. Same remedy as a desync — lock input and pull a fresh
   * snapshot — but a different cause: a malformed frame rather than two honest peers disagreeing.
   */
  | { kind: 'invalid'; rev: number; problem: string }
  | {
      kind: 'applied';
      /** Dense player index of the seat whose turn produced this frame. */
      actingSeat: number;
      /** A draft with real edits in it was discarded by this frame — the player lost work. */
      draftDropped: boolean;
      /** Set on the false->true edge of the once-per-turn Mexe time extension; ms granted. */
      mexeBonusMs: number | null;
      /** Server's remaining turn time, or null in a room with no timer. Anchor it to a local clock
       * at the call site — this module holds no wall clock. */
      turnMsLeft: number | null;
      /** The match is still in progress, so the caller should start the next turn's UI. */
      playing: boolean;
    };

/** What a server refusal of this client's proposal means for the session. */
export interface RejectionResult {
  /** The refusal was about a revision this client has already fallen behind — pull the truth. */
  requestResync: boolean;
}

/** What a `turn_timeout` for `seat` means. Pure policy over the last synced frame. */
export interface TimeoutResult {
  /** Dense player index that timed out. */
  seat: number;
  /** The timeout is the one that pushes the seat over the room's missed-turn limit, so the
   * `room_closed` that follows is a match ending, not a generic room reap (ONLINE-14). */
  endsMatch: boolean;
  /** Misses so far and how many remain, for the warning line. Null when `endsMatch`, or when the
   * room has no missed-turn limit. */
  warning: { missed: number; left: number } | null;
}

/**
 * The online client's application layer: the server's redacted view projected into local state,
 * plus every policy that decides what to do with a frame.
 *
 * It owns no socket (the `NetClient` is transport), no Phaser and no clock, so a recorded sequence
 * of server frames can be driven through it in a unit test. It never *decides* gameplay: the
 * server is the authority and this is its projection (`viewToState`), kept honest by the state
 * digest.
 *
 * One instance per online match. Everything a match must not inherit from the previous one lives
 * here, so the next match is a new instance rather than a list of fields to clear (ARCH-018).
 */
export class OnlineSession {
  /** This client's ROOM seat — the stable chair, used for the handoff back into the lobby.
   * Not a player index: see `seats` and `localSeat`. */
  readonly seat: number;
  readonly code: string;
  /** The match this session renders. A rematch mints a new one and arrives as a new session. */
  readonly matchId: string;
  /** Room seat per dense player index, from the last view. */
  seats: readonly number[];
  lastRev: number;
  settings: RoomSettings;
  /** Last view's `missedTurns` per dense seat — sizes the timeout warning. */
  missedTurns: readonly number[];
  /** Last view's Time Attack clocks per dense seat, empty in every other mode. */
  clocksMs: readonly number[];
  /** Last view's Panic Buttons left per dense seat, empty when the room grants none. */
  panicLeft: readonly number[];
  /** Last view's Freezes left per dense seat, empty when the room grants none. */
  freezeLeft: readonly number[];
  /** Last view's borrowed time per dense seat, empty when Time Debt is off. */
  debtMs: readonly number[];
  /** Count of detected state-hash mismatches this match — surfaced to `verify:multiplayer`. */
  desyncs = 0;
  /** Reasons the server gave for refusing this client's last proposal. Empty until one is. */
  lastRejections: readonly ReasonCode[] = [];
  /** A requested resync is outstanding: input stays locked and the overlay shows. */
  resyncing = false;
  /** This client's dense player index. Differs from `seat` whenever the room has a seat gap. */
  localSeat: number;
  private store: GameStore;
  private mexeBonusClaimed: boolean;
  /** True once this session has accounted for its match ending — either by the final frame or by
   * discovering, after a drop, that it already ended. What stops a second room frame from
   * reporting the same missed finish twice. */
  private finished = false;

  constructor(start: { view: GameView; seat: number; code: string }) {
    this.seat = start.seat;
    this.code = start.code;
    this.matchId = start.view.matchId;
    this.seats = start.view.seats;
    this.lastRev = start.view.rev;
    this.settings = start.view.settings;
    this.missedTurns = start.view.missedTurns;
    this.clocksMs = start.view.clocksMs;
    this.panicLeft = start.view.panicLeft;
    this.freezeLeft = start.view.freezeLeft;
    this.debtMs = start.view.debtMs;
    this.mexeBonusClaimed = start.view.mexeBonusClaimed;
    this.localSeat = start.view.seat;
    this.store = new GameStore(viewToState(start.view));
  }

  /** The local reconstruction of the server's view. Read-only by type; this client never commits. */
  state(): GameState {
    return this.store.get();
  }

  /** Room seat -> dense player index. Falls back to the identity mapping, which is what a room
   * with no seat gap has anyway. */
  playerIndexOf(roomSeat: number): number {
    const i = this.seats.indexOf(roomSeat);
    return i === -1 ? roomSeat : i;
  }

  /**
   * Adopt an authoritative frame. `hadDraft` is the caller's answer to "did the player have real
   * edits in flight" — the one thing the session cannot see, because the draft is the editor's.
   */
  applySync(view: GameView, hadDraft: boolean): SyncResult {
    // Match identity first, because the revision comparison below is only sound inside one match:
    // `rev` restarts at 1 on every deal, so a frame belonging to another match would read as
    // either stale (silently dropped, board frozen) or fresh (another match's board applied as
    // this one's). No delivery path is known to produce one — one socket per client, ordered, and
    // the server never re-sends a finished match's frames — so this refuses rather than repairs.
    if (view.matchId !== this.matchId) {
      return { kind: 'invalid', rev: view.rev, problem: `frame from match ${view.matchId}, session is ${this.matchId}` };
    }
    if (view.rev < this.lastRev) return { kind: 'stale' };
    // Checked before anything is written, so a frame this client cannot represent leaves the last
    // good state — and `lastRev` — untouched instead of half-applied.
    const problem = viewProjectionProblem(view);
    if (problem !== null) return { kind: 'invalid', rev: view.rev, problem };
    const actingSeat = this.store.get().activePlayerIndex;
    this.lastRev = view.rev;
    this.store = new GameStore(viewToState(view));
    this.settings = view.settings;
    this.seats = view.seats;
    this.missedTurns = view.missedTurns;
    this.clocksMs = view.clocksMs;
    this.panicLeft = view.panicLeft;
    this.freezeLeft = view.freezeLeft;
    this.debtMs = view.debtMs;
    const bonusJustClaimed = view.mexeBonusClaimed && !this.mexeBonusClaimed;
    this.mexeBonusClaimed = view.mexeBonusClaimed;

    const localHash = stateHash(digestOfState(this.store.get(), view.rev));
    if (localHash !== view.hash) {
      this.desyncs++;
      // Already asked once for this snapshot — take it and move on rather than loop.
      if (!this.resyncing) {
        this.resyncing = true;
        return { kind: 'desync', rev: view.rev, localHash, serverHash: view.hash };
      }
    }
    this.resyncing = false;
    return {
      kind: 'applied',
      actingSeat,
      // A dropped draft takes priority over the bonus notice — it is the rarer, more disruptive
      // event for the player who just lost work (ONLINE-09).
      draftDropped: hadDraft,
      mexeBonusMs: !hadDraft && bonusJustClaimed ? view.settings.mexeBonusMs : null,
      turnMsLeft: view.turnMsLeft,
      playing: this.store.get().phase === 'playing',
    };
  }

  /** The final frame of the match. Replaces the projection so the results can be read off it. */
  applyGameOver(view: GameView): GameState {
    this.finished = true;
    this.store = new GameStore(viewToState(view));
    return this.store.get();
  }

  /**
   * A `room_state` frame arrived while this session is the one being rendered. `locked` is false
   * only for a room with no match running, so an unlocked room this session never saw finish means
   * the match ended while this client's socket was down (a drop over the finish, inside the
   * reconnect grace): the room is already a rematch lobby and this board is dead. Reported once —
   * the reconnect answer broadcasts room state more than once, and one handoff is enough.
   */
  roomState(locked: boolean): { missedFinish: boolean } {
    const missedFinish = !locked && !this.finished;
    if (missedFinish) this.finished = true;
    return { missedFinish };
  }

  /** The server refused this client's proposal. */
  rejection(reasons: readonly ReasonCode[]): RejectionResult {
    this.lastRejections = reasons;
    // A stale revision means this client acted on a state the server has already moved past — the
    // local view is behind, so pull the authoritative one rather than letting the player retry
    // against stale cards.
    return { requestResync: reasons.includes('reason.staleRevision') };
  }

  /**
   * A seat ran out of turn time. A room that closes on `missedTurnLimit` never gets the state_sync
   * that would move play off `seat` (the server skips the broadcast once the room closed), so a
   * seat still active here is the one this timeout pushed over the limit (ONLINE-14).
   */
  timeout(roomSeat: number): TimeoutResult {
    const seat = this.playerIndexOf(roomSeat);
    const limit = this.settings.missedTurnLimit;
    const endsMatch = limit > 0 && this.store.get().activePlayerIndex === seat;
    const missed = this.missedTurns[seat] ?? 0;
    return {
      seat,
      endsMatch,
      warning: limit > 0 && !endsMatch ? { missed, left: Math.max(0, limit - missed) } : null,
    };
  }
}
