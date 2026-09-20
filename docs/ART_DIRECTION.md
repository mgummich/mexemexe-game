# MEXEMEXE! — Art Direction

## Pillars

1. **Warm** — golden-hour light, wood, terracotta, string lights. The table feels like Sunday at a Brazilian family gathering.
2. **Readable** — a card's rank and suit must be identifiable at a glance at 1080p. Contrast beats decoration, always.
3. **Tactile** — cards look like worn, well-loved physical objects: soft shadows, slight edge wear, satisfying pickup/drop motion.
4. **Playful** — round shapes, bouncy tweens, expressive character avatars, celebratory sparkle on wins.
5. **Brazilian neighborhood card-table culture** — the boteco plastic table, the family kitchen, cafezinho cups, dominó boxes in the background, festa junina bunting. Atmosphere through *props, palette, names, and language* — never through people stereotypes.
6. **Puzzle clarity** — during Mexe Mode the board is a puzzle: valid melds glow green, broken ones glow red, nothing ambiguous.

## Palette

- Base wood/browns: `#4a3526`, `#5e4632`, `#2b2018`
- Felt green: `#2e6b45` / kitchen toalha red-check: `#a5453a`
- Cream card face: `#f7f2e7`, warm ink: `#2b2b33`
- Hearts `#d82e2e`, Diamonds `#e07b28` (orange-red for suit distinction), Clubs/Spades `#2b2b33`
- Accent gold: `#f7d23e`, confirm green `#2e9e50`, draw orange `#d8892e`, invalid red `#d83a3a`

This is the *art* palette — what the world is painted in. The UI chrome reads
its colours by role from `src/ui/tokens.ts` (`TEXT.*`, `SURFACE.*`, `ACTION.*`),
which is where a re-point of the interface happens; see
[ARCHITECTURE.md](ARCHITECTURE.md) "UI design system".

## Canvas & scaling

- Logical canvas **480×270** landscape / **270×480** portrait (`src/ui/viewport.ts`),
  Phaser `pixelArt: true`, `roundPixels: true`, FIT scaling to whatever the device gives.
- The canvas itself renders at **`RENDER_SCALE = 3`** — 1440×810 — and every camera is zoomed
  by the same factor, so scene code keeps writing plain world-unit coordinates while sprites
  land near their native texture size (`src/main.ts`).
- Cards are **24×32 world units** from 72×96 files — native at `RENDER_SCALE`. Rank glyph
  top-left ~8px, large suit pip bottom-right.
- No texture smoothing, no anti-aliased blur. Crisp 1px outlines, limited palettes per sprite.

### Resolution policy (Phase 26)

**Source resolution is per family, and it is fixed.** A new asset matches the
family it joins; that is check 1 in *Accepting an asset* below.

| Family | Source | World units | Why this size |
|---|---|---|---|
| Sprites: cards, avatars, emotes, UI buttons, banner, logo, props (27 files) | **3× world units** (native at `RENDER_SCALE`) | as drawn | crisp at every target; this is the default, and what every new asset matches |
| Backgrounds | **1× world units** (480×270 / 224×400) | full frame | see the decision below |
| Suit pips, sparkle | 32×32 for 8×8 units | 8×8 | inherited, harmless (a 1.33× source) |

**Backgrounds stay at 480×270, deliberately.** Regenerating the ten background
files at `RENDER_SCALE` would raise them from 175 kB total to roughly 1.5–2 MB —
against a measured first-load budget of 1.5 MB for the whole game excluding music
([PERFORMANCE.md](PERFORMANCE.md)), and every one of them is precached for offline
play. The visible cost of keeping them is a background pixel grid three times the
size of a card's; the visible cost of changing them is a first load three to four times
heavier on the phone this game is mostly played on. The coarser grid also reads as
depth — a soft, blocky table behind crisp cards — which is why this is a decision
and not a deferral. Revisit only if the download budget changes or a device target
appears where the mismatch costs readability rather than style.

**Device coverage.** 1280×720 renders the 1440×810 canvas slightly down (0.89×);
1920×1080 renders it up (1.33×); a 390×844 phone at DPR 2–3 lands between the two.
Both ends are gated: `npm run verify:cross` includes a 2560×1440 desktop and a
412×915 phone at DPR 3, captured per project under
`docs/screenshots/cross-browser/` for eyeballing.
Nearest-neighbour sampling throughout, so every one of those is a sharp scale of
the same pixels rather than a blur — and `roundPixels` keeps a sprite from
straddling half a device pixel. Large screens letterbox rather than reveal more
board: the world is a fixed 480×270, so a 21:9 monitor gets bars, not an advantage
([ARCHITECTURE.md](ARCHITECTURE.md)).

**Memory.** The whole texture set is 380 kB of PNG on disk, which is why
`BootScene` can load every asset once at boot and never stream. Measured heap
after boot is ~17 MB against an 80 MB budget
([PERFORMANCE.md](PERFORMANCE.md)).

## Asset style rules (PixelLab prompts)

- Original pixel art, cozy Brazilian card-table setting; no copyrighted characters; no Cross Blitz copying.
- Sprites/UI on transparent backgrounds; backgrounds fill 480×270.
- Consistent light from upper-left; warm bounce light.
- Characters: bust avatars, friendly, diverse neighborhood cast, distinct silhouettes:
  - **Dona Cida** — older woman, floral blouse, reading glasses, serene (conservative player)
  - **Juninho** — young man, football shirt, cap backwards, grinning (aggressive)
  - **Bia** — woman with curly hair, headphones around neck, focused (puzzle-minded)
  - **Seu Zé** — older man, straw hat, mustache, relaxed smile (patient)

## Families and their anchors

Six families. Each one has a single **anchor** — the shipped file a new member is
judged against — because "matches the style" is unanswerable and "matches this
file" is not. An anchor is not the prettiest asset; it is the one that best fixes
the family's rules.

| Family | Anchor | What the anchor fixes | Members |
|---|---|---|---|
| **Cards** | `cards/back-0.png` | 72×96 canvas, 2px warm border, the cream/ink pair, a repeating motif that stays legible face-down at hand scale | blank face, 5 backs, the 53 runtime-composed faces |
| **Characters** | `characters/avatar-cida.png` | 72×72 bust, front-facing, thick single-colour outline, flat cel shading, one silhouette-defining prop (glasses, hat, headphones), transparent ground | 9 avatars |
| **Tables** | `tables/boteco.png` | 480×270 full frame, playing surface centred and unclutteredly readable under cards, props only at the edges, upper-left light | 5 landscape + 5 portrait backgrounds, the dominoes prop |
| **Controls** | `ui/feito-normal.png` | a 168×60 wooden slab with a 1px darker rim and no baked-in text: the label is drawn by the engine (translatable), the four states are tints of it, and it is drawn as a **nine-slice**, so the same file serves 128×24 and 16×14 without smearing the rim or the grain | FEITO, COMPRAR, small button |
| **Icons** | `ui/suit-hearts.png` | one shape, one colour plus its outline, readable at 8×8 world units, no gradient | 4 suit pips, 6 emote glyphs, the emote bubble |
| **Effects** | `effects/sparkle.png` | additive-friendly on both the felt and the wood, no hard edge that reads as a sprite when it overlaps a card | sparkle, victory banner |

A new member is accepted when it passes the eight checks below **and** sits
beside its anchor in a golden frame without either of them looking like the odd
one out. The anchor changes only when the whole family is regenerated, which
makes replacing one a decision rather than a drift.

Readability outranks family consistency where they conflict: a card face that
matches the deck beautifully and cannot be read at 390×844 is rejected, and that
has never yet been a real conflict because the anchors were chosen from assets
that already pass.

## Accepting an asset

A new or regenerated asset is accepted when every line here is true. They are
checks, not taste — taste is the pillars above, and this is what stops a
pleasant-looking file from quietly breaking the screen it lands on.

1. **Native at the size it is drawn.** `RENDER_SCALE = 3`, so a sprite drawn at
   24×24 world units needs a 72×72 file. Under that is upscaling; far over it is
   wasted bytes and a mismatched pixel grid. The measured state of every family
   is in [ASSETS.md](ASSETS.md) §Visual debt.
2. **One pixel grid with its neighbours.** Art that sits next to the cards shares
   their block size — every sprite family is native at `RENDER_SCALE`. The ten
   backgrounds are the one deliberate exception, decided with numbers below.
3. **Readable at a glance, on the smallest target.** Check it at 390×844
   portrait, not only at 1280×720. A rank, a suit, an avatar's silhouette and a
   button's label must survive the small screen; contrast beats decoration.
4. **Transparent background for anything that is not a background.** Backgrounds
   fill their frame exactly (480×270 landscape, 224×400 portrait).
5. **Light from the upper left**, warm bounce fill, consistent with the table it
   sits on.
6. **Nothing critical carried by colour alone.** A state that matters is also a
   shape, a position or a word — the accessibility rule in `AGENTS.md` applies to
   art, not only to UI.
7. **No copyrighted characters, no real-person likenesses, no stereotypes.**
   Atmosphere comes from props, palette, names and language.
8. **It arrives with a row in [ASSETS.md](ASSETS.md)** — path, size, prompt or
   generating script — in the same change.

**Golden examples.** The deterministic showcase states are the reference frames:
`?showcase=menu`, `?showcase=game&seed=42`, `?showcase=mexe&seed=77`, and the
same three at `390×844`. They render identically on a given machine, so a
before/after capture is a valid comparison ([TESTING.md](TESTING.md) §Flake
policy). Judge a new asset in those frames, in place, rather than on its own.

## Motion

- Pickup: scale 1.15 + shadow, 80ms. Drop/snap: overshoot ease-back, 120ms. Deal: staggered slide from deck, 40ms apart.
- Valid meld: soft green pulse. Invalid: red outline + 2px shake on attempted confirm.
- Win: banner slam + sparkle radial burst.

## Audio direction

Light acoustic-percussive SFX (cards, wood taps); win jingle with cavaquinho feel. Keep short, dry, satisfying.
