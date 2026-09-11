// Synthesizes the game's SFX as small WAV files (PixelLab does not do audio).
// Deliberately simple: short envelopes over sine/triangle/noise.
import fs from 'node:fs';
import path from 'node:path';

const SR = 22050;
const OUT = 'public/assets/audio';
fs.mkdirSync(OUT, { recursive: true });

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log('wrote', name);
}

const rng = (() => {
  let s = 12345;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
})();

function env(i, n, attack = 0.01, decay = 3) {
  const t = i / n;
  const a = Math.min(1, t / attack);
  return a * Math.exp(-decay * t);
}

function tone(freqFn, dur, { decay = 4, shape = 'sine', vol = 0.8 } = {}) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * freqFn(i / n)) / SR;
    const s = shape === 'tri' ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
    out[i] = s * env(i, n, 0.01, decay) * vol;
  }
  return out;
}

function noise(dur, { decay = 8, hp = 0.6, vol = 0.5 } = {}) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2;
    const v = w - prev * hp; // crude high-pass for papery swish
    prev = w;
    out[i] = v * env(i, n, 0.005, decay) * vol;
  }
  return out;
}

function mix(...parts) {
  const n = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(n);
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Mix balance (docs/AUDIO_DIRECTION.md): loudness order win > feito > invalid >
// drop/draw/deal > pickup/snap > click > ambience, peaks <=0.5 pre-user-volume.
// Vol constants below are scaled so each cue's summed/sequential peak lands
// on its tier target; ratios within a cue are preserved from the original mix.
writeWav('pickup.wav', mix(noise(0.07, { decay: 14, vol: 0.14 }), tone(() => 880, 0.06, { decay: 10, vol: 0.1 })));
writeWav('drop.wav', mix(noise(0.09, { decay: 12, vol: 0.17 }), tone((t) => 440 - 120 * t, 0.08, { decay: 9, vol: 0.13 })));
writeWav('snap.wav', mix(tone((t) => 660 + 220 * t, 0.07, { decay: 8, vol: 0.14, shape: 'tri' }), noise(0.04, { decay: 18, vol: 0.1 })));
writeWav('deal.wav', concat(noise(0.05, { decay: 16, vol: 0.3 }), noise(0.05, { decay: 16, vol: 0.24 }), noise(0.05, { decay: 16, vol: 0.195 })));
writeWav('feito.wav', concat(tone(() => 523, 0.09, { decay: 5, vol: 0.373, shape: 'tri' }), tone(() => 659, 0.09, { decay: 5, vol: 0.373, shape: 'tri' }), tone(() => 784, 0.16, { decay: 4, vol: 0.42, shape: 'tri' })));
writeWav('draw.wav', mix(noise(0.12, { decay: 8, vol: 0.19 }), tone((t) => 330 - 60 * t, 0.1, { decay: 7, vol: 0.11 })));
writeWav('win.wav', concat(tone(() => 523, 0.12, { decay: 3, vol: 0.427, shape: 'tri' }), tone(() => 659, 0.12, { decay: 3, vol: 0.427, shape: 'tri' }), tone(() => 784, 0.12, { decay: 3, vol: 0.427, shape: 'tri' }), tone(() => 1047, 0.3, { decay: 2.5, vol: 0.48, shape: 'tri' })));
writeWav('invalid.wav', concat(tone(() => 220, 0.09, { decay: 6, vol: 0.36 }), tone(() => 175, 0.14, { decay: 6, vol: 0.36 })));
writeWav('click.wav', mix(tone(() => 1200, 0.03, { decay: 20, vol: 0.09 }), noise(0.02, { decay: 30, vol: 0.06 })));

// Ambience: ~7s seamless loop, soft evening crickets (filtered noise chirps) + a warm pluck every couple seconds.
// ponytail: hand-rolled DSP, no synth lib — a few dozen lines cover this fine.
function ambience() {
  const dur = 7;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  // cricket bed: several chirping noise-bursts at slightly different rates, band-limited by a leaky integrator (crude low-pass)
  const voices = [
    { rate: 5.2, freq: 4200, phase: 0 },
    { rate: 4.7, freq: 3600, phase: 1.3 },
    { rate: 5.9, freq: 4800, phase: 2.6 },
  ];
  for (const v of voices) {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const chirp = Math.max(0, Math.sin(2 * Math.PI * v.rate * t + v.phase)) ** 6;
      const raw = rng() * 2 * Math.sin(2 * Math.PI * v.freq * t);
      lp += (raw - lp) * 0.3;
      out[i] += lp * chirp * 0.06;
    }
  }
  // warm pluck every ~2.3s, seeded so the loop point (t=0 and t=dur) both sit in silence
  const pluckEvery = 2.35;
  for (let start = 0.6; start < dur - 0.6; start += pluckEvery) {
    const pDur = 0.9;
    const pN = Math.floor(SR * pDur);
    const startI = Math.floor(start * SR);
    for (let i = 0; i < pN && startI + i < n; i++) {
      const t = i / SR;
      const s = Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 330 * t);
      out[startI + i] += s * env(i, pN, 0.02, 3.5) * 0.05;
    }
  }
  // fade the whole loop's edges to zero so it stitches seamlessly
  const fade = Math.floor(SR * 0.15);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[n - 1 - i] *= g;
  }
  return out;
}
writeWav('ambience.wav', ambience());
