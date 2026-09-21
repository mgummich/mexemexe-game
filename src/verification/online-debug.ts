import { readRecentRooms, type NetClient } from '../net/client';
import type { LobbyMachine } from '../net/lobby';
import type { OnlineSession } from '../net/online-session';
import { DEFAULT_QUEUE_TARGET, DEFAULT_ROOM_VISIBILITY, EMPTY_PARTY, type QueueTarget } from '../net/protocol';
import type { LobbyBox, MexeOnlineDebugApi, RenderedSeatRow } from './debug-api';

/**
 * The `window.__MEXE__.online` surface, built *here* from the objects the product already owns
 * (ARCH-011).
 *
 * The point of the split: a scene used to assemble ~30 closures reaching into its own private
 * fields, which made the debug contract invisible at the call sites that had to maintain it and
 * gave the test surface its own pointers into live scene state. Now the scene hands over its
 * owners — the lobby machine or the online session, plus the socket — and this module reads them.
 * The handful of callbacks each factory still takes are *product* actions and rendered text, not
 * test-only behaviour: nothing in the product exists solely to feed this file.
 *
 * Privacy is unchanged and is not this module's to weaken: `OnlineSession.state()` is the redacted
 * projection (opponent hands are placeholders), and no reconnect token is reachable from here.
 */

/** Rendered facts only a live scene can answer, for the mid-match surface. */
export interface MatchDebugView {
  /** The in-match connection notice exactly as painted, or '' when none is showing. */
  notice: () => string;
  /** Ms left on the active seat's turn as the last state_sync anchored it. */
  turnMsLeft: () => number | null;
  /** The product's own draw-and-end-turn action — the same one COMPRAR triggers. */
  comprar: () => void;
}

/** Product actions and rendered facts the lobby surface needs from the scene that owns the screen. */
export interface LobbyDebugView {
  displayName: () => string;
  /** Through the scene's own join path, not straight at the socket: a verification join has to be
   * the same join a card tap is, refusal handling included. */
  join: (code: string, name?: string) => void;
  startQueue: () => void;
  cancelQueue: () => void;
  openCustomSettings: () => void;
  /** Open a sub-screen the way its link does; the machine refuses it off the lobby. */
  openParty: () => void;
  openBrowse: () => void;
  /** Where the keyboard focus ring is — canvas UI has no DOM focus to query. */
  focus: () => { index: number; count: number; label: string };
  /** The seat rows the lobby actually PAINTED on the last rebuild, in row order. */
  lobbySeats: () => RenderedSeatRow[];
  /** The lobby's painted vertical blocks, top to bottom. */
  lobbyBoxes: () => LobbyBox[];
}

/** The surface for a running online match: the session is the state, the client is the transport. */
export function matchDebugSurface(
  session: OnlineSession,
  client: NetClient,
  scene: MatchDebugView,
): MexeOnlineDebugApi {
  const noop = (): void => { /* not applicable mid-match — see the lobby surface below */ };
  return {
    status: () => client.getStatus(),
    code: () => session.code,
    seat: () => session.seat,
    localSeat: () => session.localSeat,
    rev: () => session.lastRev,
    players: () => [],
    notice: scene.notice,
    // No lobby error screen exists mid-match — a refusal here surfaces as the notice above.
    errorText: () => '',
    lastRejections: () => [...session.lastRejections],
    trace: () => client.trace,
    statusTrace: () => client.statusTrace,
    createRoom: noop,
    joinRoom: noop,
    setReady: noop,
    startGame: noop,
    // Fairness settings are frozen once the match starts.
    setRoomSettings: noop,
    roomSettings: () => session.settings,
    // The party state rides on room_state, which a match does not receive — the client's latched
    // copy from the lobby is the right answer here, not a stale empty one.
    party: () => client.lastRoomState?.party ?? EMPTY_PARTY,
    matchId: () => session.matchId,
    // The lobby owns the history and settings screens; there is none mid-match.
    openParty: noop,
    openCustomSettings: noop,
    turnMsLeft: scene.turnMsLeft,
    speed: () => ({
      clocksMs: [...session.clocksMs],
      panicLeft: [...session.panicLeft],
      freezeLeft: [...session.freezeLeft],
      debtMs: [...session.debtMs],
    }),
    usePanic: () => client.usePanic(),
    phase: () => 'match',
    focus: () => ({ index: -1, count: 0, label: '' }),
    // Discovery belongs to the lobby: a running match is neither listed nor browsable, and its
    // visibility is frozen with the rest of the room's terms.
    visibility: () => client.lastRoomState?.visibility ?? DEFAULT_ROOM_VISIBILITY,
    setVisibility: noop,
    openBrowse: noop,
    // Matchmaking ends at the handoff: a seated player is refused by the server anyway (OM-04),
    // so the mid-match surface does not offer a way to ask.
    joinQueue: noop,
    cancelQueue: noop,
    queue: () => ({ status: 'idle', target: DEFAULT_QUEUE_TARGET }),
    listings: () => [],
    browseNotice: () => null,
    recentRooms: () => readRecentRooms().map((r) => ({ code: r.code, host: r.host })),
    comprar: scene.comprar,
    /** Submit a raw (possibly illegal) proposal straight to the server, bypassing the editor's
     * client-side gate — the UI itself never constructs an illegal draft, so this is the only way
     * for `verify:multiplayer` to exercise server-side rejection. */
    submitRaw: (rev, melds) => client.submitTurn(rev, melds),
    forceDrop: () => client.forceDrop(),
    desyncs: () => session.desyncs,
    requestResync: () => client.requestResync(),
  };
}

/** The surface for the lobby: every reader is the machine's state, every action a product path. */
export function lobbyDebugSurface(
  lobby: LobbyMachine,
  client: NetClient,
  scene: LobbyDebugView,
): MexeOnlineDebugApi {
  const noop = (): void => { /* not applicable in the lobby — see the match surface above */ };
  return {
    status: () => client.getStatus(),
    code: () => lobby.code,
    seat: () => lobby.seat,
    rev: () => null,
    players: () => lobby.players,
    notice: () => '',
    errorText: () => lobby.errorMsg ?? '',
    lastRejections: () => [],
    trace: () => client.trace,
    statusTrace: () => client.statusTrace,
    createRoom: (name) => client.createRoom(name ?? scene.displayName()),
    joinRoom: (code, name) => scene.join(code, name),
    displayName: scene.displayName,
    react: (reaction) => client.sendReaction(reaction),
    setReady: (ready) => client.setReady(ready),
    startGame: () => client.startGame(),
    speed: () => ({ clocksMs: [], panicLeft: [], freezeLeft: [], debtMs: [] }),
    usePanic: noop,
    setRoomSettings: (s) => client.setRoomSettings(s),
    roomSettings: () => lobby.roomSettings,
    party: () => lobby.party,
    matchId: () => null,
    openParty: scene.openParty,
    openCustomSettings: scene.openCustomSettings,
    turnMsLeft: () => null,
    phase: () => lobby.phase,
    focus: scene.focus,
    visibility: () => lobby.visibility,
    setVisibility: (v) => client.setVisibility(v),
    joinQueue: (target: QueueTarget) => {
      lobby.queueRequested(target);
      scene.startQueue();
    },
    cancelQueue: scene.cancelQueue,
    queue: () => ({
      status: lobby.phase === 'queue' ? 'queued' : lobby.phase === 'matched' ? 'matched' : 'idle',
      target: lobby.queueTarget,
    }),
    openBrowse: scene.openBrowse,
    listings: () => lobby.listings,
    browseNotice: () => lobby.browseNotice,
    leaveRoom: () => client.leaveRoom(),
    recentRooms: () => readRecentRooms().map((r) => ({ code: r.code, host: r.host })),
    lobbySeats: scene.lobbySeats,
    lobbyBoxes: scene.lobbyBoxes,
    lobbyNotice: () => lobby.lobbyNotice,
    comprar: noop,
    submitRaw: noop,
    forceDrop: () => client.forceDrop(),
    desyncs: () => 0,
    requestResync: () => client.requestResync(),
  };
}
