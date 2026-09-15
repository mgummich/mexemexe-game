/**
 * Online Phase 7 — the local recent-room list (OD-11/OD-12/OD-14).
 *
 * This is display history, and the tests that matter are the ones about what it is *not*: not a
 * credential store, not authoritative, not unbounded, and not something a corrupt storage key
 * can turn into a join attempt on garbage.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetRoom, MAX_RECENT_ROOMS, readRecentRooms, rememberRoom } from '../../src/net/client';

const RECENT_KEY = 'mexe.online.recent';
const HOUR = 60 * 60 * 1000;

/** Minimal in-memory Storage, because the suite runs in `node` with no DOM. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe('OD recent rooms', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('OD-11 remembers a room locally, most recent first, deduped by code', () => {
    rememberRoom('CAFE7', 'Marina', 1_000);
    rememberRoom('JOGA8', 'Bia', 2_000);
    rememberRoom('CAFE7', 'Marina', 3_000);
    expect(readRecentRooms(3_000).map((r) => r.code)).toEqual(['CAFE7', 'JOGA8']);
  });

  it('stores nothing that could reclaim a seat', () => {
    rememberRoom('CAFE7', 'Marina', 1_000);
    const raw = localStorage.getItem(RECENT_KEY)!;
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(['at', 'code', 'host']);
    // The reconnect token lives in sessionStorage under its own key and never comes near this.
    expect(raw).not.toContain('token');
  });

  it('stays short, so stale history cannot bury the shortcut it exists for', () => {
    for (let i = 0; i < MAX_RECENT_ROOMS + 4; i++) rememberRoom(`ROOM${i}`, 'H', 1_000 + i);
    expect(readRecentRooms(1_100).length).toBe(MAX_RECENT_ROOMS);
  });

  it('OD-12 ages out entries too old to be worth offering', () => {
    rememberRoom('CAFE7', 'Marina', 0);
    expect(readRecentRooms(1 * HOUR).map((r) => r.code)).toEqual(['CAFE7']);
    expect(readRecentRooms(12 * HOUR)).toEqual([]);
  });

  it('OD-14 forgets a room the server has said is gone', () => {
    rememberRoom('CAFE7', 'Marina', 1_000);
    rememberRoom('JOGA8', 'Bia', 2_000);
    forgetRoom('CAFE7', 2_000);
    expect(readRecentRooms(2_000).map((r) => r.code)).toEqual(['JOGA8']);
  });

  it('treats storage as a trust boundary: corrupt history is dropped, never repaired', () => {
    for (const bad of ['{', 'null', '{"code":"X"}', '[{"code":123,"at":1}]', '[{"at":1}]', '["CAFE7"]']) {
      localStorage.setItem(RECENT_KEY, bad);
      expect(readRecentRooms(1_000)).toEqual([]);
    }
    // A code is sanitized to the room alphabet's shape rather than trusted as typed, so a
    // tampered entry cannot smuggle an arbitrary string into a join.
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ code: 'ca fe7<script>', host: 'M', at: 1_000 }]));
    expect(readRecentRooms(1_000)[0]!.code).toBe('CAFE7SCR');
  });

  it('survives storage being unavailable at all', () => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    expect(readRecentRooms(1_000)).toEqual([]);
    expect(() => rememberRoom('CAFE7', 'Marina', 1_000)).not.toThrow();
  });
});
