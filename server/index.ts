/**
 * MEXE! online alpha WebSocket server. Plain Node + `ws`, run via `tsx`.
 * See docs/MULTIPLAYER_ARCHITECTURE.md for protocol and validation order.
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { RoomManager } from './rooms';
import {
  attachSocket as attach,
  closeRoomSockets,
  detachSocket as detach,
  evictSeat,
  hitFlood,
  newConnState,
  type ConnState,
} from './connections';

const PORT = Number(process.env.PORT) || 8787;
const SWEEP_INTERVAL_MS = 30_000;
/** Liveness probe. A half-open socket (lid closed, dead NAT entry) otherwise holds its seat
 * `connected` until TCP gives up, so the disconnect grace never starts (docs/PHASE7_AUDIT.md #1). */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** How often stalled matches are checked. Independent of the grace period itself. */
const TURN_TICK_MS = 5_000;
/** Largest inbound frame accepted. The biggest legal message is a submit_turn with the whole
 * deck as card ids; 16 KiB is far above that and far below anything that hurts (#2). */
const MAX_PAYLOAD_BYTES = 16 * 1024;

// Deterministic deal for verify:multiplayer only — never set in a real deployment.
const testSeed = process.env.MEXE_TEST_SEED ? Number(process.env.MEXE_TEST_SEED) : undefined;
const rooms = new RoomManager(testSeed === undefined ? {} : { genSeed: () => testSeed });

const connections = new Map<WebSocket, ConnState>();
// code -> seat -> socket, for broadcast/targeted send
const sockets = new Map<string, Map<number, WebSocket>>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error('send failed', err);
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

function broadcastRoomState(code: string): void {
  const bySeat = sockets.get(code);
  const players = rooms.getPlayers(code);
  if (!bySeat || !players) return;
  for (const ws of bySeat.values()) {
    send(ws, { v: PROTOCOL_VERSION, type: 'room_state', players });
  }
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
      send(ws, {
        v: PROTOCOL_VERSION,
        type: 'room_joined',
        code,
        seat,
        token,
        players: rooms.getPlayers(code) ?? [],
      });
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
        return;
      }
      conn.code = msg.code;
      conn.seat = result.seat;
      attachSocket(msg.code, result.seat, ws);
      send(ws, {
        v: PROTOCOL_VERSION,
        type: 'room_joined',
        code: msg.code,
        seat: result.seat,
        token: result.token,
        players: result.players,
      });
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
      const result = rooms.submitTurn(conn.code, conn.seat, msg.rev, msg.melds);
      if (!result.ok) {
        send(ws, { v: PROTOCOL_VERSION, type: 'proposal_rejected', reqId: msg.reqId, reasons: result.reasons });
        return;
      }
      broadcastStateSync(conn.code);
      if (result.gameOver) broadcastGameOver(conn.code);
      return;
    }
    case 'draw_end_turn': {
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const result = rooms.drawEndTurn(conn.code, conn.seat, msg.rev);
      if (!result.ok) {
        send(ws, { v: PROTOCOL_VERSION, type: 'proposal_rejected', reqId: msg.reqId, reasons: result.reasons });
        return;
      }
      broadcastStateSync(conn.code);
      if (result.gameOver) broadcastGameOver(conn.code);
      return;
    }
    case 'reconnect': {
      const result = rooms.reconnect(msg.token);
      if (!result.ok) {
        sendError(ws, result.error, 'invalid or expired token', msg.reqId);
        return;
      }
      // Exactly one connection may ever act for a seat: evict whatever socket previously
      // held it before attaching this one (S4).
      evictSeat(sockets, connections, result.code, result.seat, ws);
      conn.code = result.code;
      conn.seat = result.seat;
      attachSocket(result.code, result.seat, ws);
      // Always re-establish room context first (code/seat/players), then — if a match is already
      // running — the current view. A client that reconnected from a fresh page load has neither,
      // and needs both to resume instead of stranding itself in the lobby.
      send(ws, {
        v: PROTOCOL_VERSION,
        type: 'room_joined',
        code: result.code,
        seat: result.seat,
        token: msg.token,
        players: result.players,
      });
      if (result.view) {
        send(ws, { v: PROTOCOL_VERSION, type: 'state_sync', view: result.view });
      }
      const bySeat = sockets.get(result.code);
      for (const [seat, sock] of bySeat ?? []) {
        if (seat !== result.seat) send(sock, { v: PROTOCOL_VERSION, type: 'player_reconnected', seat: result.seat });
      }
      return;
    }
    case 'resync': {
      // Recovery is one-way: the server re-sends what it already holds and never reads any
      // client state. A lobby seat gets the room list, an in-match seat the full view.
      if (conn.code === null || conn.seat === null) {
        sendError(ws, 'no_room', 'not in a room', msg.reqId);
        return;
      }
      const players = rooms.getPlayers(conn.code);
      if (players) send(ws, { v: PROTOCOL_VERSION, type: 'room_state', players });
      const view = rooms.getView(conn.code, conn.seat);
      if (view) send(ws, { v: PROTOCOL_VERSION, type: 'state_sync', view });
      return;
    }
    case 'ping':
      send(ws, { v: PROTOCOL_VERSION, type: 'pong' });
      return;
  }
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD_BYTES });

/** Sockets that answered the last heartbeat probe. A socket missing from this set when the next
 * probe fires is terminated rather than left holding its seat. */
const alive = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  const conn: ConnState = newConnState(Date.now());
  connections.set(ws, conn);
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));

  ws.on('message', (data) => {
    try {
      // Crude flood guard (S5): a looping/hostile client gets disconnected rather than
      // allowed to exhaust the process. Not a real rate limiter.
      if (hitFlood(conn, Date.now())) {
        sendError(ws, 'rate_limited', 'too many messages, closing connection');
        ws.close();
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
      console.error('message handler error', err);
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
    }
    connections.delete(ws);
    alive.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('socket error', err);
  });
});

setInterval(() => {
  // Reaped rooms must not leave their sockets stuck forever on a dead code (S1).
  for (const code of rooms.sweep()) closeRoom(code, 'room closed: timed out');
}, SWEEP_INTERVAL_MS).unref();

setInterval(() => {
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

setInterval(() => {
  for (const { code, gameOver } of rooms.advanceStalledTurns()) {
    broadcastStateSync(code);
    if (gameOver) broadcastGameOver(code);
  }
}, TURN_TICK_MS).unref();

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err);
});

server.listen(PORT, () => {
  console.log(`MEXE! server listening on :${PORT} (protocol v${PROTOCOL_VERSION})`);
});
