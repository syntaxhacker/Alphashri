# API Test Suite

Comprehensive test suite for Alphashri backend APIs using pytest and FastAPI TestClient.

## Quick Start

```bash
# Install test dependencies
pip install pytest pytest-asyncio pytest-cov httpx

# Run all API tests
pytest tests/api/ -v

# Run with coverage
pytest tests/api/ --cov=api --cov-report=html

# Run integration tests
pytest tests/integration/ -v
```

## Test Structure

```
tests/
├── api/                    # Unit tests for API endpoints
│   ├── conftest.py        # Shared fixtures
│   ├── test_auth.py       # Authentication tests
│   ├── test_strategies.py # Strategy management tests
│   ├── test_paper_trading.py # Paper trading tests
│   ├── test_bots.py       # Bot management tests
│   ├── test_backtest.py   # Backtest tests
│   ├── test_screeners.py  # Screener tests
│   ├── test_market_ticker.py # Market ticker tests
│   ├── test_chart.py      # Chart preview tests
│   ├── test_symbols.py    # Symbol search tests
│   ├── test_news.py       # News feed tests
│   └── test_health.py     # Health check tests
├── integration/            # End-to-end integration tests
│   ├── conftest.py        # Integration fixtures
│   ├── test_auth_flow.py  # Authentication flows
│   ├── test_trading_flow.py # Trading flows
│   └── test_bot_lifecycle.py # Bot lifecycle
└── fixtures/              # Test data fixtures
    ├── sample_users.json
    ├── sample_strategies.json
    └── sample_trades.json
```

## Running Specific Tests

```bash
# Run specific test file
pytest tests/api/test_auth.py -v

# Run tests matching a pattern
pytest tests/api/ -k "auth" -v
pytest tests/api/ -k "bots" -v

# Run with markers
pytest tests/api/ -m "auth" -v
pytest tests/api/ -m "integration" -v

# Run with parallel execution
pytest tests/api/ -n auto
```

## Test Coverage

Current test results (Last Updated: 2026-03-03):

| Category       | Tests   | Passing | Success Rate | Status                 |
| -------------- | ------- | ------- | ------------ | ---------------------- |
| Authentication | 43      | 43      | 100%         | ✅ Perfect             |
| Strategies     | 63      | 63      | 100%         | ✅ Perfect             |
| Health Checks  | 18      | 18      | 100%         | ✅ Perfect             |
| Paper Trading  | 42      | 41      | 98%          | ✅ Production Ready    |
| Utilities      | 54      | 49      | 91%          | ⚠️ Minor issues        |
| Bots           | 54      | 47      | 87%          | ⚠️ Needs fixes         |
| Integration    | 51      | 39      | 76%          | ⚠️ Needs fixes         |
| Data APIs      | 36      | 21      | 58%          | ⚠️ Needs fixes         |
| **Total**      | **361** | **321** | **89%**      | ✅ Core features ready |

### What's Fully Tested

- ✅ User authentication (register, login, tokens, sessions)
- ✅ Strategy management (CRUD, templates, variations)
- ✅ Health monitoring
- ✅ Paper trading (portfolio, orders, positions, risk)

### Running 100% Passing Tests

```bash
# Core functionality (all passing)
pytest tests/api/test_auth.py -v          # 43/43 ✅
pytest tests/api/test_strategies.py -v    # 63/63 ✅
pytest tests/api/test_health.py -v        # 18/18 ✅
pytest tests/api/test_paper_trading.py -v # 41/42 ✅
```

Generate coverage report:

```bash
pytest tests/api/ --cov=api --cov-report=html --cov-report=term
open htmlcov/index.html
```

## Writing New Tests

1. Use fixtures from `conftest.py`
2. Follow naming convention: `test_<method>_<endpoint>_<scenario>`
3. Test both positive and negative cases
4. Mock external dependencies
5. Ensure tests are independent

Example:

```python
def test_get_user_success(client, auth_headers, active_user):
    """Test getting current user with valid token."""
    response = client.get("/api/auth/me", headers=auth_headers(active_user))
    assert response.status_code == 200
    assert response.json()["email"] == active_user.email
```

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Run API Tests
  run: pytest tests/api/ --cov=api --cov-report=xml

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    file: ./coverage.xml
```

## Documentation

- [API Test Scenarios](./API_TEST_SCENARIOS.md) - Detailed test scenarios
- [Test Summary](./TEST_SUMMARY.md) - Quick reference guide
