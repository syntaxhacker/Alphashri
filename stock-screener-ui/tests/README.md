# Test Suite Map

Current as of the 2026-11-22 quality audit. Older counts in this file (1,614 total / 19 E2E tests) were stale; the numbers below come from live discovery commands, not from a hand-maintained tally. Re-run those commands rather than editing the numbers by hand.

> Selection note: a bare `pytest` collects **9,213** Python cases, but CI currently executes only **662** (`-m "unit and not slow"`, 6 shards) because most tests are unmarked. The CI/marker fix is owned by another lane — do not change marker selection from this file or from the guards here.

## Scale at a glance

| What | Count | How to verify |
| --- | --- | --- |
| Python test modules under `tests/` | 406 | `find tests -name 'test_*.py' \| wc -l` |
| — at `tests/` root (unit/API/parity/backtest/etc.) | 246 | `find tests -maxdepth 1 -name 'test_*.py' \| wc -l` |
| — under `tests/api/` | 141 | `find tests/api -name 'test_*.py' \| wc -l` |
| — under `tests/test_candle_alert/`, `integration/`, `contract/`, `indicators/` | 8, 7, 2, 2 | `find <dir> -name 'test_*.py' \| wc -l` |
| Collected Python cases (all) | 9,213 | `.venv/bin/python -m pytest -o addopts="" --collect-only -q \| tail -1` |
| Python cases CI executes | 662 | `-m "unit and not slow"` in CI collection; see shard recipe below |
| Playwright E2E | **701 tests in 58 spec files** | `npx playwright test --list \| tail -1` (collect-only, no browser needed) |

Frontend vitest specs live in `src/**/*.test.ts(x)` and are driven by `bun run test` / `npx vitest run <file>`. They are **not** part of this directory's Python suite.

## Directory ownership

```
tests/
├── conftest.py                 # root fixtures; mirrors a small API subset (see below)
├── test_*.py                   # 246 unit / parity / backtest / integration-ish modules
├── test_test_layout.py         # GUARD: spec + Python test placement (no Docker/network)
├── test_conftest_fixture_parity.py  # GUARD: AST parity of mirrored conftest fixtures
├── api/                        # 141 FastAPI endpoint modules + own conftest.py
│   ├── conftest.py             # client/auth_client/db + autouse cache/snapshot resets
│   ├── test_agri/              # deterministic agri fixtures (own conftest.py)
│   ├── test_event_radar/       # scheduled corporate-catalyst endpoints
│   ├── test_report_sim/        # report simulation
│   └── test_value_scan/        # deep-value scoring/filters/router
├── integration/                # 4 modules + conftest.py; extends API fixtures
│   └── testcontainers/         # real PostgreSQL, needs Docker; in pytest.ini norecursedirs
├── contract/                   # 2 modules: OpenAPI drift + API contract
├── indicators/                 # 2 modules + fixtures/expected.json, ohlcv.csv
├── test_candle_alert/          # 8 modules + own conftest.py
├── e2e/                        # 58 Playwright *.spec.ts (701 tests); playwright.config.ts testDir
│   ├── helpers/                # TS page/navigation/mock helpers for specs
│   └── fixtures/               # tooltip harness (.html/.tsx)
├── fixtures/                   # shared data: agri CSV, sample JSON
├── helpers/                    # db.py (import_all_models) + shared TS helpers
├── mocks/                      # shared TS API mocks (apiResponses.ts, routeHelper.ts)
├── scenarios/                  # scenario documents
└── *.md                        # scenario/results/gap notes + this map
```

**Ownership rule:** new Python tests go under `tests/` (or an existing subdirectory); new Playwright specs go under `tests/e2e/`. Do not scatter `test_*.py` into `api/`, `trading/`, `backtest/`, or the repo root — `pytest.ini` sets `testpaths = tests`, so those files would not be collected. The layout guard enforces this. Standalone test files in `experiments/`, `scripts/`, `edge_scanner_tv/`, and `.prime/` are intentional exceptions (research/tool/skill self-checks run explicitly).

## Test split

| Category | Location | What it covers | Requirements |
| --- | --- | --- | --- |
| Unit | `tests/test_*.py` (246) | trading, strategies, backtest sim, DB models, indicators, security, mutation checks | none (in-memory SQLite / mocks) |
| API | `tests/api/**` (141) | FastAPI routes via `TestClient`, JWT/auth, bots, chart patterns, value scan, event radar | none; no live broker/API calls |
| Integration | `tests/integration/*.py` (4) | multi-step flows (auth, trading, bots, trade persistence) | none beyond API fixtures |
| Contract | `tests/contract/` (2) | OpenAPI spec drift vs `app.openapi()`, missing tags, path-count floor | app import; no server |
| Testcontainers | `tests/integration/testcontainers/` (3) | real PostgreSQL behaviour | Docker; excluded from normal collection by `norecursedirs` |
| Indicator parity | `tests/indicators/` (2) | expected values + CSV/JSON golden fixtures | none |
| E2E | `tests/e2e/*.spec.ts` (701 cases) | browser flows, mocked network via `tests/mocks` + `e2e/helpers` | Chromium; optionally `CI_MODE=1` + backend on :8765 |

`pytest.ini` also ignores `tests/test_orb_conservative_integration.py`, `tests/test_week52_chaser_integration.py`, and `tests/test_week52_target_integration.py` (external-credential dependencies). They exist but are not collected.

## Fixtures, helpers, mocks

- **Root `tests/conftest.py`** — `test_db_engine` / `test_db` (in-memory SQLite), `test_user`, `test_strategy`, `test_bot`, `client`, `client_with_db`, `mock_db` / `mock_user` / `mock_bot` / `mock_strategy`, `sample_*` payloads, and autouse `reset_trading_module_state`.
- **Mirrored subset** — `test_engine`, `db`, `auth_client` are duplicated in the root conftest so they resolve even when pytest loads only the first explicit file argument's conftest chain. `tests/api/conftest.py` remains authoritative for tests under `tests/api/`. Changing one requires changing the other; `test_conftest_fixture_parity.py` checks names, dependencies and scope via AST.
- **API `tests/api/conftest.py`** — `client`, `auth_client`, `test_engine`, `db`, token fixtures (`valid_access_token`, `expired_*`, `revoked_*`), and autouse resets for option caches, the analytics rate limiter, and the chain-snapshot writer. It deliberately avoids `with TestClient(app)` because the app lifespan starts network-backed background tasks that wedge teardown.
- **Other conftests** — `tests/integration/conftest.py` extends the API fixtures; `tests/integration/testcontainers/conftest.py` owns Docker/PostgreSQL fixtures; `tests/api/test_agri/conftest.py` and `tests/test_candle_alert/conftest.py` are local to those modules.
- **Helpers** — `tests/helpers/db.py:import_all_models()` registers models before `Base.metadata.create_all`. Shared TS helpers live in `tests/helpers/*.ts` and `tests/e2e/helpers/*.ts`.
- **Mocks / fixtures data** — `tests/mocks/apiResponses.ts` and `routeHelper.ts` stub browser network calls; root-conftest `mock_*` fixtures stub DB objects; data files live in `tests/fixtures/`, `tests/indicators/fixtures/`, and `tests/e2e/fixtures/`.
- `src/components/common/colorHygiene.spec.ts` is a **vitest** guard that happens to use the `.spec.ts` suffix. It is not a Playwright spec; the layout guard keys on the `@playwright/test` import and ignores it.

## Marker conventions

`pytest.ini` uses `--strict-markers` and `asyncio_mode = auto` (no explicit `@pytest.mark.asyncio` needed). Registered markers:

`unit`, `integration`, `contract`, `e2e`, `testcontainers`, `postgres`, `slow`, `slow_testcontainers`, `auth`, `strategy`, `paper_trading`, `bots`, `market_data`, `screener`, `backtest`, `chart`, `news`, `asyncio`.

Most modules are currently unmarked; that is the known selection gap owned by the CI lane. When adding a marker to a test, use one from the list above and run the targeted selection to confirm it still collects. Do not change `-m "unit and not slow"` in CI from this lane.

## Coverage

`pytest.ini` sets `[coverage:run] source = .` and omits tests/migrations, so `--cov=.` works without extra flags.

```bash
# Focused coverage (preferred locally)
.venv/bin/python -m pytest tests/test_security.py --cov=api --cov=trading --cov-report=term-missing -q
.venv/bin/python -m pytest tests/api/test_value_scan/ --cov=api.value_scan --cov-report=term-missing -q

# HTML report (htmlcov/index.html)
.venv/bin/python -m pytest tests/test_correlation.py --cov=api --cov-report=html -q
```

Do not run coverage over all 9,213 cases locally — use CI shards for the full matrix.

## Run one file, one case, or one shard

```bash
# Single module / single case
.venv/bin/python -m pytest tests/test_security.py -q
.venv/bin/python -m pytest tests/test_security.py::TestClassName::test_name -q

# Filter by keyword or marker (CI's current selection shown)
.venv/bin/python -m pytest tests/ -k "auth and not slow" -q
.venv/bin/python -m pytest tests/ -m "unit and not slow" -q

# Python shard, CI-style: collect node ids, then round-robin 6 ways
.venv/bin/python -m pytest -o addopts="" --collect-only -q -m "unit and not slow" \
  | grep '::' > /tmp/all-tests.txt
awk '((NR-1) % 6) == 0' /tmp/all-tests.txt \
  | xargs .venv/bin/python -m pytest -o addopts="" -n 4 --dist loadfile -q --tb=short

# One Playwright spec / one E2E shard (collect-only listing is safe locally)
npx playwright test --list | tail -1
npx playwright test tests/e2e/auth.spec.ts --workers=4 --output=/tmp/pw-out
npx playwright test --shard=1/20 --workers=4 --output=/tmp/pw-out
```

Never run the full Playwright suite locally without a file/shard filter; the full 20-shard run is main/nightly-only. PRs use the smoke set.

## Structural guards (fast, no Docker/network)

```bash
.venv/bin/python -m pytest tests/test_test_layout.py tests/test_conftest_fixture_parity.py -q
```

- `test_test_layout.py` fails when a spec importing `@playwright/test` sits outside `tests/e2e/`, or when a `test_*.py` with real pytest definitions appears outside `tests/` (legacy research/tool roots allowlisted). Unparseable Python is skipped, not failed.
- `test_conftest_fixture_parity.py` compares `test_engine`, `db`, `auth_client` signatures across the root and API conftests using `ast` only — no app imports. It skips if a conftest is unreadable, the marker comment changes, or a scope is dynamic.

These guards are part of the Python suite; run them after touching conftests or moving any test file.

## Writing new tests

1. Put the file in the owning directory from the map above.
2. Use the nearest conftest's fixtures; never open `db/alphashri.db` — tests use in-memory SQLite (`test_engine` / `test_db_engine`).
3. Mock external dependencies (broker, news, LLM); no live HTTP in unit/API tests.
4. Name tests `test_<behaviour>_<scenario>` and cover both success and failure paths.
5. Run the touched module plus the two guards; see `TEST_RULES.md` for assertion and mock conventions.

## Related docs

- [TESTING_INDEX.md](../docs/TESTING_INDEX.md) — authoritative test/performance docs and folders (start here)
- [TEST_RULES.md](../TEST_RULES.md) — test shape, mocks, guards
- [AGENT_QUICKSTART.md](../docs/AGENT_QUICKSTART.md) — commands and fixtures
- [API_TEST_SCENARIOS.md](./API_TEST_SCENARIOS.md), [TEST_SCENARIOS.md](./TEST_SCENARIOS.md), [TEST_RESULTS.md](./TEST_RESULTS.md)
- [python_test_gap_analysis.md](./python_test_gap_analysis.md), [TESTING_ROADMAP.md](../TESTING_ROADMAP.md)
