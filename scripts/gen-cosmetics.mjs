// Procedurally generates new cosmetic art (tables, card back, emotes) since
// PixelLab credits ran out. Same house style as gen-sfx.mjs: deterministic,
// no external deps, hand-rolled encoder (PNG via zlib instead of WAV via
// nothing). Palette sampled from the existing PixelLab assets so new pieces
// sit in the same colour world.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------- deterministic RNG (LCG, seeded) ----------
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- tiny RGBA canvas ----------
function canvas(w, h, bg = [0, 0, 0, 0]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  return { w, h, data };
}
function set(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  c.data[i] = r; c.data[i + 1] = g; c.data[i + 2] = b; c.data[i + 3] = a;
}
function get(c, x, y) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return [0, 0, 0, 0];
  const i = (y * c.w + x) * 4;
  return [c.data[i], c.data[i + 1], c.data[i + 2], c.data[i + 3]];
}
function rect(c, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(c, x, y, color);
}

// fill a boolean mask with fillColor, and outline (4-neighbour dilation) with outlineColor
function paintMasked(c, ox, oy, w, h, maskFn, fillColor, outlineColor) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = maskFn(x, y) ? 1 : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y)) {
        set(c, ox + x, oy + y, fillColor);
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        set(c, ox + x, oy + y, outlineColor);
      }
    }
  }
}

// ---------- minimal PNG encoder (RGBA8, no filtering) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let cc = n;
    for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
    t[n] = cc >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG({ w, h, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function write(file, c) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(c));
  console.log('wrote', file, `${c.w}x${c.h}`);
}

// ---------- palette (sampled from boteco.png / kitchen.png / back-0..3.png / emote-*.png) ----------
const P = {
  woodDark: [111, 69, 38, 255],
  woodMid: [138, 90, 52, 255],
  woodLight: [180, 122, 66, 255],
  sand: [217, 178, 106, 255],
  terracotta: [181, 101, 47, 255],
  feltDark: [36, 56, 44, 255],
  feltMid: [51, 80, 62, 255],
  leafDark: [44, 74, 44, 255],
  leafMid: [63, 107, 63, 255],
  clay: [168, 90, 52, 255],
  red: [178, 58, 58, 255],
  cream: [242, 230, 201, 255],
  wornWood: [122, 106, 85, 255],
  wornWoodDark: [98, 86, 68, 255],
  navy: [5, 45, 101, 255],
  navyLight: [6, 49, 101, 255],
  azWhite: [230, 238, 245, 255],
  azBlue: [120, 168, 214, 255],
  cardCorner: [215, 186, 142, 255],
  teal: [16, 210, 222, 255],
  gold: [247, 195, 30, 255],
  outline: [17, 15, 17, 255],
};

// ================= TABLE: quintal.png (480x270) =================
function genQuintal() {
  const w = 480, h = 270, B = 28;
  const c = canvas(w, h);
  const rng = makeRng(9001);
  // border: terracotta/sand checkerboard tiles
  const tile = 14;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= B && x < w - B && y >= B && y < h - B) continue; // center handled below
      const tx = Math.floor(x / tile), ty = Math.floor(y / tile);
      set(c, x, y, (tx + ty) % 2 === 0 ? P.sand : P.terracotta);
    }
  }
  // center: warm wood surface, low-contrast plank seams + faint grain
  for (let y = B; y < h - B; y++) {
    for (let x = B; x < w - B; x++) {
      let col = P.woodMid;
      if ((x - B) % 24 === 0) col = P.woodDark; // plank seam
      else if (rng() < 0.02) col = P.woodLight; // sparse grain fleck
      set(c, x, y, col);
    }
  }
  // planter/leaf motifs only along the border, evenly spaced
  const leafAt = (cx, cy) => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= 3) {
          set(c, cx + dx, cy + dy, (dx + dy) % 2 === 0 ? P.leafMid : P.leafDark);
        }
      }
    }
    rect(c, cx - 1, cy + 3, cx + 2, cy + 5, P.clay); // little pot
  };
  for (let x = 50; x < w - 20; x += 90) {
    leafAt(x, 8);
    leafAt(x, h - 9);
  }
  for (let y = 60; y < h - 40; y += 90) {
    leafAt(8, y);
    leafAt(w - 9, y);
  }
  write('public/assets/tables/quintal.png', c);
}

// ================= TABLE: feira.png (480x270) =================
function genFeira() {
  const w = 480, h = 270, AWNING = 34, SIDE = 30;
  const c = canvas(w, h);
  const rng = makeRng(7331);
  // center: worn wood, low contrast
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let col = P.wornWood;
      if ((x + y) % 26 === 0) col = P.wornWoodDark; // faint plank seam
      else if (rng() < 0.015) col = P.wornWoodDark; // knot fleck
      set(c, x, y, col);
    }
  }
  // top awning band: red/cream stripes with a scalloped (triangle) bottom edge
  const stripe = 16;
  for (let y = 0; y < AWNING; y++) {
    for (let x = 0; x < w; x++) {
      const s = Math.floor(x / stripe) % 2 === 0 ? P.red : P.cream;
      set(c, x, y, s);
    }
  }
  for (let x = 0; x < w; x++) {
    const s = Math.floor(x / stripe) % 2 === 0 ? P.red : P.cream;
    const notch = Math.abs((x % stripe) - stripe / 2); // triangle scallop, apex at stripe center
    for (let y = 0; y < notch / 2; y++) set(c, x, AWNING + y, s);
  }
  // left/right crate borders: horizontal slats
  const slat = 10;
  for (let side = 0; side < 2; side++) {
    const x0 = side === 0 ? 0 : w - SIDE;
    for (let y = AWNING; y < h; y++) {
      const sy = Math.floor((y - AWNING) / slat);
      const base = sy % 2 === 0 ? P.woodMid : P.woodDark;
      for (let x = x0; x < x0 + SIDE; x++) set(c, x, y, base);
      if ((y - AWNING) % slat === 0) rect(c, x0, y, x0 + SIDE, y + 1, P.woodDark); // slat line
    }
  }
  write('public/assets/tables/feira.png', c);
}

// ================= CARD BACK: back-4.png (matches back-0..3 canvas size) =================
function genCardBack() {
  // back-0..3 are 72x96 with a 4px rounded-corner cut; azulejo blue/white lattice.
  const w = 72, h = 96, R = 4;
  const c = canvas(w, h);
  const inside = (x, y) => {
    // rounded-rect test matching the ~4px corner cut seen on back-0..3
    if (x < R && y < R) return (R - x) + (R - y) <= R + 1;
    if (x >= w - R && y < R) return (x - (w - R - 1)) + (R - y) <= R + 1;
    if (x < R && y >= h - R) return (R - x) + (y - (h - R - 1)) <= R + 1;
    if (x >= w - R && y >= h - R) return (x - (w - R - 1)) + (y - (h - R - 1)) <= R + 1;
    return true;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      // azulejo: diamond lattice grid of small tiles, alternating white/blue accent
      const gx = 8, gy = 8;
      const lx = x % gx, ly = y % gy;
      const onDiagA = lx === ly;
      const onDiagB = lx === gx - 1 - ly;
      let col = (x + y) % 2 === 0 ? P.navy : P.navyLight;
      if (onDiagA || onDiagB) col = P.azWhite;
      else if (Math.abs(lx - gx / 2) <= 1 && Math.abs(ly - gy / 2) <= 1) col = P.azBlue; // center dot of each tile
      set(c, x, y, col);
    }
  }
  // corner accent pixels, matching the cream highlight sampled just inside back-0's rounded corners
  for (const [cx, cy] of [[R, R], [w - R - 1, R], [R, h - R - 1], [w - R - 1, h - R - 1]]) {
    if (inside(cx, cy)) set(c, cx, cy, P.cardCorner);
  }
  write('public/assets/cards/back-4.png', c);
}

// ================= EMOTES (36x36) =================
function genEmoteSleepy() {
  const w = 36, h = 36;
  const c = canvas(w, h);
  // three descending "Z" blocks, decreasing size, drawn as filled masks then outlined
  const zMask = (x, y, x0, y0, size, stroke) => {
    // size x size square Z: top bar, diagonal, bottom bar
    const lx = x - x0, ly = y - y0;
    if (lx < 0 || ly < 0 || lx >= size || ly >= size) return false;
    if (ly < stroke) return true; // top bar
    if (ly >= size - stroke) return true; // bottom bar
    // diagonal band from top-right to bottom-left
    const t = ly / size;
    const diagX = size - 1 - t * size;
    return Math.abs(lx - diagX) < stroke;
  };
  const zs = [
    { x0: 4, y0: 4, size: 14, stroke: 3 },
    { x0: 16, y0: 14, size: 10, stroke: 2 },
    { x0: 24, y0: 22, size: 7, stroke: 2 },
  ];
  paintMasked(c, 0, 0, w, h, (x, y) => zs.some((z) => zMask(x, y, z.x0, z.y0, z.size, z.stroke)), P.teal, P.outline);
  write('public/assets/ui/emote-sleepy.png', c);
}

function genEmoteConfident() {
  const w = 36, h = 36;
  const c = canvas(w, h);
  // 5-point star via polygon point-in-test
  const cx = w / 2, cy = h / 2, rOuter = 15, rInner = 6.2;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const inPoly = (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };
  paintMasked(c, 0, 0, w, h, (x, y) => inPoly(x + 0.5, y + 0.5), P.gold, P.outline);
  write('public/assets/ui/emote-confident.png', c);
}

genQuintal();
genFeira();
genCardBack();
genEmoteSleepy();
genEmoteConfident();
