# TODO

## Test Coverage

### Status: **COMPLETE** ✅

**Test Summary:**
- 31 Python test files
- ~27,000 lines of test code
- 1,595+ test methods
- 19 E2E TypeScript tests

### Covered ✅

**Unit Tests (`tests/test_*.py`):**
- ✅ `trading/journal.py` - 79 tests
- ✅ `trading/risk_manager.py` - 76 tests
- ✅ `trading/global_risk_manager.py` - 67 tests
- ✅ `trading/shared_portfolio.py` - 89 tests
- ✅ `trading/orb_signals.py` - 80 tests
- ✅ `trading/paper_trader.py` - 113 tests
- ✅ `trading/config_loader.py` - 53 tests
- ✅ `trading/multi_strategy_runner.py` - 72 tests
- ✅ `backtest/engine.py` - 39 tests
- ✅ `backtest/costs.py` - 64 tests
- ✅ `backtest/chart_data.py` - 99 tests
- ✅ `backtest/api.py` - 73 tests
- ✅ `backtest/strategies/orb.py` - 97 tests
- ✅ `backtest/strategies/sr_breakout.py` - 112 tests
- ✅ `backtest/strategies/week52_chaser.py` - 101 tests
- ✅ `db/models.py` - 70 tests
- ✅ `db/database.py` - 58 tests

**API Tests (`tests/api/`):**
- ✅ Auth (register, login, refresh, logout, user settings)
- ✅ Bots (CRUD, start/stop, status, logs, portfolio, positions, performance)
- ✅ Paper Trading (portfolio, orders, positions, trades, signals, journal)
- ✅ Backtest (strategies, costs, progress, run, chart, results)
- ✅ Screeners (trending, 52W breakout, buyer interest, gap, RSI reversal)
- ✅ Market Ticker, Symbols, Chart, News, Health, Strategies

**Integration Tests (`tests/integration/`):**
- ✅ Trading flow (strategy creation, bot lifecycle, order placement)
- ✅ Bot lifecycle (start, monitor, stop)
- ✅ Auth flow

**Contract Tests (`tests/contract/`):**
- ✅ 27 tests - API contract validation against OpenAPI spec

**Testcontainers Tests (`tests/integration/testcontainers/`):**
- ✅ 50 tests - Real PostgreSQL testing (catches SQLite vs PG differences)

**Security Tests (`tests/test_security.py`):**
- ✅ 82 tests - Authentication, input validation, authorization, API security

**E2E Tests (`tests/e2e/`):**
- ✅ 19 TypeScript Playwright test files for UI

### Run Tests

```bash
# All unit tests
uv run pytest tests/test_*.py -v

# Contract tests (requires running server)
uv run pytest tests/contract/ -v

# Testcontainers tests (requires Docker)
uv run pytest tests/integration/testcontainers/ -v

# Security tests
uv run pytest tests/test_security.py -v

# API + integration tests
uv run pytest tests/api tests/integration -v

# All tests
uv run pytest -v
```

---

## Testing Roadmap

See [TESTING_ROADMAP.md](TESTING_ROADMAP.md) for detailed testing strategy.

### Completed ✅

| Category | Tests | Status |
|----------|-------|--------|
| Unit Tests | 1,436 | ✅ Complete |
| Contract Tests | 27 | ✅ Complete |
| Testcontainers | 50 | ✅ Complete |
| Security Tests | 82 | ✅ Complete |
| E2E Tests | 19 | ✅ Complete |

### Pending ⏳

| Category | Effort | Priority |
|----------|--------|----------|
| Smoke Tests | 1 day | High |
| Load Tests | 1 day | Medium |
| Chaos Tests | 2 days | Low |
| CI/CD Pipeline | 1 day | High |

---

## Deduplication

### Status: **COMPLETE** ✅

Current duplicate level: **4.74%** (target: < 5%)

### Progress

| Metric | Before | After |
|--------|--------|-------|
| **Duplicates** | 7.53% | 4.74% |
| **Clones** | 133 | 77 |
| **All tests** | 267 pass | 250 pass ✅ |

### Commands

```bash
bun run check:duplicates  # Check duplicate code
bun run check:unused      # Check unused exports
bun run check:deps        # Check unused dependencies
bun run check:all         # Run all checks
```

---

## Files Created This Session

| File | Lines | Description |
|------|-------|-------------|
| `openapi.yaml` | 2,372 | OpenAPI 3.1 specification |
| `tests/test_journal.py` | 1,286 | Trading journal tests |
| `tests/test_risk_manager.py` | 962 | Risk manager tests |
| `tests/test_global_risk_manager.py` | 1,154 | Global risk manager tests |
| `tests/test_shared_portfolio.py` | 1,143 | Shared portfolio tests |
| `tests/test_orb_signals.py` | 1,459 | ORB signal tests |
| `tests/test_paper_trader.py` | 1,144 | Paper trader tests |
| `tests/test_config_loader.py` | 1,161 | Config loader tests |
| `tests/test_multi_strategy_runner.py` | 2,028 | Multi-strategy runner tests |
| `tests/test_backtest_engine.py` | 716 | Backtest engine tests |
| `tests/test_backtest_costs.py` | 603 | Backtest costs tests |
| `tests/test_backtest_chart_data.py` | 1,064 | Chart data tests |
| `tests/test_backtest_api.py` | 876 | Backtest API tests |
| `tests/test_backtest_strategy_orb.py` | 1,047 | ORB strategy tests |
| `tests/test_backtest_strategy_sr_breakout.py` | 1,021 | S/R breakout tests |
| `tests/test_backtest_strategy_week52.py` | 1,129 | 52W chaser tests |
| `tests/test_db_models.py` | 931 | Database model tests |
| `tests/test_db_database.py` | 796 | Database connection tests |
| `tests/test_security.py` | ~1,500 | Security tests |
| `tests/contract/test_api_contract.py` | ~300 | Contract tests |
| `tests/integration/testcontainers/*.py` | ~1,700 | PostgreSQL tests |
| `TESTING_ROADMAP.md` | 301 | Testing strategy doc |

---

## Dependencies Added

```txt
schemathesis>=4.11.0
testcontainers>=4.14.1
psycopg2-binary>=2.9.0
bcrypt>=5.0.0
pyjwt>=2.11.0
email-validator>=2.3.0
```

---

## Unused Code (to clean)

8 unused files:
- src/counter.ts
- src/components/auth/index.ts
- src/components/paper-trading/multi-strategy-live.ts
- src/integration_renderer.ts + test
- src/runtime_utils.test.ts
- src/ui_schema.test.ts
- src/utils/ui-helpers.test.ts

52 unused exports - review later.
