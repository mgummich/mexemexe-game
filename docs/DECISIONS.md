# Decisions — MEXEMEXE!

The durable architectural decisions, each with **where its reasoning lives** and
**what was rejected**. One line each, on purpose: the rationale belongs in the
canonical document that owns the subject, and a second copy of it here would be a
second thing to keep true.

A decision earns a row if changing it would ripple through several modules, or if
someone would otherwise re-litigate it every few months. Refactors, renames and
local cleanups do not get rows.

| # | Decision | Reasoning lives in | Rejected, and why |
|---|---|---|---|
| D1 | `src/rules` is the only gameplay-legality authority. The server, the client, the AI and the tutorial all ask it. | [ARCHITECTURE.md](ARCHITECTURE.md#ownership-and-authority) | A second check anywhere (a UI pre-check, a server re-derivation) — two answers to "is this legal" is the bug class this forecloses |
| D2 | Online state is server-authoritative; a client holds a redacted projection with placeholder cards. | [MULTIPLAYER.md](MULTIPLAYER.md) §1–2 | Client-authoritative moves with server validation: the hidden information would have to reach the client to be rendered |
| D3 | The AI's search budget is a count of trials, never a wall clock. | [ARCHITECTURE.md](ARCHITECTURE.md#ai) · INV-A5 | A time-boxed search: the same seed would choose differently on a slow phone, which breaks replay and determinism |
| D4 | No multi-ply lookahead. | [ARCHITECTURE.md](ARCHITECTURE.md#ai) | Not a preference — INV-A2 denies the AI the pile order and the opponents' hands, so there is nothing to look ahead *through* |
| D5 | Difficulty and personality are orthogonal configuration over one engine; the evaluator stays neutral. | [ARCHITECTURE.md](ARCHITECTURE.md#ai) · Phase 48 | Per-personality evaluation weights: they would move personality into the shared evaluator and make every tier's behaviour a function of who is playing |
| D6 | Persistence is never a gameplay authority, and a local match is deliberately not resumable mid-turn. | [ARCHITECTURE.md](ARCHITECTURE.md#persistence) · SCN-34 | A mid-match save: it would become a second source of board state, and a corrupt one would have to be trusted or refused mid-hand |
| D7 | One supported version per artifact, and a refused format fails loudly rather than being read best-effort. Migration is bounded to one hop, for preferences only. | [ARCHITECTURE.md](ARCHITECTURE.md#compatibility-policy) | A migration framework: four artifacts on independent schedules, and a half-understood save is worse than none |
| D8 | The wire version is checked before anything else, and a mismatch is refused with copy the player can act on. Adding a server error code is *not* a version bump. | [MULTIPLAYER.md](MULTIPLAYER.md) §4 | Negotiating a shared subset: subtle desyncs instead of one clear refusal |
| D9 | The reconnect token lives in `sessionStorage`, paired with the endpoint that issued it. | [MULTIPLAYER.md](MULTIPLAYER.md) §9 | `localStorage`: a credential that outlives the tab, and one a crafted `?ws=` link could aim at another server |
| D10 | One server process, rooms in memory, no database. | [MULTIPLAYER.md](MULTIPLAYER.md) §0 · [OPERATIONS.md](OPERATIONS.md) | A persistence layer: nothing in the product outlives a match, and a rollback with no migration to reverse is worth more than durable rooms |
| D11 | No telemetry, no third-party analytics, no persistent diagnostic identifier. | [OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md) | Opt-in product metrics (considered and declined in Phase 73): aggregate server counters and the player's own exportable play log already answer the quality questions |
| D12 | Exceptions are logged as a class, never as text; redaction lives inside the logger. | [OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md) | Redacting at call sites: one new call site forgetting is a leak, and an exception message is attacker-influenced free text |
| D13 | The verification surface (`window.__MEXE__`) ships in production. | [OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md) | A dev-only surface: the e2e suites run against `dist/`, so a surface absent there would prove nothing about what players get. It is bounded by what the client already knows |
| D14 | Phaser renders everything; the bundle is not split. | [PERFORMANCE.md](PERFORMANCE.md) | Code splitting: one game screen, no route to split along, and 347 kB gzip measured |
| D15 | Music streams with `preload = 'none'` and is never precached. | [PERFORMANCE.md](PERFORMANCE.md) · [PWA_OFFLINE.md](PWA_OFFLINE.md) | Preloading or caching it: 1.2 MB on a cold boot for audio that is off by default, and 13 MB in the offline cache |
| D16 | Most screens are captured and read by humans; six deterministic states have per-platform pixel baselines. | [TESTING.md](TESTING.md) §Visual baselines | Pixel diffing *every* screen: renderer-dependent bytes across machines, and a baseline set too large to review, teach everyone to ignore the check. Six states with a `{platform}` suffix keep the signal (revised in Phase 33, once Phase 84 had measured that captures are byte-stable per machine) |
| D17 | Retries are per-suite, justified, and mirrored by nightly no-retry twins. | [TESTING.md](TESTING.md) §Flake policy | Global retries: they convert a race into a green check |
| D18 | Documentation drift is tested for its mechanical classes only. | [TESTING.md](TESTING.md) · `tests/docs-drift.test.ts` | Semantic prose checking: a check that cries wolf gets ignored, and then so does the real drift |
| D19 | CI shrinks for a documentation-only or server-only change, and runs everything otherwise. | [TESTING.md](TESTING.md) §Which gate runs when | Per-area routing for client changes: any shared module can move rendering, so the savings would be bought with coverage |
| D20 | The server image runs TypeScript directly (`tsx`), unprivileged. | [DEVELOPMENT.md](DEVELOPMENT.md#dependencies-and-bundle-cost) · [THREAT_MODEL.md](THREAT_MODEL.md) TM-17 | Compiling to JS in the image: it is the better answer if the revisit conditions there are ever met; today it buys a build step and loses "deployed code is reviewed code" |

## Keeping this true

A change that reverses a row edits the row, in the same change, with the new
reasoning in the canonical document and the old one moved to the rejected column —
that column is the point of the file. A change that adds a decision of this size
adds a row. Anything smaller does not belong here.
