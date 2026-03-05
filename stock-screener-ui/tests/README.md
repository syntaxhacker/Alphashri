# Test Suite

Comprehensive test suite for Alphashri backend using pytest, FastAPI TestClient, and Testcontainers.

## Quick Start

```bash
# Install dependencies
uv pip install pytest pytest-asyncio pytest-cov httpx testcontainers schemathesis

# Run all unit tests
uv run pytest tests/test_*.py -v

# Run API tests
uv run pytest tests/api/ -v

# Run integration tests
uv run pytest tests/integration/ -v

# Run contract tests (requires running server)
uv run pytest tests/contract/ -v

# Run testcontainers tests (requires Docker)
uv run pytest tests/integration/testcontainers/ -v

# Run security tests
uv run pytest tests/test_security.py -v

# Run with coverage
uv run pytest --cov=. --cov-report=html
```

## Test Structure

```
tests/
├── test_*.py                    # Unit tests for trading modules (1,436 tests)
│   ├── test_journal.py          # Trading journal tests
│   ├── test_risk_manager.py     # Risk manager tests
│   ├── test_global_risk_manager.py
│   ├── test_shared_portfolio.py
│   ├── test_orb_signals.py      # ORB signal tests
│   ├── test_paper_trader.py
│   ├── test_config_loader.py
│   ├── test_multi_strategy_runner.py
│   ├── test_backtest_*.py       # Backtest module tests
│   ├── test_db_*.py             # Database tests
│   └── test_security.py         # Security tests (82 tests)
├── api/                         # API endpoint tests
│   ├── conftest.py              # Shared fixtures
│   ├── test_auth.py
│   ├── test_strategies.py
│   ├── test_paper_trading.py
│   ├── test_bots.py
│   ├── test_backtest.py
│   └── ...
├── integration/                 # Integration tests
│   ├── conftest.py
│   ├── test_auth_flow.py
│   ├── test_trading_flow.py
│   ├── test_bot_lifecycle.py
│   └── testcontainers/          # Real PostgreSQL tests (50 tests)
│       ├── conftest.py          # Docker fixtures
│       ├── test_real_db_auth.py
│       ├── test_real_db_bots.py
│       └── test_real_db_strategies.py
├── contract/                    # Contract tests (27 tests)
│   └── test_api_contract.py     # OpenAPI validation
├── e2e/                         # E2E TypeScript tests (19 tests)
├── fixtures/                    # Test data
├── helpers/                     # Test utilities
└── mocks/                       # Mock responses
```

## Test Categories

| Category          | Tests      | Status      | Requirement    |
| ----------------- | ---------- | ----------- | -------------- |
| Unit Tests        | 1,436      | ✅ Complete | None           |
| API Tests         | ~400       | ✅ Complete | None           |
| Contract Tests    | 27         | ✅ Complete | Running server |
| Testcontainers    | 50         | ✅ Complete | Docker         |
| Security Tests    | 82         | ✅ Complete | None           |
| Integration Tests | ~50        | ✅ Complete | None           |
| E2E Tests         | 19         | ✅ Complete | Browser        |
| **Total**         | **1,614+** | ✅          |                |

## Running Specific Tests

```bash
# Trading module tests
uv run pytest tests/test_journal.py -v
uv run pytest tests/test_risk_manager.py -v
uv run pytest tests/test_orb_signals.py -v

# Backtest tests
uv run pytest tests/test_backtest_*.py -v

# Database tests
uv run pytest tests/test_db_*.py -v

# Security tests
uv run pytest tests/test_security.py -v

# Contract tests
uv run pytest tests/contract/ -v -m contract

# Testcontainers (real PostgreSQL)
uv run pytest tests/integration/testcontainers/ -v

# Run with pattern
uv run pytest tests/ -k "auth" -v
uv run pytest tests/ -k "risk" -v

# Run with markers
uv run pytest tests/ -m "contract" -v
uv run pytest tests/ -m "testcontainers" -v
```

## Test Coverage

| Module                                 | Tests | Coverage |
| -------------------------------------- | ----- | -------- |
| `trading/journal.py`                   | 79    | Full     |
| `trading/risk_manager.py`              | 76    | Full     |
| `trading/global_risk_manager.py`       | 67    | Full     |
| `trading/shared_portfolio.py`          | 89    | Full     |
| `trading/orb_signals.py`               | 80    | Full     |
| `trading/paper_trader.py`              | 113   | Full     |
| `trading/config_loader.py`             | 53    | Full     |
| `trading/multi_strategy_runner.py`     | 72    | Full     |
| `backtest/engine.py`                   | 39    | Full     |
| `backtest/costs.py`                    | 64    | Full     |
| `backtest/chart_data.py`               | 99    | Full     |
| `backtest/api.py`                      | 73    | Full     |
| `backtest/strategies/orb.py`           | 97    | Full     |
| `backtest/strategies/sr_breakout.py`   | 112   | Full     |
| `backtest/strategies/week52_chaser.py` | 101   | Full     |
| `db/models.py`                         | 70    | Full     |
| `db/database.py`                       | 58    | Full     |

## Writing New Tests

1. Use fixtures from `conftest.py`
2. Follow naming: `test_<method>_<scenario>`
3. Test positive and negative cases
4. Mock external dependencies
5. Ensure test isolation

Example:

```python
def test_create_user_success(db_session):
    """Test user creation with valid data."""
    user = User(email="test@example.com", hashed_password="...")
    db_session.add(user)
    db_session.commit()
    assert user.id is not None
```

## CI/CD Integration

```yaml
# .github/workflows/test.yml
- name: Run Unit Tests
  run: uv run pytest tests/test_*.py -v

- name: Run Contract Tests
  run: uv run pytest tests/contract/ -v

- name: Run Testcontainers Tests
  run: uv run pytest tests/integration/testcontainers/ -v
```

## Documentation

- [TESTING_ROADMAP.md](../TESTING_ROADMAP.md) - Testing strategy
- [TODO.md](../TODO.md) - Progress tracking
- [API_TEST_SCENARIOS.md](./API_TEST_SCENARIOS.md) - API test scenarios
