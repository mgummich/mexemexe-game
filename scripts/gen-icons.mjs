// Generates PWA icons (192, 512, maskable 512) as pixel art. Same house
// style as gen-cosmetics.mjs: deterministic, no external deps. Canvas and
// PNG encoder come from ./png.mjs. Drawn at a small logical size and
// nearest-neighbour upscaled so it stays crisp pixel art at target size.
import { canvas, set, rect, upscale, write } from './png.mjs';

// ---------- palette (matches CLAUDE.md game palette) ----------
const P = {
  bg: [26, 15, 10, 255], // #1a0f0a
  gold: [247, 210, 62, 255], // #f7d23e
  cream: [247, 242, 231, 255], // #f7f2e7
  tan: [192, 168, 120, 255], // #c0a878
};

// Draws two overlapping playing cards, laid out on a 32-unit design grid
// then scaled/offset so the same drawing can be shrunk to fit the maskable
// safe zone. Coordinates below span x:3..27, y:5..27 of that 32-unit grid.
function drawCards(c, ox, oy, scale) {
  const r = (x0, y0, x1, y1, color) =>
    rect(c, ox + Math.round(x0 * scale), oy + Math.round(y0 * scale), ox + Math.round(x1 * scale), oy + Math.round(y1 * scale), color);
  // back card: tan-bordered, cream face, slightly behind/left
  r(3, 7, 16, 27, P.tan);
  r(4, 8, 15, 26, P.cream);
  // front card: gold-bordered, cream face, offset right/down, drawn on top
  r(12, 5, 27, 25, P.gold);
  r(13, 6, 26, 24, P.cream);
  // front card pip: a simple diamond in bg colour, reads as a suit mark
  const cx = ox + Math.round(19 * scale), cy = oy + Math.round(15 * scale);
  const half0 = Math.round(4 * scale) || 1;
  for (let dy = -half0; dy <= half0; dy++) {
    const half = half0 - Math.abs(dy);
    rect(c, cx - half, cy + dy, cx + half + 1, cy + dy + 1, P.bg);
  }
}

function genIcon(file, size, inset) {
  const logical = 32;
  const c = canvas(logical, logical, P.bg);
  if (inset) {
    // maskable: shrink to 70% and center, so all content sits inside the
    // central 80% safe zone (with margin to spare) required by the spec.
    drawCards(c, 5, 5, 0.7);
  } else {
    drawCards(c, 0, 0, 1);
  }
  const up = upscale(c, size / logical);
  write(file, up);
}

genIcon('public/icon-192.png', 192, false);
genIcon('public/icon-512.png', 512, false);
genIcon('public/icon-maskable-512.png', 512, true);
