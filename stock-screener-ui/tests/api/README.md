# API tests

FastAPI endpoint tests for `stock-screener-ui`. **141** test modules under `tests/api/` (verify with `find tests -path 'tests/api/*' -name 'test_*.py' | wc -l`). All use the in-process `fastapi.testclient.TestClient` with in-memory SQLite — no server, Docker, broker token, or live HTTP is required.

## Layout

```
tests/api/
├── conftest.py          # authoritative API fixtures + autouse resets
├── test_*.py            # endpoint modules (auth, bots, chart patterns, options, ...)
├── test_agri/           # deterministic APMC data (own conftest.py)
│   ├── conftest.py
│   └── test_*.py
├── test_event_radar/    # corporate-catalyst calendar/anomaly endpoints
├── test_report_sim/     # report simulation
└── test_value_scan/     # deep-value scoring/filters/router
```

## Fixtures

From `conftest.py` (the closest conftest wins for tests in this tree):

| Fixture | Purpose |
| --- | --- |
| `test_engine` | in-memory SQLite engine, `create_all` / `drop_all` around each test |
| `db` | nested-transaction `Session` bound to `test_engine`, rolled back at teardown |
| `client` | `TestClient(app)` with only `get_db` overridden |
| `auth_client` | `client` plus a seeded user and `get_current_user` override |
| `test_password`, `test_user_data`, `test_user`, `inactive_user`, `multiple_users` | user/auth variants |
| `valid_access_token`, `valid_refresh_token`, `expired_*`, `invalid_token`, `revoked_*` | JWT cases |
| `auth_headers`, `auth_headers_for_user`, `register_response_data`, `login_response_data` | HTTP auth helpers |
| `sample_candles_data`, `sample_instruments`, `sample_*_strategy`, `*_bot`, `sample_journal_data` | domain fixtures |
| `mock_trading_api`, `mock_load_all_trades` | network/DB boundary stubs |

Module-level helpers (not fixtures): `create_chart_response()`, `assert_chart_response_structure()`, `assert_news_response_structure()`, `assert_symbol_search_response_structure()`.

Autouse fixtures reset process-level state that would otherwise leak between tests: `_reset_option_caches`, `_reset_analytics_rate_limiter`, `_stub_chain_snapshot_writer`. `client` / `auth_client` deliberately do **not** use `with TestClient(app)`: the app lifespan starts network-backed background tasks whose thread-pool workers cannot be cancelled cleanly at teardown.

### Root-conftest mirror

`tests/conftest.py` duplicates `test_engine`, `db`, and `auth_client`. Pytest may load only the first explicit file argument's conftest chain (e.g. reversed file args), so those names must also resolve from the root. If you change one of the three, change both. `tests/test_conftest_fixture_parity.py` compares their names, dependencies, and scope with `ast` (no app import) and fails on drift:

```bash
.venv/bin/python -m pytest tests/test_conftest_fixture_parity.py -q
```

Other shared fixtures (`test_user`, `mock_*`, `sample_*`) intentionally have different signatures in the two conftests; do not "sync" them.

## Conventions

- Request protected routes with `auth_client`; use `client` for public routes and auth failures.
- Never write to `db/alphashri.db`. All persistence is `test_engine` / `test_db` or `monkeypatch`ed.
- Stub upstream clients (Upstox, news, LLM) — a green API test must not depend on network or market hours.
- New endpoint tests belong under `tests/api/`, next to the feature's existing module. Subdirectories exist per feature; add one only for a feature with its own fixtures.
- Most modules are unmarked; CI selection is owned by another lane. Do not add marker filters here.

## Run

```bash
# All API tests
.venv/bin/python -m pytest tests/api/ -q

# One feature directory / one module / one case
.venv/bin/python -m pytest tests/api/test_value_scan/ -q
.venv/bin/python -m pytest tests/api/test_auth.py -q
.venv/bin/python -m pytest tests/api/test_auth.py::test_login_success -q

# Keyword filter and focused coverage
.venv/bin/python -m pytest tests/api/ -k "event_radar" -q
.venv/bin/python -m pytest tests/api/test_value_scan/ --cov=api.value_scan --cov-report=term-missing -q
```

## Related docs

- [tests/README.md](../README.md) — full suite map, markers, sharding
- [API_TEST_SCENARIOS.md](../API_TEST_SCENARIOS.md) — endpoint scenario catalogue
- [TEST_RULES.md](../../TEST_RULES.md) — assertion/mock conventions
- [API Docs](../../AGENTS.md) — repository rules (search for "API Docs" for schema/drift workflow)
