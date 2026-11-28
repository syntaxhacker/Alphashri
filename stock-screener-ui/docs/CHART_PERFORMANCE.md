# Interactive chart/UI performance protocol

**Status: initial targets, not yet baselined (2026-11-25).** The numbers in
[`perf/chart_ui_budgets.json`](../perf/chart_ui_budgets.json) are the first
agreed gates, not a claim that today's build meets them. Every gate below must
be measured before a chart PR is called done, and the first real run becomes the
baseline.

This is the authoritative protocol for interactive chart/UI performance. The
short index lives in [`docs/PERFORMANCE.md`](./PERFORMANCE.md); edited summary
rules live in [`AGENTS.md`](../AGENTS.md) and
[`SUBAGENT_RULES.md`](../SUBAGENT_RULES.md).

## When this is mandatory

Run the gate for any change that touches:

- chart or canvas rendering (`ChartView`, `PatternTradingViewChart`, chart
  containers, pan/zoom, resize, fullscreen);
- indicators (`src/config/chartIndicators*`, indicator menu, chips, canvas
  tags, series construction);
- overlays, S/R zones, pattern overlays/trend lines, pattern-chart data mapping
  (`patternTVData*`, `patternIndicatorData*`);
- timeframe handling (ladder, switching, resampling, `?tf=`, as-of/replay);
- any data-dense UI whose work grows with the number of bars, zones or series.

When in doubt, treat it as in scope. A visual-only change to a chart still runs
the matrix; a change that can alter render cost also runs `bun run perf:chart`.

## Ephemeral filesystems (read before writing fixtures or screenshots)

This workspace lives under `/workspaces/` in Codespaces. A container/sandbox
reset wipes `/tmp`; that has already destroyed a worktree's uncommitted fixes,
fixtures, a virtualenv and 28 screenshots.

- Worktrees go in `/workspaces/test-rag/.agent-worktrees/<task>/`.
- Virtualenvs, fixtures, captures, logs and benchmark JSON go in
  `/workspaces/test-rag/.agent-artifacts/<task>/`.
- `/tmp/opencode` is allowed only outside Codespaces, or for single-use files
  that a committed script regenerates in one command.

The perf scripts resolve this automatically:

```text
CODESPACES=true  -> /workspaces/test-rag/.agent-artifacts/chart-perf
otherwise        -> /tmp/opencode/chart-perf
override         -> CHART_PERF_ARTIFACT_DIR
```

`perf/chart-perf-results.json` stays in the repo because it is a small,
gitignored result file that survives with the workspace; fixtures, screenshots
and matrix JSON go to the artifact directory. Delete only this task's own
artifact subdirectory after the PR is merged and the committed evidence exists.

## Prerequisites

1. Python dev env with `yfinance`, `pandas`, `numpy` (the project `.venv`):
   `source .venv/bin/activate`.
2. A production build and a preview server on **127.0.0.1:4174**:
   `bun run build` then `bun run preview -- --host 127.0.0.1 --port 4174`.
   Perf/matrix scripts never start a server; the main/integration agent or a
   dedicated harness agent owns the server.
3. Playwright Chromium installed (`bunx playwright install chromium`).
4. A quiet machine: `cat /proc/loadavg` and `top -bn1 | grep "^%Cpu"`.
   Require **≥30% idle** (load average below core count). Do not run another
   full suite or a second Playwright lane concurrently.

## Fixtures

`scripts/perf/gen_chart_fixtures.py` builds the real harness fixtures and is
the only network step:

- symbol **POWERGRID.NS** on NSE;
- the **11 enabled built-in timeframes**: `1m, 5m, 10m, 15m, 30m, 1h, 3h, 4h,
  1D, 1W, 1M` (`3m` and `2h` are disabled in the registry by default);
- OHLCV from **yfinance**, resampled with the backend's
  `chart_patterns.candles._resample_ohlcv`;
- real `compute_indicators` + `compute_sr_zones` output for every timeframe;
- up to `--bars` bars per timeframe (default 500). Sparse history is recorded
  honestly in `manifest.json` — e.g. a monthly frame cannot have 500 bars from
  a 20-year history. The payload budget is checked on a frame that does have
  500 bars.
- `--as-of` pins the last session. The default is the previous weekday; pin an
  explicit completed session for repeatable comparisons.

The generator writes `fixtures.json` and `manifest.json`. `manifest.json`
carries per-timeframe indicator+zone timings used by the backend budget check
(1 warm-up + 3 measured runs on a fresh download; 5 warm-ups + 30 measured
runs when re-timing existing fixtures offline with `--from-fixtures`).

Re-timing the real candles already on disk requires no network:

```bash
python scripts/perf/gen_chart_fixtures.py --from-fixtures \
  --out /workspaces/test-rag/.agent-artifacts/chart-perf/fixtures
```

This rewrites only `manifest.json`; `fixtures.json` (including its recorded
indicators and zones) is left untouched.

## Methodology

- **Warm up first.** Discard the first route load and the first backend timing
  run. Only measured runs enter the statistics.
- **3+ measured runs** per metric. Report the **median** and **p95**; a single
  run is an anecdote. The gate statistic per target is explicit in
  `perf/chart_ui_budgets.json` (`gate_stats`).
- **Fixed viewports:** **1600×1000** and **390×844**, device scale factor 1.
  Both must pass; a desktop-only result is not evidence.
- **Real fixtures**, not synthetic candles: POWERGRID.NS, all 11 timeframes,
  real indicator/zones payloads.
- **No concurrent full suites** and no parallel Playwright workers in this
  harness. Contended timings are a range, not a number.
- **Record hardware and date** in every result (`chart-perf-results.json` does
  this automatically: CPU model/count, RAM, OS, Node, browser, viewport).
- Listener counts come from a live CDP source (`Performance.getMetrics` →
  `JSEventListeners`) before and after the stress cycles, with forced GC.
  Patching `addEventListener`/`removeEventListener` is deliberately **not**
  used: listeners on DOM nodes that are removed and garbage-collected never
  call `removeEventListener`, so that counter over-reports growth.
- Route-load and timeframe-switch numbers come from the **real UI** with the
  backend mocked from the generated fixtures, so they isolate client work.
  Backend indicator+zone numbers come from the Python fixture generator.
- Screenshots are evidence of function, not of speed. The matrix writes 1600 and
  390 captures for every timeframe plus gating, all-on and stale-race states.

## Budgets

All values are **initial targets**. Decimal units: ms are milliseconds; bytes
are decimal bytes (1 KB = 1000 B); MB is 1,000,000 bytes.

| Gate | Target | Gate stat | Measurement |
|---|---|---|---|
| Initial route chart | **< 2000 ms** | median | `goto /chart/POWERGRID.NS` → first chart canvas, one warm-up discarded |
| In-app timeframe switch | **< 1000 ms** | median | `selectOption(tf)` → chart settled on the new timeframe |
| Frame during pan/zoom | **p95 < 33 ms** | p95 | rAF deltas while dragging and wheel-zooming the chart |
| Long task during interaction | **none > 200 ms** | max | `PerformanceObserver("longtask")` during the same interaction |
| Heap growth after 20 switches + 10 menu toggles + 5 fullscreen cycles | **< 20 MB** | max | `performance.memory.usedJSHeapSize` before/after, forced GC |
| Canvas/listener counts | **stable** (growth ≤ 0) | max | DOM `canvas` count + CDP `Performance.getMetrics` → `JSEventListeners` delta before/after the cycles |
| Indicator payload for 500 bars | **< 150 KB raw, < 30 KB gzip** | max | UTF-8 JSON of `{indicators, sr_zones}` and its gzip |
| Backend indicator+zones per TF | **p95 < 100 ms** | p95 | real `compute_indicators` + `compute_sr_zones` in the fixture generator |
| Toggle all-on / all-off | **< 300 ms** | median | one in-page click sequence over every enabled menu row, through the next frame |

The payload budget applies to the indicator/S-R extras the chart adds on top of
candles. The harness also records the full **Charter chart payload** (candles +
extras) so a regression in candle serialization is visible, but the stated
budget is the indicator subset.

## Commands

```bash
# 1. Build + preview (main/harness agent; not a subagent)
bun run build
bun run preview -- --host 127.0.0.1 --port 4174

# 2. Real fixtures (network step; refresh when the data path changes)
bun run perf:chart:fixtures
# optional: -- --symbol POWERGRID.NS --bars 500 --as-of 2026-11-24

# 3. Functional matrix: 11 TFs × 1600/390, all-on counts, VWAP/SMA200 gating,
#    chips, switching, stale-response race
bun run perf:chart:matrix

# 4. Budget gate (exit 1 on blockers)
bun run perf:chart
# report-only run: writes results and exits 0
bun run perf:chart -- --report
```

Both Node scripts accept `--base-url`, `--fixtures` and `--out`; `perf:chart`
also accepts `--results` and `--runs`. It refuses to measure when
`load1 > 0.7 × cores`; `--force` records a contended run (and marks it in the
result) instead of silently producing a bad baseline.

## Result artifacts

- `<artifact>/fixtures/fixtures.json` — per-TF `{candles, indicators, sr_zones}`.
- `<artifact>/fixtures/manifest.json` — sources, actual bar counts, hardware and
  indicator+zone timings.
- `<artifact>/matrix/chart-tf-matrix.json` + `*.png` — functional evidence.
- `perf/chart-perf-results.json` — measurements, per-gate checks, verdict.
  Generated and gitignored; attach the summary numbers to the PR.
- For PR-visible screenshots, run the matrix with
  `--out docs/screenshots/chart-perf` (commit the captures) or copy the
  retained artifact captures there. The artifact dir is the raw working copy;
  the committed evidence is the durable one.

A chart PR's evidence must quote the measured **median/p95** and the verdict,
not "looks fast". Link the matrix JSON and the result file in the PR body.

## Failure policy

1. **Optimize, then re-measure.** A missed target is an optimization task.
2. Never lower a budget silently or edit the number to match the measurement.
3. If the target still cannot be met, run one more optimization pass and record
   the before/after numbers.
4. Only then add an entry to `known_exceptions` in
   `perf/chart_ui_budgets.json` with the **measured limit**, **cause**,
   **owner** and **date**. Example shape:

   ```json
   {
     "target": "timeframe_switch_ms",
     "measured_limit": 1280,
     "cause": "1W/1M resample blocks the main thread on the 2019 fixture",
     "owner": "chart-ui",
     "recorded": "2026-11-25",
     "scope": "1600x1000 only"
   }
   ```

5. Repeat until the target is met or a hardware/algorithmic limit is proven
   with numbers. An exception above its own `measured_limit` is a blocker, not
   a waiver.
6. Re-check known exceptions on the next review; remove them when the
   underlying limit disappears.

## Related gates

- Correctness: targeted unit + E2E tests, `bun run lint`, `bun run build`.
- Visual: 1600/390 screenshots for every changed state, read back and checked
  (see `docs/SCREENSHOT_EVIDENCE.md`).
- Performance: this document. **Correctness + visual + performance are three
  gates; an A+ visual review cannot waive a performance blocker.**
