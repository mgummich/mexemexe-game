/**
 * Level-gated structured logger. One JSON line per call — stdout for debug/info, stderr for
 * error, so verify:multiplayer (which asserts server stderr stays empty on a clean run) never
 * trips on a normal log line. Privacy is enforced here, not at call sites: any string value
 * under a key that looks sensitive (name/token/ip/useragent/secret/password/auth/code,
 * matched case-insensitively as a substring) is redacted; arrays/objects are collapsed to a
 * size; numbers and other short strings pass through unchanged; any surviving string is capped
 * at MAX_STRING_LEN to stop an oversized value from dumping a payload into the log.
 */
import type { LogLevel } from './config';

// Substrings (case-insensitive) that mark a key as sensitive. 'code' covers room codes, which
// are shared secrets — 'codeLength' still passes through because it's a number, never redacted.
const REDACT_KEY_PARTS = ['name', 'token', 'ip', 'useragent', 'secret', 'password', 'auth', 'code'];

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
