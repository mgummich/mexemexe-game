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

- Logical canvas **480×270**, Phaser `pixelArt: true`, FIT scaling → 1280×720 (×2.67 letterbox-free), 1920×1080 (×4 exact).
- Cards **24×32 logical px** (96×128 at 1080p). Rank glyph occupies top-left ~8px; large suit pip bottom-right.
- No texture smoothing, no anti-aliased blur. Crisp 1px outlines, limited palettes per sprite.

## Asset style rules (PixelLab prompts)

- Original pixel art, cozy Brazilian card-table setting; no copyrighted characters; no Cross Blitz copying.
- Sprites/UI on transparent backgrounds; backgrounds fill 480×270.
- Consistent light from upper-left; warm bounce light.
- Characters: bust avatars, friendly, diverse neighborhood cast, distinct silhouettes:
  - **Dona Cida** — older woman, floral blouse, reading glasses, serene (conservative player)
  - **Juninho** — young man, football shirt, cap backwards, grinning (aggressive)
  - **Bia** — woman with curly hair, headphones around neck, focused (puzzle-minded)
  - **Seu Zé** — older man, straw hat, mustache, relaxed smile (patient)

## Accepting an asset

A new or regenerated asset is accepted when every line here is true. They are
checks, not taste — taste is the pillars above, and this is what stops a
pleasant-looking file from quietly breaking the screen it lands on.

1. **Native at the size it is drawn.** `RENDER_SCALE = 3`, so a sprite drawn at
   24×24 world units needs a 72×72 file. Under that is upscaling; far over it is
   wasted bytes and a mismatched pixel grid. The measured state of every family
   is in [ASSETS.md](ASSETS.md) §Visual debt.
2. **One pixel grid with its neighbours.** Art that sits next to the cards shares
   their block size. This is the rule the backgrounds currently bend.
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
