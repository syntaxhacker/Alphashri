# API Test Scenarios for Alphashri Backend

## Overview

This document provides comprehensive test scenarios for all backend API endpoints. Tests will be implemented using **pytest** for integration tests and **FastAPI TestClient** for e2e tests.

## Test Categories

1. **Authentication APIs** (`/api/auth`)
2. **Strategy Management APIs** (`/api/strategies`)
3. **Paper Trading APIs** (`/api/paper`)
4. **Bot Management APIs** (`/api/bots`)
5. **Market Ticker APIs** (`/api/market-ticker`)
6. **Screener APIs** (`/api/screener`, `/api/screeners`)
7. **Backtest APIs** (`/api/backtest`)
8. **Chart APIs** (`/api/chart`)
9. **Symbol Search APIs** (`/api/symbols`)
10. **News APIs** (`/api/news`)

---

## 1. Authentication APIs (`/api/auth`)

**File**: `stock-screener-ui/api/auth.py`

### Endpoints

| Method | Endpoint             | Description          | Auth Required |
| ------ | -------------------- | -------------------- | ------------- |
| POST   | `/api/auth/register` | Register new user    | No            |
| POST   | `/api/auth/login`    | Login user           | No            |
| POST   | `/api/auth/refresh`  | Refresh access token | No            |
| POST   | `/api/auth/logout`   | Logout user          | Optional      |
| GET    | `/api/auth/me`       | Get current user     | Yes           |
| PUT    | `/api/auth/me`       | Update user settings | Yes           |

### Test Scenarios

#### 1.1 Register User

```python
# Test Cases:
- ✅ Register with valid email and password
- ❌ Register with existing email (400 Bad Request)
- ❌ Register with invalid email format (422 Validation Error)
- ❌ Register with weak password (optional: add validation)
- ✅ Register with display_name provided
- ✅ Register without display_name (auto-generate from email)
- ✅ Verify response contains access_token and refresh_token
- ✅ Verify user is created in database
```

#### 1.2 Login User

```python
# Test Cases:
- ✅ Login with valid credentials
- ❌ Login with invalid email (401 Unauthorized)
- ❌ Login with invalid password (401 Unauthorized)
- ❌ Login with non-existent user (401 Unauthorized)
- ❌ Login with disabled user account (401 Unauthorized)
- ✅ Verify JWT token structure (has sub, jti, type, exp)
- ✅ Verify access token expires in 24 hours
- ✅ Verify refresh token expires in 7 days
```

#### 1.3 Refresh Token

```python
# Test Cases:
- ✅ Refresh with valid refresh token
- ❌ Refresh with invalid token (401)
- ❌ Refresh with expired token (401)
- ❌ Refresh with access token (401 - wrong type)
- ❌ Refresh with revoked session (401)
- ✅ Verify old session is revoked after refresh
- ✅ Verify new tokens are returned
```

#### 1.4 Logout

```python
# Test Cases:
- ✅ Logout with valid refresh token
- ✅ Logout without token (returns success)
- ✅ Verify session is revoked in database
- ✅ Logout already logged out user (success)
```

#### 1.5 Get Current User

```python
# Test Cases:
- ✅ Get user with valid token
- ❌ Get user without token (401)
- ❌ Get user with expired token (401)
- ❌ Get user with invalid token (401)
- ❌ Get user with wrong token type (401)
- ❌ Get user with non-existent user_id (401)
- ✅ Verify response contains user details (id, email, display_name)
```

#### 1.6 Update User Settings

```python
# Test Cases:
- ✅ Update display_name only
- ✅ Update initial_capital only
- ✅ Update both display_name and initial_capital
- ❌ Update without authentication (401)
- ✅ Verify changes persisted in database
```

---

## 2. Strategy Management APIs (`/api/strategies`)

**File**: `stock-screener-ui/api/strategies.py`

### Endpoints

| Method | Endpoint                           | Description           | Auth Required |
| ------ | ---------------------------------- | --------------------- | ------------- |
| GET    | `/api/strategies`                  | List all strategies   | Optional      |
| GET    | `/api/strategies/templates`        | List templates        | Optional      |
| GET    | `/api/strategies/{id}`             | Get specific strategy | Optional      |
| POST   | `/api/strategies`                  | Create strategy       | Optional      |
| PUT    | `/api/strategies/{id}`             | Update strategy       | Optional      |
| DELETE | `/api/strategies/{id}`             | Delete strategy       | Optional      |
| GET    | `/api/strategies/{id}/performance` | Get performance       | Optional      |
| GET    | `/api/strategies/{id}/trades`      | Get trades            | Optional      |
| GET    | `/api/strategies/{id}/variations`  | Get variations        | Optional      |
| GET    | `/api/strategies/bots`             | List bots             | Optional      |
| GET    | `/api/strategies/bots/{id}`        | Get bot               | Optional      |

### Test Scenarios

#### 2.1 List Strategies

```python
# Test Cases:
- ✅ List all non-template strategies
- ✅ List with include_templates=true
- ✅ Filter by strategy_type (e.g., 'ORB', 'momentum')
- ✅ Verify response has strategies array and count
- ✅ Verify strategies sorted by type and name
```

#### 2.2 List Templates

```python
# Test Cases:
- ✅ List all active templates
- ✅ Verify only templates with is_template=True returned
- ✅ Verify only active templates (is_active=True)
- ✅ Verify sorted by name
```

#### 2.3 Get Strategy

```python
# Test Cases:
- ✅ Get existing strategy by ID
- ❌ Get non-existent strategy (404)
- ✅ Verify response includes strategy details
- ✅ If template, verify variations included
- ✅ Verify variations are active only
```

#### 2.4 Create Strategy

```python
# Test Cases:
- ✅ Create strategy with minimal fields
- ✅ Create strategy with all parameters
- ✅ Create strategy from template (with parent_id)
- ❌ Create with duplicate name (400)
- ❌ Create with non-existent parent_id (400)
- ✅ Verify parent defaults are inherited
- ✅ Verify request values override parent defaults
- ✅ Verify strategy created in database
```

#### 2.5 Update Strategy

```python
# Test Cases:
- ✅ Update strategy name
- ✅ Update strategy parameters (sl_pct, tp_pct, etc.)
- ✅ Update is_active status
- ✅ Set strategy as default (is_default=True)
- ❌ Update non-existent strategy (404)
- ❌ Update template strategy (400)
- ✅ Verify other defaults unset when setting new default
- ✅ Verify changes persisted
```

#### 2.6 Delete Strategy

```python
# Test Cases:
- ✅ Delete existing strategy (soft delete)
- ❌ Delete non-existent strategy (404)
- ❌ Delete template strategy (400)
- ✅ Verify is_active set to False
- ✅ Verify strategy still exists in database
```

#### 2.7 Get Strategy Performance

```python
# Test Cases:
- ✅ Get performance for strategy with trades
- ✅ Get performance for strategy with no trades
- ✅ Filter out test trades (include_test=false)
- ❌ Get performance for non-existent strategy (404)
- ✅ Verify stats: total_trades, win_rate, net_pnl, etc.
- ✅ Verify test_trades count and has_test_data flag
```

#### 2.8 Get Strategy Trades

```python
# Test Cases:
- ✅ Get trades with default limit (50)
- ✅ Get trades with custom limit
- ✅ Filter out test trades (include_test=false)
- ❌ Get trades for non-existent strategy (404)
- ✅ Verify trades sorted by exit_time descending
- ✅ Verify response includes strategy_name
```

#### 2.9 Get Strategy Variations

```python
# Test Cases:
- ✅ Get variations for template strategy
- ❌ Get variations for non-template (400)
- ❌ Get variations for non-existent strategy (404)
- ✅ Verify only active variations returned
- ✅ Verify variations sorted by name
```

---

## 3. Paper Trading APIs (`/api/paper`)

**File**: `stock-screener-ui/api/paper_trading.py`

### Endpoints

| Method | Endpoint                        | Description         | Auth Required |
| ------ | ------------------------------- | ------------------- | ------------- |
| GET    | `/api/paper/portfolio`          | Get portfolio       | Optional      |
| POST   | `/api/paper/portfolio/reset`    | Reset portfolio     | Optional      |
| GET    | `/api/paper/positions`          | Get positions       | Optional      |
| GET    | `/api/paper/positions/{symbol}` | Get position        | Optional      |
| POST   | `/api/paper/orders`             | Place order         | Optional      |
| DELETE | `/api/paper/orders/{symbol}`    | Cancel position     | Optional      |
| GET    | `/api/paper/signals`            | Get signals         | Optional      |
| POST   | `/api/paper/signals/generate`   | Generate signals    | Optional      |
| GET    | `/api/paper/trades`             | Get trade history   | Optional      |
| GET    | `/api/paper/trades/summary`     | Get trade summary   | Optional      |
| POST   | `/api/paper/runner/start`       | Start runner        | Optional      |
| POST   | `/api/paper/runner/stop`        | Stop runner         | Optional      |
| GET    | `/api/paper/runner/status`      | Get runner status   | Optional      |
| GET    | `/api/paper/runner/logs`        | Get runner logs     | Optional      |
| GET    | `/api/paper/runner/snapshot`    | Get runner snapshot | Optional      |
| GET    | `/api/paper/config`             | Get config          | Optional      |
| PUT    | `/api/paper/config`             | Update config       | Optional      |

### Test Scenarios

#### 3.1 Portfolio Management

```python
# Test Cases - GET /api/paper/portfolio:
- ✅ Get portfolio with positions
- ✅ Get empty portfolio
- ✅ Verify portfolio structure (cash, equity, pnl, etc.)
- ✅ Verify capital_used calculation

# Test Cases - POST /api/paper/portfolio/reset:
- ✅ Reset portfolio to initial state
- ✅ Verify all positions cleared
- ✅ Verify cash reset to initial_capital
- ✅ Verify trades history cleared
```

#### 3.2 Positions Management

```python
# Test Cases - GET /api/paper/positions:
- ✅ Get all positions
- ✅ Get positions when empty
- ✅ Verify position structure (symbol, quantity, avg_price, pnl, etc.)

# Test Cases - GET /api/paper/positions/{symbol}:
- ✅ Get existing position
- ❌ Get non-existent position (404)
- ✅ Verify position details
```

#### 3.3 Order Management

```python
# Test Cases - POST /api/paper/orders:
- ✅ Place BUY order with valid data
- ✅ Place SELL order with valid data
- ❌ Place order with invalid side (422)
- ❌ Place order with insufficient funds (400)
- ❌ Place order for non-existent symbol (optional validation)
- ✅ Verify position created/updated
- ✅ Verify cash deducted/added
- ✅ Verify order in trade history

# Test Cases - DELETE /api/paper/orders/{symbol}:
- ✅ Close existing position
- ❌ Close non-existent position (404)
- ✅ Verify position removed
- ✅ Verify cash updated with P&L
- ✅ Verify trade recorded in history
```

#### 3.4 Signal Generation

```python
# Test Cases - GET /api/paper/signals:
- ✅ Get generated signals
- ✅ Get empty signals list
- ✅ Verify signal structure

# Test Cases - POST /api/paper/signals/generate:
- ✅ Generate signals for symbols
- ✅ Generate signals with specific strategy
- ✅ Verify signals returned with entry, stop_loss, target
- ✅ Verify signals filtered by risk parameters
```

#### 3.5 Trade History

```python
# Test Cases - GET /api/paper/trades:
- ✅ Get trades with default limit
- ✅ Get trades with custom limit
- ✅ Filter by strategy_id
- ✅ Filter by symbol
- ✅ Verify trades sorted by exit_time

# Test Cases - GET /api/paper/trades/summary:
- ✅ Get trade summary stats
- ✅ Verify win_rate, total_pnl, avg_pnl, etc.
- ✅ Get summary filtered by strategy
```

#### 3.6 Runner Control

```python
# Test Cases - POST /api/paper/runner/start:
- ✅ Start runner successfully
- ✅ Start already running runner (returns status)
- ✅ Verify process PID returned
- ✅ Verify log file created

# Test Cases - POST /api/paper/runner/stop:
- ✅ Stop running runner
- ✅ Stop non-running runner (returns status)
- ✅ Verify process terminated

# Test Cases - GET /api/paper/runner/status:
- ✅ Get status when running
- ✅ Get status when stopped
- ✅ Verify PID, portfolio status, etc.

# Test Cases - GET /api/paper/runner/logs:
- ✅ Get logs with default lines
- ✅ Get logs with custom line count
- ✅ Get logs when no logs available
- ✅ Verify log content

# Test Cases - GET /api/paper/runner/snapshot:
- ✅ Get current snapshot
- ✅ Verify snapshot structure (portfolio, positions, signals)
```

#### 3.7 Configuration

```python
# Test Cases - GET /api/paper/config:
- ✅ Get current configuration
- ✅ Verify config structure

# Test Cases - PUT /api/paper/config:
- ✅ Update strategy_id
- ✅ Update multiple parameters
- ✅ Verify changes persisted
- ✅ Verify config validation
```

---

## 4. Bot Management APIs (`/api/bots`)

**File**: `stock-screener-ui/api/bots.py`

### Endpoints

| Method | Endpoint                              | Description               | Auth Required |
| ------ | ------------------------------------- | ------------------------- | ------------- |
| GET    | `/api/bots`                           | List all bots             | Optional      |
| POST   | `/api/bots`                           | Create bot                | Optional      |
| GET    | `/api/bots/available-strategies`      | List available strategies | Optional      |
| GET    | `/api/bots/{id}`                      | Get bot                   | Optional      |
| PUT    | `/api/bots/{id}`                      | Update bot                | Optional      |
| DELETE | `/api/bots/{id}`                      | Delete bot                | Optional      |
| POST   | `/api/bots/{id}/start`                | Start bot                 | Optional      |
| POST   | `/api/bots/{id}/stop`                 | Stop bot                  | Optional      |
| GET    | `/api/bots/{id}/status`               | Get bot status            | Optional      |
| GET    | `/api/bots/{id}/logs`                 | Get bot logs              | Optional      |
| GET    | `/api/bots/{id}/portfolio`            | Get bot portfolio         | Optional      |
| GET    | `/api/bots/{id}/positions`            | Get bot positions         | Optional      |
| GET    | `/api/bots/{id}/scan`                 | Get bot scan items        | Optional      |
| GET    | `/api/bots/{id}/performance`          | Get bot performance       | Optional      |
| GET    | `/api/bots/{id}/performance/compare`  | Compare strategies        | Optional      |
| GET    | `/api/bots/{id}/trades`               | Get bot trades            | Optional      |
| GET    | `/api/bots/{id}/strategy-performance` | Get strategy performance  | Optional      |

### Test Scenarios

#### 4.1 Bot CRUD Operations

```python
# Test Cases - GET /api/bots:
- ✅ List all bots
- ✅ Verify bot response includes running status and PID
- ✅ Verify strategies included in response

# Test Cases - POST /api/bots:
- ✅ Create bot with valid data
- ✅ Create bot with multiple strategies
- ❌ Create bot with duplicate name (400)
- ❌ Create bot with total allocation > 100% (400)
- ❌ Create bot with non-existent strategy_id (400)
- ✅ Verify strategies associated correctly

# Test Cases - GET /api/bots/{id}:
- ✅ Get existing bot
- ❌ Get non-existent bot (404)
- ✅ Verify running status accurate

# Test Cases - PUT /api/bots/{id}:
- ✅ Update bot name
- ✅ Update bot parameters (max_positions, etc.)
- ✅ Update strategies list
- ❌ Update to duplicate name (400)
- ❌ Update with allocation > 100% (400)
- ❌ Update non-existent bot (404)
- ✅ Verify old strategies removed and new added

# Test Cases - DELETE /api/bots/{id}:
- ✅ Delete existing bot
- ❌ Delete non-existent bot (404)
- ✅ Verify running bot stopped before deletion
- ✅ Verify strategy associations removed
```

#### 4.2 Bot Control

```python
# Test Cases - POST /api/bots/{id}/start:
- ✅ Start bot successfully
- ✅ Start already running bot (returns status)
- ❌ Start non-existent bot (404)
- ❌ Start inactive bot (400 - is_active=False)
- ✅ Verify test_mode flag works
- ✅ Verify process PID returned
- ✅ Verify log file created

# Test Cases - POST /api/bots/{id}/stop:
- ✅ Stop running bot
- ✅ Stop non-running bot (returns status)
- ✅ Verify process terminated gracefully

# Test Cases - GET /api/bots/{id}/status:
- ✅ Get status when running
- ✅ Get status when stopped
- ✅ Verify snapshot data included (portfolio, positions, strategies)
- ❌ Get status for non-existent bot (404)

# Test Cases - GET /api/bots/{id}/logs:
- ✅ Get logs with default line count
- ✅ Get logs with custom line count
- ✅ Get logs when no logs available
```

#### 4.3 Bot Portfolio & Positions

```python
# Test Cases - GET /api/bots/{id}/portfolio:
- ✅ Get portfolio for running bot
- ❌ Get portfolio for non-running bot (404)
- ✅ Verify portfolio structure

# Test Cases - GET /api/bots/{id}/positions:
- ✅ Get all positions
- ✅ Filter by strategy_id
- ❌ Get positions for non-running bot (404)
- ✅ Verify positions from snapshot

# Test Cases - GET /api/bots/{id}/scan:
- ✅ Get scan items for bot
- ✅ Filter by strategy_id
- ✅ Verify scan items include strategy info
```

#### 4.4 Bot Performance

```python
# Test Cases - GET /api/bots/{id}/performance:
- ✅ Get performance summary
- ✅ Verify by_strategy breakdown
- ✅ Verify combined stats
- ❌ Get performance for non-running bot (404)

# Test Cases - GET /api/bots/{id}/performance/compare:
- ✅ Compare strategies performance
- ✅ Verify sorted by total_pnl
- ✅ Verify all strategies included

# Test Cases - GET /api/bots/{id}/trades:
- ✅ Get trades with default limit
- ✅ Filter by strategy_id
- ✅ Filter out test trades (include_test=false)
- ✅ Verify trades sorted by exit_time

# Test Cases - GET /api/bots/{id}/strategy-performance:
- ✅ Get performance breakdown by strategy
- ✅ Verify combined stats
- ✅ Verify win_rate calculation
- ✅ Filter by days parameter
```

---

## 5. Market Ticker APIs (`/api/market-ticker`)

**File**: `stock-screener-ui/api/market_ticker.py`

### Endpoints

| Method | Endpoint                      | Description         | Auth Required |
| ------ | ----------------------------- | ------------------- | ------------- |
| GET    | `/api/market-ticker`          | Get all tickers     | No            |
| GET    | `/api/market-ticker/{symbol}` | Get specific ticker | No            |

### Test Scenarios

```python
# Test Cases - GET /api/market-ticker:
- ✅ Get all ticker data
- ✅ Verify ticker structure (symbol, name, price, change, etc.)
- ✅ Verify all expected symbols included (^NSEI, ^NSEBANK, etc.)
- ✅ Verify cache_age_seconds returned
- ✅ Verify is_positive flag based on change
- ✅ Handle API errors gracefully (return error field)

# Test Cases - GET /api/market-ticker/{symbol}:
- ✅ Get ticker for valid symbol
- ❌ Get ticker for invalid symbol (404)
- ✅ Verify all fields populated
- ✅ Verify timestamp and last_updated
- ✅ Handle errors with error field
```

---

## 6. Screener APIs

**File**: `stock-screener-ui/api_server_fastapi.py`

### Endpoints

| Method | Endpoint         | Description             | Auth Required |
| ------ | ---------------- | ----------------------- | ------------- |
| GET    | `/api/screeners` | Get available screeners | No            |
| GET    | `/api/screener`  | Get screener data       | No            |

### Test Scenarios

```python
# Test Cases - GET /api/screeners:
- ✅ Get list of available screeners
- ✅ Verify screener structure (name, label, etc.)
- ✅ Verify all expected screeners included

# Test Cases - GET /api/screener:
- ✅ Get data for valid profile
- ✅ Get data with symbol filter
- ✅ Verify section labels based on profile
- ✅ Verify sorting (default_sort)
- ✅ Verify stock data structure
- ❌ Handle invalid profile gracefully
- ✅ Test pagination/large result sets
```

---

## 7. Backtest APIs

**File**: `stock-screener-ui/api_server_fastapi.py`

### Endpoints

| Method | Endpoint                       | Description           | Auth Required |
| ------ | ------------------------------ | --------------------- | ------------- |
| GET    | `/api/backtest/strategies`     | Get strategies        | No            |
| GET    | `/api/backtest/costs`          | Get cost structure    | No            |
| GET    | `/api/backtest/progress`       | Get backtest progress | No            |
| POST   | `/api/backtest/run`            | Run backtest          | No            |
| GET    | `/api/backtest/chart/{symbol}` | Get chart data        | No            |
| GET    | `/api/backtest/results`        | Get backtest results  | No            |

### Test Scenarios

```python
# Test Cases - GET /api/backtest/strategies:
- ✅ Get list of backtest strategies
- ✅ Verify strategy structure

# Test Cases - GET /api/backtest/costs:
- ✅ Get cost structure (brokerage, STT, etc.)
- ✅ Verify cost percentages

# Test Cases - POST /api/backtest/run:
- ✅ Run backtest with valid parameters
- ❌ Run with invalid date range (400)
- ❌ Run with invalid symbol (400)
- ✅ Verify backtest started
- ✅ Verify progress tracking

# Test Cases - GET /api/backtest/progress:
- ✅ Get progress for running backtest
- ✅ Get progress when no backtest running
- ✅ Verify progress structure (percentage, status, etc.)

# Test Cases - GET /api/backtest/chart/{symbol}:
- ✅ Get chart data for symbol
- ❌ Get chart for invalid symbol (404)
- ✅ Verify OHLCV data structure
- ✅ Verify date range filtering

# Test Cases - GET /api/backtest/results:
- ✅ Get results after backtest complete
- ✅ Verify trade statistics
- ✅ Verify P&L calculations
- ✅ Verify equity curve data
```

---

## 8. Chart APIs

**File**: `stock-screener-ui/api_server_fastapi.py`

### Endpoints

| Method | Endpoint                      | Description       | Auth Required |
| ------ | ----------------------------- | ----------------- | ------------- |
| GET    | `/api/chart/preview/{symbol}` | Get preview chart | No            |

### Test Scenarios

```python
# Test Cases - GET /api/chart/preview/{symbol}:
- ✅ Get chart for valid symbol
- ❌ Get chart for invalid symbol (404)
- ✅ Verify OHLCV data
- ✅ Verify indicators included (MA, RSI, etc.)
- ✅ Verify date range (default or specified)
- ✅ Verify data format for frontend charting library
```

---

## 9. Symbol Search APIs

**File**: `stock-screener-ui/api_server_fastapi.py`

### Endpoints

| Method | Endpoint              | Description    | Auth Required |
| ------ | --------------------- | -------------- | ------------- |
| GET    | `/api/symbols/search` | Search symbols | No            |

### Test Scenarios

```python
# Test Cases - GET /api/symbols/search:
- ✅ Search with valid query
- ✅ Search with empty query (return all/popular)
- ✅ Verify results limited appropriately
- ✅ Verify symbol structure (symbol, name, exchange, etc.)
- ✅ Test case-insensitive search
- ✅ Test partial match search
- ✅ Verify results sorted by relevance
```

---

## 10. News APIs

**File**: `stock-screener-ui/api_server_fastapi.py`

### Endpoints

| Method | Endpoint            | Description         | Auth Required |
| ------ | ------------------- | ------------------- | ------------- |
| GET    | `/api/news`         | Get news feed       | No            |
| GET    | `/api/news/article` | Get article details | No            |
| GET    | `/api/news/sources` | Get news sources    | No            |

### Test Scenarios

```python
# Test Cases - GET /api/news:
- ✅ Get news feed
- ✅ Filter by category
- ✅ Filter by source
- ✅ Verify pagination (limit, offset)
- ✅ Verify news structure (title, summary, url, date, etc.)
- ✅ Handle API errors gracefully

# Test Cases - GET /api/news/article:
- ✅ Get article with valid URL
- ❌ Get article with invalid URL (404/400)
- ✅ Verify article content returned

# Test Cases - GET /api/news/sources:
- ✅ Get list of news sources
- ✅ Verify source structure
```

---

## 11. Health Check

### Endpoints

| Method | Endpoint  | Description  | Auth Required |
| ------ | --------- | ------------ | ------------- |
| GET    | `/health` | Health check | No            |

### Test Scenarios

```python
# Test Cases - GET /health:
- ✅ Returns 200 OK
- ✅ Returns healthy status
- ✅ Fast response time (<100ms)
```

---

## Test Implementation Strategy

### Phase 1: Core Tests (High Priority)

1. Authentication APIs (all endpoints)
2. Strategy Management APIs (CRUD operations)
3. Paper Trading APIs (portfolio, orders, positions)
4. Bot Management APIs (CRUD + control)

### Phase 2: Data APIs (Medium Priority)

5. Screener APIs
6. Backtest APIs
7. Market Ticker APIs

### Phase 3: Utility APIs (Lower Priority)

8. Chart APIs
9. Symbol Search APIs
10. News APIs

---

## Test Structure

```
stock-screener-ui/tests/
├── api/
│   ├── __init__.py
│   ├── conftest.py                    # Shared fixtures
│   ├── test_auth.py                   # Auth endpoint tests
│   ├── test_strategies.py             # Strategy tests
│   ├── test_paper_trading.py          # Paper trading tests
│   ├── test_bots.py                   # Bot management tests
│   ├── test_market_ticker.py          # Market ticker tests
│   ├── test_screeners.py              # Screener tests
│   ├── test_backtest.py               # Backtest tests
│   ├── test_chart.py                  # Chart tests
│   ├── test_symbols.py                # Symbol search tests
│   └── test_news.py                   # News tests
├── integration/
│   ├── test_auth_flow.py              # Full auth flows
│   ├── test_trading_flow.py           # Complete trading flows
│   └── test_bot_lifecycle.py          # Bot start-stop cycles
└── fixtures/
    ├── sample_users.json
    ├── sample_strategies.json
    ├── sample_trades.json
    └── mock_market_data.json
```

---

## Test Fixtures Needed

### Database Fixtures

- Clean database before each test
- Sample users (active, inactive, different roles)
- Sample strategies (templates and variations)
- Sample bot configurations
- Sample trade history

### Mock Data

- Mock market data (for ticker APIs)
- Mock yfinance responses
- Mock external API responses (news, etc.)

### Authentication Fixtures

- Valid access token
- Expired access token
- Valid refresh token
- Expired refresh token
- Revoked session token

---

## Running Tests

```bash
# Run all API tests
pytest tests/api/ -v

# Run specific test file
pytest tests/api/test_auth.py -v

# Run with coverage
pytest tests/api/ --cov=api --cov-report=html

# Run integration tests
pytest tests/integration/ -v

# Run specific test category
pytest tests/api/ -k "auth" -v
pytest tests/api/ -k "bots" -v

# Run with markers
pytest tests/api/ -m "slow"  # Long-running tests
pytest tests/api/ -m "integration"  # Integration tests
```

---

## Next Steps

1. **Set up test infrastructure**
   - Create test database
   - Configure pytest fixtures
   - Set up CI/CD test automation

2. **Implement Phase 1 tests** (Core APIs)
   - Authentication
   - Strategies
   - Paper Trading
   - Bots

3. **Implement Phase 2 tests** (Data APIs)
   - Screeners
   - Backtests
   - Market Ticker

4. **Implement Phase 3 tests** (Utility APIs)
   - Charts
   - Symbols
   - News

5. **Integration tests**
   - End-to-end flows
   - Multi-step operations
   - Error handling scenarios

---

## Success Criteria

- ✅ 80%+ code coverage for all API modules
- ✅ All endpoints have positive and negative test cases
- ✅ All tests pass in CI/CD pipeline
- ✅ Tests run in <5 minutes total
- ✅ Clear test documentation
- ✅ Easy to add new tests for future endpoints
