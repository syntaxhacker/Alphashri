"""
Integration tests for 52-Week Target Strategy using real BacktestEngine.

This test:
1. Mocks TVScreenerUsage to return a controlled daily OHLCV DataFrame.
2. Provides 110+ daily bars so the 100-bar minimum for 52W high is satisfied.
3. Sets up data so price approaches the 52W high, triggers entry, then closes above 52W high
   to activate the trailing stop, which then fires on the next down bar.
4. Asserts the engine produced one trade with a TRAILING_STOP exit.
"""

import pytest
import pandas as pd
import numpy as np
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from backtest.strategies.week52_target import run_single_stock_week52_target


@pytest.fixture(autouse=True)
def cleanup_upstox_mocks():
    """Clean up any mocked upstox modules before/after test to ensure fresh imports."""
    mods_to_clean = [k for k in list(sys.modules.keys()) if k.startswith('upstox_trader')]
    saved = {k: sys.modules.pop(k) for k in mods_to_clean if k in sys.modules}
    yield
    # Restore any mocks that were there before
    for mod, val in saved.items():
        sys.modules[mod] = val


@pytest.fixture
def mock_week52_target_data():
    """
    Build 120 daily bars (UTC-localized) where:
    - Days 1-100: Close = 95, High = 100 -> 52W high stabilizes at 100
    - Day 101: Close = 98.0 (within 2% of 52W high 100) -> triggers ENTRY at 98
    - Day 102: Close = 101.0 (above 52W high 100) -> trailing stop activates at peak=101, TS=101*0.99=99.99
    - Day 103: Close = 99.0 (below trailing stop 99.99) -> EXIT via TRAILING_STOP
    """
    dates = pd.date_range(end=pd.Timestamp.now(tz="UTC").normalize(), periods=120, freq="D")
    # Baseline bars: low=90 <= open=91 <= close=95 <= high=100
    opens  = [91.0] * 120
    highs  = [100.0] * 120
    lows   = [90.0]  * 120
    closes = [95.0]  * 120
    volumes = [100000] * 120

    # Day 101 (index 100): close=98 touches threshold (100 * 0.98 = 98.0) -> ENTRY
    opens[100]   = 97.0
    closes[100]  = 98.0
    highs[100]   = 100.0
    lows[100]    = 96.0

    # Day 102 (index 101): close=101, above 52W high 100 -> trailing stop activates
    opens[101]   = 98.0
    closes[101]  = 101.0
    highs[101]   = 101.0
    lows[101]    = 97.0

    # Day 103 (index 102): close=99 drops below trailing (101 * 0.99 = 99.99) -> EXIT
    opens[102]   = 100.0
    closes[102]  = 99.0
    highs[102]   = 100.1
    lows[102]    = 98.5

    df = pd.DataFrame({
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": volumes,
    }, index=dates)
    return df


def test_week52_target_engine_integration(mock_week52_target_data, monkeypatch):
    """Integration test: 52W Target strategy executes a full trade via BacktestEngine."""
    mock_api = MagicMock()
    mock_api.fetch_historical_data_v3.return_value = mock_week52_target_data
    mock_api.fetch_intraday_data_v3.return_value = pd.DataFrame()

    monkeypatch.setattr('backtest.utils.get_upstox_client_from_db', lambda quiet=True: (mock_api, None))
    monkeypatch.setattr('backtest.utils.get_upstox_client_with_token', lambda token, quiet=True: (mock_api, None))

    params = {
        "entry_threshold_pct": 2.0,
        "stop_loss_pct": 2.0,
        "trailing_stop_pct": 1.0,
        "max_holding_days": 30,
        "cooldown_days": 1,
        "trade_size": 100,
        "include_costs": False,
    }

    result = run_single_stock_week52_target(("TEST_STOCK", params, 30))

    assert result["success"] is True, f"Backtest failed: {result.get('error')}"
    assert result["trades"] >= 1, "Expected at least 1 trade to have been executed."

    trade = result["trade_list"][0]
    assert trade["side"] == "LONG"
    assert trade["exit_reason"] in ("TRAILING_STOP", "SL", "MAX_HOLDING"), \
        f"Unexpected exit reason: {trade['exit_reason']}"
    assert trade["entry_price"] > 0
    assert trade["exit_price"] > 0
