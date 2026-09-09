/**
 * Client-side config. Only `VITE_`-prefixed vars exist in the bundle (Vite
 * strips everything else at build time) and none of them may hold a secret —
 * this whole module ends up readable in the shipped JS.
 */

/** Location fields resolveWsUrl needs — lets tests pass a fake instead of jsdom. */
export type LocationLike = Pick<Location, 'protocol' | 'hostname' | 'host' | 'search'>;

/**
 * Resolves the game server WebSocket URL. Order, see SELF_HOSTING.md
 * "Pointing the client at the server":
 *   1. `?ws=` query override (e2e/verify:multiplayer rely on this).
 *   2. `VITE_WS_URL`, baked in at build time.
 *   3. Same-origin default: `ws://<hostname>:8787` over http (dev/LAN), or
 *      `wss://<host>/ws` over https — a page served over https can't open a
 *      plain ws:// socket, and SELF_HOSTING.md's "Behind a reverse proxy"
 *      Caddy example proxies the `/ws` path to the WebSocket server while
 *      the root path serves the static game, so that's the path that
 *      actually reaches the server for an operator following the doc.
 */
export function resolveWsUrl(loc: LocationLike = location): string {
  const override = new URLSearchParams(loc.search).get('ws');
  if (override) return override;
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (envUrl) return envUrl;
  if (loc.protocol === 'https:') return `wss://${loc.host}/ws`;
  return `ws://${loc.hostname}:8787`;
}
