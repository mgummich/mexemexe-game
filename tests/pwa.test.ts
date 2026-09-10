import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

describe('manifest.webmanifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf-8'));

  it('has required top-level fields', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
  });

  it('has an icon at least 192px and a maskable icon', () => {
    const sizeOf = (icon: { sizes: string }) => parseInt(icon.sizes.split('x')[0] ?? '0', 10);
    expect(manifest.icons.some((icon: { sizes: string }) => sizeOf(icon) >= 192)).toBe(true);
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true);
  });

  it('every icon src exists on disk under public/', () => {
    for (const icon of manifest.icons) {
      const file = path.join(PUBLIC, icon.src.replace(/^\.\//, ''));
      expect(fs.existsSync(file), `missing ${file}`).toBe(true);
    }
  });
});

describe('index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');

  it('links the manifest', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('manifest.webmanifest');
  });

  it('references an existing apple-touch-icon file', () => {
    const match = html.match(/apple-touch-icon"\s+href="([^"]+)"/);
    expect(match).toBeTruthy();
    const href = match?.[1] ?? '';
    const file = path.join(PUBLIC, href.replace(/^\.\//, ''));
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('sw.js', () => {
  const source = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf-8');

  it('evicts old caches keyed on CACHE_NAME', () => {
    expect(source).toContain('name !== CACHE_NAME');
  });

  // Load the service worker source against a stubbed `self` global. The
  // file only touches self.addEventListener and assigns self.__swInternals,
  // so this stub is enough to run it outside a browser/worker context.
  function loadSwInternals() {
    const sandbox: { self: Record<string, unknown> } = {
      self: { addEventListener() {}, location: { origin: 'https://mexe.example' } },
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.self.__swInternals as {
      cacheMode: (url: URL, method: string, mode: string) => string;
    };
  }

  it('classifies requests per the caching policy', () => {
    const { cacheMode } = loadSwInternals();
    const origin = 'https://mexe.example';

    expect(cacheMode(new URL(`${origin}/assets/audio/music/full-song-1.mp3`), 'GET', 'no-cors')).toBe('passthrough');
    expect(cacheMode(new URL(`${origin}/`), 'GET', 'navigate')).toBe('navigate');
    expect(cacheMode(new URL(`${origin}/assets/cards/back-0.png`), 'HEAD', 'no-cors')).toBe('head');
    expect(cacheMode(new URL(`${origin}/assets/cards/back-0.png`), 'GET', 'no-cors')).toBe('cache-first');
    expect(cacheMode(new URL('https://other.example/x.png'), 'GET', 'no-cors')).toBe('passthrough');
  });
});
