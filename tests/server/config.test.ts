import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../server/config';
import { DEFAULT_DISCONNECT_GRACE_MS, DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_MAX_ROOMS, RoomManager } from '../../server/rooms';

describe('loadConfig', () => {
  it('defaults with an empty env', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(8787);
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.mode).toBe('development');
    expect(cfg.logLevel).toBe('info');
    expect(cfg.maxRooms).toBe(500);
    expect(cfg.maxConnections).toBe(2_000);
    expect(cfg.maxConnectionsPerIp).toBe(20);
    expect(cfg.disconnectGraceMs).toBe(30_000);
    expect(cfg.idleTimeoutMs).toBe(10 * 60_000);
    expect(cfg.testSeed).toBeUndefined();
  });

  it('takes its room defaults from the room aggregate, so a bare RoomManager and a deployment agree', () => {
    const cfg = loadConfig({});
    expect(cfg.maxRooms).toBe(DEFAULT_MAX_ROOMS);
    expect(cfg.disconnectGraceMs).toBe(DEFAULT_DISCONNECT_GRACE_MS);
    expect(cfg.idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    // And the default a RoomManager built with no deps actually applies is that same number:
    // a room created without env config seeds its reconnect grace from it.
    const rooms = new RoomManager();
    const created = rooms.createRoom('Host');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(rooms.getRoomInfo(created.code)!.settings.reconnectGraceMs).toBe(DEFAULT_DISCONNECT_GRACE_MS);
  });

  it('rejects a non-numeric PORT, naming the var', () => {
    expect(() => loadConfig({ PORT: 'nope' })).toThrow(/PORT/);
  });

  it('rejects a negative PORT', () => {
    expect(() => loadConfig({ PORT: '-1' })).toThrow(/PORT/);
  });

  it('rejects MEXE_TEST_SEED set in production mode', () => {
    expect(() => loadConfig({ MEXE_ENV: 'production', MEXE_TEST_SEED: '42' })).toThrow(/MEXE_TEST_SEED/);
  });

  it('allows MEXE_TEST_SEED in development mode', () => {
    const cfg = loadConfig({ MEXE_TEST_SEED: '42' });
    expect(cfg.testSeed).toBe(42);
  });

  it('honors an explicit debug LOG_LEVEL', () => {
    expect(loadConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
  });

  it('reads connection caps from env', () => {
    const cfg = loadConfig({ MEXE_MAX_CONNECTIONS: '50', MEXE_MAX_CONNECTIONS_PER_IP: '3' });
    expect(cfg.maxConnections).toBe(50);
    expect(cfg.maxConnectionsPerIp).toBe(3);
  });
});

describe('MEXE_METRICS_TOKEN', () => {
  it('is undefined when unset or empty, which keeps /metrics closed in production', () => {
    expect(loadConfig({}).metricsToken).toBeUndefined();
    expect(loadConfig({ MEXE_METRICS_TOKEN: '' }).metricsToken).toBeUndefined();
  });

  it('rejects a token short enough to guess rather than pretending it protects anything', () => {
    expect(() => loadConfig({ MEXE_METRICS_TOKEN: 'short' })).toThrow(ConfigError);
  });

  it('accepts a token of a usable length', () => {
    expect(loadConfig({ MEXE_METRICS_TOKEN: 'x'.repeat(16) }).metricsToken).toBe('x'.repeat(16));
  });
});

describe('MEXE_ALLOWED_ORIGINS', () => {
  it('parses a comma list, trimming whitespace and trailing slashes', () => {
    const cfg = loadConfig({ MEXE_ALLOWED_ORIGINS: 'https://mexe.example/, http://localhost:5173 ,' });
    expect(cfg.allowedOrigins).toEqual(['https://mexe.example', 'http://localhost:5173']);
  });

  it('is optional in development, where an empty list means no check', () => {
    expect(loadConfig({}).allowedOrigins).toEqual([]);
  });

  it('refuses to start production on silence, so an omission cannot pass for a decision', () => {
    expect(() => loadConfig({ MEXE_ENV: 'production' })).toThrow(/MEXE_ALLOWED_ORIGINS/);
    expect(() => loadConfig({ MEXE_ENV: 'production', MEXE_ALLOWED_ORIGINS: '  ' })).toThrow(/MEXE_ALLOWED_ORIGINS/);
  });

  it('accepts an explicit any-origin production deployment', () => {
    expect(loadConfig({ MEXE_ENV: 'production', MEXE_ALLOWED_ORIGINS: '*' }).allowedOrigins).toEqual(['*']);
  });
});

describe('MEXE_TRUSTED_PROXY_HOPS', () => {
  it('defaults to trusting no proxy, which is what makes X-Forwarded-For ignorable', () => {
    expect(loadConfig({}).trustedProxyHops).toBe(0);
  });

  it('reads a hop count and rejects a negative or fractional one', () => {
    expect(loadConfig({ MEXE_TRUSTED_PROXY_HOPS: '2' }).trustedProxyHops).toBe(2);
    expect(() => loadConfig({ MEXE_TRUSTED_PROXY_HOPS: '-1' })).toThrow(/MEXE_TRUSTED_PROXY_HOPS/);
    expect(() => loadConfig({ MEXE_TRUSTED_PROXY_HOPS: '1.5' })).toThrow(/MEXE_TRUSTED_PROXY_HOPS/);
  });
});
