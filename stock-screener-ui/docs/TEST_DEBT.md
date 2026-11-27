# Backend test-debt tracker

A concise, current record of the **full-sweep** backend test debt. This is a
tracker, not a test spec — see [TEST_RULES.md](../TEST_RULES.md) for how to fix
an individual test and [TESTING_SPEED.md](./TESTING_SPEED.md) for the fast
changed-test runner and timing pipeline.

## Status (as of 2026-11-22)

- **The full 8,987-test exclusion sweep is NOT green.** It is the push / nightly
  **debt alarm**, not a PR gate. `AGENTS.md` records a historical **~230-failure
  debt** for the full suite; treat that number as a dated reference, not a live
  count — re-measure before quoting it (see [How to get a fresh list](#how-to-get-a-fresh-list)).
- **The PR fast tier (662 tests, `-m "unit and not slow"`, 12 shards) is a
  separate job and is green.** Do not conflate the two: ~9,237 node ids collect
  unfiltered → **8,987** after the full exclusion marker → **662** in the PR
  fast tier. Most tests are unmarked, so the 662 tier is an *include* filter that
  sees only marked tests.
- The known remaining failures are fixture/expectation drift, not evidence of
  product regressions — see [Policy](#policy).

> Evidence note: the 12-shard CI failure log that motivated this tracker
> (`/tmp/opencode/ci-python-fail.log`) was **not present** in this environment.
> Fixed-cluster facts below are taken from the checked-in changelog, the
> 2026-11-22 performance log and git history; remaining-cluster counts are
> **rough/owner-supplied estimates**, not freshly counted. Verify with the
> command below before relying on any number.

## Fixed clusters

These were burned down in the 2026-11-22 audit. Counts are from `changelog/`
and `docs/PERFORMANCE_LOG_2026-11-22.md` where stated; otherwise from commit
messages.

| Cluster | Count | What changed |
| --- | --- | --- |
| MockRunner `_cycle_data_cache` + backtest patch targets + `sys.executable` + shim guard | **41 stale tests fixed; 2 dead tests deleted** | Runner risk doubles now expose `_cycle_data_cache`; `@patch('backtest.engine.*')` targets re-pointed to `backtest.strategies.*`; subprocess tests use `sys.executable`; parity test gained a shim-aware `_nautilus_installed()` guard so the real-engine leg skips only when the package is genuinely absent. Two dead tests removed: an always-`pytest.skip` placeholder in `test_backend_remaining.py` and a shadowed duplicate `test_watch_empty_store`. Commit `77155424`, `test: clear low-risk backend test debt` (140 passed, 2 environmental skips). |
| News-poller asyncio mocking | **7 → 0 failures** (14 tests) | Rewrote `tests/api/test_news_poller.py` with correct async mocking (commit `9f355659`). |
| ORB / config / DB stale expectations | **14 → 0 failures** (204 tests) | Updated ORB signal defaults, config-loader and DB-model expectations in the same commit (`9f355659`). |
| Correlation cache isolation | fixed (count not itemised) | `tests/test_correlation.py` isolated to a tmp `CACHE_DIR` with patched time; no shared cache bleed between tests (commit `83db695f`, `test: isolate correlation cache tests to tmp`). |
| Frontend changed-test zero selection | fixed (guard, not a count) | The changed-test runner now diffs against the PR base and **fails when zero tests are selected**; previously an empty selection passed silently (commit `23c65d47`, `ci: diff frontend changed tests against the pr base`). |

## Remaining clusters (rough counts — re-measure before quoting)

No exact total is claimed here. The figures are approximate, grouped by the
owner/area that should fix them; they are **fixture/test drift**, not production
bugs.

| Cluster | Owner / area | Rough count |
| --- | --- | --- |
| Broker / bot DB `SessionLocal` isolation | `tests/` broker + bot modules; shared in-memory SQLite / `SessionLocal` fixtures | **~30** (estimate) |
| Symbol aliases missing gitignored data | tests relying on symbol-alias data under gitignored local paths | **~30** (estimate) |
| Event-radar missing fixtures | `tests/api/test_event_radar/`; missing local fixtures/data | **~13** (estimate) |
| Week52 cache property | `tests/` week52 cache property tests | **~11** (estimate) |
| Misc API / date / source drift | assorted API tests, date/session assumptions, source-name drift | **remaining** (unquantified) |

These are the *named* clusters; the sum is deliberately not asserted as the
full-sweep failure total.

## Policy

- **Fix the fixture or the test, not production code**, unless a genuine
  regression is proven with a failing-first reproduction (`TEST_RULES.md §0`).
  If a failure is actually a product bug, prove it fails first, then fix the
  code and keep the regression test.
- **Never mask a failure with a skip or an allowlist.** No `pytest.skip`, no
  `xfail`, no broad `ignore`/allowlist entries to make the sweep green. A test
  that cannot run honestly is a fixture problem to solve, not a silence to buy.
- **Deletion requires proof of no unique coverage.** Before deleting a test,
  show that no other test covers its unique assertion; the two deletions above
  were an always-skipped placeholder and an exact shadowed duplicate. Do not
  delete a failing test to reduce the count.
- Keep the fast tier and the full sweep separate: a green 662 tier does **not**
  make the 8,987 sweep green.

## How to get a fresh list

Run from `stock-screener-ui/`. This is the full exclusion sweep (the CI debt
alarm), using the exact CI marker expression:

```bash
.venv/bin/python -m pytest -o addopts="" \
  -m "not (slow or slow_testcontainers or integration or contract or e2e or testcontainers or postgres)" \
  -n 4 --dist loadfile -q --tb=short
```

- Marker (exact): `not (slow or slow_testcontainers or integration or contract or e2e or testcontainers or postgres)`
- `-n 4 --dist loadfile` mirrors CI's 4 xdist workers per shard (12 shards in CI);
  locally it is a single full run, not the sharded matrix.
- The PR fast tier uses a different marker, `unit and not slow`, and is a
  separate job — do not use it to assess this debt.

**Timing artifacts** (see [TESTING_SPEED.md](./TESTING_SPEED.md) §*Timing
pipeline*): load `tests/perf_plugin.py` and set `PERF_TIMINGS_JSON` /
`PERF_TIER=backend-full` (plus `PERF_SHARD` / `PERF_TOTAL_SHARDS` /
`PERF_MARKER_EXPR` for context) to emit `perf/pytest-timings.json`; merge with
`scripts/perf/collect_pytest_timings.py` into `perf/pytest-summary.json`; compare
with `scripts/perf/check_test_budgets.py` against `perf/budgets.json`. Generated
JSON is gitignored and uploaded only as a CI artifact. Budgets are warning-only
until the baseline week completes.
