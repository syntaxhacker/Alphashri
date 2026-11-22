# Fast local changed-test runner (backend)

`scripts/test/run_changed.py` picks the backend tests likely to be affected by
your diff and runs only those. It is a **local-only** speed tool — CI remains
the gate.

## Why local-only

- The full Python suite is ~9,200 cases and takes >15 minutes locally. Running
  it while the API/tape writer is live starves them and is too slow to give
  useful feedback (see `AGENTS.md` → *Running Targeted Tests (Fast)*).
- This script never starts a server, installs packages, reads API keys, or
  touches the network. It only calls `git diff`, reads files under `tests/`,
  and runs the selected pytest node ids.
- It intentionally does **not** change `pytest.ini`, the conftests, or CI. The
  marker expression is copied from `.github/workflows/test.yml`, and heavy
  paths are mirrored from `tests/conftest.py` / `pytest.ini` `norecursedirs`.
- It is a heuristic, not a correctness proof: a green run means the mapped
  tests pass, not that unrelated tests do. CI runs the full matrix.

## Usage

Run from `stock-screener-ui/` (the script resolves the project root from its
own path, so it also works from the repo root):

```bash
.venv/bin/python scripts/test/run_changed.py --dry-run       # show selection + commands, run nothing
.venv/bin/python scripts/test/run_changed.py --list          # node ids only, exit
.venv/bin/python scripts/test/run_changed.py                 # map + run
.venv/bin/python scripts/test/run_changed.py --from HEAD~1   # different diff base
.venv/bin/python scripts/test/run_changed.py --paths api/replay_api.py tests/api/test_replay_api.py
.venv/bin/python scripts/test/run_changed.py --full-if-empty # fall back to whole fast tier
```

| Flag | Meaning |
|---|---|
| `--from REF` | Diff base for `git diff --name-only REF...HEAD` (default `origin/develop`). |
| `--paths PATH [PATH ...]` | Use these paths instead of git. Comma-separated values and directories (expanded to `test_*.py`) are accepted. |
| `--dry-run` | Print changed files, reasons, node ids and the exact pytest commands, then exit. |
| `--list` | Print only the node ids and exit. |
| `--full-if-empty` | If nothing maps to the diff, run the whole fast tier instead. Without it, an empty selection is an **error** (exit 2) — never a silent zero-test run. |
| `--marker EXPR` | Override the `pytest -m` expression. |
| `--jobs N` / `-n N` | Override xdist workers; always capped at the available cores. Default `min(4, os.cpu_count())` (also capped by CPU affinity). |

## Mapping rules

Given the normalized changed paths, the mapper applies these rules; every
selected node id carries the reason it was picked (`--dry-run` shows them):

1. **Changed test files** — any changed `tests/**/test_*.py` is selected as-is.
2. **Exact stem match** — `api/foo.py` selects `tests/test_foo.py` and/or
   `tests/api/test_foo.py` when they exist. Example: `api/replay_api.py` →
   `tests/api/test_replay_api.py`.
3. **Importers / patch targets** — for each changed backend module (e.g.
   `api.value_scan.cache`), scan every test file for import statements
   (`import api.value_scan.cache`, `from api.value_scan import cache as …`) and
   for dotted strings used by `@patch(...)` / `monkeypatch.setattr(...)`. This
   is the "grep-based" rule and is what catches package submodules such as
   `api/value_scan/filters.py` → `tests/api/test_value_scan/test_filters.py`.
4. **Package `__init__` fan-out** — a changed `**/__init__.py` selects the
   tests co-located with that package (`api/value_scan/__init__.py` → all
   `tests/api/test_value_scan/test_*.py`; `api/__init__.py` → `tests/api/`).
5. **API route/model changes** — route modules (`APIRouter(...)`,
   `@router.get(...)`, names containing `router`/`routes`/`_api`), API models
   (`db/models*.py`, pydantic/response models), `api_server_fastapi.py` and
   `openapi.yaml` always force `tests/contract/test_openapi_sync.py`.
   That check runs in a **separate pytest invocation without `-m`**, because
   CI's marker expression excludes the `contract` category — otherwise the
   forced check would be silently deselected.
6. **Heavy categories are dropped** by path before selection
   (`tests/integration/`, `tests/contract/`, `tests/e2e/`,
   `tests/testcontainers/`, `tests/needs_review/`, `tests/backtest/`,
   `tests/strategies/`, root-level `tests/test_*_integration.py`) — with the
   forced OpenAPI check above as the single deliberate exception — and again
   by pytest via the marker expression.

Frontend (`src/`), scripts, docs and other non-backend paths are reported as
skipped; use vitest / `npx vitest run --changed` for those (see `TEST_RULES.md`).

### Marker expression

Default (from `.github/workflows/test.yml`, the tier that excludes the heavy
categories while keeping unmarked unit/API tests):

```text
not (slow or slow_testcontainers or integration or contract or e2e or testcontainers or postgres)
```

CI's PR gate also defines `unit and not slow`, but that is an *include* filter
that only sees marked tests (~660 of ~9,200). Most mapped tests are unmarked,
so using it here would silently drop nearly everything. Pass
`--marker "unit and not slow"` if you explicitly want that narrower view.

## Example (diff on `origin/develop...HEAD`)

`--dry-run` output for a representative diff includes:

```text
Selected node ids (79):
  tests/api/test_replay_api.py  <- exact stem of api/replay_api.py, imports/patches api.replay_api
  tests/api/test_value_scan/test_filters.py  <- imports/patches api.value_scan.filters
  tests/test_chart_patterns_scan.py  <- imports/patches chart_patterns.scan, changed test file
Forced contract check (1):
  tests/contract/test_openapi_sync.py  <- API route/model change api/value_scan/router.py ...
jobs=2  marker='not (slow or ... or postgres)'
```

## Tests for the mapping logic

`tests/test_run_changed_mapping.py` builds a fake tree under `pytest`'s
`tmp_path` and exercises all rules above. It is pure filesystem work — no git,
no pytest subprocess, no network:

```bash
.venv/bin/python -m pytest tests/test_run_changed_mapping.py -q
```

## Collection-time notes (`pytest.ini`)

- Measured with `.venv/bin/python -m pytest --collect-only -q` from
  `stock-screener-ui/`. Collection is ~13–23 s for ~9,230 node ids; wall time is
  ~20–40 s and noisy while other lanes are editing tests.
- `testpaths = tests` already restricts a bare `pytest` to `tests/`. Verified:
  every collected node id is under `tests/`; `node_modules`, `.git`, `.venv`,
  `experiments/data`, `reports`, `dist`, `coverage`, `logs`, `backups` and the
  caches are **not** walked. The added `norecursedirs` entries (those trees plus
  `htmlcov`, `cache`, `data`, `test-results`, `playwright-report`) are defensive
  for explicit broad runs such as `pytest .`. A before/after node-id diff with
  and without them is empty — no real test directory is excluded and the
  expected collection-time delta is ~0.
- The old `ignore =` block was invalid (pytest has no `ignore` ini option, only
  the `--ignore` CLI flag) and silently did nothing. It was removed. The three
  root-level `*_integration.py` modules are still excluded from CI by
  `tests/conftest.py`, which tags them `pytest.mark.integration` for the `-m`
  exclusion; no conftest change was needed.
- `--import-mode=importlib` was tested via CLI override: identical 9,237 node
  ids, no new warnings, no speedup (~46.6 s vs ~45.0 s wall). It was **not**
  added; CI clears `addopts` anyway, so it would not affect the gate.

## Frontend unit tests (vitest) — pool-speed investigation (2026-11-22)

**Decision: keep the committed `vitest.config.ts` default** (`pool: "forks"`,
`execArgv: ["--max-old-space-size=8192"]`, default isolation). No pool or
isolation change was adopted for CI: `threads` cannot start with the current
heap flag, `isolate: false` breaks a test, and `threads` with the flag cleared
is only ~15–18% faster on a *quiet* box and still needs full-suite validation.

### Tooling / environment

- `bun` is **not installed** here; used the checked-in `node_modules/.bin/vitest`
  4.1.0 on node v24.22.2 via `npx` 11.19.1. No installs, servers, API keys or
  git writes were used.
- The box has 2 visible CPUs. Most runs happened while other agents ran pytest:
  loadavg 4.8–10.3, 0–9.5% idle — the repo's "≥30% idle" gate was not met, so
  after waiting ~2 minutes the runs were interleaved so contention hit every
  variant. A final quiet window (75% idle, loadavg ~2.3) gave the cleanest
  numbers. **Contended wall times are a range; use the quiet pair for the
  speedup estimate.**

### Sample (10 files, 222 tests) — report / screener / paper

`reportBits`, `pressureDesk`, `NiftyChartPanel`, screener `columns/base`,
`CorrelationMatrix`, `ScreenerTable`, `ScreenerContainer`, paper
`tradeHistoryUtils`, `LivePriceUpdater`, `PaperTradingView`. All runs used the
same files and no coverage; variants are CLI overrides of the committed config.

| Variant | Command override | Files / tests | Wall time |
|---|---|---|---|
| Current default | none | 10/10 files, 222/222 tests pass (7/7 runs) | contended: 86.6, 55.0, 58.4, 54.4, 36.4 s; quiet: 24.4, 27.9 s |
| `threads`, unmodified config | `--pool=threads` | **0 tests, exit 1** (2/2 runs) | 14.5, 13.0 s (failed at worker start) |
| `threads`, heap flag cleared | `--pool=threads --execArgv=` | 10/10 files, 222/222 tests pass (5/5 runs) | contended: 60.4, 25.0, 42.4 s; quiet: 20.1, 23.6 s |
| No isolation | `--no-isolate` | **9/10 files, 221/222 tests** (2/2 runs) | 32.0, 27.5 s |

Contended numbers are too noisy to conclude anything (2 of the 3 interleaved
pairs had `threads` slower). In the two quiet, back-to-back pairs `threads` was
consistently faster: 20.1 s vs 24.4 s (−18%) and 23.6 s vs 27.9 s (−15%), with
222/222 tests passing both times. Vitest's own durations agree (18.8/21.9 s vs
23.1/26.3 s). So the gain is real but modest — not enough to adopt a config
that drops the 8 GB heap guard without full-suite proof.

### Why each alternative was rejected

- **`pool: "threads"` with the current config**: Node refuses the inherited
  `execArgv` for worker threads —
  `ERR_WORKER_INVALID_EXEC_ARGV: Initiated Worker with invalid execArgv flags:
  --max-old-space-size=8192`. Every worker failed to start; zero tests ran.
  Clearing the flag (`--execArgv=`) makes Solid/happy-dom pass with full
  pass/fail parity and is ~15–18% faster on a quiet box, but that drops the
  8 GB heap guard (worker threads cannot take that flag — it would have to
  move to the parent `NODE_OPTIONS`) and only 10 of ~748 files were checked.
  Not adopted for CI; keep it as a local experiment until the full suite is
  validated.
- **`isolate: false`**: fails deterministically, twice, in
  `src/components/paper-trading/LivePriceUpdater.test.tsx > "does not open the
  SSE stream on a holiday at 11:00 IST"` — `expected "vi.fn()" to not be called
  at all, but actually been called 2 times` (a holidays fetch plus the SSE
  fetch). Cross-file module/mock state leaks, so the sample is **not**
  independent. Rejected; default isolation stays ON.
- **`poolOptions` / `singleFork` tuning**: removed in vitest 4.1.0; the only
  supported knobs are `pool`, `maxWorkers`, `fileParallelism`, `isolate`,
  `execArgv`. No safe tuning was measured.

### What was added: `test:fast`

```bash
bun run test:fast     # or: npx vitest run --dir src --changed
```

Changed-only run of the frontend unit tests — a genuinely different job from
`test:unit` (whole `src/` suite), not a duplicate. It uses vitest's own git
awareness and exits 0 with "No test files found" when `src/` is clean. With
`bun` absent, call the `npx` form directly. In CI, PRs to `develop` run the
changed tier with the PR base SHA passed explicitly
(`--changed=<base SHA>`); PRs to `main`, pushes and nightly run the full `src/`
suite. A guard fails the changed tier if it collects zero tests while the PR
changes frontend sources/tests.

CI's default remains the safe config. To experiment with threads locally:
`NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --dir src --pool=threads --execArgv=`
(the parent-process heap flag keeps the memory guard). Validate pass/fail
parity on the full suite before ever considering it for CI.

---

## Timing pipeline (pytest + vitest) — 2026-11-22

A single, opt-in timing pipeline now produces comparable "why did tests get
slower?" artifacts for both tiers. It **does not gate CI yet**: budget misses
are warnings until a baseline week has been collected.

### Files

| File | Role |
|---|---|
| `tests/perf_plugin.py` | pytest plugin; records per-test setup/call/teardown, status, node id, file, markers, and aggregate fixture setup cost. Writes JSON only when `PERF_TIMINGS_JSON` is set. |
| `scripts/perf/collect_pytest_timings.py` | Merges one or more raw pytest timing JSONs (shard runs + collect-only) into `pytest-summary.json`. |
| `scripts/perf/summarize_vitest.py` | Converts Vitest's JSON reporter output into `vitest-summary.json`. |
| `scripts/perf/check_test_budgets.py` | Compares summaries to `perf/budgets.json` and prints actionable misses. Warning-only by default; `--strict` hard-fails (use only after a baseline week). |
| `perf/budgets.json` | Conservative initial budgets; read-only, never lowered silently. |
| `.github/workflows/test.yml` | Loads the plugin, writes/uploads artifacts, runs the warning-only check. |

### How it works

* The plugin is imported only with `-p tests.perf_plugin`. Without
  `PERF_TIMINGS_JSON` every hook is a no-op, so loading it elsewhere changes
  nothing. It adds no options, markers, or collection filters.
* Durations come from pytest's own `report.duration` per phase; only two
  wrapper hooks call `perf_counter()` (collection phase and fixture setup).
  Under xdist, the controller receives every worker report, so a single
  process writes a single file — no shard clobbering.
* `PERF_TIER` (`backend-pr-fast`, `backend-full`, `frontend-changed`,
  `frontend-full`) travels from CI into the summary and selects the budget.
  `PERF_SHARD`, `PERF_TOTAL_SHARDS`, and `PERF_MARKER_EXPR` are context only.
* With xdist, collection happens in workers, so the controller's collection
  timer is ~0. CI therefore also instruments the `--collect-only` step and the
  collector takes the **max** collection time across its inputs.
* Vitest keeps its existing `verbose` reporter and additionally writes JSON:
  `--reporter=verbose --reporter=json --outputFile.json=perf/vitest-timings.json`.
  Test behaviour and coverage config are untouched.

### Artifact schema

Raw pytest JSON (`perf/pytest-timings.json`):

```json
{
  "schema_version": 1, "generator": "tests/perf_plugin.py",
  "tier": "backend-pr-fast", "marker_expr": "unit and not slow",
  "shard": "1", "total_shards": "12", "xdist_workers": 4,
  "collection_seconds": 0.255, "wall_seconds": 12.3,
  "tests": [
    {"nodeid": "tests/test_correlation.py::TestComputeCorrelation::test_perfectly_correlated_series",
     "file": "tests/test_correlation.py", "name": "test_perfectly_correlated_series",
     "status": "passed", "setup": 0.0119, "call": 0.0038, "teardown": 0.0001,
     "markers": ["unit"], "duration": 0.0159}
  ],
  "fixtures": {
    "isolated_cache": {"count": 11, "total_seconds": 0.0004, "mean_ms": 0.032, "max_ms": 0.044}
  }
}
```

Summary JSON (`perf/pytest-summary.json` / `perf/vitest-summary.json`) adds
counts, `wall_seconds`, `collection_seconds`, `fixture_setup_p95_ms`, and the
slow tail (`slowest`, `slow_tests` with marker context) that the budget checker
uses. Vitest's summary uses `full_name`/`duration_seconds` instead of node ids.

### Budgets (initial, warning-only)

| Tier | Metric | Budget |
|---|---|---|
| backend PR fast | wall | < 300 s |
| backend full | wall | < 1200 s |
| backend (both) | collection | < 30 s |
| backend (both) | fixture setup p95 (per-test setup phase) | < 50 ms |
| backend (both) | unmarked test duration | <= 2 s (tests marked `slow`, `slow_testcontainers`, `integration`, `contract`, `e2e`, `testcontainers`, `postgres` are exempt) |
| frontend changed | wall | < 120 s |
| frontend full | wall | < 600 s |

### Local reproduction (tiny samples only, no full suite)

```bash
# backend: before/after on one file
.venv/bin/python -m pytest tests/test_correlation.py -o addopts="" -q --tb=short
PERF_TIMINGS_JSON=perf/pytest-timings.json PERF_TIER=backend-pr-fast \
  .venv/bin/python -m pytest tests/test_correlation.py -o addopts="" -q --tb=short -p tests.perf_plugin
.venv/bin/python scripts/perf/collect_pytest_timings.py \
  -i perf/pytest-timings.json -o perf/pytest-summary.json

# frontend: verbose output is preserved alongside the JSON
npx vitest run src/test-utils/renderWithProviders.test.tsx --reporter=verbose \
  --reporter=json --outputFile.json=perf/vitest-timings.json --dir src
PERF_TIER=frontend-changed .venv/bin/python scripts/perf/summarize_vitest.py \
  -i perf/vitest-timings.json -o perf/vitest-summary.json

# warning-only check (add --strict to hard-fail)
.venv/bin/python scripts/perf/check_test_budgets.py \
  -s perf/pytest-summary.json -s perf/vitest-summary.json
```

Measured on this box (2026-11-22, `npx` vitest 4.1.0, `.venv` pytest 9.2.0;
other agents were active, so treat deltas as indicative):

| Sample | Before | After (instrumented) |
|---|---|---|
| pytest `tests/test_correlation.py` (32 tests) | 3.785 s wall / 0.48 s pytest | 3.950 s wall / 0.58 s pytest; 32 records, p95 setup 2.00 ms |
| vitest `src/test-utils/renderWithProviders.test.tsx` (4 tests) | 2.566 s wall / 1.29 s vitest | 2.288 s wall / 1.09 s vitest; 4 records, JSON 1.8 KB |

The instrumentation overhead is ~0.1 s on the pytest sample (dominated by the
per-fixture wrapper and one JSON write) and within run-to-run noise for vitest.
CI adds `continue-on-error: true` to both budget-check steps: misses are
printed as `WARN` lines, never a red build, until the baseline week is done.

### Caveats

* The repo-root `.gitignore` ignores `*.json` globally; `perf/.gitignore`
  re-includes only `budgets.json`. Generated timing JSONs stay ignored locally
  and are uploaded only as CI artifacts.
* Vitest wall time is derived from report `startTime`/`endTime` (test execution
  only, excluding worker startup/bun install). `--wall-seconds` overrides it
  if end-to-end wall is wanted.
* "fixture setup p95" is the p95 of the **setup phase** across tests (the phase
  where fixtures run), which is cheaper to collect than tracing each fixture;
  per-fixture count/total/max is also in the artifact.
