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
- Static game only (no online play): `docker compose up -d --build --no-deps mexe`.
  `--no-deps` is needed because `mexe` waits for `mexe-server` to report healthy
  (`depends_on: condition: service_healthy`) and would otherwise start it too.
- Server health check: `curl http://localhost:8787/health` →
  `{"ok":true,"uptimeSec":142,"rooms":3,"connections":7,"protocol":3}`.

## Prebuilt images (GitHub Container Registry)

Every tagged release publishes both targets to ghcr.io, so you can skip the
local build:

```bash
docker pull ghcr.io/<owner>/mexemexe-game-web:v1.10.0
docker pull ghcr.io/<owner>/mexemexe-game-server:v1.10.0
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
VITE_WS_URL=wss://mexe.example.com/ws docker compose up -d --build --no-deps mexe
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
VITE_WS_URL=wss://mexe.example.com/ws docker compose up -d --build --no-deps mexe
```

### Traefik

Traefik needs no WebSocket-specific setting — it passes the upgrade through
whenever the client asks for it. The only thing that matters is that `/ws`
routes to `mexe-server` and everything else to `mexe`, with the `/ws` router at
a higher priority so it wins over the catch-all.

With the Docker provider, add labels to `docker-compose.yml` and put both
services on Traefik's network (`docker network create proxy` once):

```yaml
services:
  mexe:
    networks: [proxy]
    labels:
      - traefik.enable=true
      - traefik.http.routers.mexe.rule=Host(`mexe.example.com`)
      - traefik.http.routers.mexe.entrypoints=websecure
      - traefik.http.routers.mexe.tls.certresolver=le
      - traefik.http.services.mexe.loadbalancer.server.port=80

  mexe-server:
    networks: [proxy]
    labels:
      - traefik.enable=true
      - traefik.http.routers.mexe-ws.rule=Host(`mexe.example.com`) && PathPrefix(`/ws`)
      - traefik.http.routers.mexe-ws.priority=100
      - traefik.http.routers.mexe-ws.entrypoints=websecure
      - traefik.http.routers.mexe-ws.tls.certresolver=le
      - traefik.http.services.mexe-ws.loadbalancer.server.port=8787

networks:
  proxy:
    external: true
```

The server ignores the request path, so `/ws` needs no strip-prefix middleware.
Once Traefik reaches the containers directly you can drop the `ports:` mappings
for both services — publishing 8080/8787 on the host is only useful for direct
access.

The same routing as a file-provider config, for a Traefik that is not watching
Docker:

```yaml
http:
  routers:
    mexe:
      rule: "Host(`mexe.example.com`)"
      service: mexe
      entrypoints: [websecure]
      tls: {certresolver: le}
    mexe-ws:
      rule: "Host(`mexe.example.com`) && PathPrefix(`/ws`)"
      priority: 100
      service: mexe-ws
      entrypoints: [websecure]
      tls: {certresolver: le}
  services:
    mexe:
      loadBalancer:
        servers: [{url: "http://127.0.0.1:8080"}]
    mexe-ws:
      loadBalancer:
        servers: [{url: "http://127.0.0.1:8787"}]
```

Either layout matches the client's HTTPS default (`wss://<host>/ws`), so no
`VITE_WS_URL` is needed. If the ONLINE menu never connects, check the browser
console: a `ws://` URL means the page was served over HTTP, and a 404 on the
upgrade means the `/ws` router lost to the catch-all — raise its priority.

nginx-proxy works the same way as Caddy; the WebSocket route needs connection
upgrade headers passed through, which it does by default for `wss`.

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
