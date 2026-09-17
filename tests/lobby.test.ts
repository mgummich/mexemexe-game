import { describe, expect, it } from 'vitest';
import { LobbyMachine } from '../src/net/lobby';
import {
  DEFAULT_ROOM_SETTINGS, DEFAULT_ROOM_VISIBILITY, EMPTY_PARTY, PROTOCOL_VERSION,
  type RoomJoinedMsg, type RoomPlayerSummary, type RoomStateMsg,
} from '../src/net/protocol';

/**
 * Every lobby transition, driven directly (ARCH-003). Nothing here constructs a Phaser scene, a
 * socket or a DOM node: the machine takes a server message or a player intent and answers with a
 * state and the effects its caller must perform.
 */

function player(seat: number, patch: Partial<RoomPlayerSummary> = {}): RoomPlayerSummary {
  return { seat, name: `P${seat}`, ready: false, connected: true, wins: 0, ...patch };
}

function joined(patch: Partial<RoomJoinedMsg> = {}): RoomJoinedMsg {
  return {
    v: PROTOCOL_VERSION, type: 'room_joined', code: 'ABCDE', seat: 0, token: 'tok',
    players: [player(0), player(1)], settings: DEFAULT_ROOM_SETTINGS, hostSeat: 0,
    party: EMPTY_PARTY, visibility: DEFAULT_ROOM_VISIBILITY, ...patch,
  };
}

function roomState(patch: Partial<RoomStateMsg> = {}): RoomStateMsg {
  return {
    v: PROTOCOL_VERSION, type: 'room_state', players: [player(0), player(1)],
    settings: DEFAULT_ROOM_SETTINGS, hostSeat: 0, locked: false, party: EMPTY_PARTY,
    visibility: DEFAULT_ROOM_VISIBILITY, ...patch,
  };
}

function fresh(): LobbyMachine {
  const lobby = new LobbyMachine();
  lobby.start({ resume: null, offline: false, socketOpen: false, linkedCode: null });
  return lobby;
}

describe('LobbyMachine — entry', () => {
  it('a fresh visit opens on the entry screen and asks for a connection', () => {
    const lobby = new LobbyMachine();
    expect(lobby.start({ resume: null, offline: false, socketOpen: false, linkedCode: null }))
      .toEqual([{ type: 'connect' }]);
    expect(lobby.phase).toBe('idle');
  });

  it('being offline shows the reason instead of timing out a connection', () => {
    const lobby = new LobbyMachine();
    expect(lobby.start({ resume: null, offline: true, socketOpen: false, linkedCode: null })).toEqual([]);
    expect(lobby.phase).toBe('error');
    expect(lobby.offlineError).toBe(true);
  });

  it('regained connectivity leaves the offline error instead of getting stuck on it', () => {
    const lobby = new LobbyMachine();
    lobby.start({ resume: null, offline: true, socketOpen: false, linkedCode: null });
    expect(lobby.connectivityRestored()).toEqual([{ type: 'connect' }]);
    expect(lobby.phase).toBe('idle');
    // A real server refusal is not undone by the network coming back.
    lobby.serverError({ code: 'room_closed' });
    expect(lobby.connectivityRestored()).toEqual([]);
    expect(lobby.phase).toBe('error');
  });

  it('a resumed room re-enters the lobby as a rematch and pulls the room state', () => {
    const lobby = new LobbyMachine();
    const effects = lobby.start({ resume: { code: 'ABCDE', seat: 1 }, offline: false, socketOpen: true, linkedCode: null });
    expect(effects).toEqual([{ type: 'requestResync' }]);
    expect(lobby.phase).toBe('lobby');
    expect(lobby.rematch).toBe(true);
    expect(lobby.seat).toBe(1);
  });

  it('a share-link code joins once, as soon as there is a socket', () => {
    const lobby = new LobbyMachine();
    lobby.start({ resume: null, offline: false, socketOpen: false, linkedCode: 'ZZZZZ' });
    expect(lobby.status('open')).toEqual([{ type: 'join', code: 'ZZZZZ' }]);
    expect(lobby.status('open')).toEqual([]); // never twice
  });

  it('a connection that never opened at all is an error screen, not a silent idle', () => {
    const lobby = fresh();
    lobby.status('error', 'unreachable');
    expect(lobby.phase).toBe('error');
    expect(lobby.errorMsg).not.toBeNull();
  });
});

describe('LobbyMachine — room', () => {
  it('seating fills the room mirror and remembers the room locally', () => {
    const lobby = fresh();
    expect(lobby.roomJoined(joined())).toEqual([{ type: 'rememberRoom', code: 'ABCDE', host: 'P0' }]);
    expect(lobby.phase).toBe('lobby');
    expect(lobby.code).toBe('ABCDE');
    expect(lobby.players).toHaveLength(2);
  });

  it('a matchmade room_joined does not clobber the MATCH FOUND beat', () => {
    const lobby = fresh();
    lobby.queueState({ v: PROTOCOL_VERSION, type: 'queue_state', status: 'matched', target: 'any', players: 2 });
    lobby.roomJoined(joined());
    expect(lobby.phase).toBe('matched');
  });

  it('the ready bit is the server\'s word, never a local mirror', () => {
    const lobby = fresh();
    lobby.roomJoined(joined());
    expect(lobby.ready).toBe(false);
    lobby.roomState(roomState({ players: [player(0, { ready: true }), player(1)] }));
    expect(lobby.ready).toBe(true);
  });

  it('explains a ready bit the host cleared by changing the terms', () => {
    const lobby = fresh();
    lobby.roomJoined(joined());
    lobby.roomState(roomState({ players: [player(0, { ready: true }), player(1)] }));
    lobby.roomState(roomState({ players: [player(0), player(1)] }));
    expect(lobby.settingsChangedNotice).toBe(true);
  });

  it('does not mistake the match->lobby recycle for a settings change', () => {
    const lobby = fresh();
    lobby.roomJoined(joined());
    lobby.roomState(roomState({ players: [player(0, { ready: true }), player(1)], locked: true }));
    lobby.roomState(roomState({ players: [player(0), player(1)], locked: false }));
    expect(lobby.settingsChangedNotice).toBe(false);
  });

  it('readying up clears every explanation the lobby was showing', () => {
    const lobby = fresh();
    lobby.roomJoined(joined());
    lobby.serverError({ code: 'not_ready' });
    expect(lobby.lobbyNotice).not.toBeNull();
    lobby.readySent();
    expect(lobby.lobbyNotice).toBeNull();
    expect(lobby.rematch).toBe(false);
    expect(lobby.settingsChangedNotice).toBe(false);
  });

  it('only the host can open the custom-terms screen, and only before they are frozen', () => {
    const lobby = fresh();
    lobby.roomJoined(joined({ seat: 1, hostSeat: 0 }));
    expect(lobby.openCustom()).toBe(false);
    lobby.roomJoined(joined({ seat: 0, hostSeat: 0 }));
    expect(lobby.openCustom()).toBe(true);
    lobby.closeCustom();
    lobby.roomState(roomState({ locked: true }));
    expect(lobby.openCustom()).toBe(false);
  });
});

describe('LobbyMachine — matchmaking', () => {
  it('enters the queue on the server\'s word and starts the counter once', () => {
    const lobby = fresh();
    const queued = { v: PROTOCOL_VERSION, type: 'queue_state', status: 'queued', target: 'any' } as const;
    expect(lobby.queueState(queued)).toEqual([{ type: 'queueEntered' }]);
    expect(lobby.phase).toBe('queue');
    expect(lobby.queueState(queued)).toEqual([]); // a re-push is not a new search
  });

  it('a cancel that lost to a match still arrives as matched', () => {
    const lobby = fresh();
    lobby.queueState({ v: PROTOCOL_VERSION, type: 'queue_state', status: 'queued', target: 'any' });
    lobby.queueState({ v: PROTOCOL_VERSION, type: 'queue_state', status: 'matched', target: 'any', players: 3 });
    expect(lobby.phase).toBe('matched');
    expect(lobby.matchPlayers).toBe(3);
  });

  it('explains how a search ended, back where the player lands', () => {
    const lobby = fresh();
    lobby.queueState({ v: PROTOCOL_VERSION, type: 'queue_state', status: 'queued', target: 'any' });
    lobby.queueState({ v: PROTOCOL_VERSION, type: 'queue_state', status: 'expired', target: 'any' });
    expect(lobby.phase).toBe('idle');
    expect(lobby.queueNotice).not.toBeNull();
  });

  it('backing out of a search cancels it', () => {
    const lobby = fresh();
    lobby.queueState({ v: PROTOCOL_VERSION, type: 'queue_state', status: 'queued', target: 'any' });
    expect(lobby.back()).toEqual({ leavesRoom: false, effects: [{ type: 'cancelQueue' }] });
    expect(lobby.phase).toBe('idle');
  });
});

describe('LobbyMachine — refusals', () => {
  it('answers a room-state refusal on the lobby instead of costing the screen', () => {
    const lobby = fresh();
    lobby.roomJoined(joined());
    const effects = lobby.serverError({ code: 'not_host' });
    expect(lobby.phase).toBe('lobby');
    expect(lobby.lobbyNotice).not.toBeNull();
    expect(effects).toEqual([{ type: 'expireLobbyNotice', text: lobby.lobbyNotice }]);
    // The retirement is tied to the line it was started for, so a newer one is not cut short.
    lobby.serverError({ code: 'rate_limited' });
    expect(lobby.expireLobbyNotice('stale line')).toBe(false);
    expect(lobby.lobbyNotice).not.toBeNull();
  });

  it('retires a dead shortcut and says so on the entry screen', () => {
    const lobby = fresh();
    lobby.joinStarted('GONE1');
    expect(lobby.serverError({ code: 'room_not_found' })).toEqual([{ type: 'forgetRoom', code: 'GONE1' }]);
    expect(lobby.phase).toBe('idle');
    expect(lobby.queueNotice).not.toBeNull();
  });

  it('degrades discovery in place rather than throwing the player off the browser', () => {
    const lobby = fresh();
    lobby.openBrowse();
    lobby.serverError({ code: 'internal_error' });
    expect(lobby.phase).toBe('browse');
    expect(lobby.browseState).toBe('failed');
  });

  it('retires a stale card from the list and explains it next to the list', () => {
    const lobby = fresh();
    lobby.openBrowse();
    lobby.roomList({
      v: PROTOCOL_VERSION, type: 'room_list', reqId: 'r1',
      rooms: [
        { code: 'AAAAA', hostName: 'H', players: 1, capacity: 4, status: 'waiting', timerMode: 'casual' },
        { code: 'BBBBB', hostName: 'H2', players: 2, capacity: 4, status: 'waiting', timerMode: 'casual' },
      ],
    });
    lobby.joinStarted('AAAAA');
    lobby.serverError({ code: 'room_full' });
    expect(lobby.phase).toBe('browse');
    expect(lobby.listings.map((r) => r.code)).toEqual(['BBBBB']);
    expect(lobby.browseNotice).not.toBeNull();
  });

  it('a refusal about the seat itself costs the screen', () => {
    const lobby = fresh();
    lobby.roomJoined(joined());
    lobby.serverError({ code: 'invalid_token' });
    expect(lobby.phase).toBe('error');
    expect(lobby.errorMsg).not.toBeNull();
  });

  it('every refusal releases the in-flight guards so the buttons come back', () => {
    const lobby = fresh();
    lobby.inFlight.add('create');
    lobby.serverError({ code: 'rate_limited' });
    expect(lobby.inFlight.size).toBe(0);
  });
});

describe('LobbyMachine — name entry', () => {
  it('refuses a name with too few visible characters and stays on the screen', () => {
    const lobby = fresh();
    lobby.openName('join');
    expect(lobby.commitName('', 2)).toBe(false);
    expect(lobby.phase).toBe('name');
    expect(lobby.nameError).toBe(true);
  });

  it('returns to the screen the editor was opened from', () => {
    const lobby = fresh();
    lobby.openJoin();
    lobby.openName('join');
    expect(lobby.commitName('Ana', 2)).toBe(true);
    expect(lobby.phase).toBe('join');
    expect(lobby.nameError).toBe(false);
  });
});
