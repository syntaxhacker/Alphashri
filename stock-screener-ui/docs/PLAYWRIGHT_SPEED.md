# Playwright speed lane

Coverage is unchanged. The default `playwright.config.ts` keeps every functional spec, assertion, trace-on-retry and screenshot-on-failure setting. This lane only changes **how evidence captures and local targeted runs are executed**.

## Commands

```bash
# Parallel evidence capture (default 4 workers; no trace/video/screenshots)
bun run evidence:app
bun run evidence:screener
bun run evidence:patterns
bun run evidence:all
EVIDENCE_WORKERS=2 bun run evidence:all   # bound CPU on a small host

# Reuse an already-running dev server; otherwise the evidence config starts one.
bun run evidence:app

# Targeted local runs
bun run test:e2e:changed   # --only-changed=origin/develop
bun run test:e2e:failed    # --last-failed
bun run test:e2e:ui        # Playwright UI mode

# Speed micro-benchmarks (no screenshots written)
bun run evidence:benchmark
```

## What changed

- `playwright.evidence.config.ts`: `fullyParallel`, `EVIDENCE_WORKERS` (default 4), `EVIDENCE_MAX_FAILURES` (default 10), trace/video/screenshot off, `webServer` with `reuseExistingServer`.
- `tests/e2e/helpers/evidenceFast.ts`: shared context per viewport, deterministic `waitForSettled` (testid + fonts + 2 RAF), WS/analytics noise blocking. `/api/**` and fonts stay live.
- `scripts/evidence/benchmark.mjs`: measures context reuse, `networkidle` vs deterministic wait, and noise blocking.
- `scripts/evidence/write-manifest.mjs`: manifest generation after capture, never inside a test.
- Evidence scripts no longer force `--workers=1`; each spec still runs in its own process when invoked separately, or in one parallel run with `evidence:all`.

## No-loss guardrails

- Functional suite/config untouched.
- Every evidence state and assertion remains.
- No test removed, skipped, weakened, or retried more.
- Only WS/telemetry noise is blocked for capture; `/api/**` and fonts remain.
- Manifest/hash audit still runs after capture.

## Expected wins (from the earlier perf lane)

- Shared contexts + parallel workers: ~2.5–3.5× capture.
- Removing `networkidle`/fixed sleeps: ~1.08s/frame.
- Blocking WS/telemetry: ~1.03s/frame.

Measure with `bun run evidence:benchmark` on the host; don't trust vendor N× claims.
