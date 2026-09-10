import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config';

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
