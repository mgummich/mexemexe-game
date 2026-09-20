# Assets

Every shipped asset, its source and its path. All art is generated with
[PixelLab](https://pixellab.ai) (Pro model unless noted); a few geometric
assets and all audio are generated procedurally by scripts in `scripts/`.

**How assets load.** `src/assets/manifest.ts` lists every asset with key, path
and size. `BootScene` GET-probes each path and substitutes a procedural
fallback texture (`src/assets/fallbacks.ts`) for anything missing, so a missing
file degrades to placeholder art instead of crashing. Fallbacks show up in
`window.__MEXE__.missingAssets`, and `npm run verify` fails if that list is not
empty.

**Replacing an asset.** Drop a file with the same path and size under
`public/assets/` — no code change needed. Adding a *new* asset means a manifest
entry plus a row in this file.

**Regenerating.** `npm run gen:cosmetics` (procedural tables, card backs,
emotes), `npm run gen:icons` (PWA icons), `node scripts/gen-sfx.mjs` (all SFX).
All three are deterministic: re-running produces byte-identical files.

**Music masters.** `music/` at the repo root holds the two unprocessed source
tracks; the shipped, bitrate-normalised copies live in
`public/assets/audio/music/` and are the ones the game streams. Music is never
cached by the service worker (see [PWA_OFFLINE.md](PWA_OFFLINE.md)).

Card faces are composed at runtime from the PixelLab blank card + suit pips +
PixelLab pixel font — this guarantees 52 consistent, readable faces (AI
free-drawing all 52 would scramble rank glyphs); see the note at the end.

| Asset | Prompt (short) | Size | Path | Status |
|---|---|---|---|---|
| Pixel font | warm cream chunky playful arcade font, Bold, 8px | ttf | /public/assets/ui/font.ttf | ✅ done |
| Card blank face | blank playing card face, cream paper, brown border | 72×96 | /public/assets/cards/blank.png | ✅ done |
| 52 card faces | composed: blank + suit pip + font rank | 72×96 | runtime textures | ✅ composed |
| Card back 0 (blue) | deep blue + gold lattice | 72×96 | /public/assets/cards/back-0.png | ✅ done |
| Card back 1 (junina) | golden yellow, bunting flags + viola | 72×96 | /public/assets/cards/back-1.png | ✅ done |
| Card back 2 (monstera) | tropical green monstera damask | 72×96 | /public/assets/cards/back-2.png | ✅ done |
| Card back 3 (terracotta) | terracotta red, cream waves | 72×96 | /public/assets/cards/back-3.png | ✅ done |
| Suit: hearts | red heart pip | 32×32 | /public/assets/ui/suit-hearts.png | ✅ done |
| Suit: diamonds | orange diamond pip | 32×32 | /public/assets/ui/suit-diamonds.png | ✅ done |
| Suit: clubs | charcoal clover pip | 32×32 | /public/assets/ui/suit-clubs.png | ✅ done |
| Suit: spades | charcoal spade pip | 32×32 | /public/assets/ui/suit-spades.png | ✅ done |
| BG boteco table | green felt + wood, cafezinho, top-down | 480×270 | /public/assets/tables/boteco.png | ✅ done |
| BG kitchen table | red checkered toalha, pão de queijo | 480×270 | /public/assets/tables/kitchen.png | ✅ done |
| BG menu (boteco exterior) | dusk boteco, string lights, bunting | 480×270 | /public/assets/tables/menu.png | ✅ done (trimmed side bars) |
| Avatar Dona Cida | grandmother, glasses, floral blouse | 48×48 | /public/assets/characters/avatar-cida.png | ✅ done |
| Avatar Juninho | young man, cap, football shirt | 48×48 | /public/assets/characters/avatar-juninho.png | ✅ done |
| Avatar Bia | curly hair, headphones | 48×48 | /public/assets/characters/avatar-bia.png | ✅ done |
| Avatar Seu Zé | straw hat, mustache | 48×48 | /public/assets/characters/avatar-ze.png | ✅ done |
| Avatar player | golden shirt, fanned cards | 48×48 | /public/assets/characters/avatar-player.png | ✅ done |
| Logo "MEXEMEXE!" | chunky golden wordmark | 320×128 | /public/assets/ui/logo.png | ✅ done |
| FEITO button | green wooden button blank | 128×44 | /public/assets/ui/feito-normal.png | ✅ done |
| COMPRAR button | orange wooden button blank | 128×44 | /public/assets/ui/comprar-normal.png | ✅ done |
| Small button | wooden square button | 36×36 | /public/assets/ui/btn-small-normal.png | ✅ done |
| Panel | warm wooden panel, rope trim | 96×96 | ~~/public/assets/ui/panel.png~~ | 🗑 removed Phase 22 — never drawn; UI panels are `Graphics` rounded rects (`GameScene.buildStaticUi`) |
| Emote bubble | white speech bubble | 60×54 | /public/assets/ui/emote-bubble.png | ✅ done |
| Victory banner | festive banner, bunting + gold | 320×96 | /public/assets/ui/banner-victory.png | ✅ done |
| Sparkle | 4-point gold sparkle | 32×32 | /public/assets/effects/sparkle.png | ✅ done |
| Tutorial icons ×4 | meld/drag/draw/win glyphs | 32×32 | ~~/public/assets/ui/tut-*.png~~ | 🗑 removed Phase 22 — never drawn; `TutorialScene` is text + board highlights |
| SFX ×9 + ambience loop | procedural synthesis (PixelLab has no audio) | wav | /public/assets/audio/*.wav | ✅ done (scripts/gen-sfx.mjs) |

Button hover/pressed/disabled states derive from `-normal` via runtime tint
(see PixelButton) — fewer assets, i18n-safe (text drawn by engine). The slab is
drawn as a nine-slice, so one authored aspect covers every button size in the
game without stretching its rim: a button asset is authored once, at the family's
source size, and never per size.

## Producing or regenerating an asset

One workflow, whether the asset is new or a replacement. The steps exist because
generated art has no build step to catch a mistake: the file *is* the source.

**1. Decide which kind it is.**

| Kind | Made with | Reproducible? |
|---|---|---|
| Illustrated art — characters, tables, cards, props, banners | PixelLab (Pro unless a row says otherwise) | **No.** The same prompt gives a different image. The file in `public/assets/` is the master |
| Geometric / procedural — table felts, card backs, emote glyphs, PWA icons, every SFX | `scripts/gen-cosmetics.mjs`, `gen-icons.mjs`, `gen-sfx.mjs` | **Yes, byte-identically.** Re-running and seeing a clean `git status` is the check |

**2. Generate it at the family's source size** — the table in
[ART_DIRECTION.md](ART_DIRECTION.md) §Resolution policy. Sprites are native at
`RENDER_SCALE` (3× their world units); the ten backgrounds are the one exception,
decided there.

**3. Name it for its family, not for its content.**
`assets/<family>/<name>.png`, lowercase, hyphenated. A portrait variant of a
background is `<name>-portrait.png`. Button states are **not** files — hover,
pressed and disabled are runtime tints of `-normal` (`PixelButton`), which is why
three button files cover twelve states.

**4. Wire it once.** A new asset needs a `def(...)` line in
`src/assets/manifest.ts` with its world-unit size. Nothing else: `BootScene`
probes, loads and falls back automatically, and a missing file shows up in
`window.__MEXE__.missingAssets` rather than crashing.

**5. Record it in the same change.** A row in this file: asset, the **full
prompt** (the later sections below are the standard to follow — not a summary,
the prompt you actually sent), size, path, status. A PixelLab asset with no
recorded prompt cannot be re-attempted, which is the whole of its provenance.

**6. Review it in place, not on its own.** `tests/assets.test.ts` runs inside
`npm run test` and catches the objective defects first — a file the manifest does
not know about, a size that does not match the family, a sprite with no alpha, a
name that is not `family/lowercase-hyphenated.png`. Then the human part: Capture the golden frames
([ART_DIRECTION.md](ART_DIRECTION.md) §Accepting an asset) before and after, on
the same machine — captures are byte-stable there, so the comparison is real —
and walk the eight acceptance checks. `npm run verify` must stay green: it fails
on a non-empty `missingAssets` and on the fps floors, which is how an asset that
is too large to draw gets caught.

**7. Bump the version.** Anything under `public/assets/` changing means the
service-worker cache key must change, or players who already have the game keep
the old file — `npm run release` does it, and
[OPERATIONS.md](OPERATIONS.md) §Releasing explains why.

**Versioning of the art itself is the file's history.** There is no `-v2` suffix
and no parallel directory of old attempts: a replacement overwrites its path, the
row in this file is updated, and git holds what it was. A second copy under a new
name is how two assets end up shipped for one purpose.

## Visual debt (Phase 24 audit)

Measured, not eyeballed: every file under `public/assets/` was cross-checked
against `src/assets/manifest.ts` and its pixel size compared with the size it is
actually drawn at (`RENDER_SCALE = 3` in `src/main.ts` — the canvas renders three
device pixels per world unit so sprites land on their native texture size).

| Family | File size | Drawn at | Source ÷ drawn | Verdict |
|---|---|---|---|---|
| Table and menu backgrounds (10 files) | 480×270 landscape, 224×400 portrait | 1440×810 / 672×1200 | **0.33×** | **P2 — the only debt.** Upscaled 3×, so the background's pixel grid is three device pixels wide while every sprite in front of it is one. Visible as a coarser block size behind a crisp foreground |
| Cards (blank, 5 backs), avatars (9), emotes (6), bubble, buttons, banner, logo, dominoes prop — 27 files | native | native | **1.0×** | no debt, and no headroom: a higher `RENDER_SCALE` would put every one of these below native |
| Suit pips (4), sparkle | 32×32 | 24×24 | 1.33× | no debt |

(Measured from the PNG headers against `manifest.ts` × `RENDER_SCALE`, not from
this file's own size column — two rows of which were stale, and are now corrected:
the card files are 72×96, not the 48×64 they were first generated at.)

Everything else the audit looked for is clean:

- **No placeholders ship.** Every manifest path resolves on disk, and
  `npm run verify` fails if `window.__MEXE__.missingAssets` is non-empty, so a
  missing file cannot pass as art.
- **No orphans.** Every file under `public/assets/` is reachable from the
  manifest (or, for the five music tracks, from `src/audio/music.ts`, which
  streams them outside the Phaser loader on purpose).
- **No missing states.** Button hover/pressed/disabled are runtime tints of
  `-normal`, which is why there are three button files rather than twelve.
- **Provenance is recorded** per asset in the table above: PixelLab, or a
  deterministic script that regenerates it byte-identically.

**Replacement scope, explicitly.** One family — the ten backgrounds — and only
if the resolution strategy decides the mixed pixel grid is wrong rather than
stylistic. Nothing else in this repository needs regenerating for quality
reasons. That decision is Phase 26's; production, if it happens, is Phase 30's.

## Later additions (integrated)

| Asset | Prompt (short) | Size | Path | Status |
|---|---|---|---|---|
| Emote: excited | yellow exclamation icon | 36×36 | /public/assets/ui/emote-excited.png | ✅ done — shown on AI confirm, <3 hand cards played |
| Emote: thinking | grey rising dots icon | 36×36 | /public/assets/ui/emote-thinking.png | ✅ done — shown on AI draw |
| Emote: annoyed | red anger-vein cross icon | 36×36 | /public/assets/ui/emote-annoyed.png | ✅ done — shown on AI fallback error |
| Emote: happy | golden musical note icon | 36×36 | /public/assets/ui/emote-happy.png | ✅ done — shown on AI confirm, ≥3 hand cards played |
| Prop: dominoes box | worn wooden dominoes box, top-down | 64×48 | /public/assets/tables/prop-dominoes.png | ✅ done — covers boteco felt smudge (2p games only) |

## Procedural additions (generated by `scripts/gen-cosmetics.mjs`)

Generated by `scripts/gen-cosmetics.mjs` (deterministic, seeded LCG, hand-rolled
PNG encoder — same pattern as `scripts/gen-sfx.mjs` for audio), NOT PixelLab.
PixelLab regeneration remains a possible future upgrade once credits are back.

| Asset | Description | Size | Path | Status |
|---|---|---|---|---|
| BG quintal table | sunny backyard patio, tiled floor border, wood centre | 480×270 | /public/assets/tables/quintal.png | ✅ done — procedural |
| BG feira table | street-market stall, striped awning + crate borders, worn wood centre | 480×270 | /public/assets/tables/feira.png | ✅ done — procedural |
| Card back 4 (azulejo) | blue-and-white tile lattice | 72×96 | /public/assets/cards/back-4.png | ✅ done — procedural (72×96, the same canvas as back-0..3) |
| Emote: sleepy | teal "Zzz" | 36×36 | /public/assets/ui/emote-sleepy.png | ✅ done — procedural |
| Emote: confident | gold star | 36×36 | /public/assets/ui/emote-confident.png | ✅ done — procedural |

## Extra avatars — PixelLab

4 avatars deferred earlier in Phase 9 (blocked on credits) generated once the
PixelLab subscription renewed. Generated via `create_image_pro` (16
candidates/call, best frame picked by eye), same bust-portrait / front-facing
/ thick single-color black outline / flat cel shading / transparent-background
treatment as the original 5 avatars. Original PixelLab generations, no
copyrighted source.

| Asset | Prompt used | Size | Path | Status |
|---|---|---|---|---|
| Avatar Rosa | pixel art game avatar, bust portrait, front-facing head and shoulders, older Brazilian woman, headscarf, big hoop earrings, warm smile, thick single-color black outline, flat cel shading, warm skin tone, transparent background | 72×72 | /public/assets/characters/avatar-rosa.png | ✅ done |
| Avatar Tuca | pixel art game avatar, bust portrait, front-facing head and shoulders, teenage Brazilian boy, skate helmet, freckles, cheerful expression, thick single-color black outline, flat cel shading, warm skin tone, transparent background | 72×72 | /public/assets/characters/avatar-tuca.png | ✅ done |
| Avatar Nina | pixel art game avatar, bust portrait, front-facing head and shoulders, young Brazilian woman, short afro hair, denim jacket, confident smile, thick single-color black outline, flat cel shading, warm skin tone, transparent background | 72×72 | /public/assets/characters/avatar-nina.png | ✅ done |
| Avatar Ivo | pixel art game avatar, bust portrait, front-facing head and shoulders, middle-aged Brazilian man, glasses, barber apron, comb in breast pocket, friendly expression, thick single-color black outline, flat cel shading, warm skin tone, transparent background | 72×72 | /public/assets/characters/avatar-ivo.png | ✅ done |

Tables, card backs and emotes above remain procedurally generated
(`scripts/gen-cosmetics.mjs`) — this Phase 9 PixelLab pass only covers the 4
avatars; no re-generation of the procedural set was done or needed.

## Portrait table backgrounds — PixelLab

`coverBackground()` (src/ui/menu-layout.ts) uniform-scales art to fill the
world; the 480x270 landscape art crops ~69% away in the 270x480 portrait
world. These are dedicated 9:16 portrait variants (224x400 — PixelLab's
closest 4px-aligned size to the exact 225x400 ratio, capped by its 400x400
max canvas area) so portrait needs no cropping. Loaded unconditionally
alongside the landscape set (no orientation-conditional loading);
`coverBackground()` picks `${key}-portrait` in portrait, falling back to the
landscape key if that texture failed to load (`backgroundKeyFor()`, tested
in tests/menu-layout.test.ts). `makeFallback()`'s `bg-` prefix match already
covers the new keys, no change needed.

| Asset | Prompt used | Size | Path | Orientation | Used by | Fallback |
|---|---|---|---|---|---|---|
| BG boteco portrait | dark green felt table surface filling the frame, thick warm wooden frame around all four edges, a small coffee cup and a folded napkin tucked near the top edge only, large clear empty felt in the middle, flat overhead top-down view, the table surface completely fills the frame edge to edge, no room, no walls, no chairs, no floor, no horizon, no perspective, no text, no signs, no letters, no numbers, no logos, original pixel art | 224×400 | /public/assets/tables/boteco-portrait.png | portrait | WinScene | landscape `bg-boteco` |
| BG kitchen portrait | vivid red and cream white gingham checkered picnic tablecloth pattern covering entire frame evenly, bold thick red bands crossing cream white bands with clear white cross-hatch where bands overlap, only two props: a red ceramic mug near top edge, a small round plate of pao de queijo bread near bottom edge, large clear checkered area in middle, flat overhead top-down view, surface fills the frame edge to edge, no room, no walls, no chairs, no horizon, no perspective, no text, no letters, no numbers, no logos, original pixel art | 224×400 | /public/assets/tables/kitchen-portrait.png | portrait | (table cosmetic, unused directly by a scene yet — parity with landscape `bg-kitchen`) | landscape `bg-kitchen` |
| BG menu portrait | Cozy Brazilian pixel-art vertical menu background, dusk boteco exterior facade at night, warm string lights and colorful bunting flags overhead, closed wooden double doors, potted palm plants either side, tiled ground, festive inviting mood, no signage, no readable words, no shop sign, no text, no logos, crisp pixel art, mobile portrait composition | 224×400 | /public/assets/tables/menu-portrait.png | portrait | MenuScene, SetupScene, OnlineScene | landscape `bg-menu` |
| BG quintal portrait | warm brown vertical wooden plank table surface filling the frame, a yellow and orange checkered tile border running along all four edges, nothing in the middle, flat overhead top-down view, the table surface completely fills the frame edge to edge, no room, no walls, no chairs, no floor, no horizon, no perspective, no text, no signs, no letters, no numbers, no logos, original pixel art | 224×400 | /public/assets/tables/quintal-portrait.png | portrait | (table cosmetic, parity with landscape `bg-quintal`) | landscape `bg-quintal` |
| BG feira portrait | grey-brown burlap canvas market-stall surface with a clearly visible diagonal weave texture filling the frame, dark wooden posts down left and right edges, a red and cream striped awning valance across the top edge only, nothing in the middle, flat overhead top-down view, surface fills the frame edge to edge, no room, no walls, no chairs, no horizon, no perspective, no text, no letters, no numbers, no logos, original pixel art | 224×400 | /public/assets/tables/feira-portrait.png | portrait | (table cosmetic, parity with landscape `bg-feira`) | landscape `bg-feira` |

First menu-portrait generation baked in a readable shop-sign wordmark
("BRAZELA BROGUECO") — rejected and regenerated with the shop doors closed
and an explicit "no signage, no readable words, no shop sign" prompt instead.
menu-portrait was kept as-is from that earlier pass (it's a street-facade
scene, not a tabletop, so it wasn't affected by the room/chairs/perspective
issue below).

Second pass regenerated boteco/kitchen/quintal/feira portrait — the first
pass had rendered these as 3/4-perspective room scenes (table+chairs,
market-stall elevation, backyard with door/plants) instead of flat overhead
table surfaces, and feira had baked-in readable text on signage. Regenerated
via `create_image_pixflux` with `view: "high top-down"`,
`outline: "selective outline"`, and `color_image_base64` set to a small
(~8x8px, 6-color) palette swatch quantized from each landscape sibling PNG
(ImageMagick `convert -resize 8x8 -colors 6`) to lock the palette without
transferring the full-size PNG inline. boteco, quintal, feira passed on the
first attempt; kitchen needed one retry (first attempt drew a busy beige
overlay box in the middle plus extra unlisted props) — accepted on the
second attempt, palette leans a bit more salmon/pink than the landscape's
vivid red/white gingham but is not a clash.

Third pass (composition kept, palette-only refine) re-ran kitchen, quintal
and feira in place via `create_image_pixflux` `init_image_base64` (the
existing 224×400 portrait PNG) + `color_image_base64`, per the workflow
above. The plain `-resize 8x8 -colors 6` swatch used in pass two turned out
to blend distinct colors into a single averaged pastel when downsizing
(kitchen's vivid red + white averaged to flat salmon) — switched to
`-colors 6` (quantize at full res first) then `-filter point -resize 8x8`
(nearest-neighbor, no blending) for correct discrete swatch colors. Large
inline PNGs (any raw portrait or landscape base64 over ~15KB, occasionally
even ~5-6KB) were repeatedly silently truncated in transit by the MCP
transport, producing "broken data stream" decode errors; worked around by
quantizing the offending PNG to 16 colors (`-colors 16 PNG8:`) before
base64-ing, which reliably fit.

- feira: accepted on attempt 2 of 3, `init_image_strength: 150` (attempt 1
  at 300 kept too much of the original and lost the weave/posts entirely,
  going flat pinkish-mauve). Result reads clearly as grey-brown burlap with
  visible wood posts and the red/cream awning matching the landscape; the
  diagonal weave lines are present but subtle rather than bold. Attempt 3 at
  100 with a stronger "diagonal woven crosshatch" prompt distorted the posts
  and was discarded in favor of attempt 2.
- kitchen: **not fully resolved after 4 attempts** (300, 180, 150, 230, 60 —
  one extra beyond the nominal 3 since the first two used the flawed swatch
  above). Every attempt kept the checkered composition and both props
  (mug/plate) but the palette would not move off muted salmon/tan into the
  landscape's vivid red + white; lower strengths instead broke the grid into
  floating squares without gaining saturation. Kept the best version —
  attempt 2 (`init_image_strength: 180`, flawed swatch) — since it has the
  cleanest, most regular checkerboard grid of the batch even though the
  color gap to the landscape remains. Revisit with a stronger/more literal
  text_guidance_scale or a non-init-image (fresh generation + palette-only
  lock) approach if this needs to match more closely.
- quintal: **not resolved after 3 attempts** (300, 180, 120). None produced
  a visible checkered border — strength 300 left the border-less portrait
  essentially unchanged, and 180/120 also failed to introduce the border
  (120 only added faint corner accents) while shifting the plank color
  further from the landscape's richer brown. Kept the **pre-existing
  quintal-portrait.png unchanged** (its thin, faint edge line is closer to
  the landscape than any regenerated attempt) and flagging that a real bold
  checkered border still needs a different approach — possibly
  `inpaint_image` targeted at just the border region instead of a
  whole-image img2img pass.

## Note: card faces are not files

`assets/cards/{suit}-{rank}.png` and `assets/cards/joker.png` are **composed at
runtime** by `src/assets/compose-cards.ts` from three real assets — `cards/blank.png`,
the four `ui/suit-*.png` pips, and `ui/font.ttf` — into 72×96 canvases. Generating 52
full faces would scramble the rank glyphs. They are flagged `composed: true` in
`src/assets/manifest.ts` so `BootScene` never probes or loads them; the on-disk
files listed for them in older
tables above never existed and are not expected to.

All five shipped music tracks are normalised to 128 kbps.
