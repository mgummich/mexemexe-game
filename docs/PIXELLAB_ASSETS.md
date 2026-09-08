# PixelLab Asset Tracker

All art generated with PixelLab MCP (Pro model unless noted). Card faces are
composed at runtime from the PixelLab blank card + suit pips + PixelLab pixel
font — guarantees 52 consistent, readable faces (AI free-drawing all 52 would
scramble rank glyphs).

| Asset | Prompt (short) | Size | Path | Status |
|---|---|---|---|---|
| Pixel font | warm cream chunky playful arcade font, Bold, 8px | ttf | /public/assets/ui/font.ttf | ✅ done |
| Card blank face | blank playing card face, cream paper, brown border | 48×64 | /public/assets/cards/blank.png | ✅ done |
| 52 card faces | composed: blank + suit pip + font rank | 48×64 | runtime textures | ✅ composed |
| Card back 0 (blue) | deep blue + gold lattice | 48×64 | /public/assets/cards/back-0.png | ✅ done |
| Card back 1 (junina) | golden yellow, bunting flags + viola | 48×64 | /public/assets/cards/back-1.png | ✅ done |
| Card back 2 (monstera) | tropical green monstera damask | 48×64 | /public/assets/cards/back-2.png | ✅ done |
| Card back 3 (terracotta) | terracotta red, cream waves | 48×64 | /public/assets/cards/back-3.png | ✅ done |
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
| Logo "MEXE!" | chunky golden wordmark | 320×128 | /public/assets/ui/logo.png | ✅ done |
| FEITO button | green wooden button blank | 128×44 | /public/assets/ui/feito-normal.png | ✅ done |
| COMPRAR button | orange wooden button blank | 128×44 | /public/assets/ui/comprar-normal.png | ✅ done |
| Small button | wooden square button | 36×36 | /public/assets/ui/btn-small-normal.png | ✅ done |
| Panel | warm wooden panel, rope trim | 96×96 | /public/assets/ui/panel.png | ✅ done |
| Emote bubble | white speech bubble | 40×36 | /public/assets/ui/emote-bubble.png | ✅ done |
| Victory banner | festive banner, bunting + gold | 320×96 | /public/assets/ui/banner-victory.png | ✅ done |
| Sparkle | 4-point gold sparkle | 32×32 | /public/assets/effects/sparkle.png | ✅ done |
| Tutorial icons ×4 | meld/drag/draw/win glyphs | 32×32 | /public/assets/ui/tut-*.png | ✅ done |
| SFX ×9 + ambience loop | procedural synthesis (PixelLab has no audio) | wav | /public/assets/audio/*.wav | ✅ done (scripts/gen-sfx.mjs) |

Button hover/pressed/disabled states derive from `-normal` via runtime tint
(see PixelButton) — fewer assets, i18n-safe (text drawn by engine).

## Phase 2 additions (integrated)

| Asset | Prompt (short) | Size | Path | Status |
|---|---|---|---|---|
| Emote: excited | yellow exclamation icon | 32×32 | /public/assets/ui/emote-excited.png | ✅ done — shown on AI confirm, <3 hand cards played |
| Emote: thinking | grey rising dots icon | 32×32 | /public/assets/ui/emote-thinking.png | ✅ done — shown on AI draw |
| Emote: annoyed | red anger-vein cross icon | 32×32 | /public/assets/ui/emote-annoyed.png | ✅ done — shown on AI fallback error |
| Emote: happy | golden musical note icon | 32×32 | /public/assets/ui/emote-happy.png | ✅ done — shown on AI confirm, ≥3 hand cards played |
| Prop: dominoes box | worn wooden dominoes box, top-down | 64×48 | /public/assets/tables/prop-dominoes.png | ✅ done — covers boteco felt smudge (2p games only) |
