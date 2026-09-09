/**
 * Thin WebSocket client for online play. Never throws into the game: every
 * socket failure surfaces as a status change plus an optional message, never
 * an exception the caller has to catch. See docs/PHASE5_CLIENT_PLAN.md.
 */
import { playlog } from '../core/playlog';
import { resolveWsUrl } from '../config';
import { PROTOCOL_VERSION } from './protocol';
import type { ClientMessage, ServerMessage, SubmitTurnMeld } from './protocol';

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'reconnecting';

const TOKEN_KEY = 'mexe.online.token';
const PING_INTERVAL_MS = 20_000;
const TRACE_CAP = 80;
/** C1: single bounded retry — one reconnect attempt this long after an unexpected close. */
const RECONNECT_DELAY_MS = 800;

type ServerListener = (msg: ServerMessage) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  private reqCounter = 0;
  private status: ConnStatus = 'closed';
  private lastStatusMessage: string | undefined;
  private statusListeners = new Set<(s: ConnStatus, message?: string) => void>();
  private listeners = new Map<string, Set<ServerListener>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Set by disconnect()/leaveRoom() so onclose knows not to retry a deliberate close. */
  private explicitClose = false;
  /** Bounds the retry to one attempt per unexpected close — cleared again on a successful open. */
  private reconnectAttempted = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Bounded trace of every message sent/received, newest last — for e2e/debug-api. */
  trace: { dir: 'out' | 'in'; type: string }[] = [];

  getStatus(): ConnStatus {
    return this.status;
  }

  onStatus(cb: (s: ConnStatus, message?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** Register for one server message type. Returns an unsubscribe function. */
  on<K extends ServerMessage['type']>(
    type: K,
    cb: (msg: Extract<ServerMessage, { type: K }>) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const listener = cb as ServerListener;
    set.add(listener);
    return () => set!.delete(listener);
  }

  /** @param isRetry internal — true when this call is the single bounded reconnect attempt (C1),
   * so it keeps the 'reconnecting' status instead of flashing back to 'connecting'. */
  connect(isRetry = false): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.explicitClose = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!isRetry) this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(resolveWsUrl());
    } catch (err) {
      this.setStatus('error', String(err));
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (isRetry) playlog.record('net:reconnect');
      this.reconnectAttempted = false;
      this.setStatus('open');
      this.startPing();
      const token = sessionStorage.getItem(TOKEN_KEY);
      if (token) this.sendRaw({ v: PROTOCOL_VERSION, type: 'reconnect', reqId: this.nextReqId(), token });
    };
    ws.onclose = () => {
      // Only a socket that actually opened counts as a disconnect — a refused connection is a
      // never-reachable server (handled below), and counting it would inflate the drop metric.
      if (this.status !== 'connecting') playlog.record('net:disconnect');
      this.stopPing();
      // Never got past 'connecting': the socket never opened at all (server not running/refused),
      // not a mid-session drop. Distinct terminal status so the scene can show dedicated copy
      // instead of the generic dropped-connection message.
      if (this.status === 'connecting') {
        this.setStatus('error', 'unreachable');
        return;
      }
      const token = sessionStorage.getItem(TOKEN_KEY);
      if (!this.explicitClose && token && !this.reconnectAttempted) {
        this.reconnectAttempted = true;
        this.setStatus('reconnecting');
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect(true);
        }, RECONNECT_DELAY_MS);
        return;
      }
      this.setStatus('closed');
    };
    ws.onerror = () => {
      // No status change here — onclose fires right after and owns the retry-vs-terminal
      // decision. Setting 'error' here first would race a still-pending reconnect.
      this.lastStatusMessage = 'connection error';
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return; // malformed frame from the server — ignore, never throw
      }
      this.pushTrace('in', msg.type);
      if (msg.type === 'room_joined') sessionStorage.setItem(TOKEN_KEY, msg.token);
      if (msg.type === 'proposal_rejected') playlog.record('net:reject', { reason: msg.reasons[0] ?? '' });
      const set = this.listeners.get(msg.type);
      if (set) for (const cb of set) cb(msg);
    };
  }

  /** Explicit exit from the online flow: tells the server, drops the reconnect token, closes the socket. */
  leaveRoom(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'leave_room', reqId: this.nextReqId() });
    sessionStorage.removeItem(TOKEN_KEY);
    this.disconnect();
  }

  /** Verification-only: closes the underlying socket as if the network died — unlike disconnect()/
   * leaveRoom() this leaves explicitClose false and the reconnect token in place, so onclose runs
   * the normal C1 single-retry reconnect path. Used by verify:multiplayer to exercise reconnect. */
  forceDrop(): void {
    this.ws?.close();
  }

  /** Closes the socket without touching the reconnect token — used when the scene just tears down. */
  disconnect(): void {
    this.explicitClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore — socket may already be closing
      }
      this.ws = null;
    }
    this.setStatus('closed');
  }

  createRoom(name: string): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'create_room', reqId: this.nextReqId(), name });
  }

  joinRoom(code: string, name: string): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'join_room', reqId: this.nextReqId(), code, name });
  }

  setReady(ready: boolean): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'ready', reqId: this.nextReqId(), ready });
  }

  startGame(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'start_game', reqId: this.nextReqId() });
  }

  /** Returns the reqId used, so a caller could correlate a later rejection if it ever needs to. */
  submitTurn(rev: number, melds: SubmitTurnMeld[]): string {
    const reqId = this.nextReqId();
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'submit_turn', reqId, rev, melds });
    return reqId;
  }

  drawEndTurn(rev: number): string {
    const reqId = this.nextReqId();
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'draw_end_turn', reqId, rev });
    return reqId;
  }

  /** Ask the server to re-send authoritative state. Used when the local reconstruction's hash
   * disagrees with the server's, or after a stale-revision rejection. */
  requestResync(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'resync', reqId: this.nextReqId() });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.sendRaw({ v: PROTOCOL_VERSION, type: 'ping', reqId: this.nextReqId() });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private nextReqId(): string {
    return `r${++this.reqCounter}`;
  }

  private sendRaw(msg: ClientMessage): void {
    this.pushTrace('out', msg.type);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      this.setStatus('error', String(err));
    }
  }

  private pushTrace(dir: 'out' | 'in', type: string): void {
    this.trace.push({ dir, type });
    if (this.trace.length > TRACE_CAP) this.trace.shift();
  }

  private setStatus(s: ConnStatus, message?: string): void {
    this.status = s;
    this.lastStatusMessage = message;
    for (const cb of this.statusListeners) cb(s, message);
  }

  getLastStatusMessage(): string | undefined {
    return this.lastStatusMessage;
  }
}
