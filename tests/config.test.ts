import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWsUrl } from '../src/config';

const httpLoc = { protocol: 'http:', hostname: 'localhost', host: 'localhost:5173', search: '' };
const httpsLoc = { protocol: 'https:', hostname: 'mexe.example.com', host: 'mexe.example.com', search: '' };

describe('resolveWsUrl', () => {
  it('defaults to ws://<hostname>:8787 over http', () => {
    expect(resolveWsUrl(httpLoc)).toBe('ws://localhost:8787');
  });

  it('defaults to wss://<host>/ws over https', () => {
    expect(resolveWsUrl(httpsLoc)).toBe('wss://mexe.example.com/ws');
  });

  it('preserves a non-default port in host over https', () => {
    expect(resolveWsUrl({ ...httpsLoc, host: 'mexe.example.com:8443' })).toBe(
      'wss://mexe.example.com:8443/ws',
    );
  });

  it('?ws= override wins over everything', () => {
    expect(resolveWsUrl({ ...httpsLoc, search: '?ws=wss://override.example.com/ws' })).toBe(
      'wss://override.example.com/ws',
    );
  });

  it('VITE_WS_URL beats the protocol-aware fallback', () => {
    vi.stubEnv('VITE_WS_URL', 'wss://configured.example.com/ws');
    expect(resolveWsUrl(httpLoc)).toBe('wss://configured.example.com/ws');
  });

  afterEach(() => vi.unstubAllEnvs());
});
