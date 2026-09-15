/**
 * Online Phase 7 — private matchmaking and invite discovery (OD-*).
 *
 * Two halves, for two different questions. The `RoomManager` block asks what the projection
 * *is* — which rooms qualify, which fields exist, where the bound is — and answers it in
 * microseconds without a socket. The integration block asks what a client can actually reach
 * over the wire: authority, lifecycle, races and the rate budget.
 *
 * The privacy assertions here are deliberately written as "this exact key set", not as "does not
 * contain a token": a future field added to the listing has to be argued for in this file before
 * it can ship, which is the only version of the check that keeps working as the type grows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { MAX_ROOM_LISTINGS } from '../../src/net/protocol';
import { allSeatsReady, Client, startServer, stopServer, type Server } from './harness';

/** Every field a browser card is allowed to carry. Nothing else may appear in a listing. */
const LISTING_KEYS = ['code', 'hostName', 'players', 'capacity', 'status', 'timerMode'];

describe('OD listing projection (RoomManager)', () => {
  it('OD-01 a new room is private, with no way to ask for anything else', () => {
    const rooms = new RoomManager();
    const created = rooms.createRoom('Marina');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(rooms.getVisibility(created.code)).toBe('private');
  });

  it('OD-02 a private room is absent from discovery', () => {
    const rooms = new RoomManager();
    rooms.createRoom('Marina');
    expect(rooms.listRooms()).toEqual([]);
  });

  it('OD-03 a listed room appears, with the room it can seat', () => {
    const rooms = new RoomManager();
    const created = rooms.createRoom('Marina');
    if (!created.ok) throw new Error('create failed');
    rooms.setVisibility(created.code, 0, 'listed');
    expect(rooms.listRooms()).toEqual([
      { code: created.code, hostName: 'Marina', players: 1, capacity: 4, status: 'waiting', timerMode: 'casual' },
    ]);
  });

  it('OD-04 the projection carries exactly the safe fields and no others', () => {
    const rooms = new RoomManager();
    const created = rooms.createRoom('Marina');
    if (!created.ok) throw new Error('create failed');
    rooms.setVisibility(created.code, 0, 'listed');
    const [listing] = rooms.listRooms();
    expect(Object.keys(listing!).sort()).toEqual([...LISTING_KEYS].sort());
  });

  it('OD-15 a full listed room says so instead of offering a seat', () => {
    const rooms = new RoomManager();
    const created = rooms.createRoom('Marina');
    if (!created.ok) throw new Error('create failed');
    rooms.setVisibility(created.code, 0, 'listed');
    for (const name of ['B', 'C', 'D']) rooms.joinRoom(created.code, name);
    expect(rooms.listRooms()[0]).toMatchObject({ players: 4, capacity: 4, status: 'full' });
    expect(rooms.joinRoom(created.code, 'E')).toEqual({ ok: false, error: 'room_full' });
  });

  it('bounds the answer, so discovery can never become a scrape', () => {
    const rooms = new RoomManager();
    for (let i = 0; i < MAX_ROOM_LISTINGS + 5; i++) {
      const created = rooms.createRoom(`H${i}`);
      if (!created.ok) throw new Error('create failed');
      rooms.setVisibility(created.code, 0, 'listed');
    }
    expect(rooms.listRooms().length).toBe(MAX_ROOM_LISTINGS);
    expect(rooms.listRooms(3).length).toBe(3);
  });
});

describe('OD discovery over the wire', () => {
  const PORT = 8820;
  let server: Server;

  beforeAll(async () => {
    // Deliberately the real, unraised budgets: this block creates eight rooms from one source
    // address, well inside the shipped per-source create limit. A test that had to widen a
    // production limit to pass would be testing a server nobody runs.
    server = await startServer(PORT, { MEXE_TEST_SEED: '7' });
  }, 30_000);

  afterAll(() => stopServer(server));

  /** A room on a fresh socket. `listed` makes it discoverable, which is never the default. */
  async function room(name: string, listed = false): Promise<{ client: Client; code: string; token: string }> {
    const client = await Client.open(PORT);
    client.send({ type: 'create_room', name });
    const joined = await client.next('room_joined');
    if (listed) {
      client.send({ type: 'set_room_visibility', visibility: 'listed' });
      await client.until(
        (msgs) => msgs.some((m) => m.type === 'room_state' && m.visibility === 'listed'),
        'a room_state reporting listed',
      );
    }
    return { client, code: joined.code, token: joined.token };
  }

  /** One `list_rooms` round trip on its own socket, so a caller's budget stays its own. */
  async function list(): Promise<{ code: string; hostName: string; players: number; status: string }[]> {
    const browser = await Client.open(PORT);
    browser.send({ type: 'list_rooms' });
    const answer = await browser.next('room_list');
    browser.close();
    return answer.rooms;
  }

  it('OD-01/OD-02 a created room reports itself private and stays out of the list', async () => {
    const { client, code } = await room('Quiet');
    const joined = await client.next('room_joined');
    expect(joined.visibility).toBe('private');
    expect((await list()).some((r) => r.code === code)).toBe(false);
    client.close();
  });

  it('OD-03/OD-05/OD-06 a listed room appears carrying no secret of any kind', async () => {
    const { client, code, token } = await room('Marina', true);
    const rooms = await list();
    const mine = rooms.find((r) => r.code === code);
    expect(mine).toBeDefined();
    expect(Object.keys(mine!).sort()).toEqual([...LISTING_KEYS].sort());
    // The whole answer, as bytes: a token or a card id anywhere in it is a leak wherever it hid.
    const wire = JSON.stringify(rooms);
    expect(wire).not.toContain(token);
    expect(wire).not.toMatch(/"(hand|cards|cardIds|seed|seat|token|rev)"/);
    client.close();
  });

  it('OD-08/OD-19 a code taken from the list joins that exact room, and a dead one fails kindly', async () => {
    const { client: host, code } = await room('Marina', true);
    const listed = (await list()).find((r) => r.code === code);
    expect(listed).toBeDefined();

    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code: listed!.code, name: 'Bia' });
    const joined = await guest.next('room_joined');
    expect(joined.code).toBe(code);
    expect(joined.players.map((p) => p.name)).toEqual(['Marina', 'Bia']);

    // The listing the second guest holds is now a snapshot of a room that is about to stop
    // existing: everyone leaves, and the join that follows has to be refused, not resurrected.
    guest.send({ type: 'leave_room' });
    host.send({ type: 'leave_room' });
    const late = await Client.open(PORT);
    late.send({ type: 'join_room', code: listed!.code, name: 'Late' });
    const err = await late.next('error');
    expect(err.code).toBe('room_not_found');
    expect((await list()).some((r) => r.code === code)).toBe(false); // OD-18
    host.close();
    guest.close();
    late.close();
  });

  it('OD-09/OD-10 a held session reclaims its own seat, and cannot take a second one', async () => {
    const { client: host, code, token } = await room('Marina', true);
    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code, name: 'Bia' });
    await guest.next('room_joined');

    // The host's device comes back on a new socket, the way a reload does.
    host.close();
    const returning = await Client.open(PORT);
    returning.send({ type: 'reconnect', token });
    const back = await returning.next('room_joined');
    expect(back.code).toBe(code);
    expect(back.seat).toBe(0);

    // Discovery hands the same device the same code. It must not become a second player.
    returning.clear();
    returning.send({ type: 'join_room', code, name: 'Marina' });
    const err = await returning.next('error');
    expect(err.code).toBe('already_in_room');
    expect((await list()).find((r) => r.code === code)?.players).toBe(2);
    returning.close();
    guest.close();
  });

  it('OD-16/OD-17 a room in a match offers nothing; the lobby it returns to does', async () => {
    const { client: host, code } = await room('Marina', true);
    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code, name: 'Bia' });
    await guest.next('room_joined');
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    await allSeatsReady(host);
    host.send({ type: 'start_game' });
    await host.next('game_started');

    expect((await list()).some((r) => r.code === code)).toBe(false);
    const latecomer = await Client.open(PORT);
    latecomer.send({ type: 'join_room', code, name: 'Caio' });
    expect((await latecomer.next('error')).code).toBe('game_started');
    latecomer.close();
    host.close();
    guest.close();
  });

  it('OD-20/OD-21/OD-22 visibility is the server’s, the host’s, and the lobby’s alone', async () => {
    const { client: host, code } = await room('Marina');
    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code, name: 'Bia' });
    await guest.next('room_joined');

    // OD-21: a guest asking is refused, and the room does not move.
    guest.clear();
    guest.send({ type: 'set_room_visibility', visibility: 'listed' });
    expect((await guest.next('error')).code).toBe('not_host');
    expect((await list()).some((r) => r.code === code)).toBe(false);

    // OD-20: the host's change reaches every seat as authoritative room state, not as an echo.
    guest.clear();
    host.send({ type: 'set_room_visibility', visibility: 'listed' });
    await guest.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.visibility === 'listed'),
      'the guest being told the room is listed',
    );
    // Visibility is not one of the terms a seat plays under, so nobody has to agree again.
    const state = guest.received.filter((m) => m.type === 'room_state').at(-1);
    expect(state?.type === 'room_state' && state.players.every((p) => !p.ready)).toBe(true);

    // OD-22: once the match is running the room refuses the change outright.
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    await allSeatsReady(host);
    host.send({ type: 'start_game' });
    await host.next('game_started');
    host.clear();
    host.send({ type: 'set_room_visibility', visibility: 'private' });
    expect((await host.next('error')).code).toBe('game_started');
    host.close();
    guest.close();
  });

  it('OD-25 one room’s listing never carries another room’s private state', async () => {
    const { client: open, code: openCode } = await room('Listed', true);
    const { client: secret, code: secretCode, token: secretToken } = await room('Secret');
    const rooms = await list();
    expect(rooms.some((r) => r.code === openCode)).toBe(true);
    expect(rooms.some((r) => r.code === secretCode)).toBe(false);
    const wire = JSON.stringify(rooms);
    expect(wire).not.toContain(secretCode);
    expect(wire).not.toContain(secretToken);
    expect(wire).not.toContain('Secret');
    open.close();
    secret.close();
  });

  it('a hostile or padded list request is refused at the boundary, not downstream', async () => {
    const client = await Client.open(PORT);
    // Filters are not representable on the wire, so extra payload is simply ignored.
    client.send({ type: 'list_rooms', limit: 10_000, filter: 'x'.repeat(500), rooms: [{ code: 'X' }] });
    expect((await client.next('room_list')).rooms.length).toBeLessThanOrEqual(MAX_ROOM_LISTINGS);
    client.clear();
    client.send({ type: 'set_room_visibility', visibility: 'public' });
    expect((await client.next('error')).code).toBe('bad_message');
    client.close();
  });
});

describe('OD-23/OD-26/OD-27 discovery abuse is bounded, and private play survives it', () => {
  // Its own process: the point of the test is to exhaust a budget, which would change the
  // meaning of every other test sharing the source address.
  const PORT = 8821;
  let server: Server;

  beforeAll(async () => {
    server = await startServer(PORT, { MEXE_TEST_SEED: '8' });
  }, 30_000);

  afterAll(() => stopServer(server));

  it('refuses a looping room-list caller, then still creates and joins rooms by code', async () => {
    const abuser = await Client.open(PORT);
    for (let i = 0; i < 40; i++) abuser.send({ type: 'list_rooms' });
    const err = await abuser.next('error');
    expect(err.code).toBe('rate_limited');
    // Refused, not answered: the expensive half is building the answer, so the budget has to cut
    // in before it. Far fewer answers than requests is the property; the exact count is the
    // window's business.
    expect(abuser.received.filter((m) => m.type === 'room_list').length).toBeLessThan(40);
    // And the connection survives — enumeration is throttled, not punished as an attack.
    abuser.close();

    // OD-27: creating a room does not consult discovery at all.
    const host = await Client.open(PORT);
    host.send({ type: 'create_room', name: 'Marina' });
    const joined = await host.next('room_joined');
    expect(joined.visibility).toBe('private');

    // OD-26: the invite path is untouched by the discovery caller's exhausted budget.
    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code: joined.code, name: 'Bia' });
    expect((await guest.next('room_joined')).code).toBe(joined.code);
    host.close();
    guest.close();
  }, 20_000);
});
