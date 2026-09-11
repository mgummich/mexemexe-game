/**
 * MEXEMEXE! online alpha WebSocket server. Plain Node + `ws`, run via `tsx`.
 * See docs/MULTIPLAYER.md for protocol and validation order.
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_ROOM_SETTINGS, parseClientMessage, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { RoomManager, HOST_SEAT } from './rooms';
import { config } from './config';
import { createLogger } from './log';
import {
  attachSocket as attach,
  closeRoomSockets,
  detachSocket as detach,
  evictSeat,
  hitFlood,
  hitJoinLimit,
  moveSocket,
  newConnState,
  type ConnState,
} from './connections';

const log = createLogger(config.logLevel);

const SWEEP_INTERVAL_MS = 30_000;
/** Liveness probe. A half-open socket (lid closed, dead NAT entry) otherwise holds its seat
 * `connected` until TCP gives up, so the disconnect grace never starts (docs/archive/PHASE7_AUDIT.md #1). */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** How often the server checks its own turn clocks and stalled matches. One second, because it
 * is now also the resolution of the turn timer: a coarser tick would let a turn run measurably
 * past its budget. The check itself is a per-room arithmetic comparison, not a per-room timer,
 * so nothing to leak when a room is deleted — the room's deadline goes with it. */
const TURN_TICK_MS = 1_000;
/** Largest inbound frame accepted. The biggest legal message is a submit_turn with the whole
 * deck as card ids; 16 KiB is far above that and far below anything that hurts (#2). */
const MAX_PAYLOAD_BYTES = 16 * 1024;
/** Hard-exit if graceful shutdown hasn't finished by this deadline (a stuck close handler
 * must never keep the process alive forever). */
const SHUTDOWN_TIMEOUT_MS = 5_000;

// Deterministic deal for verify:multiplayer only — never set in a real deployment
// (config.ts refuses to start with this set in production mode).
const testSeed = config.testSeed;
const rooms = new RoomManager({
  maxRooms: config.maxRooms,
  disconnectGraceMs: config.disconnectGraceMs,
  idleTimeoutMs: config.idleTimeoutMs,
  ...(testSeed === undefined ? {} : { genSeed: () => testSeed }),
});

const connections = new Map<WebSocket, ConnState>();
const connectionsByIp = new Map<string, number>();
// code -> seat -> socket, for broadcast/targeted send
const sockets = new Map<string, Map<number, WebSocket>>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    log.error('send_failed', { message: String(err) });
  }
}

function sendError(ws: WebSocket, code: string, message: string, reqId?: string): void {
  send(ws, { v: PROTOCOL_VERSION, type: 'error', code, message, ...(reqId === undefined ? {} : { reqId }) });
}

function attachSocket(code: string, seat: number, ws: WebSocket): void {
  attach(sockets, code, seat, ws);
}

function detachSocket(code: string, seat: number, ws: WebSocket): void {
  detach(sockets, code, seat, ws);
}

/** Notify every socket still attached to a dead/abandoned room, then drop them (S1/S2). */
function closeRoom(code: string, message: string): void {
  const msg: ServerMessage = { v: PROTOCOL_VERSION, type: 'error', code: 'room_closed', message };
  closeRoomSockets(sockets, connections, code, msg);
  // Room codes are shared secrets that let anyone join — log only their length (docs above).
  log.debug('room_closed', { codeLength: code.length });
}

function broadcastStateSync(code: string): void {
  const bySeat = sockets.get(code);
  if (!bySeat) return;
  for (const [seat, ws] of bySeat) {
    const view = rooms.getView(code, seat);
    if (view) send(ws, { v: PROTOCOL_VERSION, type: 'state_sync', view });
  }
}

function broadcastGameOver(code: string): void {
  const bySeat = sockets.get(code);
  const room = rooms.getRoom(code);
  if (!bySeat || !room?.state) return;
  // Draw-pile exhaustion ends the game without anyone emptying their hand — that's the only
  // "stalemate" ending now that consecutiveDraws is gone (see rules.ts drawAndEndTurn).
  const stalemate = !room.state.players.some((p) => p.hand.length === 0);
  for (const [seat, ws] of bySeat) {
    const view = rooms.getView(code, seat);
    if (view) {
      send(ws, {
        v: PROTOCOL_VERSION,
        type: 'game_over',
        winnerId: room.state.winnerId,
        stalemate,
        view,
      });
    }
  }
}

/** A finished match needs no room: free the slot and detach every socket right after the
 * game_over broadcast, with an explicit close notice, instead of leaving the room pinned
 * until its players leave or the idle sweep reaps it (#6). */
function closeFinishedRoom(code: string): void {
  rooms.deleteRoom(code);
  closeRoomSockets(sockets, connections, code, {
    v: PROTOCOL_VERSION,
    type: 'error',
    code: 'room_closed',
    message: 'match finished',
  } satisfies ServerMessage);
}

function broadcastRoomState(code: string): void {
  const bySeat = sockets.get(code);
  const info = rooms.getRoomInfo(code);
  if (!bySeat || !info) return;
  for (const ws of bySeat.values()) {
    send(ws, {
      v: PROTOCOL_VERSION, type: 'room_state',
      players: info.players, settings: info.settings, hostSeat: HOST_SEAT, locked: info.locked,
    });
  }
}

/** The room_joined payload, built from the room manager rather than from the caller's own
 * snapshot — create, join and reconnect all need the same four fields plus the settings. */
function roomJoined(code: string, seat: number, token: string): ServerMessage {
  const info = rooms.getRoomInfo(code);
  return {
    v: PROTOCOL_VERSION, type: 'room_joined', code, seat, token,
    players: info?.players ?? [],
    settings: info?.settings ?? DEFAULT_ROOM_SETTINGS,
    hostSeat: HOST_SEAT,
  };
}

function handleMessage(ws: WebSocket, conn: ConnState, msg: ClientMessage): void {
  switch (msg.type) {
    case 'create_room': {
      if (conn.code !== null) {
        sendError(ws, 'already_in_room', 'leave current room before creating another', msg.reqId);
        return;
      }
      const result = rooms.createRoom(msg.name);
      if (!result.ok) {
        sendError(ws, result.error, 'server has reached its room limit, try again later', msg.reqId);
        return;
      }
      const { code, seat, token } = result;
      conn.code = code;
      conn.seat = seat;
      attachSocket(code, seat, ws);
      log.debug('room_created', { codeLength: code.length });
      send(ws, roomJoined(code, seat, token));
      return;
    }
    case 'join_room': {
      if (conn.code !== null) {
        sendError(ws, 'already_in_room', 'leave current room before joining another', msg.reqId);
        return;
      }
      const result = rooms.joinRoom(msg.code, msg.name);
      if (!result.ok) {
        sendError(ws, result.error, `cannot join room: ${result.error}`, msg.reqId);
        // Only nonexistent codes count toward the guess limit — a full or started room is a
        // real code shared by a real host, not a probe.
        if (result.error === 'room_not_found' && hitJoinLimit(conn)) {
          log.info('join_limit_exceeded', {});
          ws.close(1008, 'too many failed joins');
        }
        return;
      }
      conn.code = msg.code;
      conn.seat = result.seat;
      attachSocket(msg.code, result.seat, ws);
      send(ws, roomJoined(msg.code, result.seat, result.token));
      broadcastRoomState(msg.code);
      return;
    }
    case 'leave_room': {
      if (conn.code !== null && conn.seat !== null) {
        const code = conn.code;
        detachSocket(code, conn.seat, ws);
        const result = rooms.leaveRoom(code, conn.seat);
        // A game that lost a player never advances again — end it for the survivor
        // rather than leaving them on a dead board (S2).
        if (result.roomClosed) closeRoom(code, 'opponent left, match ended');
        else broadcastRoomState(code);
      }
      conn.code = null;
      conn.seat = null;
      return;
    }
    case 'ready': {
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const result = rooms.setReady(conn.code, conn.seat, msg.ready);
      if (!result.ok) {
        sendError(ws, result.error, 'room not found', msg.reqId);
        return;
      }
      broadcastRoomState(conn.code);
      return;
    }
    case 'set_room_settings': {
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const result = rooms.setRoomSettings(conn.code, conn.seat, msg.settings);
      if (!result.ok) {
        sendError(ws, result.error, `cannot change room settings: ${result.error}`, msg.reqId);
        return;
      }
      broadcastRoomState(conn.code);
      return;
    }
    case 'mexe_started': {
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      // No reply on refusal: a repeat claim, or one from a seat that is not on the clock, is an
      // ordinary no-op, not an error the player should see. The next state_sync carries the
      // authoritative time left either way.
      if (rooms.claimMexeBonus(conn.code, conn.seat).ok) broadcastStateSync(conn.code);
      return;
    }
    case 'start_game': {
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const result = rooms.startGame(conn.code, conn.seat);
      if (!result.ok) {
        sendError(ws, result.error, `cannot start room: ${result.error}`, msg.reqId);
        return;
      }
      const bySeat = sockets.get(conn.code);
      if (bySeat) {
        for (const [seat, sock] of bySeat) {
          const view = rooms.getView(conn.code, seat);
          if (view) send(sock, { v: PROTOCOL_VERSION, type: 'game_started', view });
        }
      }
      return;
    }
    case 'submit_turn': {
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const code = conn.code;
      const result = rooms.submitTurn(code, conn.seat, msg.rev, msg.melds);
      if (!result.ok) {
        send(ws, { v: PROTOCOL_VERSION, type: 'proposal_rejected', reqId: msg.reqId, reasons: result.reasons });
        return;
      }
      broadcastStateSync(code);
      if (result.gameOver) {
        broadcastGameOver(code);
        closeFinishedRoom(code);
      }
      return;
    }
    case 'draw_end_turn': {
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const code = conn.code;
      const result = rooms.drawEndTurn(code, conn.seat, msg.rev);
      if (!result.ok) {
        send(ws, { v: PROTOCOL_VERSION, type: 'proposal_rejected', reqId: msg.reqId, reasons: result.reasons });
        return;
      }
      broadcastStateSync(code);
      if (result.gameOver) {
        broadcastGameOver(code);
        closeFinishedRoom(code);
      }
      return;
    }
    case 'reconnect': {
      const result = rooms.reconnect(msg.token);
      if (!result.ok) {
        sendError(ws, result.error, 'invalid or expired token', msg.reqId);
        return;
      }
      // The seat this socket held before the hop, if any. `moveSocket` below detaches the socket
      // from it, but only the room manager can mark the seat absent — without this the old seat
      // stays `connected` with nothing attached, which makes its room invisible to
      // advanceStalledTurns (active seat looks present), to the sweep (`anyConnected`) and to the
      // idle backstop, i.e. stuck forever with its remaining players stranded.
      const held =
        conn.code !== null && conn.seat !== null && (conn.code !== result.code || conn.seat !== result.seat)
          ? { code: conn.code, seat: conn.seat }
          : null;
      // Exactly one connection may ever act for a seat: evict whatever socket previously
      // held it before attaching this one (S4).
      evictSeat(sockets, connections, result.code, result.seat, ws);
      moveSocket(sockets, conn, result.code, result.seat, ws);
      if (held) {
        rooms.disconnect(held.code, held.seat);
        for (const sock of sockets.get(held.code)?.values() ?? []) {
          send(sock, { v: PROTOCOL_VERSION, type: 'player_disconnected', seat: held.seat });
        }
        broadcastRoomState(held.code);
      }
      // Always re-establish room context first (code/seat/players), then — if a match is already
      // running — the current view. A client that reconnected from a fresh page load has neither,
      // and needs both to resume instead of stranding itself in the lobby.
      send(ws, roomJoined(result.code, result.seat, msg.token));
      if (result.view) {
        send(ws, { v: PROTOCOL_VERSION, type: 'state_sync', view: result.view });
      }
      const bySeat = sockets.get(result.code);
      for (const [seat, sock] of bySeat ?? []) {
        if (seat !== result.seat) send(sock, { v: PROTOCOL_VERSION, type: 'player_reconnected', seat: result.seat });
      }
      // A lobby renders presence from `room_state`, not from player_reconnected — without this
      // the other seats keep showing a stale "(disconnected)" marker for a seat that is back.
      broadcastRoomState(result.code);
      return;
    }
    case 'resync': {
      // Recovery is one-way: the server re-sends what it already holds and never reads any
      // client state. A lobby seat gets the room list, an in-match seat the full view.
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const info = rooms.getRoomInfo(conn.code);
      if (info) {
        send(ws, {
          v: PROTOCOL_VERSION, type: 'room_state',
          players: info.players, settings: info.settings, hostSeat: HOST_SEAT, locked: info.locked,
        });
      }
      const view = rooms.getView(conn.code, conn.seat);
      if (view) send(ws, { v: PROTOCOL_VERSION, type: 'state_sync', view });
      return;
    }
    case 'ping':
      send(ws, { v: PROTOCOL_VERSION, type: 'pong' });
      return;
  }
}

const startedAt = Date.now();

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        rooms: rooms.roomCount(),
        connections: connections.size,
        protocol: PROTOCOL_VERSION,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });

/** Sockets that answered the last heartbeat probe. A socket missing from this set when the next
 * probe fires is terminated rather than left holding its seat. */
const alive = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket, req) => {
  const ip = req.socket.remoteAddress ?? 'unknown';
  const ipCount = connectionsByIp.get(ip) ?? 0;
  if (connections.size >= config.maxConnections || ipCount >= config.maxConnectionsPerIp) {
    log.info('connection_rejected', { reason: connections.size >= config.maxConnections ? 'global_cap' : 'ip_cap' });
    ws.close(1013, 'capacity');
    return;
  }
  const conn: ConnState = newConnState(Date.now());
  connections.set(ws, conn);
  connectionsByIp.set(ip, ipCount + 1);
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));

  ws.on('message', (data) => {
    try {
      // Crude flood guard (S5): a looping/hostile client gets disconnected rather than
      // allowed to exhaust the process. Not a real rate limiter.
      if (hitFlood(conn, Date.now())) {
        sendError(ws, 'rate_limited', 'too many messages, closing connection');
        // 1008 (policy violation), matching the failed-join close — a plain close() is
        // indistinguishable from a network drop on the client side.
        ws.close(1008, 'rate limited');
        return;
      }
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      const parsed = parseClientMessage(raw);
      if ('error' in parsed) {
        sendError(ws, 'bad_message', parsed.error);
        return;
      }
      handleMessage(ws, conn, parsed);
    } catch (err) {
      // A handler must never crash the process on malformed/hostile input.
      log.error('message_handler_error', { message: String(err) });
      sendError(ws, 'internal_error', 'internal error');
    }
  });

  ws.on('close', () => {
    if (conn.code !== null && conn.seat !== null) {
      detachSocket(conn.code, conn.seat, ws);
      rooms.disconnect(conn.code, conn.seat);
      const bySeat = sockets.get(conn.code);
      for (const sock of bySeat?.values() ?? []) {
        send(sock, { v: PROTOCOL_VERSION, type: 'player_disconnected', seat: conn.seat });
      }
      // Same reason as the reconnect path: keep lobby presence in step with the seat's state.
      broadcastRoomState(conn.code);
    }
    connections.delete(ws);
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining > 0) connectionsByIp.set(ip, remaining);
    else connectionsByIp.delete(ip);
    alive.delete(ws);
  });

  ws.on('error', (err) => {
    log.error('socket_error', { message: String(err) });
  });
});

const sweepTimer = setInterval(() => {
  // Reaped rooms must not leave their sockets stuck forever on a dead code (S1).
  for (const code of rooms.sweep()) closeRoom(code, 'room closed: timed out');
}, SWEEP_INTERVAL_MS).unref();

const heartbeatTimer = setInterval(() => {
  for (const ws of connections.keys()) {
    if (!alive.has(ws)) {
      // Missed a full probe interval: drop it now so `close` runs the normal disconnect path
      // and the seat's grace timer actually starts.
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    try {
      ws.ping();
    } catch {
      // socket already closing — the close handler will clean up
    }
  }
}, HEARTBEAT_INTERVAL_MS).unref();

const turnTickTimer = setInterval(() => {
  for (const { code, gameOver, crashed, closed, timedOut } of rooms.advanceStalledTurns()) {
    if (crashed) {
      // Crash policy: the manager already dropped the corrupt room — tell its sockets.
      closeRoom(code, 'internal error, match ended');
      continue;
    }
    // Order matters: the state sync goes first because a client clears its connection notice
    // when it applies one, so a notice sent before it would be wiped by the very update it
    // explains. Closing the room comes last, after its survivors have both.
    if (!closed) broadcastStateSync(code);
    if (timedOut !== undefined) {
      for (const sock of sockets.get(code)?.values() ?? []) {
        send(sock, { v: PROTOCOL_VERSION, type: 'turn_timeout', seat: timedOut });
      }
    }
    if (closed) {
      // Missed-turn limit: the manager already dropped the room, so there is no state left to
      // sync — the notice above is what tells the survivors why the match ended.
      closeRoom(code, 'a player missed too many turns, match ended');
      continue;
    }
    if (gameOver) {
      broadcastGameOver(code);
      closeFinishedRoom(code);
    }
  }
}, TURN_TICK_MS).unref();

process.on('uncaughtException', (err) => {
  log.error('uncaught_exception', { message: String(err) });
  // Every inbound message is already wrapped in its own try/catch, so reaching here means the
  // process state is unknown, not that a client sent something hostile. Serving rooms from a
  // half-applied state is worse than dropping them: exit and let the supervisor restart
  // (docker-compose uses `restart: unless-stopped`). See docs/OPERATIONS.md.
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  log.error('unhandled_rejection', { message: String(err) });
});

let shuttingDown = false;

/** Stop accepting new work and tear everything down cleanly on SIGTERM/SIGINT. Idempotent —
 * a second signal during shutdown is a no-op — and hard-exits if something hangs past the
 * timeout rather than leaving the process stuck. */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('shutdown_start', { signal });

  const hardExit = setTimeout(() => {
    log.error('shutdown_timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardExit.unref();

  clearInterval(sweepTimer);
  clearInterval(heartbeatTimer);
  clearInterval(turnTickTimer);

  const shutdownMsg: ServerMessage = { v: PROTOCOL_VERSION, type: 'error', code: 'server_shutdown', message: 'server shutting down' };
  for (const ws of connections.keys()) {
    send(ws, shutdownMsg);
    ws.close();
  }

  wss.close(() => {
    // Drop idle keep-alive sockets (e.g. a reverse proxy or health prober) instead of waiting
    // for them to close on their own — otherwise server.close() can hang the full
    // SHUTDOWN_TIMEOUT_MS and hard-exit even on an otherwise clean shutdown. Node >=18.2.
    server.closeAllConnections();
    server.close(() => {
      clearTimeout(hardExit);
      log.info('shutdown_complete');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(config.port, config.host, () => {
  log.info('server_listening', {
    port: config.port,
    host: config.host,
    mode: config.mode,
    protocol: PROTOCOL_VERSION,
    maxRooms: config.maxRooms,
  });
});
