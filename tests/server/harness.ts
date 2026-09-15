/**
 * Shared harness for the server integration suites: spawns the real `server/index.ts` process
 * under `tsx` and drives it with raw `ws` clients. Raw sockets, not Playwright — a hostile or
 * malformed frame is exactly what a browser client can never send, and spawning the server is
 * ~1s versus a browser context per client.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '../../src/net/protocol';
const TSX = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

export interface Server {
  proc: ChildProcessWithoutNullStreams;
  port: number;
  stderr: string[];
  /** Captured too, not just stderr: the privacy canaries below have to hold for *every* line the
   * process emits, and info/debug lines go to stdout. */
  stdout: string[];
}

export async function startServer(port: number, env: Record<string, string> = {}): Promise<Server> {
  // `detached` so the whole process group can be killed: the `tsx` bin is a shim that runs the
  // real server in a child node process, and killing only the shim leaves that child listening on
  // the port, which makes the next run fail with EADDRINUSE.
  const proc = spawn(TSX, ['server/index.ts'], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined, PORT: String(port), ...env },
  });
  const stderr: string[] = [];
  const stdout: string[] = [];
  proc.stderr.on('data', (d) => stderr.push(String(d)));
  proc.stdout.on('data', (d) => stdout.push(String(d)));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return { proc, port, stderr, stdout };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not become healthy on port ${port}: ${stderr.join('')}`);
}

/** A raw client that records every server message it ever received, so a test can assert on
 * what a *different* socket's action pushed to it. */
export class Client {
  readonly received: ServerMessage[] = [];
  closeCode: number | null = null;
  closeReason = '';
  constructor(private readonly ws: WebSocket) {
    ws.on('message', (d) => this.received.push(JSON.parse(String(d)) as ServerMessage));
    ws.on('close', (code, reason) => {
      this.closeCode = code;
      this.closeReason = String(reason);
    });
  }

  static async open(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Client(ws);
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, reqId: 'r1', ...msg }));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  close(): void {
    this.ws.close();
  }

  /** Waits for the first message of `type`, counting ones already received. */
  async next<K extends ServerMessage['type']>(type: K, timeoutMs = 4000): Promise<Extract<ServerMessage, { type: K }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.received.find((m) => m.type === type);
      if (hit) return hit as Extract<ServerMessage, { type: K }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}; got ${this.received.map((m) => m.type).join(',')}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Waits until `pred` holds over everything received so far. `next('room_state')` alone is not
   * enough to sequence a lobby: it matches the room_state the *join* broadcast already delivered,
   * so a start_game fired right after it can beat the other seat's `ready` to the server. */
  async until(pred: (msgs: ServerMessage[]) => boolean, what: string, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pred(this.received)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; got ${this.received.map((m) => m.type).join(',')}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Waits for this socket to be closed by the server, and returns the close code. */
  async closed(timeoutMs = 4000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    return this.closeCode;
  }

  clear(): void {
    this.received.length = 0;
  }
}

/** The server only starts a lobby whose every occupied seat is ready, so a test must observe
 * that state before sending start_game. */
export function stopServer(server: Server): void {
  try {
    process.kill(-server.proc.pid!, 'SIGKILL');
  } catch {
    server.proc.kill('SIGKILL');
  }
}

export function allSeatsReady(c: Client): Promise<void> {
  return c.until(
    (msgs) =>
      msgs.some((m) => m.type === 'room_state' && m.players.length >= 2 && m.players.every((p) => p.ready)),
    'a room_state with every seat ready',
  );
}

export async function health(port: number): Promise<{ ok: boolean; rooms: number; connections: number }> {
  const res = await fetch(`http://localhost:${port}/health`);
  return (await res.json()) as { ok: boolean; rooms: number; connections: number };
}

/** Health read taken only once two consecutive reads agree on the connection count. */
export async function quiescedHealth(port: number): Promise<{ ok: boolean; rooms: number; connections: number }> {
  let prev = await health(port);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const now = await health(port);
    if (now.connections === prev.connections && now.rooms === prev.rooms) return now;
    prev = now;
  }
  return prev;
}
