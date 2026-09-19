/**
 * A refusal answers one proposal (CH-05).
 *
 * `proposal_rejected` is correlated against the reqId still in flight, at the transport boundary
 * where that ledger lives. A refusal that arrives after an authoritative frame has already
 * replaced the board answers nothing, and must not reach the app: acting on it sounds the error
 * over a correct board and rebuilds the editor under whatever the player has started since.
 */
import { beforeEach, describe, expect, it } from 'vitest';

class FakeSocket {
  static readonly OPEN = 1;
  readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    opened.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  deliver(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

let opened: FakeSocket[] = [];

const g = globalThis as Record<string, unknown>;
g.WebSocket = FakeSocket;
g.location = { protocol: 'http:', hostname: 'localhost', host: 'localhost', search: '' };
g.sessionStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
g.window = { addEventListener: () => undefined, removeEventListener: () => undefined };

const { NetClient } = await import('../../src/net/client');

/** An open client, plus the reqId of a proposal it has just sent. */
function submitted(): { client: InstanceType<typeof NetClient>; socket: FakeSocket; rejections: unknown[]; reqId: string } {
  const client = new NetClient();
  client.connect();
  const socket = opened[0]!;
  socket.onopen?.();
  const rejections: unknown[] = [];
  client.on('proposal_rejected', (msg) => rejections.push(msg));
  const reqId = client.drawEndTurn(3)!;
  expect(reqId).toBeTruthy();
  return { client, socket, rejections, reqId };
}

const view = { rev: 4, seat: 0, players: [], table: [], drawCount: 0, activeSeat: 0, turn: 1, phase: 'playing' };

beforeEach(() => {
  opened = [];
});

describe('proposal refusals are correlated to the proposal in flight', () => {
  it('delivers the refusal that answers the outstanding proposal', () => {
    const { socket, rejections, reqId } = submitted();
    socket.deliver({ v: 4, type: 'proposal_rejected', reqId, reasons: ['reason.unknownCard'] });
    expect(rejections).toHaveLength(1);
  });

  it('drops a refusal that arrives after an authoritative frame replaced the board', () => {
    const { socket, rejections, reqId } = submitted();
    socket.deliver({ v: 4, type: 'state_sync', view });
    socket.deliver({ v: 4, type: 'proposal_rejected', reqId, reasons: ['reason.staleRevision'] });
    expect(rejections).toEqual([]);
  });

  it('drops a duplicate refusal for a proposal already answered', () => {
    const { socket, rejections, reqId } = submitted();
    socket.deliver({ v: 4, type: 'proposal_rejected', reqId, reasons: ['reason.unknownCard'] });
    socket.deliver({ v: 4, type: 'proposal_rejected', reqId, reasons: ['reason.unknownCard'] });
    expect(rejections).toHaveLength(1);
  });

  it('answers each of two proposals in flight, in whichever order the refusals arrive', () => {
    // `submitRaw` (verification-only) deliberately bypasses the scene's one-at-a-time input lock,
    // so a second proposal can be outstanding before the first is answered. Both refusals are
    // real answers and neither may be swallowed by the other.
    const { client, socket, rejections, reqId } = submitted();
    const second = client.submitTurn(3, [{ id: 'm1', cardIds: ['c1'] }])!;
    expect(second).not.toBe(reqId);
    socket.deliver({ v: 4, type: 'proposal_rejected', reqId: second, reasons: ['reason.unknownCard'] });
    socket.deliver({ v: 4, type: 'proposal_rejected', reqId, reasons: ['reason.notYourTurn'] });
    expect(rejections).toHaveLength(2);
  });

  it('drops a refusal carrying a reqId this client never sent', () => {
    const { socket, rejections } = submitted();
    socket.deliver({ v: 4, type: 'proposal_rejected', reqId: 'not-mine', reasons: ['reason.notYourTurn'] });
    expect(rejections).toEqual([]);
  });

});
