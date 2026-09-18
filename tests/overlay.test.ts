import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';
import { closeOnShutdown, onEscape } from '../src/ui/overlay';

/**
 * The parts of a Phaser scene an overlay's lifecycle actually touches: the keyboard it listens to
 * for Esc, and the scene events it must unhook from. Building one is cheaper — and far more
 * honest about what the contract is — than booting a real scene with a canvas.
 */
type Handler = () => void;

/** The two-method emitter overlay.ts calls: `on`/`off` for the keyboard, `once`/`off` for events. */
function emitter() {
  const handlers = new Map<string, Handler[]>();
  const list = (ev: string): Handler[] => handlers.get(ev) ?? [];
  return {
    on: (ev: string, fn: Handler) => handlers.set(ev, [...list(ev), fn]),
    once: (ev: string, fn: Handler) => handlers.set(ev, [...list(ev), fn]),
    off: (ev: string, fn: Handler) => handlers.set(ev, list(ev).filter((h) => h !== fn)),
    emit: (ev: string) => [...list(ev)].forEach((fn) => fn()),
    count: (ev: string) => list(ev).length,
  };
}

function fakeScene(): Phaser.Scene & { fireEsc: () => void; shutdown: () => void; keyHandlers: number } {
  const keyboard = emitter();
  const events = emitter();
  return {
    input: { keyboard },
    events,
    fireEsc: () => keyboard.emit('keydown-ESC'),
    shutdown: () => events.emit('shutdown'),
    get keyHandlers() {
      return keyboard.count('keydown-ESC');
    },
  } as unknown as Phaser.Scene & { fireEsc: () => void; shutdown: () => void; keyHandlers: number };
}

describe('UI-01 Esc backs out one overlay at a time', () => {
  it('only the innermost overlay reacts, and disposing restores the one below', () => {
    const scene = fakeScene();
    const hits: string[] = [];
    const offOuter = onEscape(scene, () => hits.push('outer'));
    const offInner = onEscape(scene, () => hits.push('inner'));

    scene.fireEsc();
    expect(hits).toEqual(['inner']);

    offInner();
    scene.fireEsc();
    expect(hits).toEqual(['inner', 'outer']);

    offOuter();
    scene.fireEsc();
    expect(hits).toEqual(['inner', 'outer']);
    expect(scene.keyHandlers).toBe(0);
  });
});

describe('UI-02 a scene shutdown closes the panel that was open over it', () => {
  it('shutdown runs close(), and a normal close stops listening for it', () => {
    const scene = fakeScene();
    let closed = 0;
    const off = closeOnShutdown(scene, () => closed++);
    scene.shutdown();
    expect(closed).toBe(1);

    const scene2 = fakeScene();
    let closed2 = 0;
    const off2 = closeOnShutdown(scene2, () => closed2++);
    off2();
    scene2.shutdown();
    expect(closed2).toBe(0);
    off();
  });

  /**
   * The bug this guards: MenuScene, SetupScene and OnlineScene all `scene.restart()` on
   * `viewport:changed`, so every orientation flip under an open panel used to strand that panel's
   * Esc entry. Repeat the flip and the stack grows without bound, and the entry on top of it is
   * the one Esc reaches.
   */
  it('a flip under an open panel leaves no Esc entry behind, however many times it repeats', () => {
    const outer = fakeScene();
    const outerHits: string[] = [];
    const offOuter = onEscape(outer, () => outerHits.push('outer'));

    for (let flip = 0; flip < 5; flip++) {
      const scene = fakeScene();
      let offEsc = (): void => {};
      const close = (): void => {
        offEsc();
        offShutdown();
      };
      offEsc = onEscape(scene, close);
      const offShutdown = closeOnShutdown(scene, () => close());
      scene.shutdown();
    }

    outer.fireEsc();
    expect(outerHits).toEqual(['outer']);
    offOuter();
  });
});
