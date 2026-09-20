import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, stopServer, type Server } from './harness';

const TSX = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

/** A port nothing else holds, released again immediately — same trick the e2e harness uses. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      if (addr === null || typeof addr === 'string') {
        probe.close(() => reject(new Error('no port')));
        return;
      }
      probe.close(() => resolve(addr.port));
    });
  });
}

let running: Server | null = null;
afterEach(() => {
  if (running) stopServer(running);
  running = null;
});

describe('SRV-LISTEN a port it cannot have is a loud failure', () => {
  /**
   * Before this, `server.listen` had no `error` handler: EADDRINUSE surfaced as an unhandled
   * event, and anything probing `/health` got a cheerful answer from whatever process already
   * owned the port. That is how a fixed-port e2e run ended up driving a foreign server and
   * reporting the result as a lobby bug (see docs/TESTING.md, multiplayer suite).
   */
  it('exits non-zero and names the port instead of throwing an unhandled error', async () => {
    const port = await freePort();
    running = await startServer(port);

    const second = spawn(TSX, ['server/index.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined, PORT: String(port) },
    });
    const out: string[] = [];
    second.stdout.on('data', (d) => out.push(String(d)));
    second.stderr.on('data', (d) => out.push(String(d)));
    const code = await new Promise<number | null>((resolve) => second.on('exit', resolve));

    expect(code).toBe(1);
    const log = out.join('');
    expect(log).toContain('server_listen_failed');
    expect(log).toContain('EADDRINUSE');
    expect(log).toContain(String(port));
    // The first server is untouched by the failed one.
    expect((await fetch(`http://localhost:${port}/health`)).ok).toBe(true);
  }, 30_000);
});
