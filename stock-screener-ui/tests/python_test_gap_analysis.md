# Python Unit Testing Plan by Screen

This document maps frontend screens to their backend Python logic and identifies gaps in unit test coverage.

## 1. Authentication & Security

- **Screens**: Login, Register
- **Backend**: `api/auth.py`, `api_server_fastapi.py`
- **Current Coverage**:
  - [x] Basic Login/Register (`tests/api/test_auth.py`)
  - [x] JWT Token generation/validation (`tests/test_security.py`)
- **Proposed Unit Tests**:
  - [ ] Password hashing salt rotation logic.
  - [ ] Brute-force protection throttling unit tests.
  - [ ] Edge cases for JWT expiration and refresh token reuse.

## 2. Screener Dashboards

- **Screens**: Main Screener, Buyer Interest
- **Backend**: `run_daily_trading.py`, Screener logic in `api/`
- **Current Coverage**:
  - [x] Market Ticker Updates (`tests/api/test_market_ticker.py`)
  - [x] Screener API endpoints (`tests/api/test_screeners.py`)
- **Proposed Unit Tests**:
  - [ ] Unit tests for individual screener calculation functions (e.g., specific math for RVol, EMA crossovers).
  - [ ] Error handling when market data providers (Upstox) return malformed responses.

## 3. Paper Trading

- **Screens**: Live Positions, Portfolio Summary
- **Backend**: `trading/paper_trader.py`, `trading/shared_portfolio.py`, `api/paper_trading.py`
- **Current Coverage**:
  - [x] Basic order execution (`tests/test_paper_trader.py`)
  - [x] Portfolio tracking (`tests/test_shared_portfolio.py`)
- **Proposed Unit Tests**:
  - [ ] Handling of partial fills in the paper trader engine.
  - [ ] Slippage model unit tests (different slippage based on volume).
  - [ ] Portfolio margin calculation edge cases.

## 4. Backtest & Strategies

- **Screens**: Backtest View, Strategy Config
- **Backend**: `backtest/engine.py`, `backtest/strategies/`, `api/strategies.py`
- **Current Coverage**:
  - [x] Backtest execution flow (`tests/test_backtest_engine.py`)
  - [x] Strategy-specific logic (`tests/test_orb_conservative.py`, etc.)
- **Proposed Unit Tests**:
  - [ ] Multi-instrument synchronization inside `BacktestEngine`.
  - [ ] Handling of data gaps (missing bars) in the engine logic.
  - [ ] Strategy config versioning and migration unit tests.

## 5. Trading Bots

- **Screens**: Bots Management, Multi-Strategy
- **Backend**: `api/bots.py`, `trading/multi_strategy_runner.py`, `trading/global_risk_manager.py`
- **Current Coverage**:
  - [x] Bot lifecycle (Start/Stop) (`tests/integration/test_bot_lifecycle.py`)
  - [x] Multi-strategy signal merging (`tests/test_multi_strategy_runner.py`)
- **Proposed Unit Tests**:
  - [ ] Bot state recovery logic after an simulated crash.
  - [ ] Global Risk Manager enforcement edge cases (e.g., hitting multiple limits simultaneously).
  - [ ] Logic for dynamic allocation adjustment while a bot is running.

## 6. Journal & Reports

- **Screens**: Trade History, Performance Analytics
- **Backend**: `trading/journal.py`
- **Current Coverage**:
  - [x] Trade logging (`tests/test_journal.py`)
- **Proposed Unit Tests**:
  - [ ] Complex performance metrics (Sharpe Ratio, Max Drawdown) calculation unit tests.
  - [ ] Export logic formatting validation (JSON, CSV).
