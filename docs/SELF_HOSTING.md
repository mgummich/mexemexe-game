# Self-Hosting MEXEMEXE!

MEXEMEXE! is a static web game: the offline single-player game is all client-side,
with saves in the player's browser (localStorage). Hosting it means serving the
built files.

The **online alpha** (2-player private rooms) additionally needs the small
WebSocket server in `server/`. It is optional — the game works fully with that
service stopped or never started; only the `ONLINE (ALFA)` menu path uses it.

## Quick start (Docker)

Requirements: Docker with the compose plugin.

```bash
git clone <your-repo-url> mexemexe-game
cd mexemexe-game
docker compose up -d --build
```

Open http://localhost:8080 — done. Two containers come up:

| Service       | Image target | Port  | Purpose                              |
| ------------- | ------------ | ----- | ------------------------------------ |
| `mexe`        | `web`        | 8080  | nginx serving the built static game  |
| `mexe-server` | `server`     | 8787  | WebSocket server for the online alpha |

Both are built from the same `Dockerfile` via build targets, sharing one
`npm ci` layer.

- Change a port by editing `ports` in `docker-compose.yml` (e.g. `"3000:80"`).
- Update: `git pull && docker compose up -d --build`.
- Stop: `docker compose down`.
- Static game only (no online play): `docker compose up -d --build mexe`.
- Server health check: `curl http://localhost:8787/health` →
  `{"ok":true,"uptimeSec":142,"rooms":3,"connections":7,"protocol":3}`.

## Prebuilt images (GitHub Container Registry)

Every tagged release publishes both targets to ghcr.io, so you can skip the
local build:

```bash
docker pull ghcr.io/<owner>/mexemexe-game-web:v1.7.0
docker pull ghcr.io/<owner>/mexemexe-game-server:v1.7.0
```

Both also carry a `latest` tag. Note that the published `-web` image is built
with an empty `VITE_WS_URL`, so it falls back to the same host it is served
from. If your server lives elsewhere (or behind HTTPS), build the web image
yourself as described below — that value is baked in at build time.

## Pointing the client at the server

The client resolves the WebSocket URL in this order:

1. `?ws=` query param (e.g. `?ws=wss://mexe.example.com/ws`).
2. `VITE_WS_URL`, baked into the bundle **at build time**.
3. Same-origin default, which follows the page's protocol:
   `ws://<current hostname>:8787` over HTTP, `wss://<current host>/ws` over HTTPS.

The HTTP default works out of the box for `http://localhost:8080` and for a plain
HTTP LAN host, as long as port 8787 is reachable from the browser. The HTTPS
default matches the reverse-proxy layout in the next section, so a TLS deployment
that follows it needs no `VITE_WS_URL` at all — set one only if your proxy exposes
the WebSocket endpoint somewhere other than `/ws`.

`VITE_WS_URL` is a build argument, not a runtime variable — changing it means
rebuilding the `mexe` image:

```bash
VITE_WS_URL=wss://mexe.example.com/ws docker compose up -d --build mexe
```

## Behind a reverse proxy (HTTPS)

**A page served over `https://` cannot open a plain `ws://` connection** — the
browser blocks it. Any HTTPS deployment must terminate TLS in front of the
WebSocket server. The client's own default handles this (`wss://<host>/ws`, see
above), which matches the Caddy layout below; give it an explicit `VITE_WS_URL`
only if your WebSocket route lives elsewhere. Getting this wrong is the most
common first-deployment surprise — the ONLINE menu simply never connects.

Caddy, proxying both on one hostname:

```
mexe.example.com {
    reverse_proxy /ws localhost:8787
    reverse_proxy localhost:8080
}
```

Then build with a matching URL:

```bash
VITE_WS_URL=wss://mexe.example.com/ws docker compose up -d --build mexe
```

Traefik/nginx-proxy work the same way — the WebSocket route needs connection
upgrade headers passed through, which all three do by default for `wss`.

## Without Docker

```bash
npm ci
npm run build
# serve the dist/ directory with anything:
npx serve dist        # or nginx, Apache, GitHub Pages, Netlify...

# optional, for online play:
npm run server        # listens on :8787, PORT= to override
```

## Notes

- No database, no volumes: rooms live in the server process's memory and are
  gone on restart. Restarting `mexe-server` ends any match in progress.
- Player saves and settings are per-browser localStorage; clearing site data
  resets them.
- The images build the game from source, so a rebuild is needed after code
  changes.
- `MEXE_TEST_SEED` on the server forces a deterministic deal. It exists for the
  `verify:multiplayer` suite — never set it in a real deployment. With
  `MEXE_ENV`/`NODE_ENV=production` the server refuses to start rather than
  dealing every match from the same seed.
- Run the server with `MEXE_ENV=production` in a real deployment, and see
  `OPERATIONS.md` for the full environment-variable reference, log format,
  health-endpoint reading, troubleshooting and rollback.

### Service worker cache and deploys

The client's service worker (`public/sw.js`) keys its cache on
`mexe-v<package.json version>` — the version is stamped into `dist/sw.js` at
build time by a Vite plugin. `activate` deletes every cache that isn't the
current one.

That means **bump `package.json`'s version for any deploy that changes files
under `public/assets/`**. The JS bundles are content-hashed and `index.html` is
fetched network-first, so those two always roll forward on their own. Art, SFX
and fonts are not hashed: they live at a fixed URL and are served cache-first,
so a redeploy of the same version keeps serving the previously cached copy to
anyone who already loaded the game.

Players are never force-reloaded. A new build installs as a waiting worker and
the app shows "Nova versão disponível / New version available"; the handover
happens only when the player taps it, so an in-progress match is never
interrupted. A player who never taps picks the update up on their next cold
start of the app.
