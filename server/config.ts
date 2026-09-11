/**
 * Server config, read from env once at startup. Pure `loadConfig(env)` so tests can pass a
 * fake env without touching `process.env` or exiting the real process; the module-level
 * singleton below is the only thing that calls `process.exit`.
 */

export class ConfigError extends Error {}

export type Mode = 'development' | 'production';
export type LogLevel = 'debug' | 'info' | 'error';

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly mode: Mode;
  readonly logLevel: LogLevel;
  readonly maxRooms: number;
  readonly maxConnections: number;
  readonly maxConnectionsPerIp: number;
  readonly disconnectGraceMs: number;
  readonly idleTimeoutMs: number;
  readonly testSeed: number | undefined;
  readonly metricsToken: string | undefined;
}

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';
// Same defaults RoomManager already hardcodes (server/rooms.ts) — moved here so they're
// configurable, not changed.
const DEFAULT_MAX_ROOMS = 500;
const DEFAULT_MAX_CONNECTIONS = 2_000;
const DEFAULT_MAX_CONNECTIONS_PER_IP = 20;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;

/** Env value must parse to a finite positive number, or config load fails naming `name`. */
function parsePositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConfigError(`invalid ${name}: "${raw}" must be a finite positive number`);
  }
  return n;
}

function parseMode(env: NodeJS.ProcessEnv): Mode {
  const raw = env.MEXE_ENV ?? env.NODE_ENV;
  if (raw === 'production') return 'production';
  return 'development';
}

function parseLogLevel(env: NodeJS.ProcessEnv, mode: Mode): LogLevel {
  const raw = env.LOG_LEVEL;
  if (raw === 'debug' || raw === 'info' || raw === 'error') return raw;
  // Debug only when explicitly requested — default is 'info' in both modes.
  void mode;
  return 'info';
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const mode = parseMode(env);
  // MEXE_TEST_SEED=0 is falsy, so it's treated as unset (parsePositiveInt would reject 0 anyway) — fine, 0 isn't a meaningful seed distinct from unset.
  const testSeed = env.MEXE_TEST_SEED ? parsePositiveInt(env, 'MEXE_TEST_SEED', 0) : undefined;
  // Deterministic deals must never ship — a seeded deck in production is a fatal config error.
  if (mode === 'production' && testSeed !== undefined) {
    throw new ConfigError('MEXE_TEST_SEED must not be set when MEXE_ENV/NODE_ENV=production');
  }
  // A guessable metrics token is worse than none: it reads as protection while not being any.
  const metricsToken = env.MEXE_METRICS_TOKEN;
  if (metricsToken !== undefined && metricsToken !== '' && metricsToken.length < 16) {
    throw new ConfigError('MEXE_METRICS_TOKEN must be at least 16 characters');
  }
  return {
    port: parsePositiveInt(env, 'PORT', DEFAULT_PORT),
    host: env.HOST || DEFAULT_HOST,
    mode,
    logLevel: parseLogLevel(env, mode),
    maxRooms: parsePositiveInt(env, 'MEXE_MAX_ROOMS', DEFAULT_MAX_ROOMS),
    maxConnections: parsePositiveInt(env, 'MEXE_MAX_CONNECTIONS', DEFAULT_MAX_CONNECTIONS),
    maxConnectionsPerIp: parsePositiveInt(env, 'MEXE_MAX_CONNECTIONS_PER_IP', DEFAULT_MAX_CONNECTIONS_PER_IP),
    disconnectGraceMs: parsePositiveInt(env, 'MEXE_DISCONNECT_GRACE_MS', DEFAULT_DISCONNECT_GRACE_MS),
    idleTimeoutMs: parsePositiveInt(env, 'MEXE_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS),
    testSeed,
    metricsToken: metricsToken || undefined,
  };
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error(`[config] ${message}`);
    process.exit(1);
  }
}

export const config: Config = loadConfigOrExit();
