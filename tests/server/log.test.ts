import { describe, expect, it } from 'vitest';
import { createLogger, errorFields, type LogSink } from '../../server/log';

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
    log.info('payload', { reason: 'x'.repeat(300) });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.reason).toHaveLength(201);
    expect(entry.reason.endsWith('…')).toBe(true);
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

// Fake secrets, asserted absent from the emitted line rather than from any one field — a
// redaction that only holds for the key we happened to check is not redaction.
const PLAYER_NAME = 'SECRET_PLAYER_NAME_123';
const ROOM_CODE = 'SECRET_ROOM_CODE_456';
const RECONNECT_TOKEN = 'SECRET_RECONNECT_TOKEN_789';
const CLIENT_IP = '203.0.113.42';

describe('logger privacy canaries', () => {
  it('keeps player names, room codes, tokens and IPs out of every emitted line', () => {
    const sink = fakeSink();
    const log = createLogger('debug', sink);
    log.info('joined', { name: PLAYER_NAME, playerName: PLAYER_NAME, code: ROOM_CODE, roomCode: ROOM_CODE });
    log.info('resumed', { token: RECONNECT_TOKEN, reconnectToken: RECONNECT_TOKEN });
    log.info('conn', { ip: CLIENT_IP, remoteAddress: CLIENT_IP, clientIp: CLIENT_IP, userAgent: 'Mozilla/5.0' });
    const all = [...sink.out, ...sink.err].join('\n');
    for (const canary of [PLAYER_NAME, ROOM_CODE, RECONNECT_TOKEN, CLIENT_IP]) {
      expect(all).not.toContain(canary);
    }
  });

  it('redacts free-form text keys exactly, leaving bounded lookalikes alone', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('handled', { message: PLAYER_NAME, error: ROOM_CODE, stack: 'at foo', messageType: 'submit_turn' });
    const entry = JSON.parse(sink.out[0]!);
    expect(entry.message).toBe('[redacted]');
    expect(entry.error).toBe('[redacted]');
    expect(entry.stack).toBe('[redacted]');
    // Bounded, predefined, and useful — a substring match on 'message' would have eaten it.
    expect(entry.messageType).toBe('submit_turn');
  });

  it('never serializes an arbitrary object, however deep', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.info('state', { view: { hand: [{ id: ROOM_CODE }], player: { name: PLAYER_NAME } } });
    expect(sink.out[0]).not.toContain(ROOM_CODE);
    expect(sink.out[0]).not.toContain(PLAYER_NAME);
  });
});

describe('errorFields', () => {
  it('keeps the error type and drops the message', () => {
    const err = new TypeError(`cannot read hand of ${PLAYER_NAME} in ${ROOM_CODE}`);
    expect(errorFields(err)).toEqual({ errorType: 'TypeError' });
  });

  it('defaults to production, the safe direction to be wrong in', () => {
    // A call site that forgets to pass a mode must not start logging exception text.
    expect(errorFields(new Error(ROOM_CODE))).toEqual({ errorType: 'Error' });
    expect(errorFields(new Error(ROOM_CODE), 'production')).toEqual({ errorType: 'Error' });
  });

  it('keeps the message in development, where the operator is the developer', () => {
    const fields = errorFields(new TypeError('bad meld'), 'development');
    expect(fields).toEqual({ errorType: 'TypeError', errorMessage: 'bad meld' });
  });

  it('never echoes a runtime-assigned name — an error type is a source identifier', () => {
    // `name` is writable, so a name carrying data would smuggle free text back into the line.
    const err = new Error('boom');
    err.name = `Error: ${PLAYER_NAME} in ${ROOM_CODE}`;
    expect(errorFields(err)).toEqual({ errorType: 'Error' });

    const longName = new Error('boom');
    longName.name = 'A'.repeat(200);
    expect(errorFields(longName)).toEqual({ errorType: 'Error' });

    // A genuine custom class name still passes — it is a static identifier in the source.
    class ProtocolError extends Error {
      override name = 'ProtocolError';
    }
    expect(errorFields(new ProtocolError('x'))).toEqual({ errorType: 'ProtocolError' });
  });

  it('logs a thrown exception without persisting its text', () => {
    const sink = fakeSink();
    const log = createLogger('info', sink);
    log.error('message_handler_error', errorFields(new Error(`token ${RECONNECT_TOKEN}`)));
    const entry = JSON.parse(sink.err[0]!);
    expect(entry.errorType).toBe('Error');
    expect(sink.err[0]).not.toContain(RECONNECT_TOKEN);
  });

  it('survives a non-Error throw', () => {
    expect(errorFields(PLAYER_NAME)).toEqual({ errorType: 'string' });
    expect(errorFields(null)).toEqual({ errorType: 'object' });
  });
});
