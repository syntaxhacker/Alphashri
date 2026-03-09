"""
Integration test for 52-Week High Chaser Strategy using real BacktestEngine.

This test:
1. Mocks TVScreenerUsage to return a controlled daily OHLCV DataFrame.
2. Provides 30+ daily bars positioned so the 52W high indicator initializes
   (min_periods=20 for chaser), price enters proximity to 52W high, then exits
   via TP or SL.
3. Asserts the engine produced at least one trade with a recognized exit reason.
"""

import pytest
import pandas as pd
from datetime import datetime, timedelta, timezone

from backtest.strategies.week52_chaser import run_single_stock_backtest as run_single_stock_week52_chaser


@pytest.fixture
def mock_week52_chaser_data():
    """
    Build 60 daily bars (UTC-localized) where:
    - Days 1-25: High = 100 (builds up 52W high indicator, min_periods=20)
    - Days 26-30: Price stays flat at 95
    - Day 31: Close = 98.5 → within 2% of 52W high (100), triggers ENTRY
    - Days 32-39: Price rises to 112 → hits 10% TP
    """
    dates = pd.date_range(
        end=pd.Timestamp.now(tz="UTC").normalize(),
        periods=60,
        freq="D",
    )
    # OHLCV baseline: low=89 <= open=91 <= close=93 <= high=100
    opens   = [91.0] * 60
    highs   = [100.0] * 60
    lows    = [89.0] * 60
    closes  = [93.0] * 60
    volumes = [500_000] * 60

    # Day 31 (index 30): entry bar — close within 2% of 52W high (100)
    opens[30]   = 97.0
    highs[30]   = 99.0
    lows[30]    = 96.5
    closes[30]  = 98.5   # distance = (100 - 98.5) / 98.5 * 100 ≈ 1.52% < 2% → ENTER

    # Days 32-39: price climbs to trigger TP (entry ≈ 98.5, TP = +10% = 108.35)
    # Ensure low <= open <= close <= high on every bar
    price = 98.5
    for d in range(31, 40):
        price += 1.5
        lows[d]    = round(price - 1.0, 2)
        opens[d]   = round(price - 0.5, 2)
        closes[d]  = round(price, 2)
        highs[d]   = round(price + 0.5, 2)

    df = pd.DataFrame({
        "open":   opens,
        "high":   highs,
        "low":    lows,
        "close":  closes,
        "volume": volumes,
    }, index=dates)
    return df


def test_week52_chaser_engine_integration(mock_week52_chaser_data, monkeypatch):
    """Integration test: 52W Chaser strategy executes a full trade via BacktestEngine."""
    import upstox_trader.screeners.tv_screen_usage

    class MockUpstoxAPI:
        def fetch_historical_data_v3(self, **kwargs):
            return mock_week52_chaser_data

        def fetch_intraday_data_v3(self, **kwargs):
            return pd.DataFrame()

    class MockTVScreenerUsage:
        def __init__(self, enable_paper_trading=False):
            self.upstox_api = MockUpstoxAPI()

    monkeypatch.setattr(
        upstox_trader.screeners.tv_screen_usage,
        "TVScreenerUsage",
        MockTVScreenerUsage,
    )

    params = {
        "entry_threshold_pct": 2.0,
        "stop_loss_pct": 3.0,
        "take_profit_pct": 10.0,
        "enable_trailing_stop": False,
        "trailing_stop_pct": 3.0,
        "trailing_activation_pct": 2.0,
        "max_holding_days": 45,
        "cooldown_days": 1,
        "trade_size": 100,
        "enable_filters": False,
        "include_costs": False,
    }

    result = run_single_stock_week52_chaser(("TEST_STOCK", params, 30))

    assert result["success"] is True, f"Backtest failed: {result.get('error')}\n{result.get('traceback', '')}"
    assert result["trades"] >= 1, "Expected at least 1 trade to have executed."

    trade = result["trade_list"][0]
    assert trade["side"] == "LONG"
    assert trade["exit_reason"] in ("TP", "SL", "TRAILING_STOP", "MAX_HOLDING", "NEW_52W_HIGH"), \
        f"Unexpected exit reason: {trade['exit_reason']}"
    assert trade["entry_price"] > 0
    assert trade["exit_price"] > 0
