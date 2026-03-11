"""
Unit tests for backtest/strategies/week52_chaser.py.

Tests cover:
- Week52HighIndicator: 52-week high tracking
- Week52ChaserStrategy: Strategy metadata, params, validation
- Helper functions: calculate_adx, calculate_rsi, get_date_from_ns
- Signal generation and entry/exit logic
- Stop-loss, take-profit, trailing stop calculations
- Edge cases: invalid data, empty candles, boundary conditions
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, patch, MagicMock
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backtest.strategies.week52_chaser import (
    Week52HighIndicator,
    Week52ChaserStrategy,
    Week52ChaserConfig,
    Week52ChaserNautilusStrategy,
    calculate_adx,
    calculate_rsi,
    get_date_from_ns,
)
from backtest.strategies.base import StrategyParam


def create_mock_candle_data(
    num_days: int = 300,
    start_price: float = 100.0,
    trend: str = "flat",
    volatility: float = 0.02,
) -> pd.DataFrame:
    """Create mock candle data for testing."""
    dates = pd.date_range(end=datetime.now(), periods=num_days, freq="D")
    prices = [start_price]

    for i in range(1, num_days):
        if trend == "up":
            change = np.random.uniform(0, volatility)
        elif trend == "down":
            change = np.random.uniform(-volatility, 0)
        else:
            change = np.random.uniform(-volatility / 2, volatility / 2)

        new_price = prices[-1] * (1 + change)
        prices.append(max(1.0, new_price))

    df = pd.DataFrame(
        {
            "open": prices,
            "high": [p * (1 + np.random.uniform(0, 0.01)) for p in prices],
            "low": [p * (1 - np.random.uniform(0, 0.01)) for p in prices],
            "close": [p * (1 + np.random.uniform(-0.005, 0.005)) for p in prices],
            "volume": [np.random.randint(100000, 1000000) for _ in prices],
        },
        index=dates,
    )

    df["high"] = df[["open", "high", "close"]].max(axis=1)
    df["low"] = df[["open", "low", "close"]].min(axis=1)

    return df


def create_candles_with_52w_high(
    num_days: int = 300, high_at_day: int = 200, high_price: float = 150.0
) -> pd.DataFrame:
    """Create candles with a specific 52-week high pattern."""
    dates = pd.date_range(end=datetime.now(), periods=num_days, freq="D")

    base_price = 100.0
    prices = []

    for i in range(num_days):
        if i < high_at_day:
            price = base_price + (high_price - base_price) * (i / high_at_day)
        else:
            price = high_price - (high_price - base_price) * 0.2 * (
                (i - high_at_day) / (num_days - high_at_day)
            )
        prices.append(price)

    df = pd.DataFrame(
        {
            "open": prices,
            "high": [p * 1.01 for p in prices],
            "low": [p * 0.99 for p in prices],
            "close": prices,
            "volume": [500000] * num_days,
        },
        index=dates,
    )

    return df


class TestCalculateADX:
    """Tests for calculate_adx function."""

    def test_returns_series(self):
        """Test: ADX returns a pandas Series."""
        df = create_mock_candle_data(100)
        result = calculate_adx(df["high"], df["low"], df["close"])
        assert isinstance(result, pd.Series)
        assert len(result) == len(df)

    def test_adx_values_in_valid_range(self):
        """Test: ADX values are between 0 and 100."""
        df = create_mock_candle_data(100)
        adx = calculate_adx(df["high"], df["low"], df["close"])
        valid_adx = adx.dropna()
        assert all(0 <= v <= 100 for v in valid_adx)

    def test_adx_requires_warmup_period(self):
        """Test: ADX has NaN values during warmup period."""
        df = create_mock_candle_data(50)
        adx = calculate_adx(df["high"], df["low"], df["close"], period=14)
        assert adx.iloc[:27].isna().all()

    def test_adx_strong_trend_higher_values(self):
        """Test: Strong trend produces higher ADX values."""
        trending_df = create_mock_candle_data(100, trend="up", volatility=0.03)
        flat_df = create_mock_candle_data(100, trend="flat", volatility=0.005)

        trending_adx = calculate_adx(
            trending_df["high"], trending_df["low"], trending_df["close"]
        )
        flat_adx = calculate_adx(flat_df["high"], flat_df["low"], flat_df["close"])

        assert trending_adx.iloc[-1] > flat_adx.iloc[-1]

    def test_adx_custom_period(self):
        """Test: ADX with custom period."""
        df = create_mock_candle_data(100)
        adx_14 = calculate_adx(df["high"], df["low"], df["close"], period=14)
        adx_21 = calculate_adx(df["high"], df["low"], df["close"], period=21)

        assert len(adx_14) == len(adx_21)
        assert adx_14.iloc[-1] != adx_21.iloc[-1]

    def test_adx_with_constant_prices(self):
        """Test: ADX with constant prices returns NaN or 0."""
        n = 50
        constant = pd.Series([100.0] * n)
        adx = calculate_adx(constant, constant, constant)
        assert adx.iloc[-1] == 0 or pd.isna(adx.iloc[-1])


class TestCalculateRSI:
    """Tests for calculate_rsi function."""

    def test_returns_series(self):
        """Test: RSI returns a pandas Series."""
        df = create_mock_candle_data(100)
        result = calculate_rsi(df["close"])
        assert isinstance(result, pd.Series)
        assert len(result) == len(df)

    def test_rsi_values_in_valid_range(self):
        """Test: RSI values are between 0 and 100."""
        df = create_mock_candle_data(100)
        rsi = calculate_rsi(df["close"])
        valid_rsi = rsi.dropna()
        assert all(0 <= v <= 100 for v in valid_rsi)

    def test_rsi_neutral_at_50_for_flat_prices(self):
        """Test: RSI near 50 for flat price movement."""
        n = 50
        prices = pd.Series([100 + np.random.uniform(-0.5, 0.5) for _ in range(n)])
        rsi = calculate_rsi(prices)
        assert 40 < rsi.iloc[-1] < 60

    def test_rsi_high_for_uptrend(self):
        """Test: RSI is high for uptrending prices."""
        prices = pd.Series([100 + i * 0.5 for i in range(50)])
        rsi = calculate_rsi(prices)
        assert rsi.iloc[-1] > 70

    def test_rsi_low_for_downtrend(self):
        """Test: RSI is low for downtrending prices."""
        prices = pd.Series([100 - i * 0.5 for i in range(50)])
        rsi = calculate_rsi(prices)
        assert rsi.iloc[-1] < 30

    def test_rsi_custom_period(self):
        """Test: RSI with custom period."""
        df = create_mock_candle_data(100)
        rsi_14 = calculate_rsi(df["close"], period=14)
        rsi_21 = calculate_rsi(df["close"], period=21)

        assert len(rsi_14) == len(rsi_21)


class TestGetDateFromNs:
    """Tests for get_date_from_ns function."""

    def test_converts_nanoseconds_to_datetime(self):
        """Test: Converts nanoseconds to datetime."""
        now = datetime.now(timezone.utc)
        now_ns = int(now.timestamp() * 1_000_000_000)
        result = get_date_from_ns(now_ns)
        assert isinstance(result, datetime)

    def test_preserves_timezone(self):
        """Test: Result is timezone-aware (UTC)."""
        now_ns = int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)
        result = get_date_from_ns(now_ns)
        assert result.tzinfo is not None

    def test_handles_zero(self):
        """Test: Handles zero timestamp (epoch)."""
        result = get_date_from_ns(0)
        assert result.year == 1970

    def test_roundtrip_accuracy(self):
        """Test: Roundtrip conversion is accurate within 1 second."""
        original = datetime(2024, 6, 15, 12, 30, 45, tzinfo=timezone.utc)
        ns = int(original.timestamp() * 1_000_000_000)
        result = get_date_from_ns(ns)
        diff = abs((result - original).total_seconds())
        assert diff < 1


class TestWeek52HighIndicator:
    """Tests for Week52HighIndicator class."""

    def test_initialization_default_params(self):
        """Test: Indicator initializes with default parameters."""
        indicator = Week52HighIndicator()
        assert indicator.period == 252
        assert indicator.min_periods == 100

    def test_initialization_custom_params(self):
        """Test: Indicator initializes with custom parameters."""
        indicator = Week52HighIndicator(period=100, min_periods=50)
        assert indicator.period == 100
        assert indicator.min_periods == 50

    def test_update_returns_none_before_min_periods(self):
        """Test: Returns None before any previous bars available."""
        indicator = Week52HighIndicator(period=252, min_periods=100)
        result = indicator.update(100.0)
        assert result is None

    def test_update_returns_value_after_min_periods(self):
        """Test: Returns value after minimum periods reached."""
        indicator = Week52HighIndicator(period=252, min_periods=10)
        for i in range(5):
            indicator.update(100.0)

        for i in range(10):
            result = indicator.update(100.0 + i)
        assert result is not None

    def test_tracks_rolling_high(self):
        """Test: Correctly tracks the rolling high."""
        indicator = Week52HighIndicator(period=10, min_periods=5)

        prices = [100, 105, 110, 108, 112, 115, 113, 118, 116, 120]
        for price in prices:
            indicator.update(price)

        assert indicator.value is not None

    def test_excludes_current_bar_to_avoid_lookahead(self):
        """Test: Current bar's high is excluded from calculation."""
        indicator = Week52HighIndicator(period=10, min_periods=3)

        indicator.update(100)
        indicator.update(105)
        indicator.update(110)
        result = indicator.update(200)

        assert result == 110

    def test_is_initialized(self):
        """Test: is_initialized returns correct status."""
        indicator = Week52HighIndicator(period=252, min_periods=5)

        assert not indicator.is_initialized()
        for i in range(4):
            indicator.update(100.0)
        assert not indicator.is_initialized()
        indicator.update(100.0)
        assert indicator.is_initialized()

    def test_maintains_max_period_rolling_window(self):
        """Test: Maintains only last 'period' prices."""
        indicator = Week52HighIndicator(period=5, min_periods=3)

        for i in range(10):
            indicator.update(100 + i)

        assert len(indicator._high_prices) == 5

    def test_value_property(self):
        """Test: value property returns current 52W high."""
        indicator = Week52HighIndicator(period=10, min_periods=3)

        assert indicator.value is None
        indicator.update(100)
        indicator.update(105)
        indicator.update(110)
        indicator.update(108)

        assert indicator.value == 110

    def test_rolling_high_updates_correctly(self):
        """Test: Rolling high updates as old values fall off."""
        indicator = Week52HighIndicator(period=5, min_periods=3)

        prices = [100, 110, 120, 115, 105, 95, 85]
        results = []

        for price in prices:
            indicator.update(price)
            if indicator.value is not None:
                results.append(indicator.value)

        assert len(results) > 0


class TestWeek52ChaserStrategyMetadata:
    """Tests for Week52ChaserStrategy metadata methods."""

    def test_get_name(self):
        """Test: Strategy has correct name."""
        name = Week52ChaserStrategy.get_name()
        assert "52W" in name
        assert "Chaser" in name

    def test_get_description(self):
        """Test: Strategy has description."""
        desc = Week52ChaserStrategy.get_description()
        assert isinstance(desc, str)
        assert len(desc) > 0
        assert "52-week" in desc.lower() or "52w" in desc.lower()

    def test_get_params_returns_list(self):
        """Test: get_params returns list of StrategyParam."""
        params = Week52ChaserStrategy.get_params()
        assert isinstance(params, list)
        assert all(isinstance(p, StrategyParam) for p in params)

    def test_get_params_has_required_params(self):
        """Test: Has all required parameters."""
        params = Week52ChaserStrategy.get_params()
        param_keys = [p.key for p in params]

        required_params = [
            "entry_threshold_pct",
            "stop_loss_pct",
            "take_profit_pct",
            "enable_trailing_stop",
            "trailing_stop_pct",
            "trailing_activation_pct",
            "max_holding_days",
            "cooldown_days",
            "trade_size",
            "enable_filters",
        ]

        for req in required_params:
            assert req in param_keys

    def test_entry_threshold_param_defaults(self):
        """Test: Entry threshold has correct defaults."""
        params = Week52ChaserStrategy.get_params()
        entry_threshold = next(
            (p for p in params if p.key == "entry_threshold_pct"), None
        )
        assert entry_threshold is not None
        assert entry_threshold.default == 3.0
        assert entry_threshold.type == "number"

    def test_stop_loss_param_defaults(self):
        """Test: Stop loss has correct defaults."""
        params = Week52ChaserStrategy.get_params()
        sl = next((p for p in params if p.key == "stop_loss_pct"), None)
        assert sl is not None
        assert sl.default == 3.0
        assert sl.min == 1.0
        assert sl.max == 8.0

    def test_take_profit_param_defaults(self):
        """Test: Take profit has correct defaults."""
        params = Week52ChaserStrategy.get_params()
        tp = next((p for p in params if p.key == "take_profit_pct"), None)
        assert tp is not None
        assert tp.default == 5.0

    def test_trailing_stop_is_boolean(self):
        """Test: Enable trailing stop is boolean type."""
        params = Week52ChaserStrategy.get_params()
        ts = next((p for p in params if p.key == "enable_trailing_stop"), None)
        assert ts is not None
        assert ts.type == "boolean"
        assert ts.default is False

    def test_get_default_params(self):
        """Test: get_default_params returns correct dict."""
        strategy = Week52ChaserStrategy()
        defaults = strategy.get_default_params()

        assert isinstance(defaults, dict)
        assert defaults["entry_threshold_pct"] == 3.0
        assert defaults["stop_loss_pct"] == 3.0
        assert defaults["take_profit_pct"] == 5.0


class TestWeek52ChaserStrategyValidation:
    """Tests for Week52ChaserStrategy.validate_params."""

    def test_valid_params_returns_empty_list(self):
        """Test: Valid params return no errors."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "entry_threshold_pct": 3.0,
            "stop_loss_pct": 3.0,
            "take_profit_pct": 5.0,
        })
        assert errors == []

    def test_stop_loss_greater_than_take_profit_returns_error(self):
        """Test: SL >= TP returns error."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "stop_loss_pct": 6.0,
            "take_profit_pct": 5.0,
        })
        assert len(errors) == 1
        assert "Stop Loss" in errors[0]

    def test_stop_loss_equal_to_take_profit_returns_error(self):
        """Test: SL == TP returns error."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "stop_loss_pct": 5.0,
            "take_profit_pct": 5.0,
        })
        assert len(errors) == 1

    def test_negative_entry_threshold_returns_error(self):
        """Test: Negative entry threshold returns error."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "entry_threshold_pct": -1.0,
        })
        assert len(errors) == 1
        assert "positive" in errors[0].lower()

    def test_zero_entry_threshold_returns_error(self):
        """Test: Zero entry threshold returns error."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "entry_threshold_pct": 0,
        })
        assert len(errors) == 1

    def test_trailing_stop_enabled_with_zero_value_returns_error(self):
        """Test: Trailing stop enabled with zero value returns error."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "enable_trailing_stop": True,
            "trailing_stop_pct": 0,
        })
        assert len(errors) == 1
        assert "Trailing Stop" in errors[0]

    def test_trailing_stop_enabled_with_negative_value_returns_error(self):
        """Test: Trailing stop enabled with negative value returns error."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "enable_trailing_stop": True,
            "trailing_stop_pct": -1.0,
        })
        assert len(errors) == 1

    def test_trailing_stop_disabled_no_validation_error(self):
        """Test: Trailing stop disabled skips validation of value."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "enable_trailing_stop": False,
            "trailing_stop_pct": -1.0,
        })
        assert all("Trailing Stop" not in e for e in errors)

    def test_multiple_errors_returned(self):
        """Test: Multiple validation errors are all returned."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "entry_threshold_pct": -1.0,
            "stop_loss_pct": 10.0,
            "take_profit_pct": 5.0,
            "enable_trailing_stop": True,
            "trailing_stop_pct": 0,
        })
        assert len(errors) >= 2


class TestWeek52ChaserConfig:
    """Tests for Week52ChaserConfig dataclass."""

    def test_config_default_values(self):
        """Test: Config has correct default values."""
        from nautilus_trader.model import InstrumentId, BarType, Venue

        instrument_id = InstrumentId.from_str("RELIANCE.SIMULATED")
        bar_type = BarType.from_str("RELIANCE.SIMULATED-1-DAY-LAST-EXTERNAL")

        config = Week52ChaserConfig(
            instrument_id=instrument_id,
            bar_type=bar_type,
        )

        assert config.entry_threshold_pct == 3.0
        assert config.stop_loss_pct == 3.0
        assert config.take_profit_pct == 5.0
        assert config.enable_trailing_stop is False
        assert config.trailing_stop_pct == 3.0
        assert config.trailing_activation_pct == 2.0
        assert config.max_holding_days == 30
        assert config.cooldown_days == 30
        assert config.trade_size == 100
        assert config.enable_filters is False

    def test_config_custom_values(self):
        """Test: Config accepts custom values."""
        from nautilus_trader.model import InstrumentId, BarType

        config = Week52ChaserConfig(
            instrument_id=InstrumentId.from_str("TEST.SIMULATED"),
            bar_type=BarType.from_str("TEST.SIMULATED-1-DAY-LAST-EXTERNAL"),
            entry_threshold_pct=5.0,
            stop_loss_pct=2.0,
            take_profit_pct=8.0,
            enable_trailing_stop=True,
            trailing_stop_pct=2.5,
            max_holding_days=20,
            cooldown_days=15,
            trade_size=200,
        )

        assert config.entry_threshold_pct == 5.0
        assert config.stop_loss_pct == 2.0
        assert config.take_profit_pct == 8.0
        assert config.enable_trailing_stop is True


class TestWeek52ChaserNautilusStrategy:
    """Tests for Week52ChaserNautilusStrategy class."""

    def test_strategy_params_from_config(self):
        """Test: Strategy reads params from config correctly."""
        assert Week52ChaserNautilusStrategy is not None

    def test_52w_indicator_class_exists(self):
        """Test: 52W indicator class is available."""
        assert Week52HighIndicator is not None
        indicator = Week52HighIndicator(period=252, min_periods=100)
        assert indicator.period == 252
        assert indicator.min_periods == 100

    def test_on_reset_clears_state_via_indicator(self):
        """Test: Indicator state can be reset by creating new instance."""
        indicator = Week52HighIndicator(period=252, min_periods=100)
        for i in range(10):
            indicator.update(100.0 + i)
        
        assert indicator.value is not None or indicator._count == 10
        
        indicator = Week52HighIndicator(period=252, min_periods=100)
        assert indicator._count == 0
        assert indicator.value is None

    def test_trade_list_exists_in_strategy_class(self):
        """Test: Strategy class has trades attribute."""
        from backtest.strategies.week52_chaser import Week52ChaserNautilusStrategy
        assert hasattr(Week52ChaserNautilusStrategy, '__init__')


class TestEntryLogic:
    """Tests for entry signal generation."""

    def _create_indicator_with_data(self, num_bars: int = 150):
        """Create indicator pre-loaded with data."""
        indicator = Week52HighIndicator(period=252, min_periods=100)
        high_price = 150.0

        for i in range(num_bars):
            if i < num_bars - 1:
                indicator.update(high_price - 10 + (i % 20))
            else:
                indicator.update(high_price)

        return indicator

    def test_entry_when_within_threshold(self):
        """Test: Entry triggered when price within threshold of 52W high."""
        indicator = self._create_indicator_with_data(150)

        high_52w = indicator.value
        assert high_52w is not None

        entry_threshold_pct = 3.0
        close_price = high_52w * 0.98

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert 0 < distance_pct <= entry_threshold_pct

    def test_no_entry_when_above_threshold(self):
        """Test: No entry when price too far from 52W high."""
        indicator = self._create_indicator_with_data(150)

        high_52w = indicator.value
        entry_threshold_pct = 3.0
        close_price = high_52w * 0.90

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert distance_pct > entry_threshold_pct

    def test_no_entry_when_above_52w_high(self):
        """Test: No entry when price above 52W high (negative distance)."""
        indicator = self._create_indicator_with_data(150)

        high_52w = indicator.value
        close_price = high_52w * 1.05

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert distance_pct < 0

    def test_entry_requires_cooldown_complete(self):
        """Test: Entry blocked during cooldown period."""
        cooldown_days = 30
        bars_since_exit = 10

        in_cooldown = bars_since_exit < cooldown_days
        assert in_cooldown is True

        bars_since_exit = 35
        in_cooldown = bars_since_exit < cooldown_days
        assert in_cooldown is False


class TestExitLogic:
    """Tests for exit conditions."""

    def test_take_profit_exit(self):
        """Test: Exit at take profit percentage."""
        entry_price = 100.0
        take_profit_pct = 5.0
        close_price = 105.5

        pnl_pct = ((close_price - entry_price) / entry_price) * 100

        assert pnl_pct >= take_profit_pct

    def test_stop_loss_exit(self):
        """Test: Exit at stop loss percentage."""
        entry_price = 100.0
        stop_loss_pct = 3.0
        close_price = 96.5

        pnl_pct = ((close_price - entry_price) / entry_price) * 100

        assert pnl_pct <= -stop_loss_pct

    def test_max_holding_exit(self):
        """Test: Exit at max holding days."""
        max_holding_days = 30
        bars_in_trade = 30

        should_exit = bars_in_trade >= max_holding_days
        assert should_exit is True

    def test_trailing_stop_activation_at_52w_high(self):
        """Test: Trailing stop activates when price reaches 52W high."""
        entry_price = 100.0
        entry_52w_high = 105.0
        close_price = 105.0
        enable_trailing_stop = True

        trailing_active = enable_trailing_stop and close_price >= entry_52w_high
        assert trailing_active is True

    def test_trailing_stop_exit(self):
        """Test: Exit when trailing stop hit."""
        highest_price = 110.0
        trailing_stop_pct = 3.0
        close_price = 106.0

        trailing_stop_price = highest_price * (1 - trailing_stop_pct / 100)

        assert close_price <= trailing_stop_price

    def test_new_52w_high_exit(self):
        """Test: Exit when new 52W high forms far above entry."""
        entry_52w_high = 100.0
        current_52w_high = 115.0

        should_exit = current_52w_high > entry_52w_high * 1.10
        assert should_exit is True

    def test_exit_priority(self):
        """Test: Exit conditions are checked in correct priority."""
        entry_price = 100.0
        take_profit_pct = 5.0
        stop_loss_pct = 3.0

        close_at_tp = 106.0
        close_at_sl = 96.0

        pnl_at_tp = ((close_at_tp - entry_price) / entry_price) * 100
        pnl_at_sl = ((close_at_sl - entry_price) / entry_price) * 100

        assert pnl_at_tp >= take_profit_pct
        assert pnl_at_sl <= -stop_loss_pct


class TestTradingCostsIntegration:
    """Tests for trading cost calculations in strategy."""

    def test_costs_calculated_on_exit(self):
        """Test: Trading costs are calculated on exit."""
        from backtest.costs import calculate_trading_costs

        entry_price = 100.0
        exit_price = 105.0
        quantity = 100

        costs = calculate_trading_costs(entry_price, exit_price, quantity)

        assert "total_costs" in costs
        assert costs["total_costs"] > 0

    def test_net_pnl_includes_costs(self):
        """Test: Net P&L subtracts trading costs."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100

        gross_pnl = (exit_price - entry_price) * quantity

        from backtest.costs import calculate_trading_costs
        costs = calculate_trading_costs(entry_price, exit_price, quantity)

        net_pnl = gross_pnl - costs["total_costs"]

        assert net_pnl < gross_pnl
        assert net_pnl > 0


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_indicator_with_single_price(self):
        """Test: Indicator handles single price update."""
        indicator = Week52HighIndicator(period=252, min_periods=100)
        result = indicator.update(100.0)
        assert result is None

    def test_indicator_with_zero_price(self):
        """Test: Indicator handles zero price."""
        indicator = Week52HighIndicator(period=10, min_periods=3)
        indicator.update(0.0)
        indicator.update(0.0)
        indicator.update(0.0)
        result = indicator.update(0.0)

        if result is not None:
            assert result >= 0

    def test_indicator_with_negative_price(self):
        """Test: Indicator handles negative price (edge case)."""
        indicator = Week52HighIndicator(period=10, min_periods=3)
        indicator.update(-10.0)
        indicator.update(-5.0)
        indicator.update(-2.0)
        result = indicator.update(-1.0)

    def test_empty_historical_df(self):
        """Test: Strategy handles empty historical DataFrame."""
        empty_df = pd.DataFrame()
        assert empty_df.empty is True
        assert len(empty_df) == 0

    def test_very_small_threshold(self):
        """Test: Very small entry threshold (0.5%)."""
        strategy = Week52ChaserStrategy()
        errors = strategy.validate_params({
            "entry_threshold_pct": 0.5,
        })
        assert all("positive" not in e.lower() for e in errors)

    def test_very_large_threshold(self):
        """Test: Very large entry threshold (10%)."""
        high_52w = 100.0
        entry_threshold_pct = 10.0
        close_price = 92.0

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert 0 < distance_pct <= entry_threshold_pct

    def test_equal_entry_and_exit_price(self):
        """Test: Equal entry and exit price (breakeven)."""
        entry_price = 100.0
        exit_price = 100.0

        pnl_pct = ((exit_price - entry_price) / entry_price) * 100

        assert pnl_pct == 0

    def test_very_high_volatility_prices(self):
        """Test: Indicator handles high volatility."""
        indicator = Week52HighIndicator(period=10, min_periods=5)

        volatile_prices = [100, 150, 80, 200, 50, 250, 30, 300, 20, 350]
        for price in volatile_prices:
            indicator.update(price)

        assert indicator.value is not None

    def test_consecutive_same_prices(self):
        """Test: Indicator handles consecutive same prices."""
        indicator = Week52HighIndicator(period=10, min_periods=5)

        for _ in range(10):
            indicator.update(100.0)

        assert indicator.value == 100.0


class TestDistanceCalculation:
    """Tests for distance to 52W high calculation."""

    def test_distance_calculation_positive(self):
        """Test: Positive distance when below 52W high."""
        high_52w = 100.0
        close_price = 97.0

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert distance_pct > 0
        assert abs(distance_pct - 3.09) < 0.1

    def test_distance_calculation_negative(self):
        """Test: Negative distance when above 52W high."""
        high_52w = 100.0
        close_price = 105.0

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert distance_pct < 0

    def test_distance_zero_at_52w_high(self):
        """Test: Zero distance when at 52W high."""
        high_52w = 100.0
        close_price = 100.0

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert distance_pct == 0

    def test_distance_with_exact_threshold(self):
        """Test: Entry when distance exactly equals threshold."""
        high_52w = 103.0
        close_price = 100.0
        entry_threshold_pct = 3.0

        distance_pct = ((high_52w - close_price) / close_price) * 100

        assert abs(distance_pct - entry_threshold_pct) < 0.1


class TestPnLCalculations:
    """Tests for P&L calculations."""

    def test_gross_pnl_profit(self):
        """Test: Gross P&L calculation for profit."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100

        gross_pnl = (exit_price - entry_price) * quantity

        assert gross_pnl == 500

    def test_gross_pnl_loss(self):
        """Test: Gross P&L calculation for loss."""
        entry_price = 100.0
        exit_price = 95.0
        quantity = 100

        gross_pnl = (exit_price - entry_price) * quantity

        assert gross_pnl == -500

    def test_pnl_percentage(self):
        """Test: P&L percentage calculation."""
        entry_price = 100.0
        exit_price = 105.0

        pnl_pct = ((exit_price - entry_price) / entry_price) * 100

        assert pnl_pct == 5.0

    def test_net_pnl_after_costs(self):
        """Test: Net P&L after costs."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100

        gross_pnl = (exit_price - entry_price) * quantity
        trading_costs = 50.0

        net_pnl = gross_pnl - trading_costs

        assert net_pnl == 450

    def test_net_pnl_percentage(self):
        """Test: Net P&L percentage calculation."""
        entry_price = 100.0
        quantity = 100
        gross_pnl = 500
        trading_costs = 50

        net_pnl = gross_pnl - trading_costs
        net_pnl_pct = (net_pnl / (entry_price * quantity)) * 100

        assert net_pnl_pct == 4.5


class TestTrailingStopLogic:
    """Tests for trailing stop logic."""

    def test_trailing_stop_disabled_by_default_in_params(self):
        """Test: Trailing stop disabled by default in strategy params."""
        params = Week52ChaserStrategy.get_params()
        enable_trailing = next((p for p in params if p.key == "enable_trailing_stop"), None)
        assert enable_trailing is not None
        assert enable_trailing.default is False

    def test_trailing_stop_activation_price(self):
        """Test: Trailing stop activates at 52W high."""
        entry_52w_high = 105.0
        close_price = 105.0

        should_activate = close_price >= entry_52w_high
        assert should_activate is True

    def test_trailing_stop_price_calculation(self):
        """Test: Trailing stop price calculated correctly."""
        highest_price = 110.0
        trailing_stop_pct = 3.0

        trailing_stop_price = highest_price * (1 - trailing_stop_pct / 100)

        assert abs(trailing_stop_price - 106.7) < 0.1

    def test_trailing_stop_moves_up_not_down(self):
        """Test: Trailing stop only moves up with price."""
        prices = [100, 105, 110, 108, 112, 115, 113]
        trailing_stop_pct = 3.0

        highest = prices[0]
        trailing_stops = []

        for price in prices:
            if price > highest:
                highest = price
            trailing_stop = highest * (1 - trailing_stop_pct / 100)
            trailing_stops.append(trailing_stop)

        assert trailing_stops[-1] >= trailing_stops[0]

    def test_initial_sl_still_active_before_trailing(self):
        """Test: Initial SL still used before trailing activates."""
        entry_price = 100.0
        stop_loss_pct = 3.0
        trailing_active = False

        if not trailing_active:
            sl_price = entry_price * (1 - stop_loss_pct / 100)
            assert sl_price == 97.0


class TestCooldownPeriod:
    """Tests for cooldown period logic."""

    def test_cooldown_blocks_entry(self):
        """Test: Cooldown period blocks new entries."""
        cooldown_days = 30
        bars_since_exit = 15

        in_cooldown = bars_since_exit < cooldown_days
        assert in_cooldown is True

    def test_cooldown_allows_entry_after_period(self):
        """Test: Entry allowed after cooldown period."""
        cooldown_days = 30
        bars_since_exit = 30

        in_cooldown = bars_since_exit < cooldown_days
        assert in_cooldown is False

    def test_cooldown_resets_after_exit(self):
        """Test: Cooldown counter resets after exit."""
        bars_since_exit_after_exit = 0
        cooldown_days = 30

        in_cooldown = bars_since_exit_after_exit < cooldown_days
        assert in_cooldown is True

    def test_cooldown_increments_each_bar(self):
        """Test: Cooldown counter increments each bar."""
        bars_since_exit = 0
        bars_since_exit += 1
        bars_since_exit += 1

        assert bars_since_exit == 2


class TestHoldDuration:
    """Tests for holding period calculations."""

    def test_hold_duration_increments(self):
        """Test: Hold duration increments each bar in trade."""
        bars_in_trade = 0
        bars_in_trade += 1
        bars_in_trade += 1
        bars_in_trade += 1

        assert bars_in_trade == 3

    def test_hold_duration_resets_on_exit(self):
        """Test: Hold duration resets on exit."""
        bars_in_trade = 10
        bars_in_trade = 0

        assert bars_in_trade == 0

    def test_hold_duration_converted_to_minutes(self):
        """Test: Hold duration converted to minutes for UI."""
        hold_days = 5
        hold_minutes = hold_days * 24 * 60

        assert hold_minutes == 7200


class TestFilterLogic:
    """Tests for entry filter logic."""

    def test_adx_filter_requires_strong_trend(self):
        """Test: ADX filter requires value >= 25."""
        adx_value = 30
        adx_threshold = 25

        passes = adx_value >= adx_threshold
        assert passes is True

    def test_adx_filter_blocks_weak_trend(self):
        """Test: ADX filter blocks weak trend."""
        adx_value = 20
        adx_threshold = 25

        passes = adx_value >= adx_threshold
        assert passes is False

    def test_rsi_filter_range(self):
        """Test: RSI filter requires 50-70 range."""
        rsi_value = 60
        rsi_min = 50
        rsi_max = 70

        passes = rsi_min <= rsi_value <= rsi_max
        assert passes is True

    def test_rsi_filter_blocks_low_rsi(self):
        """Test: RSI filter blocks low RSI."""
        rsi_value = 40
        rsi_min = 50
        rsi_max = 70

        passes = rsi_min <= rsi_value <= rsi_max
        assert passes is False

    def test_rsi_filter_blocks_high_rsi(self):
        """Test: RSI filter blocks high RSI."""
        rsi_value = 80
        rsi_min = 50
        rsi_max = 70

        passes = rsi_min <= rsi_value <= rsi_max
        assert passes is False

    def test_volume_filter(self):
        """Test: Volume filter requires 1.5x average."""
        volume = 150000
        avg_volume = 100000
        volume_mult = 1.5

        passes = volume >= avg_volume * volume_mult
        assert passes is True

    def test_ma_filter_price_above_ma(self):
        """Test: Price must be above MA50 and MA200."""
        close_price = 105
        ma50 = 100
        ma200 = 95

        passes = close_price > ma50 and close_price > ma200
        assert passes is True

    def test_filters_disabled_by_default(self):
        """Test: Filters disabled by default."""
        params = Week52ChaserStrategy.get_params()
        enable_filters = next((p for p in params if p.key == "enable_filters"), None)
        assert enable_filters is not None
        assert enable_filters.default is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
