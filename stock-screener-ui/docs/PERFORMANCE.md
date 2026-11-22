# Performance — index

- **Last checked: 2026-11-22**
- **Next check: 2026-11-29**

Short index only. The budgets and the enforcement rules live in
[`AGENTS.md` → *Performance budgets and checks*](../AGENTS.md#performance-budgets-and-checks).
Keep this page a pointer; do not duplicate numbers here.

## Detailed docs / authority

| Topic | Source |
|---|---|
| Wall/test budgets (backend + frontend) | [`perf/budgets.json`](../perf/budgets.json) |
| API latency budgets (per-route warm p95; `API_COLD` = `agri_filters` cold budget 10,000 ms) | [`perf/api_budgets.json`](../perf/api_budgets.json) |
| API benchmark, warm/cold semantics, verdicts, known breach | [docs/API_LATENCY.md](./API_LATENCY.md) · [`scripts/bench_api.py`](../scripts/bench_api.py) |
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
must also update the contract test), and refresh last-checked / next-check on
every review.

## Measurement methodology

- **Warm up first.** Discard the first run/request of any benchmark so import,
  JIT, disk-cache and connection-pool costs do not pollute the measurement.
  `bench_api.py` discards 5 warmups and measures 30 iterations by default
  (from `perf/api_budgets.json`); p50/p95/p99 come from the measured samples
  only. Warm and cold are separate tables, never averaged together. Cold paths
  must be tagged `API_COLD` — only `/api/agri/filters` has an agreed cold budget
  (10,000 ms); other routes report `cold: null` as INFO.
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
