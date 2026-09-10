import { describe, expect, it } from 'vitest';
import { onAppHidden, onAppVisible } from '../src/core/lifecycle';

/** Minimal addEventListener/removeEventListener stub standing in for `document` or `window`,
 * same recipe as offline.test.ts's fakeTarget for src/core/pwa.ts. */
function fakeTarget(): {
  target: { addEventListener: (t: string, fn: () => void) => void; removeEventListener: (t: string, fn: () => void) => void };
  fire: (type: string) => void;
} {
  const handlers = new Map<string, Set<() => void>>();
  const target = {
    addEventListener: (type: string, fn: () => void) => {
      let set = handlers.get(type);
      if (!set) { set = new Set(); handlers.set(type, set); }
      set.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      handlers.get(type)?.delete(fn);
    },
  };
  return { target, fire: (type) => handlers.get(type)?.forEach((fn) => fn()) };
}

describe('onAppHidden', () => {
  it('fires only when visibilityState is hidden, ignores other visibilitychange firings', () => {
    const { target: doc, fire } = fakeTarget();
    const win = fakeTarget().target;
    const docWithState = { ...doc, visibilityState: 'visible' };
    let calls = 0;
    onAppHidden(() => calls++, docWithState, win);
    docWithState.visibilityState = 'hidden';
    fire('visibilitychange');
    expect(calls).toBe(1);
    docWithState.visibilityState = 'visible';
    fire('visibilitychange');
    expect(calls).toBe(1); // still hidden-only — visible firing must not also call the hidden handler
  });

  it('also fires on pagehide', () => {
    const doc = fakeTarget().target;
    const { target: win, fire } = fakeTarget();
    let calls = 0;
    onAppHidden(() => calls++, { ...doc, visibilityState: 'visible' }, win);
    fire('pagehide');
    expect(calls).toBe(1);
  });

  it('unsubscribe stops further calls', () => {
    const { target: docTarget, fire: fireDoc } = fakeTarget();
    const doc = { ...docTarget, visibilityState: 'hidden' };
    const win = fakeTarget().target;
    let calls = 0;
    const unsub = onAppHidden(() => calls++, doc, win);
    fireDoc('visibilitychange');
    expect(calls).toBe(1);
    unsub();
    fireDoc('visibilitychange');
    expect(calls).toBe(1);
  });
});

describe('onAppVisible', () => {
  it('fires only when visibilityState is visible', () => {
    const { target: docTarget, fire: fireDoc } = fakeTarget();
    const doc = { ...docTarget, visibilityState: 'hidden' };
    const win = fakeTarget().target;
    let calls = 0;
    onAppVisible(() => calls++, doc, win);
    fireDoc('visibilitychange'); // still hidden
    expect(calls).toBe(0);
    doc.visibilityState = 'visible';
    fireDoc('visibilitychange');
    expect(calls).toBe(1);
  });

  it('also fires on pageshow, exactly once per firing (no duplicate relayout)', () => {
    const doc = { ...fakeTarget().target, visibilityState: 'hidden' };
    const { target: win, fire: fireWin } = fakeTarget();
    let calls = 0;
    onAppVisible(() => calls++, doc, win);
    fireWin('pageshow');
    expect(calls).toBe(1);
  });

  it('unsubscribe stops further calls', () => {
    const doc = { ...fakeTarget().target, visibilityState: 'visible' };
    const { target: win, fire: fireWin } = fakeTarget();
    let calls = 0;
    const unsub = onAppVisible(() => calls++, doc, win);
    fireWin('pageshow');
    expect(calls).toBe(1);
    unsub();
    fireWin('pageshow');
    expect(calls).toBe(1);
  });
});
