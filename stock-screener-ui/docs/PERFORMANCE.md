# Performance — index

- **Last checked: 2026-11-28**
- **Next check: 2026-12-05**

Short index only. The budgets and the enforcement rules live in
[`AGENTS.md` → *Performance budgets and checks*](../AGENTS.md#performance-budgets-and-checks).
Keep this page a pointer; do not duplicate numbers here.

## Detailed docs / authority

| Topic | Source |
|---|---|
| Wall/test budgets (backend + frontend) | [`perf/budgets.json`](../perf/budgets.json) |
| API latency budgets (per-route warm p95, including the seeded-cache chart route; `API_COLD` = `agri_filters` cold budget 10,000 ms — re-measured **PASS** 2026-11-28, see [docs/API_LATENCY.md](./API_LATENCY.md)) | [`perf/api_budgets.json`](../perf/api_budgets.json) |
| Interactive chart/UI protocol, budgets and scripts (initial targets pending baseline) | [docs/CHART_PERFORMANCE.md](./CHART_PERFORMANCE.md) · [`perf/chart_ui_budgets.json`](../perf/chart_ui_budgets.json) · [`scripts/perf/`](../scripts/perf/) |
| API benchmark, warm/cold semantics, verdicts, agri cold path re-measured/resolved 2026-11-28 | [docs/API_LATENCY.md](./API_LATENCY.md) · [`scripts/bench_api.py`](../scripts/bench_api.py) · [`scripts/perf/bench_agri.py`](../scripts/perf/bench_agri.py) |
| Backend fast changed-test runner (selection rules, markers, flags) | [docs/TESTING_SPEED.md](./TESTING_SPEED.md) · [`scripts/test/run_changed.py`](../scripts/test/run_changed.py) |
| CI shard/tier facts (12 python shards; E2E 20 shards) | [`.github/workflows/test.yml`](../../.github/workflows/test.yml) · `AGENTS.md` |

**Denominators (do not mix):** **~9,237** node ids collected with no marker
filter → **8,987** after the full exclusion marker → **662** in the PR fast tier.
The **662-test fast tier** (`-m "unit and not slow"`, 12 shards) is the PR gate.
The **8,987-test exclusion sweep** is a push/nightly debt alarm: the full suite
carries a known ~230-failure debt and is **not** a gate until green. Never lower
a budget silently — optimize, mark the slow test, or record an explicit
exception with owner + date in the relevant budget file (`perf/budgets.json` for
wall/test budgets, `perf/api_budgets.json` for API latency; API budget changes
must also update the contract test; `perf/chart_ui_budgets.json` for interactive
chart/UI, see [docs/CHART_PERFORMANCE.md](./CHART_PERFORMANCE.md)), and refresh
last-checked / next-check on every review.

## Measurement methodology

- **Warm up first.** Discard the first run/request of any benchmark so import,
  JIT, disk-cache and connection-pool costs do not pollute the measurement.
  `bench_api.py` discards 5 warmups and measures 30 iterations by default
  (from `perf/api_budgets.json`); p50/p95/p99 come from the measured samples
  only. Warm and cold are separate tables, never averaged together. Cold paths
  must be tagged `API_COLD` — only `/api/agri/filters` has an agreed cold budget
  (10,000 ms); other routes report `cold: null` as INFO. That agri cold budget
  was re-measured as **PASS** on 2026-11-28 (only the agri cold path was
  re-measured in that pass); see [docs/API_LATENCY.md](./API_LATENCY.md) and
  [`scripts/perf/bench_agri.py`](../scripts/perf/bench_agri.py).
- **Chart route warm read.** The in-process chart benchmark pre-seeds a
  session-current `1D` candle file under its own temp workdir and disables only
  the stale-first *background* refresh, so the measured p95 is candle-cache
  read + indicators/SR + payload. It is not an upstream-fetch number, and over
  `--base-url` it is informational because the harness cannot seed the server.
- **Report the median (p50), not the mean.** Use p95 only for the tail budgets
  that name it; quote the sample size and the window. A single run is an
  anecdote — repeat and report the spread.
- **CPU matters.** Check `cat /proc/loadavg` and `top -bn1 | grep "^%Cpu"` first;
  require ≥30% idle (load average below core count). Contended wall times are a
  range, not a number. Wait for a quiet window rather than benchmarking under
  load.
- **No concurrent suites.** Never run two full suites (across lanes) at once and
  never run Playwright above the idle CPU can absorb. A stranded worker or a
  parallel lane corrupts timing and makes counts unattributable. After a
  cancelled/failed run, confirm nothing was orphaned:
  `pgrep -af "vitest|pytest|playwright"`.
- **Narrow runs for feedback.** Prefer the changed-only runners to full sweeps;
  see [docs/TESTING_SPEED.md](./TESTING_SPEED.md) for the exact commands. CI is
  the gate for the full matrix.
- **Interactive UI has its own protocol.** Chart/canvas/indicator changes use
  [docs/CHART_PERFORMANCE.md](./CHART_PERFORMANCE.md): warm-up, 3+ runs, median
  and p95, fixed 1600×1000 and 390×844 viewports, real fixtures, no concurrent
  suites, and hardware/date recorded. Its numbers live in
  [`perf/chart_ui_budgets.json`](../perf/chart_ui_budgets.json) and are gated by
  `bun run perf:chart`; they are not averaged with the API or test-budget tables
  here.

## Benchmark harnesses

Deterministic, network-free harnesses in [`scripts/perf/`](../scripts/perf/).
Paths are repo-relative; commands run from `stock-screener-ui`. Use the project
venv interpreter. The harnesses also offer golden/parity modes — see each
script's docstring. Report medians, never a single run.

| Script | Measures | One-line command |
|---|---|---|
| [`stock-screener-ui/scripts/perf/bench_levels.py`](../scripts/perf/bench_levels.py) | LevelBook build/fusion vs the raw `compute_sr_zones` detector | `PYTHONPATH=. CI_MODE=1 python scripts/perf/bench_levels.py` |
| [`stock-screener-ui/scripts/perf/bench_agri.py`](../scripts/perf/bench_agri.py) | Agri `/api/agri/filters` cold/warm/profile/parity against a synthetic cache (never the real DB) | `python scripts/perf/bench_agri.py warm` (run `build` once first) |
| [`stock-screener-ui/scripts/perf/bench_indicators.py`](../scripts/perf/bench_indicators.py) | Indicator computation across timeframes, with optional golden parity check | `PYTHONPATH=. CI_MODE=1 python scripts/perf/bench_indicators.py` |
| [`stock-screener-ui/scripts/perf/bench_sr.py`](../scripts/perf/bench_sr.py) | Support/resistance zone computation on seeded candles, with golden dump/compare | `PYTHONPATH=. python scripts/perf/bench_sr.py --mode bench` |
| [`stock-screener-ui/scripts/perf/bench_api_reads.py`](../scripts/perf/bench_api_reads.py) | 52W touch-history enrichment read path on in-memory SQLite with a frozen clock | `python scripts/perf/bench_api_reads.py` |
| [`stock-screener-ui/scripts/perf/bench_backtest_chart.py`](../scripts/perf/bench_backtest_chart.py) | Backtest chart-data payload build, with frozen-fixture parity capture/compare | `python scripts/perf/bench_backtest_chart.py bench` |
| [`stock-screener-ui/scripts/perf/bench_backtest_sim.py`](../scripts/perf/bench_backtest_sim.py) | Sim `BarDataWrangler` bar conversion, with bit-exact capture/compare and A/B | `PYTHONPATH=. python scripts/perf/bench_backtest_sim.py bench <baseline.json>` |
| [`stock-screener-ui/scripts/perf/bench_instrument_index.py`](../scripts/perf/bench_instrument_index.py) | Instrument-key resolution: linear scan vs indexed map (counted + wall passes) | `PYTHONPATH=. CI_MODE=1 python scripts/perf/bench_instrument_index.py` |
| [`stock-screener-ui/scripts/perf/bench_screener_52w.py`](../scripts/perf/bench_screener_52w.py) | 52W screener read path with counted upstream reads; capture/verify/bench modes | `python scripts/perf/bench_screener_52w.py --mode bench3` |
| [`stock-screener-ui/scripts/perf/bench_screener_52w_meta.py`](../scripts/perf/bench_screener_52w_meta.py) | 52W rationale/summary call counts + response parity over mixed/empty/skeleton fixtures | `python scripts/perf/bench_screener_52w_meta.py --compare <baseline.json>` (run `--capture <baseline.json>` first) |
| [`stock-screener-ui/scripts/perf/bench_dashboard_sparks.py`](../scripts/perf/bench_dashboard_sparks.py) | Dashboard spark fan-out with a fixed-latency fetch stub | `PYTHONPATH=. CI_MODE=1 python scripts/perf/bench_dashboard_sparks.py` |

## 2026-11-26 backend/DB performance loop

**Gate:** measurable backend/DB improvement, zero regressions, agri untouched,
in-memory-only DB verification. **Certified result: PASS** — 233 integrated
targeted tests green in CI-like collection order, benchmark contract 50 passed,
migrations 44 validated, app running and healthy.

**Baseline → final (cold, ms):** replay_configs 298.39 → **9.29**; chart
232.64 → **58.48**; login 398.25 → 247.84; health 10.42 → 11.28 (noise).
**Warm p95 final (ms):** health 0.67, login 237.76, profitability 1.73,
market_snapshot 15.17, replay_configs 4.45, chart 58.35 — all PASS. Warm
profitability/market_snapshot baselines were cache-dependent (7.70 / 52.96);
final numbers also reflect a warm disk cache, so they are **not** claimed as
code-caused. **Unit:** two cost-12 bcrypt fixtures 12.2s → 2.1–3.8s; targeted
wall 12.2s → 3.25s on final confirmation. **DB in-memory synthetic:** movers
lookup 4.06×, segment count 8.25×, live-stream symbol read ~7.7×, trade
projection ~2.2× narrower read.

**Lanes delivered:** route prebuild (`api_server_fastapi.py`); analytical
cache-lag tolerance (`chart_patterns/candles.py`,
`api/reports_api/profitability.py`); DB indexes/projections
(`db/models/broker.py`, `db/models/replay_saved_config.py`, new migration
`2026_11_26_1200-idxperf1a2b3c4d5e_add_query_covering_indexes.py`,
`api/symbols.py`, `api/paper/live_stream.py`, `api/reports_api/movers.py`);
trade projections (`api/strategy_performance.py`,
`api/paper/dashboard_analytics.py`, `api/paper/analytics.py`,
`api/paper/aggregated.py`); scoped fixture hashing (`tests/api/conftest.py`,
two paper test files); benchmark/test harness (`scripts/perf/db_query_bench.py`,
`tests/perf/test_db_query_bench.py`, new tests).

**Caveats:** agri backend/caches/tests excluded throughout this loop; the agri
cold path was re-measured separately on 2026-11-28 (PASS; only agri cold was
re-measured in that pass) — see [docs/API_LATENCY.md](./API_LATENCY.md) and
[`scripts/perf/bench_agri.py`](../scripts/perf/bench_agri.py). Live
`db/alphashri.db` hash drifted from the externally running uvicorn/WAL
checkpoints — never opened, migrated, restored or written by this work; all
verification was in-memory SQLite or read-only. A mixed-directory explicit-file
pytest invocation hits a pytest 9.1.1 same-name fixture-shadowing quirk
(`tests/conftest.py` `client` vs `tests/api/conftest.py` `client`); CI-like
collection order passes 233/233. No budgets were lowered; no commits, pushes or
PRs.
