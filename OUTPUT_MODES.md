# Output Modes

**Canonical for:** command output verbosity conventions used by humans, agents, local tooling, and CI.

This is the long form of [`WORKFLOW.md`](WORKFLOW.md) §1, which stays the short
canonical statement agents read. If the two ever disagree, `WORKFLOW.md` wins.

Core principle:

> Successful operations should produce almost no context, while failures should reveal only the information needed to investigate them.

This is a presentation policy only. Output modes must never change validation behavior, exit codes, or correctness.

## Modes

### AI Mode

Default for agents.

Set:

```bash
MEXE_OUTPUT=ai
```

Success:

```text
PASS test:rules 61/61 1.4s
PASS build 4.6s
```

Failure:

```text
FAIL test:server

ON-07 reconnect reclaims seat
expected: seat=2
received: seat=3

server/room-session.ts:184
log: tmp/agent-logs/test-server.log
```

Only expose:
- failed check/test/acceptance ID
- expected vs actual where available
- first relevant error/location
- artifact/log path
- narrow rerun command if useful

Do not expose on success:
- passing test names
- coverage tables
- dependency inventories
- bundle manifests
- full HTTP/network logs
- screenshots inline
- trace contents
- complete stdout/stderr

### Human Mode

Default for manual developer use.

Set:

```bash
MEXE_OUTPUT=human
```

Example:

```text
✓ Rules (1.4s)
✓ Multiplayer (2.7s)
✓ TypeScript (3.2s)
✓ Build (4.6s)
```

Human Mode can show more structure but should still avoid noise.

### Debug Mode

Set:

```bash
MEXE_OUTPUT=debug
```

Use only for concrete diagnostic need.

Debug may show:
- full stdout/stderr
- verbose reporters
- complete stacks
- detailed network logs
- full trace/video details
- coverage tables

Return to AI/Human mode once the failure is understood.

## Progressive disclosure

Failure investigation should proceed:

```text
minimal failure summary
→ inspect exact failing test/file
→ inspect targeted log section
→ open full log only if still needed
```

Never load full logs into an AI context first.

## Artifacts

Verbose logs should go to an ignored path such as:

```text
tmp/agent-logs/
```

Playwright artifacts should remain file-based.

Report paths, not contents, unless targeted inspection is required.

## CI

Recommended:

```text
local AI agent → AI Mode
local developer → Human Mode
CI success → Human Mode
CI failure → Human summary + full logs/artifacts retained
deep investigation → Debug Mode
```

## Wrapper

**Not built.** `scripts/run-check.mjs` does not exist; verbose output goes to
`tmp/agent-logs/` by hand today. Proposed shape, should it ever be worth
automating:

```bash
MEXE_OUTPUT=ai node scripts/run-check.mjs unit -- npm run test
MEXE_OUTPUT=human node scripts/run-check.mjs build -- npm run build
```

It would:
- captures output
- preserves exit code
- measures duration
- prints a small success summary
- saves verbose failure output to `tmp/agent-logs/`
- prints the failure tail + log path

It intentionally does not parse every tool format. Tool-specific concise reporters can be added only if a concrete need appears.
