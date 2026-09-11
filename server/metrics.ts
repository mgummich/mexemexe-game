/**
 * Prometheus text-format metrics for `/metrics`. Aggregate counts only — there is deliberately
 * no per-room, per-player, per-socket or per-request series here, because one time series per
 * player *is* a tracking system however it is labelled. The only label used at all is a
 * `reason` drawn from a fixed two-value set, so cardinality is bounded by the code, not by
 * traffic. See docs/OBSERVABILITY_PRIVACY.md.
 */

export const counters = {
  connectionsTotal: 0,
  connectionsRejectedGlobalCap: 0,
  connectionsRejectedIpCap: 0,
  disconnectsTotal: 0,
  reconnectsTotal: 0,
  roomsCreatedTotal: 0,
  gamesStartedTotal: 0,
  gamesFinishedTotal: 0,
  messageHandlerErrorsTotal: 0,
  socketErrorsTotal: 0,
};

export interface MetricsSnapshot {
  connections: number;
  rooms: number;
  maxConnections: number;
  maxRooms: number;
  uptimeSec: number;
  heapUsedBytes: number;
  residentBytes: number;
}

function metric(name: string, help: string, type: 'counter' | 'gauge', lines: string[]): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines].join('\n');
}

export function renderMetrics(s: MetricsSnapshot): string {
  return (
    [
      metric('mexemexe_connections_current', 'WebSocket connections currently open.', 'gauge', [
        `mexemexe_connections_current ${s.connections}`,
      ]),
      metric('mexemexe_rooms_current', 'Rooms currently held in memory.', 'gauge', [`mexemexe_rooms_current ${s.rooms}`]),
      metric('mexemexe_connections_capacity_ratio', 'Open connections as a fraction of MEXE_MAX_CONNECTIONS.', 'gauge', [
        `mexemexe_connections_capacity_ratio ${(s.connections / s.maxConnections).toFixed(4)}`,
      ]),
      metric('mexemexe_rooms_capacity_ratio', 'Live rooms as a fraction of MEXE_MAX_ROOMS.', 'gauge', [
        `mexemexe_rooms_capacity_ratio ${(s.rooms / s.maxRooms).toFixed(4)}`,
      ]),
      metric('mexemexe_uptime_seconds', 'Seconds since this process started serving.', 'gauge', [
        `mexemexe_uptime_seconds ${s.uptimeSec}`,
      ]),
      metric('mexemexe_heap_used_bytes', 'V8 heap in use.', 'gauge', [`mexemexe_heap_used_bytes ${s.heapUsedBytes}`]),
      metric('mexemexe_resident_bytes', 'Process resident set size.', 'gauge', [`mexemexe_resident_bytes ${s.residentBytes}`]),
      metric('mexemexe_connections_total', 'WebSocket connections accepted since start.', 'counter', [
        `mexemexe_connections_total ${counters.connectionsTotal}`,
      ]),
      metric('mexemexe_connections_rejected_total', 'Connections refused by an admission cap.', 'counter', [
        `mexemexe_connections_rejected_total{reason="global_cap"} ${counters.connectionsRejectedGlobalCap}`,
        `mexemexe_connections_rejected_total{reason="ip_cap"} ${counters.connectionsRejectedIpCap}`,
      ]),
      metric('mexemexe_disconnects_total', 'WebSocket connections closed since start.', 'counter', [
        `mexemexe_disconnects_total ${counters.disconnectsTotal}`,
      ]),
      metric('mexemexe_reconnects_total', 'Successful seat reconnects since start.', 'counter', [
        `mexemexe_reconnects_total ${counters.reconnectsTotal}`,
      ]),
      metric('mexemexe_rooms_created_total', 'Rooms created since start.', 'counter', [
        `mexemexe_rooms_created_total ${counters.roomsCreatedTotal}`,
      ]),
      metric('mexemexe_games_started_total', 'Matches started since start.', 'counter', [
        `mexemexe_games_started_total ${counters.gamesStartedTotal}`,
      ]),
      metric('mexemexe_games_finished_total', 'Matches that reached game over since start.', 'counter', [
        `mexemexe_games_finished_total ${counters.gamesFinishedTotal}`,
      ]),
      metric('mexemexe_message_handler_errors_total', 'Throws caught by the inbound message handler.', 'counter', [
        `mexemexe_message_handler_errors_total ${counters.messageHandlerErrorsTotal}`,
      ]),
      metric('mexemexe_socket_errors_total', 'Socket-level errors reported by ws.', 'counter', [
        `mexemexe_socket_errors_total ${counters.socketErrorsTotal}`,
      ]),
    ].join('\n') + '\n'
  );
}
