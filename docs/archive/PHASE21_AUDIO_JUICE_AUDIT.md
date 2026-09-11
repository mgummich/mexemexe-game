# Phase 21: Audio & Juice (Game-Feel) Audit

## 1. Current Audio System

**SFX Layer** (src/audio/sfx.ts)
- Fire-and-forget `playSfx(scene, key, volume)` with mute/volume multiplied from settings.
- 80ms retrigger guard per key — no rapid stacking (intended per docs/AUDIO_DIRECTION.md).
- Try/catch silently eats missing audio and load failures; never crashes.
- Called from: widgets.ts (button click), GameScene.ts (all gameplay events).

**Music Layer** (src/audio/music.ts)
- HTMLAudioElement (not Phaser loader) — 5 MP3 tracks pre-fetched on-demand.
- Context-aware round-robin: 'menu' / 'game' / 'mexe' contexts auto-select track pools.
- In-game 'game'/'mexe' flips don't swap tracks (900ms fade too disruptive on every turn hand-off).
- Fade transition: 900ms (0 instant under reduced motion via settings.motionScale()).
- Browser autoplay unlocks on first pointerdown/keydown after startMusic() call.
- App sleep: pauses on hidden, resumes on visible if muted is off and musicVolume > 0.

## 2. Mute/Volume Handling + Persistence

**Settings Singleton** (src/core/settings.ts, persistence.ts)
- Persisted to localStorage under key `mexe-save` (versioned envelope).
- Settings: `muted` (boolean), `sfxVolume` / `musicVolume` (0–100), `musicEnabled` (on/off), `musicContextAware`.
- Defaults: sfxVolume 80, musicVolume 55, musicEnabled true, musicContextAware true.
- Corrupt data: `parseSave()` merges partial saves; unknown/out-of-range values reset to defaults (fallback-safe).
- Listeners notified on change via `settings.onChange()`.

**Volume Getters**
- `sfxVolume()` = vol/100 × (muted ? 0 : 1)
- `musicVolume()` = vol/100 × (muted || !musicEnabled ? 0 : 1)

**Panel** (src/ui/settings-panel.ts)
- Mute button (toggle).
- Separate SFX/music sliders (0–100).
- Music on/off toggle (independent of slider).
- Music context-aware toggle.

## 3. Reduced Motion & Reduced Effects

**Reduced Motion** (settings.reducedMotion)
- Part of OS accessibility API (prefers-reduced-motion media query).
- Scales all cosmetic tweens to instant (motionScale() = 0).

**Battery Saver** (settings.batterySaver)
- "Trims non-essential decorative effects" on weaker/battery-limited devices.
- Grouped with reducedMotion: same motionScale() = 0 effect.

**No Separate "Reduced Effects" Setting**
- reducedMotion and batterySaver both zero out animation duration.
- No third setting for sfx-only or visual-only reduction.
- SFX always plays unless muted/volume-off (no per-effect mute).

## 4. Mobile / PWA Audio Unlock + Resume

**Autoplay Unlock** (src/audio/music.ts, lines 141–150)
- Browsers block audio until user gesture.
- startMusic() adds one-shot pointerdown/keydown listeners to play() the audio element.
- Listeners removed once audio is unpaused (prevents page-lifetime listener spam).

**App Sleep/Resume** (src/core/lifecycle.ts, music.ts)
- onAppVisible/onAppHidden subscribe to visibilitychange + pagehide/pageshow (iOS compat).
- On hidden: pause music.
- On visible: resume if paused AND musicVolume > 0 (respects current settings).

**Offline Indicator** (src/core/pwa.ts)
- setupOfflineBanner() renders a fixed banner (top: 44px) when navigator.onLine is false.
- No SFX or animation on state change.

## 5. Missing Feedback Moments

| Action | SFX? | Animation? | Notes |
|--------|------|-----------|-------|
| Button press | ✓ sfx-click | Press squash (scale 0.94) | All PixelButton clicks |
| Card pick/select | ✓ sfx-pickup/snap | Card scale+center on drag start | GameScene line 1152 |
| Card drop (invalid) | ✓ sfx-invalid/drop | Animate back to origin | GameScene line 2575 |
| Legal snap | ✓ sfx-snap | Card settles, no extra tween | GameScene line 2575 |
| FEITO confirm | ✓ sfx-feito | None observed | Line 1510, 1583, 1973 |
| Draw card | ✓ sfx-draw | Card flies to hand zone | Line 2711 |
| Pass/end turn | ✗ None | Music context switch only | Line 585–625 (onTurnStart) |
| Undo/reset | ✗ None | None | Line 634–660 (onUndo/onReset) |
| Turn start | ✗ None | Banner scale 1→1.22 yoyo | Line 603 (my turn) |
| Win/endgame | ✓ sfx-win (2x) | Celebration sprites likely | Line 681, 1041 |
| Tutorial step advance | ✗ None | None | NEXT button in step panel |
| Room code copy | ✗ None | None | OnlineScene line 301 |
| Offline/reconnect | ✗ None | None | pwa.ts banner, no feedback |

## 6. Confusing or Noisy Feedback

**Spam Risk**
- Card drag emits updateDropZoneHover every pointermove (lines 2311–2429). No SFX, but redraws zone highlights repeatedly.
- No debounce on highlight redraws; potential visual flicker if zone boundaries are tight.

**Overlapping Cues**
- Button sfx-click (0.4 vol) can overlap with game sfx (0.3–0.6 vol) if menus open during gameplay.
- No priority/queue system; last playSfx() in the 80ms window wins (if within retrigger guard).

**Volume Levels** (lines 12, 90, 687, etc.)
- Inconsistent volume passed per-call: 0.3 (snap), 0.4 (pickup, click), 0.5 (drop, draw), 0.6 (default).
- No centralized volume profile; hard to normalize feedback level across actions.

## 7. Animation / Tween Hotspots & Leak Risks

**Tween Cleanup**
- GameScene shutdown (line 357) calls unsubs, removes timers/listeners, stops ambience.
- **Missing**: `this.tweens.killAll()` — in-flight tweens not explicitly killed.
- Phaser auto-kills tweens on scene shutdown, so no actual leak; but explicit kill is safer.

**Per-Frame Allocations**
- updateDropZoneHover (line 2427): allocates a `Phaser.Geom.Rectangle`, but **only after** the
  `if (key === this.hoverKey) return;` early return at line 2415 — so it fires once per hover-zone
  change, not per pointermove. **Not a per-frame allocation; no fix needed.** (Corrected on review.)

**Spark Particles** (line 1268)
- onComplete: spark.destroy() properly cleans up each spark.

**Tweens Not Awaited**
- Most tweens are fire-and-forget; no tracking if they complete or are interrupted.
- onComplete callbacks (e.g., line 2576) are used to trigger renderAll(), so functional but tight coupling.

## 8. Accessibility Risks

**Color-Only Feedback**
- Meld zone highlights (line 1776–1781) use alpha/color only; no text/outline alternative.
- Helper mode has ghostPreview (line 2414–2425) but off by default for 'standard' helper.

**Flashing**
- No explicit flashing observed; tweens use yoyo (e.g., line 603 banner).
- Battery saver + reduced motion both eliminate animations, so flashing risk is low.

**Sound-Required State**
- Offline banner is visual-only (no sound alert).
- Room code copy succeeds silently (clipboard may fail); no toast/feedback.
- ~~Tutorial NEXT button has no SFX~~ — withdrawn on review; it is a `PixelButton` and already plays `sfx-click`.

**No Text Alternatives for Audio Cues**
- All SFX are pure audio; no visual signal (toast, flash, glow) to reinforce moment.
- Players with hearing loss miss all feedback cues except visual highlights.

## 9. Existing Tests Covering Audio / Settings

- **music-playback.test.ts**: Track rotation, context-aware playlist, motion scale fades (reducedMotion).
- **persistence.test.ts**: Settings merge, corrupt fallback, old key migration, type validation.
- **motion.test.ts**: motionScale() logic (reducedMotion, batterySaver).
- **audio.test.ts**: settings persistence (mute/volumes/musicContextAware), mute forcing both
  effective volumes to 0 without touching sliders, out-of-range volume tolerance, playSfx on a
  missing key, and playSfx while muted. (Corrected on review — this file was missed in the first
  pass.) Gap that remains: no test for the 80ms per-key retrigger guard.

## 10. Top 10 Fixes Ranked by Impact

1. **Add SFX to pass/end turn** (GameScene line 585): One sfx-deal or new tone signals action completion; high visibility moment.
2. ~~Cache workspace rect in drag loop~~ — **withdrawn on review**: the allocation sits behind an early return, so it is not per-frame.
3. **Kill tweens on scene shutdown** (GameScene line 357): Add `this.tweens.killAll()` after unsubs; prevents edge-case tween ghosts.
4. **Add SFX to undo/reset** (GameScene line 634–660): Quick click confirms state change; improves draft-edit feedback.
5. **Sound + visual on offline banner** (pwa.ts line 45–62): Toast + sfx-invalid on transition; signals network change.
6. **Add SFX feedback to room code copy** (OnlineScene line 301): sfx-click or special tone; confirms clipboard write.
7. **Centralize sfx volume profile** (audio/sfx.ts): Define levels per action type (UI, feedback, alert) instead of per-call.
8. **Add text/outline alternative to zone highlights** (GameScene line 1776): Helper mode option "highlight + label" for colorblind.
9. **Debounce zone highlight redraws** (GameScene line 2411): Track last drawn state; skip redrawDashedRect if zones unchanged.
10. ~~Add SFX to tutorial step advance~~ — **withdrawn on review**: tutorial NEXT/SKIP/REPLAY are `PixelButton`s (GameScene.ts:1568-1579), which already play `sfx-click` via widgets.ts:204.

---

**Generated:** 2026-09-11  
**Audit Scope:** Read-only, no file edits. Grep + targeted line reads only; large files (STATUS.json) skipped.

## Review corrections (Opus, before implementation)

Three findings above did not survive verification and are struck through in place:
the drag-loop allocation (guarded by an early return), the tutorial NEXT SFX gap
(PixelButton already plays `sfx-click`), and the "no playSfx/mute tests" claim
(`tests/audio.test.ts` covers both). `TutorialScene` was also checked for a missing
`setMusicContext` call — it is a thin launcher that starts GameScene, which sets the
context itself, so there is no gap there either.

## Selected for Phase 21

1. Your-turn audio cue in `onTurnStart()` (GameScene.ts:585) — `sfx-deal` @ 0.35.
2. Undo / redo / reset cues (GameScene.ts:636/643/650) — `sfx-pickup` / `sfx-snap` / `sfx-drop`.
3. Online connection-state cues in `onOnlineStatusChange()` (GameScene.ts:544) — reconnecting,
   self-reconnected, and connection-lost edges. Notice text still carries the meaning; sound is
   never required to understand state.
4. Visible room-code copy confirmation (OnlineScene.ts:301) — the button already plays
   `sfx-click`; what was missing was any on-screen confirmation.
5. New i18n key `online.copied` in both pt and en.
6. One new test for the 80ms per-key retrigger guard.

## Deferred (documented, not done)

- Centralised per-action SFX volume profile — the per-call volumes are inconsistent but audibly
  fine; a central profile is a refactor with no user-visible win today.
- Text/outline alternative to meld-zone colour highlights — real accessibility gap, but it is a
  helper-mode/UI design change, not audio-juice work. Highest-priority carry-over.
- No new audio assets were generated this phase; the existing 10-cue palette covered every gap.