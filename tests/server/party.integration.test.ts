/**
 * Online Phase 5 over real sockets: the social channel has to obey the same room boundary,
 * ownership and abuse rules as every gameplay message. Raw `ws` clients against the real process,
 * because "a reaction from a socket that no longer owns its seat" is not something the game client
 * can be made to send.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { Client, startServer, stopServer, type Server } from './harness';

const PORT = 8813;

describe('reactions over the wire (OS-20..OS-24, OS-33, OS-34)', () => {
  let server: Server;
  beforeAll(async () => {
    server = await startServer(PORT);
  });
  afterAll(() => stopServer(server));

  /** Two sockets in one fresh room. Returns both plus the code. */
  async function twoInARoom(): Promise<{ host: Client; guest: Client; code: string }> {
    const host = await Client.open(PORT);
    host.send({ type: 'create_room', name: 'Alice' });
    const { code } = await host.next('room_joined');
    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code, name: 'Bob' });
    await guest.next('room_joined');
    return { host, guest, code };
  }

  it('OS-20/OS-24 a valid reaction reaches the whole room and nobody outside it', async () => {
    const { host, guest } = await twoInARoom();
    const outsider = await twoInARoom();

    host.send({ type: 'reaction', reaction: 'nice' });
    const seen = await guest.next('player_reaction');
    expect(seen).toEqual({ v: PROTOCOL_VERSION, type: 'player_reaction', seat: 0, reaction: 'nice' });
    // The sender sees it too — one broadcast, not a "to everyone else" special case.
    await host.next('player_reaction');

    // The other room heard nothing. Give it a beat so this is an observation, not a race.
    await new Promise((r) => setTimeout(r, 200));
    expect(outsider.host.received.some((m) => m.type === 'player_reaction')).toBe(false);
    expect(outsider.guest.received.some((m) => m.type === 'player_reaction')).toBe(false);

    for (const c of [host, guest, outsider.host, outsider.guest]) c.close();
  });

  it('OS-21/OS-34 an unknown or oversized reaction is refused at the wire boundary', async () => {
    const c = await Client.open(PORT);
    c.send({ type: 'create_room', name: 'Alice' });
    await c.next('room_joined');

    for (const reaction of ['NICE', 'you stink', '', 'x'.repeat(5000)]) {
      c.clear();
      c.send({ type: 'reaction', reaction });
      const err = await c.next('error');
      expect(err.code).toBe('bad_message');
    }
    // Nothing got through: a refused payload is never relayed.
    expect(c.received.some((m) => m.type === 'player_reaction')).toBe(false);
    c.close();
  });

  it('OS-22 a second reaction inside the cooldown is dropped, not relayed', async () => {
    const { host, guest } = await twoInARoom();
    host.send({ type: 'reaction', reaction: 'nice' });
    await guest.next('player_reaction');
    guest.clear();
    host.send({ type: 'reaction', reaction: 'wow' });
    await new Promise((r) => setTimeout(r, 300));
    expect(guest.received.some((m) => m.type === 'player_reaction')).toBe(false);
    host.close();
    guest.close();
  });

  it('OS-34 reaction spam is closed by the same flood guard every message answers to', async () => {
    const c = await Client.open(PORT);
    c.send({ type: 'create_room', name: 'Alice' });
    await c.next('room_joined');
    for (let i = 0; i < 400; i++) c.send({ type: 'reaction', reaction: 'nice' });
    expect(await c.closed()).toBe(1008);
  });

  it('OS-33 a socket that lost its seat to a reconnect can no longer react or vote', async () => {
    const stale = await Client.open(PORT);
    stale.send({ type: 'create_room', name: 'Alice' });
    const joined = await stale.next('room_joined');
    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code: joined.code, name: 'Bob' });
    await guest.next('room_joined');

    // A second socket claims the same seat with the same token: exactly one transport may act for
    // a seat, so the first one is evicted.
    const fresh = await Client.open(PORT);
    fresh.send({ type: 'reconnect', token: joined.token });
    await fresh.next('room_joined');
    expect(await stale.closed()).not.toBeNull();

    guest.clear();
    stale.send({ type: 'reaction', reaction: 'nice' });
    stale.send({ type: 'ready', ready: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(guest.received.some((m) => m.type === 'player_reaction')).toBe(false);
    expect(
      guest.received.some((m) => m.type === 'room_state' && m.players.some((p) => p.seat === 0 && p.ready)),
    ).toBe(false);

    fresh.close();
    guest.close();
  });

  it('OS-06/OS-16/OS-18 the lobby payload carries wins, history and a public-safe feed', async () => {
    const { host, guest } = await twoInARoom();
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    await guest.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.players.length === 2 && m.players.every((p) => p.ready)),
      'both seats ready',
    );
    const state = [...guest.received].reverse().find((m) => m.type === 'room_state');
    expect(state && state.type === 'room_state' && state.players.every((p) => p.wins === 0)).toBe(true);
    expect(state && state.type === 'room_state' && state.party.matches).toEqual([]);
    expect(state && state.type === 'room_state' && state.party.activity.map((e) => e.kind))
      .toEqual(['joined', 'joined', 'ready', 'ready']);
    host.close();
    guest.close();
  });
});
