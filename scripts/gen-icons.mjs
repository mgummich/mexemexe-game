// Generates PWA icons (192, 512, maskable 512) as pixel art. Same house
// style as gen-cosmetics.mjs: deterministic, no external deps, hand-rolled
// PNG encoder via zlib. Drawn at a small logical size and nearest-neighbour
// upscaled so it stays crisp pixel art at target size.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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
function rect(c, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(c, x, y, color);
}

// nearest-neighbour upscale, keeps pixel art crisp at larger sizes
function upscale(c, factor) {
  const out = canvas(c.w * factor, c.h * factor);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const sx = Math.floor(x / factor), sy = Math.floor(y / factor);
      const i = (sy * c.w + sx) * 4;
      set(out, x, y, [c.data[i], c.data[i + 1], c.data[i + 2], c.data[i + 3]]);
    }
  }
  return out;
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
