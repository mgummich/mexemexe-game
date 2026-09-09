import { describe, expect, it } from 'vitest';
import { createLogger, type LogSink } from '../../server/log';

function fakeSink(): LogSink & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) };
}

describe('logger', () => {
  it('redacts name/token/ip/userAgent fields', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('conn', { name: 'Alice', token: 'abc123', ip: '1.2.3.4', userAgent: 'Mozilla' });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.name).toBe('[redacted]');
    expect(entry.token).toBe('[redacted]');
    expect(entry.ip).toBe('[redacted]');
    expect(entry.userAgent).toBe('[redacted]');
  });

  it('collapses arrays and objects to their size, never contents', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('hand', { hand: [{ id: 'c1' }, { id: 'c2' }], meta: { a: 1, b: 2 } });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.hand).toEqual({ length: 2 });
    expect(entry.meta).toEqual({ keys: 2 });
  });

  it('debug() is silent at info level', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.debug('should_not_appear');
    expect(sink.out).toHaveLength(0);
  });

  it('debug() prints at debug level', () => {
    const sink = fakeSink();
    const log = createLogger('debug', sink);
    log.debug('shows_up');
    expect(sink.out).toHaveLength(1);
  });

  it('redacts a string under clientIp (substring/case-insensitive match)', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('conn', { clientIp: '1.2.3.4' });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.clientIp).toBe('[redacted]');
  });

  it('redacts a string under code', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('room', { code: 'ABCD' });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.code).toBe('[redacted]');
  });

  it('does not redact codeLength, a number', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('room_created', { codeLength: 4 });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.codeLength).toBe(4);
  });

  it('truncates a long string value', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('payload', { message: 'x'.repeat(300) });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.message).toHaveLength(201);
    expect(entry.message.endsWith('…')).toBe(true);
  });

  it('error() writes to stderr, info() to stdout', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('ok');
    log.error('bad');
    expect(sink.out).toHaveLength(1);
    expect(sink.err).toHaveLength(1);
  });
});
