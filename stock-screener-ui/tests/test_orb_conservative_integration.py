"""
Integration test for the ORB Conservative strategy variant.

This test simulates running the strategy via the BacktestEngine with mocked
historical data to verify the following end-to-end behaviors:
1. Engine correctly parses conservative parameters.
2. Order generation occurs at the appropriate breakout.
3. Market positions open and subsequently close correctly at the predefined 1.2% TP limit
   or -0.4% SL limit.
4. Total resulting PnL correctly reflects the math parameters set for conservative ORB.
"""

import pytest
import sys
import pandas as pd
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from backtest.engine import BacktestEngine
from backtest.strategies.orb import ORBStrategy

@pytest.fixture
def mock_conservative_data():
    """
    Creates a dataframe mimicking 1 day of 5-minute bars.
    - 9:15 to 10:00 (45 mins): Opening Range set. (High: 100, Low: 90)
    - 10:05: Breakout Long entry (High: 105, Close: 102).
    - 10:20: Price hits Target +1.2% (102 * 1.012 = ~103.224). Closes at 104.
    """
    base_date = "2024-01-15 "
    data = []
    
    # --- ORB Formation (9:15 to 10:00) ---
    times = ["09:15", "09:20", "09:25", "09:30", "09:35", "09:40", "09:45", "09:50", "09:55"]
    for t in times:
        data.append({
            "datetime": base_date + t + ":00",
            "open": 95.0,
            "high": 100.0,
            "low": 90.0,
            "close": 96.0,
            "volume": 1000
        })
        
    # --- Actionable Bars (10:00 onwards) ---
    
    # 10:00 (Still no breakout, price inside 90-100 range)
    data.append({
        "datetime": base_date + "10:00:00",
        "open": 96.0, "high": 99.0, "low": 95.0, "close": 98.0, "volume": 1200
    })
    
    # 10:05 Breakout! (Long entry expected at Next Open or Current Close: 102.0)
    data.append({
        "datetime": base_date + "10:05:00",
        "open": 98.0, "high": 105.0, "low": 98.0, "close": 102.0, "volume": 5000
    })
    
    # 10:10 (Price moving up)
    data.append({
        "datetime": base_date + "10:10:00",
        "open": 102.0, "high": 103.0, "low": 101.0, "close": 102.5, "volume": 1000
    })
    
    # 10:15 (Price Hits the 1.2% Target. 102 * 1.012 = 103.224. This bar's High is 105, so TP is hit.)
    data.append({
        "datetime": base_date + "10:15:00",
        "open": 102.5, "high": 105.0, "low": 102.0, "close": 104.0, "volume": 2000
    })
    
    # Rest of the day...
    data.append({
        "datetime": base_date + "10:20:00",
        "open": 104.0, "high": 104.5, "low": 100.0, "close": 101.0, "volume": 500
    })
    
    df = pd.DataFrame(data)
    df['datetime'] = pd.to_datetime(df['datetime']).dt.tz_localize('Asia/Kolkata')
    df.set_index('datetime', inplace=True)
    return df


@pytest.fixture
def mock_screener_usage(monkeypatch, mock_conservative_data):
    """Mocks TVScreenerUsage to return our constructed DataFrame instead of hitting the Upstox API."""
    
    class MockUpstoxAPI:
        def fetch_historical_data_v3(self, symbol, unit, interval, to_date, from_date):
            return mock_conservative_data
            
        def fetch_intraday_data_v3(self, symbol, interval):
            return pd.DataFrame()
    
    class MockTVScreenerUsage:
        def __init__(self, enable_paper_trading=False):
            self.upstox_api = MockUpstoxAPI()
    
    mock_module = MagicMock()
    mock_module.TVScreenerUsage = MockTVScreenerUsage
    sys.modules['upstox_trader'] = mock_module
    sys.modules['upstox_trader.screeners'] = mock_module
    sys.modules['upstox_trader.screeners.tv_screen_usage'] = mock_module
    
    yield MockTVScreenerUsage


def test_orb_conservative_engine_integration(mock_screener_usage):
    """
    Test: Run the BacktestEngine end-to-end with the ORB Conservative parameters
    and verify the final resulting P&L metrics align with a ~1.2% gain.
    """
    engine = BacktestEngine()
    
    # Conservative parameters based on QA seed data
    conservative_params = {
        'or_minutes': 45,
        'stop_loss_pct': 0.4,
        'take_profit_pct': 1.2,
        'trade_size': 100,
        'timeframe': "5",
        'enable_shorts': False,
        'trend_filter': False
    }

    # Execute
    result = engine.run(
        strategy_id='orb',
        symbols=['TEST_STOCK'],
        days=1,
        params=conservative_params
    )
    
    # Asserts
    assert result is not None, "BacktestEngine should return a results dictionary."
    assert 'results' in result, "Result dictionary should contain a 'results' key."
    assert 'chart_data' in result, "Result dictionary should contain a 'chart_data' key."
    
    stats = result['totals']
    
    # We expect exactly 1 trade to have triggered and exited
    assert stats['trades'] == 1, f"Expected 1 trade, found {stats['trades']} in totals, chart_data returned: {result['chart_data']}"
    assert stats['win_rate'] == 100.0, "Expected the single trade to hit our TP and be a winner."
    
    # Verification of P&L
    # Entry around 102. Exit at ~103.224. Profit is positive.
    assert stats['net_pnl'] > 0, "Expected a net positive PnL."
    
    # Inspect the trades list for exactly what happened
    trades = result['chart_data']['TEST_STOCK']['trades']
    assert len(trades) == 1
    
    trade = trades[0]
    # Trade exit reason should be recorded as a Take Profit
    assert trade['exit_reason'] == 'TP', f"Expected exit reason 'TP', found {trade['exit_reason']}"
    # Verification that percentages align
    assert trade['gross_pnl_pct'] >= 1.2, f"Gross PnL % should be >= 1.2, found {trade['gross_pnl_pct']}"

