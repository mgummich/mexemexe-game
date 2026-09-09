# MEXE! 1.1.0 — Release notes (online alpha)

*Arruma. Desarruma. Bate.* This release adds an **ALPHA** online multiplayer
mode on top of the 1.0.0 launch build. Everything in the 1.0.0 notes below
still applies unchanged to local play.

## What's new: online alpha

- **2-player private rooms** over WebSocket: create a room, share the
  5-character code, join, both ready, auto-start.
- **Authoritative server**: the server (`npm run server`, plain Node + `ws`,
  port 8787 by default, `GET /health`) holds the only real game state and
  validates every move against the same rules engine (`canConfirmTurn`) local
  play uses — client and server can never disagree about what's legal.
- **Deterministic, hidden-information-safe sync**: each client sees its own
  hand in full and the opponent as a card count only; a revision number
  rejects stale or duplicate submissions.
- **Mexe Mode online**: FEITO/COMPRAR submit-and-wait; the opponent's turn is
  read-only; rejected proposals show the same localized reasons as offline
  (e.g. "Carta inválida").
- **Draw/end/win/stalemate** are server-decided and synced to both clients.
- **Disconnect notice and reconnect**: the opponent is told when you drop; a
  single bounded reconnect attempt resyncs you to the server's current state.

### Known alpha limitations

- Join code entry uses a native `window.prompt()` dialog, not a styled
  in-canvas input.
- Opponent avatar is the generic player icon (no accounts to show one).
- No accounts, matchmaking, ranked play, or chat.
- 2 players only — no 3/4-player online rooms.
- No online rematch — the win screen online only offers MENU.
- No socket liveness probe — a half-open connection can hold a seat until the
  disconnect grace timer notices.
- Reconnect is a single bounded retry, not a persistent retry loop.

### Deployment note

A page served over HTTPS must point the client at a `wss://` server
(`VITE_WS_URL` build-time env var, or `?ws=` at runtime for testing) — a
plain `ws://` connection is blocked from an HTTPS page. See the README
"Online Alpha" section for the full setup.

---

# MEXE! 1.0.0 — Release notes

*Arruma. Desarruma. Bate.* A pixel-art digital card game based on Brazilian
**Mexe-Mexe**, for 2–4 players (you + AI opponents).

## What's included

- Full Mexe-Mexe rules: 7-card deal, runs and sets, free table rearranging
  on your turn (**Mexe Mode**) with undo/redo/reset, FEITO confirm gating,
  COMPRAR draw-and-pass, win on empty hand ("bateu!"), stalemate rule.
- 2–4 players against four AI personalities (Dona Cida, Juninho, Bia,
  Seu Zé) across two skill levels; deterministic, explainable AI that can
  never confirm an illegal table.
- 10-step interactive tutorial (teach-by-doing).
- Portuguese (pt-BR) and English (en-US), switchable at any time.
- Settings: mute, SFX/ambience volume, reduced motion, +25% large text,
  language, reset data — persisted locally.
- Accessibility: colorblind-safe validity indicators (badges + strokes, not
  color-only), full keyboard shortcuts, no flashing effects.
- Verified performance: 57–60fps at 1280×720 and 1920×1080, including an
  80-card stress table.

## Controls

Mouse/touch: drag cards between hand and table. Keyboard (your turn):
Esc pause · Z undo · Shift+Z/Y redo · R reset draft · C comprar · F feito ·
S sort hand · H help.

## Known issues

- Boteco felt smudge partly covered by the dominoes prop (cosmetic, 2p).
- E2e drag coverage uses the editor debug API, not raw synthetic pointer
  drags.
- Ambience is a procedural loop, not a composed music track.
- Pixel font renders PT accents slightly rough at the smallest sizes.

## Credits & license notes

- Design/code: built with Vite, TypeScript and Phaser 3 (MIT-licensed
  framework).
- All art generated with PixelLab (see `docs/PIXELLAB_ASSETS.md` for the
  full prompt/asset table); no copyrighted third-party assets.
- All audio synthesized by `scripts/gen-sfx.mjs` (procedural; no recorded
  samples).

## Asset generation notes

Every sprite lives under `public/assets/` and is hot-swappable: replace the
file at the same path/size and the game picks it up. Missing files fall back
to safe procedural placeholders; missing audio is a silent no-op.

## Build instructions

```bash
npm install
npm run dev        # dev server
npm run build      # production build (tsc + vite)
npm run preview    # serve the build on :4173
npm run verify     # tests + lint + build + screenshot/fps/console gates
```

Useful URL params: `?seed=123` (deterministic deal), `?lang=en|pt`,
`?showcase=…` (jump to a scene; used by the screenshot suite).
