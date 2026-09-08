# Self-Hosting MEXE!

MEXE! is a fully static web game — no backend, no database. Saves live in the
player's browser (localStorage). Hosting it means serving the built files.

## Quick start (Docker)

Requirements: Docker with the compose plugin.

```bash
git clone <your-repo-url> mexemexe-game
cd mexemexe-game
docker compose up -d --build
```

Open http://localhost:8080 — done.

- Change the port by editing `ports` in `docker-compose.yml` (e.g. `"3000:80"`).
- Update: `git pull && docker compose up -d --build`.
- Stop: `docker compose down`.

## Behind a reverse proxy (HTTPS)

The container serves plain HTTP on port 80. Put your usual proxy in front,
e.g. with Caddy:

```
mexe.example.com {
    reverse_proxy localhost:8080
}
```

Or add Traefik/nginx-proxy labels to the `mexe` service as you would for any
static site container.

## Without Docker

Any static file server works:

```bash
npm ci
npm run build
# serve the dist/ directory with anything:
npx serve dist        # or nginx, Apache, GitHub Pages, Netlify...
```

## Notes

- No environment variables, no volumes, no persistence to manage.
- Player saves are per-browser localStorage; clearing site data resets progress.
- The image builds the game from source, so a rebuild is needed after code changes.
