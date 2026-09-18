/**
 * The design vocabulary every screen draws from: semantic colours, control sizes, layering and
 * spacing. Phaser-free on purpose (same rule as settings-layout.ts) so tests and the app shell
 * can both read it.
 *
 * These are *semantic* names, not a palette dump. Before this module the same warm grey existed
 * as `#c0b8a8`, `#b8b0a0`, `#b8ac98`, `#b8ab94`, `#a89e8c` and `#c9bda6` on six different screens
 * with no rule for which one a new label should use, and the same "secondary text" decision was
 * made independently every time. Pick the role, not the hex.
 *
 * What is deliberately *not* here: gameplay status colours (`STATUS_COLOR` in src/table/snap.ts —
 * legal/incomplete/illegal is a rules signal, not chrome) and per-seat identity colours
 * (`SEAT_COLORS` in OnlineScene). Folding those into chrome tokens is how a status colour ends up
 * reused as a brand colour.
 *
 * Wave 4 owns final art direction. These values are the current shipped look expressed once
 * instead of fifty times, so a later art pass can re-point them in one file.
 */

/** Text roles. Every `label()`/`fontStyle()` colour argument should be one of these. */
export const TEXT = {
  /** Default body/label ink on a dark surface. */
  primary: '#f7f2e7',
  /** Supporting copy: hints, captions, units, secondary rows. */
  muted: '#c0b8a8',
  /** De-emphasised to the edge of legibility: disabled rows, meta, "+N more". */
  dim: '#8a7f6e',
  /** Brand/chrome gold: titles, the active seat, selection, banners. */
  accent: '#f7d23e',
  /** Ink on an accent-filled plate (the gold chip/winner plate) — never accent-on-accent. */
  onAccent: '#1a0f0a',
  /** Secondary ink on an accent-filled plate. */
  onAccentMuted: '#4a3420',
  success: '#3ec06a',
  warning: '#ffb35c',
  error: '#ff6b5e',
} as const;

/** Surface and border fills (Phaser colour ints). */
export const SURFACE = {
  /** The app's ground colour — also index.html's background and the PWA theme colour. */
  base: 0x1a0f0a,
  /** Dialog/overlay panel fill. */
  overlay: 0x1a1410,
  /** The warm wooden panel every menu-family screen stacks its controls on. */
  panel: 0x2a1a10,
  /** Panel edge (outer) and the darker inner hairline that gives it depth. */
  panelBorder: 0xc0a878,
  panelBorderInner: 0x6b4a2f,
  /** Full-screen dim behind a modal. */
  scrim: 0x000000,
  /** Accent fill for plates/strokes — the int form of `TEXT.accent`. */
  accent: 0xf7d23e,
  /** Neutral light wash marking a row/zone without claiming a state (used at very low alpha). */
  highlight: 0xffffff,
  /** Inset groove a control slides in (the volume sliders' track). */
  track: 0x4a4438,
} as const;

/** `'#rrggbb'` as the integer Phaser fills want — so a colour that exists in both forms (the
 * slider handle is `TEXT.primary`) is still defined exactly once. */
export function toInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/**
 * Solid-fill counterparts of the state text colours. Deliberately *not* the same hexes: a 3-unit
 * status dot carries no glyph to read, so it takes the saturated fill, while `TEXT.error` is the
 * lighter red that stays legible as small text on a dark panel.
 */
export const STATE_FILL = {
  success: 0x3ec06a,
  error: 0xd83a3a,
} as const;

/**
 * Focus and attention rings. Two of them, because they answer different questions and must never
 * be confused: `keyboard` is "the cursor is here", `attention` is "look at this meld" (the
 * cycle-problem pointer). Both are colours no gameplay status uses — gold is `incomplete` and red
 * is `illegal` (`STATUS_COLOR`, src/table/snap.ts), so a ring in either would read as a verdict.
 */
export const FOCUS = {
  keyboard: 0xffffff,
  attention: 0x6fc3ff,
} as const;

/** Opacity of the modal scrim. */
export const SCRIM_ALPHA = 0.6;

/**
 * Control priority, as the `color` a PixelButton is tinted with. The hierarchy is
 * PRIMARY > SECONDARY > TERTIARY > ICON, with DESTRUCTIVE orthogonal to all of them — a screen
 * should have one `primary` button, and `danger` is reserved for actions that lose something
 * (quit a match, wipe the save).
 */
export const ACTION = {
  /** The screen's one call to action (pass `primary: true` as well for the press/pop feel). */
  primary: 0x2e9e50,
  /** Ordinary choices sitting beside the primary. */
  secondary: 0x8a7f68,
  /** Neutral rows inside a panel (settings, pause). */
  tertiary: 0x6b6b73,
  /** Icon-only buttons (the gear). */
  icon: 0x5e5646,
  /** Stepper arrows (◀ ▶). */
  stepper: 0x9a8d74,
  /** Destructive: red multiply-tint over the neutral wood texture. */
  danger: 0xff7a68,
  /** Take-it-back controls on the board: the ✕ that closes a panel and the ⟲ that resets a draft.
   * Small, muted brick-red — related to `danger` but never the screen's action, and never
   * something that loses a match. */
  discard: 0x8e4632,
  /** No tint at all: the button texture's own colour. PixelButton's default, and what marks a
   * selected tab against its tinted-down siblings. */
  native: 0xffffff,
} as const;

/**
 * Brand/chrome gold for strokes and text alike. Deliberately distinct from
 * `STATUS_COLOR.incomplete` (src/table/snap.ts): that hex used to double as this one, so a meld's
 * "incomplete, not really wrong" gold and a purely decorative selection gold read as one signal.
 */
export const CHROME_GOLD = 0xd4af37;
export const CHROME_GOLD_TEXT = '#d4af37';

/** Red multiply-tint for danger buttons — `ACTION.danger` under its historical name. */
export const DANGER_TINT = ACTION.danger;

/**
 * Stacking order. Anything that opens over a screen picks a layer here rather than inventing a
 * depth, so a tooltip can never end up under the dialog that raised it.
 */
export const LAYER = {
  /** Modal scrim. */
  scrim: 500,
  /** The dialog panel itself. */
  panel: 501,
  /** Everything drawn inside a dialog. */
  panelContent: 510,
  /** Tooltip plate and its text — above every panel, by definition. */
  tooltip: 999,
  tooltipText: 1000,
} as const;

/**
 * Control heights in world units. `touch` is the coarse-pointer height: a finger needs a bigger
 * target than a mouse, and every panel grew its own `view().touch ? 24 : 18` copy of that rule.
 */
export const CONTROL_H = {
  /** Dialog rows and menu stacks. */
  menu: { fine: 18, touch: 24 },
  /** Compact controls inside a scrolling panel (rules tabs, footers). */
  compact: { fine: 16, touch: 24 },
} as const;

/** Height for a control of `kind` on the current pointer type. */
export function controlH(kind: keyof typeof CONTROL_H, touch: boolean): number {
  const h = CONTROL_H[kind];
  return touch ? h.touch : h.fine;
}

/**
 * Minimum hit-box a coarse pointer gets, regardless of how small the artwork is (the art itself
 * is never resized — only the interactive area grows). Below this a finger misses.
 */
export const TOUCH_TARGET = { w: 34, h: 31 } as const;

/**
 * Spacing steps, in world units, from the screen edge inwards. Not a general 4/8/16 scale: these
 * are the four distances the layouts actually use.
 */
export const SPACE = {
  /** Screen edge to the first thing on it. */
  edge: 8,
  /** Between sections of a screen or panel. */
  section: 12,
  /** Between sibling controls in a stack. */
  control: 6,
  /** Inside a control, around its label. */
  inset: 3,
} as const;

/** `'#rrggbb'` for an integer surface — the CSS form of a colour that is stored as a Phaser fill. */
export function toHex(int: number): string {
  return `#${int.toString(16).padStart(6, '0')}`;
}

/**
 * Stacking order for the handful of things the DOM draws over the canvas. Separate from `LAYER`
 * because these are `z-index` on `<div>`s, not Phaser depths — but the same rule applies: pick a
 * name, never a number, so the error toast can never end up under the banner it is explaining.
 */
export const DOM_LAYER = {
  /** Offline / update banners. */
  banner: 9990,
  /** The portrait rotate hint. */
  hint: 9998,
  /** The soft error-recovery toast — above everything, because it explains why the rest moved. */
  error: 9999,
} as const;

/**
 * The one plate the DOM chrome is drawn on: the offline banner, the update banner, the portrait
 * hint and the error toast were four copies of the same inline `cssText` recipe, with the panel
 * fill and the accent gold spelled out as literals in each — the one corner of the UI a re-point
 * of `SURFACE`/`TEXT` would have silently missed.
 *
 * `anchor` is the caller's own edge offset (`top:...` / `bottom:...`), because that is the only
 * part that genuinely differs per banner; everything else is the shared look. There is no
 * stylesheet in this project, so inline styles are the medium.
 */
export function plateCss(opts: {
  /** e.g. `top:calc(12px + env(safe-area-inset-top))`. */
  anchor: string;
  z: number;
  /** Banners start hidden and are toggled; a toast is appended already visible. */
  display: 'none' | 'block';
  padding?: string;
  pointerEvents?: 'none' | 'auto';
}): string {
  const { anchor, z, display, padding = '6px 12px', pointerEvents = 'none' } = opts;
  return `position:fixed;left:50%;${anchor};transform:translateX(-50%);display:${display};`
    + `background:${toHex(SURFACE.overlay)};color:${TEXT.accent};border:1px solid ${TEXT.accent};padding:${padding};`
    + `font:12px monospace;border-radius:4px;z-index:${z};opacity:0.95;pointer-events:${pointerEvents};`;
}
