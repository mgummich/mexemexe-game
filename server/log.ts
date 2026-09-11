/**
 * Level-gated structured logger. One JSON line per call — stdout for debug/info, stderr for
 * error, so verify:multiplayer (which asserts server stderr stays empty on a clean run) never
 * trips on a normal log line. Privacy is enforced here, not at call sites: any string value
 * under a key that looks sensitive (name/token/ip/address/remote/agent/secret/password/auth/
 * code/email/session/fingerprint, matched case-insensitively as a substring) is redacted;
 * arrays/objects are collapsed to a size; numbers and short strings pass through unchanged; any
 * surviving string is capped at MAX_STRING_LEN so an oversized value cannot dump a payload. A second,
 * exact-match key list kills the fields that carry free-form text in practice — `message`,
 * `error`, `stack` — so a thrown exception's text can never reach a log line whatever a call
 * site passes; use `errorFields(err)` to log the error's *type* instead.
 */
import type { LogLevel, Mode } from './config';

// Substrings (case-insensitive) that mark a key as sensitive. 'code' covers room codes, which
// are shared secrets — 'codeLength' still passes through because it's a number, never redacted.
const REDACT_KEY_PARTS = [
  'name', 'token', 'ip', 'address', 'remote', 'agent', 'secret', 'password', 'auth', 'code',
  'email', 'session', 'fingerprint',
];

// Exact keys (case-insensitive) that carry free-form text — an exception message, a stack, a
// raw payload. Matched exactly, not as a substring, so bounded fields like `messageType` still
// pass through.
const REDACT_EXACT_KEYS = new Set(['message', 'err', 'error', 'errors', 'stack', 'detail', 'details', 'payload', 'text', 'body']);

const MAX_STRING_LEN = 200;

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 };

export interface LogSink {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultSink: LogSink = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

function truncate(value: string): string {
  return value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}…` : value;
}

/** Cards/hands and any other array or object value never reach the log line — only their
 * size does. Strings under a sensitive-looking key are redacted; numbers are never redacted. */
function safeField(key: string, value: unknown): unknown {
  if (Array.isArray(value)) return { length: value.length };
  if (value !== null && typeof value === 'object') return { keys: Object.keys(value).length };
  if (typeof value === 'string') {
    const lowerKey = key.toLowerCase();
    if (REDACT_EXACT_KEYS.has(lowerKey)) return '[redacted]';
    if (REDACT_KEY_PARTS.some((part) => lowerKey.includes(part))) return '[redacted]';
    return truncate(value);
  }
  return value;
}

function safeFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = safeField(k, v);
  return out;
}

export function createLogger(level: LogLevel, sink: LogSink = defaultSink) {
  const rank = LEVEL_RANK[level];
  function line(lvl: LogLevel, event: string, fields?: Record<string, unknown>): string {
    return JSON.stringify({ ts: new Date().toISOString(), level: lvl, event, ...safeFields(fields) });
  }
  return {
    debug(event: string, fields?: Record<string, unknown>): void {
      if (rank > LEVEL_RANK.debug) return;
      sink.stdout(line('debug', event, fields));
    },
    info(event: string, fields?: Record<string, unknown>): void {
      if (rank > LEVEL_RANK.info) return;
      sink.stdout(line('info', event, fields));
    },
    error(event: string, fields?: Record<string, unknown>): void {
      sink.stderr(line('error', event, fields));
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;

/** An error *class* name is a source-code identifier: letters, digits, underscore, and short.
 * Anything else under `err.name` was assigned at runtime and is therefore data, not a type. */
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * The only sanctioned way to log a caught value. An exception message is attacker- and
 * player-influenced free text (a name, a room code and a whole payload can all end up inside
 * one), so production keeps the *class* of failure and drops the text: an operator needs to
 * know a TypeError is happening in `message_handler_error`, not what it said.
 *
 * `mode` defaults to 'production' — the safe direction to be wrong in. Pass `config.mode` and a
 * development run keeps the message, so local debugging is not blinded by a production rule.
 * The message still goes through the logger's own redaction and length cap on the way out.
 */
export function errorFields(err: unknown, mode: Mode = 'production'): { errorType: string; errorMessage?: string } {
  const name = err instanceof Error ? err.name : '';
  // An unrecognized name is reported as its class, not echoed — a name carrying runtime data
  // would otherwise reintroduce exactly the free text this function exists to drop.
  const errorType = ERROR_NAME.test(name) ? name : err instanceof Error ? 'Error' : typeof err;
  if (mode === 'production') return { errorType };
  const message = err instanceof Error ? err.message : String(err);
  return { errorType, errorMessage: message };
}
