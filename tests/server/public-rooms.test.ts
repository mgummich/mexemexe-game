/**
 * Online Phase 8 — public multiplayer readiness (OP-*).
 *
 * Phase 7 proved discovery *projects* safely (`discovery.test.ts`). This file asks the question
 * a room full of strangers asks instead: with people arriving and leaving constantly, does the
 * room stay one authoritative thing? Seats, host, capacity, identity and the feed are the five
 * places churn could corrupt, so they are what is pinned here.
 *
 * Split the same way as Phase 7: a socket-free `RoomManager` block for anything that is a
 * property of the room model, and a wire block for anything a client could actually race.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { REACTIONS } from '../../src/net/protocol';
import { Client, startServer, stopServer, type Server } from './harness';

/** A listed room with `n` occupied seats, host on seat 0. */
function listedRoom(rooms: RoomManager, names: string[]): string {
  const created = rooms.createRoom(names[0]!);
  if (!created.ok) throw new Error('create failed');
  rooms.setVisibility(created.code, 0, 'listed');
  for (const name of names.slice(1)) rooms.joinRoom(created.code, name);
  return created.code;
}

describe('OP public room model (RoomManager)', () => {
  it('OP-01 a new room is private, and public is never the default', () => {
    const rooms = new RoomManager();
    const created = rooms.createRoom('Marina');
    if (!created.ok) throw new Error('create failed');
    expect(rooms.getVisibility(created.code)).toBe('private');
    expect(rooms.listRooms()).toEqual([]);
  });

  it('OP-07 a public join allocates exactly one seat, and the room knows exactly one of them', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina']);
    const joined = rooms.joinRoom(code, 'Bruno');
    expect(joined).toMatchObject({ ok: true, seat: 1 });
    const players = rooms.getPlayers(code)!;
    expect(players.map((p) => p.seat)).toEqual([0, 1]);
    expect(rooms.listRooms()[0]).toMatchObject({ players: 2, status: 'waiting' });
  });

  it('OP-08 a same-name newcomer gets a new seat and cannot reach the original seat’s session', () => {
    const rooms = new RoomManager();
    const created = rooms.createRoom('Ana');
    if (!created.ok) throw new Error('create failed');
    const impostor = rooms.joinRoom(created.code, 'Ana');
    if (!impostor.ok) throw new Error('join failed');
    // Two Anas, two seats, two tokens — and the only thing that owns a seat is the token.
    expect(impostor.seat).toBe(1);
    expect(impostor.token).not.toBe(created.token);
    expect(rooms.reconnect(impostor.token)).toMatchObject({ ok: true, seat: 1 });
    expect(rooms.reconnect(created.token)).toMatchObject({ ok: true, seat: 0 });
    // A name is not a key: nothing in the model can be addressed by it.
    expect(rooms.reconnect('Ana')).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('OP-09/OP-13 the last seat goes to one caller, and the next is refused without side effects', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina', 'Bruno', 'Carla']);
    const fourth = rooms.joinRoom(code, 'Dani');
    const fifth = rooms.joinRoom(code, 'Edu');
    expect(fourth).toMatchObject({ ok: true, seat: 3 });
    expect(fifth).toEqual({ ok: false, error: 'room_full' });
    expect(rooms.getPlayers(code)!.length).toBe(4);
    expect(rooms.listRooms()[0]).toMatchObject({ players: 4, status: 'full' });
  });

  it('OP-11 leaving twice removes one membership, not two', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina', 'Bruno', 'Carla']);
    expect(rooms.leaveRoom(code, 1)).toEqual({ roomClosed: false });
    expect(rooms.leaveRoom(code, 1)).toEqual({ roomClosed: false });
    expect(rooms.getPlayers(code)!.map((p) => p.seat)).toEqual([0, 2]);
  });

  it('OP-12 host authority follows the lowest occupied seat through a churn of joins and leaves', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina', 'Bruno', 'Carla', 'Dani']);
    expect(rooms.getHostSeat(code)).toBe(0);
    rooms.leaveRoom(code, 0);
    expect(rooms.getHostSeat(code)).toBe(1);
    // The newcomer takes the seat the old host vacated — and does not take the host badge with
    // it. Host is the lowest *occupied* seat at the moment of a departure, not a property of
    // seat 0, or an arriving stranger would inherit a room by sitting down.
    const back = rooms.joinRoom(code, 'Novo');
    expect(back).toMatchObject({ ok: true, seat: 0 });
    expect(rooms.getHostSeat(code)).toBe(1);
    rooms.leaveRoom(code, 1);
    expect(rooms.getHostSeat(code)).toBe(0);
    // Only the host may change the terms or the visibility, whoever the host now is.
    expect(rooms.setVisibility(code, 2, 'private')).toEqual({ ok: false, error: 'not_host' });
    expect(rooms.setVisibility(code, 0, 'private')).toMatchObject({ ok: true, visibility: 'private' });
    expect(rooms.listRooms()).toEqual([]);
  });

  it('OP-14 a listed room in a match offers no seat and accepts no joiner', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina', 'Bruno']);
    rooms.setReady(code, 0, true);
    rooms.setReady(code, 1, true);
    expect(rooms.startGame(code, 0).ok).toBe(true);
    expect(rooms.listRooms()).toEqual([]);
    expect(rooms.joinRoom(code, 'Late')).toEqual({ ok: false, error: 'game_started' });
  });

  it('OP-15 the lobby a finished match recycles into is listable and joinable again', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina', 'Bruno']);
    rooms.setReady(code, 0, true);
    rooms.setReady(code, 1, true);
    rooms.startGame(code, 0);
    expect(rooms.recycleForRematch(code)).toBe(true);
    expect(rooms.listRooms()[0]).toMatchObject({ code, players: 2, status: 'waiting' });
    expect(rooms.joinRoom(code, 'Next')).toMatchObject({ ok: true, seat: 2 });
    // The newcomer's chair is new: no inherited ready bit, no inherited session score.
    expect(rooms.getPlayers(code)!.find((p) => p.seat === 2)).toMatchObject({ ready: false, wins: 0 });
  });

  it('OP-17 an expired room leaves discovery and answers a join with room_not_found', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina']);
    rooms.deleteRoom(code);
    expect(rooms.listRooms()).toEqual([]);
    expect(rooms.joinRoom(code, 'Late')).toEqual({ ok: false, error: 'room_not_found' });
  });

  it('OP-18 the reaction set stays a closed, benign enum with no nag in it', () => {
    // A public room is strangers: "hurry up" is a joke among friends and a weapon among
    // strangers, so it is not representable. This list is the whole moderation surface.
    expect([...REACTIONS]).toEqual(['nice', 'gg', 'oops', 'wow']);
    expect(REACTIONS).not.toContain('hurry');
  });

  it('OP-21/OP-22 the activity feed of a churning public room carries public facts only', () => {
    const rooms = new RoomManager();
    const code = listedRoom(rooms, ['Marina', 'Bruno']);
    rooms.setReady(code, 1, true);
    rooms.claimReaction(code, 1, 'gg');
    rooms.leaveRoom(code, 1);
    rooms.joinRoom(code, 'Carla');
    const feed = rooms.getParty(code).activity;
    expect(feed.map((e) => e.kind)).toEqual(['joined', 'joined', 'ready', 'reaction', 'left', 'joined']);
    // Shape privacy: an event has no field a card id, a token or an address could live in.
    for (const event of feed) {
      expect(Object.keys(event).sort()).toEqual(
        Object.keys(event).filter((k) => ['seq', 'kind', 'seat', 'name', 'reaction'].includes(k)).sort(),
      );
    }
    const wire = JSON.stringify(rooms.getParty(code));
    expect(wire).not.toMatch(/"(hand|cards|cardIds|seed|token|rev|ip)"/);
  });
});

describe('OP public rooms over the wire', () => {
  const PORT = 8824;
  let server: Server;

  beforeAll(async () => {
    server = await startServer(PORT, { MEXE_TEST_SEED: '11' });
  }, 30_000);

  afterAll(() => stopServer(server));

  async function host(name: string): Promise<{ client: Client; code: string; token: string }> {
    const client = await Client.open(PORT);
    client.send({ type: 'create_room', name });
    const joined = await client.next('room_joined');
    client.send({ type: 'set_room_visibility', visibility: 'listed' });
    await client.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.visibility === 'listed'),
      'a room_state reporting listed',
    );
    return { client, code: joined.code, token: joined.token };
  }

  async function join(code: string, name: string): Promise<{ client: Client; seat: number; token: string }> {
    const client = await Client.open(PORT);
    client.send({ type: 'join_room', code, name });
    const joined = await client.next('room_joined');
    return { client, seat: joined.seat, token: joined.token };
  }

  it('OP-10 a socket that hammers join_room ends up in one seat, holding one membership', async () => {
    const room = await host('Marina');
    const eager = await Client.open(PORT);
    for (let i = 0; i < 6; i++) eager.send({ type: 'join_room', code: room.code, name: 'Bruno' });
    const joined = await eager.next('room_joined');
    // The first request seats them; the other five are refused as already_in_room rather than
    // each taking a chair. A lobby of one eager tapper must not read as a full room.
    await eager.until(
      (msgs) => msgs.filter((m) => m.type === 'error' && m.code === 'already_in_room').length === 5,
      'five already_in_room refusals',
    );
    expect(eager.received.filter((m) => m.type === 'room_joined').length).toBe(1);
    await room.client.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.players.length === 2),
      'a two-seat room_state',
    );
    const last = [...room.client.received].reverse().find((m) => m.type === 'room_state');
    expect(last && last.type === 'room_state' && last.players.map((p) => p.seat)).toEqual([0, 1]);
    expect(joined.seat).toBe(1);
    eager.close();
    room.client.close();
  });

  it('OP-09 four strangers racing the last two seats are seated once each, and the fifth is refused', async () => {
    const room = await host('Marina');
    const racers = await Promise.all([Client.open(PORT), Client.open(PORT), Client.open(PORT), Client.open(PORT)]);
    // Fired without awaiting in between: whatever the server's interleaving, the room has four
    // chairs and one of these four gets told so.
    racers.forEach((c, i) => c.send({ type: 'join_room', code: room.code, name: `R${i}` }));
    await Promise.all(
      racers.map((c) =>
        c.until((msgs) => msgs.some((m) => m.type === 'room_joined' || (m.type === 'error' && m.code === 'room_full')), 'an answer'),
      ),
    );
    const seated = racers.flatMap((c) => c.received.filter((m) => m.type === 'room_joined').map((m) => m.seat));
    const refused = racers.filter((c) => c.received.some((m) => m.type === 'error' && m.code === 'room_full'));
    expect(seated.sort()).toEqual([1, 2, 3]);
    expect(refused.length).toBe(1);
    racers.forEach((c) => c.close());
    room.client.close();
  });

  it('OP-12 the host badge survives a churn of leaves and joins on one live room', async () => {
    const room = await host('Marina');
    const b = await join(room.code, 'Bruno');
    const c = await join(room.code, 'Carla');
    // The host walks out of the room it created; seat 1 inherits, and every remaining socket is
    // told so by the server rather than inferring it.
    room.client.send({ type: 'leave_room' });
    await c.client.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.hostSeat === 1),
      'a room_state naming seat 1 as host',
    );
    // The old host's seat is refilled — by someone with no authority over the room.
    const d = await join(room.code, 'Dani');
    expect(d.seat).toBe(0);
    d.client.send({ type: 'set_room_visibility', visibility: 'private' });
    await d.client.until((msgs) => msgs.some((m) => m.type === 'error' && m.code === 'not_host'), 'a not_host refusal');
    b.client.send({ type: 'set_room_visibility', visibility: 'private' });
    await b.client.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.visibility === 'private'),
      'the host’s visibility change taking effect',
    );
    [room.client, b.client, c.client, d.client].forEach((x) => x.close());
  });

  it('OP-11 leave_room sent twice leaves the room with one fewer player, not two', async () => {
    const room = await host('Marina');
    const b = await join(room.code, 'Bruno');
    const c = await join(room.code, 'Carla');
    b.client.send({ type: 'leave_room' });
    b.client.send({ type: 'leave_room' });
    await room.client.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.players.length === 2),
      'a room_state with two seats left',
    );
    // Nothing arrives after it that drops a third: the second leave is a no-op, not a second
    // removal aimed at whoever now holds that seat.
    await new Promise((r) => setTimeout(r, 150));
    const last = [...room.client.received].reverse().find((m) => m.type === 'room_state');
    expect(last && last.type === 'room_state' && last.players.map((p) => p.seat)).toEqual([0, 2]);
    [room.client, b.client, c.client].forEach((x) => x.close());
  });

  it('OP-23/OP-24 a dropped stranger reclaims the same seat without becoming a second player', async () => {
    const room = await host('Marina');
    const b = await join(room.code, 'Bruno');
    b.client.close();
    const back = await Client.open(PORT);
    back.send({ type: 'reconnect', token: b.token });
    const rejoined = await back.next('room_joined');
    expect(rejoined.seat).toBe(b.seat);
    expect(rejoined.players.length).toBe(2);
    expect(rejoined.players.filter((p) => p.name === 'Bruno').length).toBe(1);
    back.close();
    room.client.close();
  });

  it('OP-19/OP-20 a reaction is enum-only, cooldowned, and never reaches another room', async () => {
    const room = await host('Marina');
    const b = await join(room.code, 'Bruno');
    const other = await host('Elsewhere');
    b.client.send({ type: 'reaction', reaction: 'gg' });
    await room.client.until(
      (msgs) => msgs.some((m) => m.type === 'room_state' && m.party.activity.some((e) => e.reaction === 'gg')),
      'the reaction in the room’s feed',
    );
    // Spam inside the cooldown, and a value that is not in the enum: neither reaches the feed.
    for (let i = 0; i < 5; i++) b.client.send({ type: 'reaction', reaction: 'gg' });
    b.client.send({ type: 'reaction', reaction: 'hurry' });
    b.client.send({ type: 'reaction', reaction: '<script>' });
    await new Promise((r) => setTimeout(r, 200));
    const feed = [...room.client.received].reverse().find((m) => m.type === 'room_state');
    const reactions = feed && feed.type === 'room_state' ? feed.party.activity.filter((e) => e.kind === 'reaction') : [];
    expect(reactions.length).toBe(1);
    // Cross-room isolation: the other room never heard any of it.
    expect(JSON.stringify(other.client.received)).not.toContain('"reaction"');
    [room.client, b.client, other.client].forEach((x) => x.close());
  });

  it('OP-16/OP-32 a stale listing fails cleanly, and discovery being useless never blocks a code join', async () => {
    const dying = await host('Ghost');
    const listing = await Client.open(PORT);
    listing.send({ type: 'list_rooms' });
    const answer = await listing.next('room_list');
    expect(answer.rooms.some((r) => r.code === dying.code)).toBe(true);
    // The room goes away between the card being drawn and the card being tapped.
    dying.client.send({ type: 'leave_room' });
    await new Promise((r) => setTimeout(r, 100));
    const late = await Client.open(PORT);
    late.send({ type: 'join_room', code: dying.code, name: 'Late' });
    const refusal = await late.next('error');
    expect(refusal.code).toBe('room_not_found');
    // …and the same socket goes on to create and join by code with nothing carried over.
    const alive = await host('Marina');
    late.send({ type: 'join_room', code: alive.code, name: 'Late' });
    const joined = await late.next('room_joined');
    expect(joined.seat).toBe(1);
    [dying.client, listing, late, alive.client].forEach((x) => x.close());
  });

  it('OP-33/OP-34/OP-35 a listed room seats two, three and four strangers and starts', async () => {
    for (const size of [2, 3, 4]) {
      const room = await host(`Host${size}`);
      const guests = [];
      for (let i = 1; i < size; i++) guests.push(await join(room.code, `G${size}-${i}`));
      const everyone = [room.client, ...guests.map((g) => g.client)];
      everyone.forEach((c) => c.send({ type: 'ready', ready: true }));
      await room.client.until(
        (msgs) => msgs.some((m) => m.type === 'room_state' && m.players.length === size && m.players.every((p) => p.ready)),
        `${size} ready seats`,
      );
      room.client.send({ type: 'start_game' });
      // Every seat gets its own redacted view, and sees only its own hand.
      await Promise.all(everyone.map((c) => c.next('game_started')));
      for (const c of everyone) {
        const started = c.received.find((m) => m.type === 'game_started');
        if (started?.type !== 'game_started') throw new Error('no view');
        expect(started.view.players.length).toBe(size);
        const mine = started.view.players.find((p) => p.seat === started.view.seat);
        expect(mine?.hand?.length).toBeGreaterThan(0);
        // Everyone else is a count. One seat's socket must never carry another seat's cards.
        const others = started.view.players.filter((p) => p.seat !== started.view.seat);
        expect(others.every((p) => p.hand === undefined && p.handCount > 0)).toBe(true);
      }
      everyone.forEach((c) => c.close());
    }
  }, 30_000);
});
