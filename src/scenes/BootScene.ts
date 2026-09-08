import Phaser from 'phaser';
import { AUDIO_ASSETS, buildManifest } from '../assets/manifest';
import { makeFallback } from '../assets/fallbacks';
import { composeCardFaces, loadPixelFont, setPixelFont } from '../assets/compose-cards';
import { debugApi } from '../verification/debug-api';

/**
 * Probes every asset with a HEAD request (vite serves index.html for missing
 * files, which would spam console errors), loads what exists, and generates
 * procedural fallback textures for the rest. Missing assets never crash.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    void this.loadAll();
  }

  private async probe(path: string): Promise<boolean> {
    try {
      const res = await fetch(path, { method: 'HEAD' });
      const type = res.headers.get('content-type') ?? '';
      return res.ok && !type.includes('html');
    } catch {
      return false;
    }
  }

  private async loadAll(): Promise<void> {
    const manifest = buildManifest();
    const checks = await Promise.all([
      ...manifest.map(async (a) => ({ asset: a, kind: 'image' as const, ok: await this.probe(a.path) })),
      ...AUDIO_ASSETS.map(async (a) => ({ asset: a, kind: 'audio' as const, ok: await this.probe(a.path) })),
    ]);

    let queued = 0;
    for (const c of checks) {
      if (!c.ok) {
        debugApi.missingAssets.push(c.asset.key);
        continue;
      }
      if (c.kind === 'image') this.load.image(c.asset.key, c.asset.path);
      else this.load.audio(c.asset.key, c.asset.path);
      queued++;
    }

    const finish = async (): Promise<void> => {
      const font = await loadPixelFont();
      setPixelFont(font);
      composeCardFaces(this, font);
      // Composed faces are real PixelLab-derived art — unmark them as missing.
      if (this.textures.exists('card-blank')) {
        debugApi.missingAssets = debugApi.missingAssets.filter(
          (k) => !(k.startsWith('card-') && this.textures.exists(k)),
        );
      }
      for (const a of manifest) {
        if (!this.textures.exists(a.key)) makeFallback(this, a.key, a.w, a.h);
      }
      debugApi.scene = 'menu';
      this.scene.start('menu');
    };

    if (queued > 0) {
      this.load.once('complete', finish);
      this.load.start();
    } else {
      finish();
    }
  }
}
