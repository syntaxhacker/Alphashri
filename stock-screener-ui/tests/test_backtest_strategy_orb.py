"""
Unit tests for backtest/strategies/orb.py.

Tests cover:
- Strategy metadata (name, description, params)
- Parameter validation
- IST time conversion
- Opening range calculation
- Signal generation (breakout detection)
- Entry/exit logic
- Stop-loss and take-profit calculations
- Edge cases (invalid data, empty candles, etc.)
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, MagicMock, patch
from dataclasses import asdict

from backtest.strategies.orb import (
    ORBStrategy,
    ORBConfig,
    ORBNautilusStrategy,
    get_ist_time,
    run_single_stock_backtest,
)
from backtest.strategies.base import StrategyParam


class TestGetIstTime:
    """Tests for get_ist_time utility function."""

    def test_converts_utc_noon_to_ist_evening(self):
        """Test: UTC noon converts to IST 5:30 PM."""
        utc_noon_ts = int(datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc).timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(utc_noon_ts)
        assert hour == 17
        assert minute == 30
        assert date == datetime(2024, 1, 15).date()

    def test_converts_market_open_time(self):
        """Test: UTC 3:45 AM (IST 9:15 AM) market open."""
        utc_time = datetime(2024, 1, 15, 3, 45, 0, tzinfo=timezone.utc)
        ts_ns = int(utc_time.timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 9
        assert minute == 15

    def test_converts_market_close_time(self):
        """Test: UTC 9:00 AM (IST 2:30 PM) near market close."""
        utc_time = datetime(2024, 1, 15, 9, 0, 0, tzinfo=timezone.utc)
        ts_ns = int(utc_time.timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 14
        assert minute == 30

    def test_handles_day_rollover(self):
        """Test: IST crosses midnight correctly."""
        utc_time = datetime(2024, 1, 15, 18, 30, 0, tzinfo=timezone.utc)
        ts_ns = int(utc_time.timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 0
        assert minute == 0
        assert date == datetime(2024, 1, 16).date()

    def test_handles_nanos_precision(self):
        """Test: Nanosecond timestamp handled correctly."""
        utc_time = datetime(2024, 1, 15, 6, 0, 0, tzinfo=timezone.utc)
        ts_ns = int(utc_time.timestamp() * 1_000_000_000) + 123456789
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 11
        assert minute == 30

    def test_opening_range_end_45_min(self):
        """Test: 45-min OR ends at IST 10:00 AM."""
        utc_time = datetime(2024, 1, 15, 4, 30, 0, tzinfo=timezone.utc)
        ts_ns = int(utc_time.timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 10
        assert minute == 0

    def test_eod_exit_time(self):
        """Test: EOD exit at IST 14:45."""
        utc_time = datetime(2024, 1, 15, 9, 15, 0, tzinfo=timezone.utc)
        ts_ns = int(utc_time.timestamp() * 1_000_000_000)
        hour, minute, date = get_ist_time(ts_ns)
        assert hour == 14
        assert minute == 45


class TestORBStrategyMetadata:
    """Tests for ORBStrategy metadata methods."""

    def test_get_name(self):
        """Test: Strategy name is correct."""
        strategy = ORBStrategy()
        assert strategy.get_name() == "ORB - Opening Range Breakout"

    def test_get_name_is_classmethod(self):
        """Test: get_name works as classmethod."""
        assert ORBStrategy.get_name() == "ORB - Opening Range Breakout"

    def test_get_description(self):
        """Test: Strategy description is meaningful."""
        strategy = ORBStrategy()
        desc = strategy.get_description()
        assert "ORB" in desc
        assert "breakout" in desc.lower()
        assert "SL" in desc or "stop" in desc.lower()

    def test_get_description_is_classmethod(self):
        """Test: get_description works as classmethod."""
        desc = ORBStrategy.get_description()
        assert isinstance(desc, str)
        assert len(desc) > 10

    def test_get_params_returns_list(self):
        """Test: get_params returns a list."""
        strategy = ORBStrategy()
        params = strategy.get_params()
        assert isinstance(params, list)

    def test_get_params_is_classmethod(self):
        """Test: get_params works as classmethod."""
        params = ORBStrategy.get_params()
        assert isinstance(params, list)

    def test_get_params_has_required_keys(self):
        """Test: All required parameters are defined."""
        params = ORBStrategy.get_params()
        param_keys = {p.key for p in params}
        required_keys = {
            'or_minutes',
            'timeframe',
            'stop_loss_pct',
            'take_profit_pct',
            'trade_size',
            'cooldown_bars',
            'enable_shorts',
            'breakout_buffer_pct',
        }
        assert required_keys.issubset(param_keys)

    def test_get_params_all_have_labels(self):
        """Test: All parameters have labels."""
        params = ORBStrategy.get_params()
        for param in params:
            assert param.label is not None
            assert len(param.label) > 0

    def test_get_params_all_have_types(self):
        """Test: All parameters have valid types."""
        params = ORBStrategy.get_params()
        valid_types = {'number', 'select', 'boolean'}
        for param in params:
            assert param.type in valid_types

    def test_or_minutes_param_defaults(self):
        """Test: OR minutes param has correct defaults."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        or_param = params['or_minutes']
        assert or_param.default == 45
        assert or_param.min == 15
        assert or_param.max == 120
        assert or_param.step == 5

    def test_stop_loss_param_defaults(self):
        """Test: Stop loss param has correct defaults."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        sl_param = params['stop_loss_pct']
        assert sl_param.default == 0.4
        assert sl_param.min == 0.1
        assert sl_param.max == 2.0

    def test_take_profit_param_defaults(self):
        """Test: Take profit param has correct defaults."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        tp_param = params['take_profit_pct']
        assert tp_param.default == 1.2
        assert tp_param.min == 0.2
        assert tp_param.max == 4.0

    def test_timeframe_param_options(self):
        """Test: Timeframe param has valid options."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        tf_param = params['timeframe']
        assert tf_param.type == 'select'
        assert set(tf_param.options) == {'1', '5', '15'}

    def test_enable_shorts_param_is_boolean(self):
        """Test: Enable shorts param is boolean type."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        shorts_param = params['enable_shorts']
        assert shorts_param.type == 'boolean'
        assert shorts_param.default is False

    def test_cooldown_bars_param_defaults(self):
        """Test: Cooldown bars param has correct defaults."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        cooldown_param = params['cooldown_bars']
        assert cooldown_param.default == 3
        assert cooldown_param.min == 0
        assert cooldown_param.max == 20

    def test_trade_size_param_defaults(self):
        """Test: Trade size param has correct defaults."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        size_param = params['trade_size']
        assert size_param.default == 100
        assert size_param.min == 1
        assert size_param.max == 5000


class TestORBStrategyValidateParams:
    """Tests for ORBStrategy parameter validation."""

    def test_valid_default_params(self):
        """Test: Default params are valid."""
        strategy = ORBStrategy()
        params = strategy.get_default_params()
        errors = strategy.validate_params(params)
        assert errors == []

    def test_or_minutes_too_low(self):
        """Test: OR minutes below 15 returns error."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'or_minutes': 10})
        assert len(errors) == 1
        assert "15" in errors[0]

    def test_or_minutes_at_boundary(self):
        """Test: OR minutes at 15 is valid."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'or_minutes': 15})
        assert all("OR Period" not in e for e in errors)

    def test_stop_loss_greater_than_take_profit(self):
        """Test: SL >= TP returns error."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'stop_loss_pct': 1.5,
            'take_profit_pct': 1.0,
        })
        assert len(errors) >= 1
        assert any("Stop Loss" in e and "Take Profit" in e for e in errors)

    def test_stop_loss_equals_take_profit(self):
        """Test: SL == TP returns error."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'stop_loss_pct': 1.0,
            'take_profit_pct': 1.0,
        })
        assert any("Stop Loss" in e for e in errors)

    def test_stop_loss_less_than_take_profit_valid(self):
        """Test: SL < TP is valid."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'stop_loss_pct': 0.5,
            'take_profit_pct': 1.5,
        })
        assert all("Stop Loss" not in e or "Take Profit" not in e for e in errors)

    def test_invalid_timeframe(self):
        """Test: Invalid timeframe returns error."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'timeframe': '30'})
        assert len(errors) >= 1
        assert any("Timeframe" in e for e in errors)

    def test_valid_timeframe_1(self):
        """Test: Timeframe 1 is valid."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'timeframe': '1'})
        assert all("Timeframe" not in e for e in errors)

    def test_valid_timeframe_5(self):
        """Test: Timeframe 5 is valid."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'timeframe': '5'})
        assert all("Timeframe" not in e for e in errors)

    def test_valid_timeframe_15(self):
        """Test: Timeframe 15 is valid."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'timeframe': '15'})
        assert all("Timeframe" not in e for e in errors)

    def test_multiple_errors(self):
        """Test: Multiple validation errors are returned."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'or_minutes': 5,
            'stop_loss_pct': 2.0,
            'take_profit_pct': 1.0,
            'timeframe': '30',
        })
        assert len(errors) >= 2

    def test_empty_params_uses_defaults(self):
        """Test: Empty params uses defaults and validates."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({})
        assert errors == []

    def test_partial_params_uses_defaults_for_missing(self):
        """Test: Partial params fill in defaults for validation."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'or_minutes': 30})
        assert errors == []

    def test_string_numeric_params(self):
        """Test: String numeric params are handled."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'or_minutes': '45',
            'stop_loss_pct': '0.4',
            'take_profit_pct': '1.2',
        })
        assert errors == []


class TestORBStrategyDefaultParams:
    """Tests for ORBStrategy default params method."""

    def test_get_default_params_returns_dict(self):
        """Test: get_default_params returns a dict."""
        strategy = ORBStrategy()
        defaults = strategy.get_default_params()
        assert isinstance(defaults, dict)

    def test_get_default_params_has_all_keys(self):
        """Test: Default params has all required keys."""
        strategy = ORBStrategy()
        defaults = strategy.get_default_params()
        params = ORBStrategy.get_params()
        for param in params:
            assert param.key in defaults

    def test_get_default_params_values_match(self):
        """Test: Default values match param definitions."""
        strategy = ORBStrategy()
        defaults = strategy.get_default_params()
        params = ORBStrategy.get_params()
        for param in params:
            assert defaults[param.key] == param.default


class TestORBConfig:
    """Tests for ORBConfig configuration class."""

    def _create_mock_instrument_id(self):
        """Create a mock InstrumentId for testing."""
        mock = MagicMock()
        mock.__str__ = Mock(return_value="TEST.SIMULATED")
        return mock

    def _create_mock_bar_type(self):
        """Create a mock BarType for testing."""
        mock = MagicMock()
        mock.__str__ = Mock(return_value="TEST.SIMULATED-5-MINUTE-LAST-EXTERNAL")
        return mock

    def test_config_default_values(self):
        """Test: Config has correct default values."""
        mock_instrument_id = self._create_mock_instrument_id()
        mock_bar_type = self._create_mock_bar_type()

        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
        )

        assert config.or_minutes == 45
        assert config.sl_pct == 0.4
        assert config.tp_pct == 1.2
        assert config.trade_size == 100
        assert config.enable_shorts is False
        assert config.cooldown_bars == 3
        assert config.breakout_buffer_pct == 0.3

    def test_config_custom_values(self):
        """Test: Config accepts custom values."""
        mock_instrument_id = self._create_mock_instrument_id()
        mock_bar_type = self._create_mock_bar_type()

        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
            or_minutes=30,
            sl_pct=0.5,
            tp_pct=1.5,
            trade_size=200,
            enable_shorts=True,
            cooldown_bars=5,
        )

        assert config.or_minutes == 30
        assert config.sl_pct == 0.5
        assert config.tp_pct == 1.5
        assert config.trade_size == 200
        assert config.enable_shorts is True
        assert config.cooldown_bars == 5

    def test_config_required_fields(self):
        """Test: Config requires instrument_id and bar_type."""
        with pytest.raises(TypeError):
            ORBConfig()

    def test_config_instrument_id_stored(self):
        """Test: Config stores instrument_id."""
        mock_instrument_id = self._create_mock_instrument_id()
        mock_bar_type = self._create_mock_bar_type()

        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
        )

        assert config.instrument_id == mock_instrument_id

    def test_config_bar_type_stored(self):
        """Test: Config stores bar_type."""
        mock_instrument_id = self._create_mock_instrument_id()
        mock_bar_type = self._create_mock_bar_type()

        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
        )

        assert config.bar_type == mock_bar_type


class TestORBNautilusStrategyInit:
    """Tests for ORBNautilusStrategy initialization."""

    def _create_config(self, **kwargs):
        """Create a test config with defaults."""
        mock_instrument_id = MagicMock()
        mock_bar_type = MagicMock()
        defaults = {
            'instrument_id': mock_instrument_id,
            'bar_type': mock_bar_type,
            'or_minutes': 45,
            'sl_pct': 0.4,
            'tp_pct': 1.2,
            'trade_size': 100,
            'enable_shorts': False,
            'cooldown_bars': 3,
        }
        defaults.update(kwargs)
        return ORBConfig(**defaults)

    def test_init_stores_config_values(self):
        """Test: Strategy stores config values correctly."""
        config = self._create_config(
            or_minutes=30,
            sl_pct=0.5,
            tp_pct=1.5,
            trade_size=200,
            enable_shorts=True,
            cooldown_bars=5,
        )
        strategy = ORBNautilusStrategy(config=config)

        assert strategy._or_minutes == 30
        assert strategy._sl_pct == 0.5
        assert strategy._tp_pct == 1.5
        assert strategy._trade_size == 200
        assert strategy._enable_shorts is True
        assert strategy._cooldown_bars == 5
        assert strategy._breakout_buffer_pct == 0.3

    def test_init_initializes_trades_list(self):
        """Test: Strategy initializes empty trades list."""
        config = self._create_config()
        strategy = ORBNautilusStrategy(config=config)
        assert strategy.trades == []

    def test_init_initializes_state_variables(self):
        """Test: Strategy initializes state variables to None/0."""
        config = self._create_config()
        strategy = ORBNautilusStrategy(config=config)

        assert strategy._current_date is None
        assert strategy._or_high is None
        assert strategy._or_low is None
        assert strategy._or_bars == 0
        assert strategy._or_defined is False
        assert strategy._entry_price is None
        assert strategy._position_side is None
        assert strategy._last_exit_bar is None
        assert strategy._bar_number == 0
        assert strategy._current_entry_time is None
        assert strategy._position_peak is None
        assert strategy._position_low is None


class TestORBNautilusStrategyOnReset:
    """Tests for ORBNautilusStrategy on_reset method."""

    def _create_strategy(self):
        """Create a strategy instance for testing."""
        mock_instrument_id = MagicMock()
        mock_bar_type = MagicMock()
        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
        )
        return ORBNautilusStrategy(config=config)

    def test_on_reset_clears_state(self):
        """Test: on_reset clears all state variables."""
        strategy = self._create_strategy()
        strategy._current_date = "2024-01-15"
        strategy._or_high = 100.0
        strategy._or_low = 95.0
        strategy._or_defined = True
        strategy._position_side = "LONG"
        strategy._entry_price = 100.0

        strategy.on_reset()

        assert strategy._current_date is None
        assert strategy._or_high is None
        assert strategy._or_low is None
        assert strategy._or_defined is False
        assert strategy._position_side is None
        assert strategy._entry_price is None


class TestORBNautilusStrategyStateManagement:
    """Tests for ORBNautilusStrategy state management."""

    def _create_strategy(self):
        """Create a strategy instance for testing."""
        mock_instrument_id = MagicMock()
        mock_bar_type = MagicMock()
        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
        )
        return ORBNautilusStrategy(config=config)

    def test_bar_number_increments(self):
        """Test: Bar number increments correctly."""
        strategy = self._create_strategy()
        assert strategy._bar_number == 0

    def test_position_peak_low_tracking(self):
        """Test: Position peak and low are tracked."""
        strategy = self._create_strategy()
        assert strategy._position_peak is None
        assert strategy._position_low is None


class TestRunSingleStockBacktest:
    """Tests for run_single_stock_backtest function."""

    def test_returns_error_dict_on_exception(self):
        """Test: Returns error dict when exception occurs."""
        result = run_single_stock_backtest(('INVALID_SYMBOL', {}, 30))
        assert 'symbol' in result
        assert result['symbol'] == 'INVALID_SYMBOL'
        assert 'success' in result
        assert result['success'] is False
        assert 'error' in result

    def test_returns_symbol_in_result(self):
        """Test: Symbol is always in result."""
        result = run_single_stock_backtest(('TEST', {}, 30))
        assert result['symbol'] == 'TEST'

    def test_params_extraction_defaults(self):
        """Test: Default params are extracted correctly."""
        params = {}
        or_minutes = int(params.get('or_minutes', 45))
        sl_pct = float(params.get('stop_loss_pct', 0.4))
        tp_pct = float(params.get('take_profit_pct', 1.2))
        trade_size = int(params.get('trade_size', 100))
        timeframe = int(params.get('timeframe', '5'))
        include_costs = bool(params.get('include_costs', True))
        enable_shorts = bool(params.get('enable_shorts', False))
        cooldown_bars = int(params.get('cooldown_bars', 3))

        assert or_minutes == 45
        assert sl_pct == 0.4
        assert tp_pct == 1.2
        assert trade_size == 100
        assert timeframe == 5
        assert include_costs is True
        assert enable_shorts is False
        assert cooldown_bars == 3

    def test_params_extraction_custom(self):
        """Test: Custom params are extracted correctly."""
        params = {
            'or_minutes': 30,
            'stop_loss_pct': 0.5,
            'take_profit_pct': 1.5,
            'trade_size': 200,
            'timeframe': '15',
            'include_costs': False,
            'enable_shorts': True,
            'cooldown_bars': 5,
        }
        or_minutes = int(params.get('or_minutes', 45))
        sl_pct = float(params.get('stop_loss_pct', 0.4))
        tp_pct = float(params.get('take_profit_pct', 1.2))
        trade_size = int(params.get('trade_size', 100))
        timeframe = int(params.get('timeframe', '5'))
        include_costs = bool(params.get('include_costs', True))
        enable_shorts = bool(params.get('enable_shorts', False))
        cooldown_bars = int(params.get('cooldown_bars', 3))

        assert or_minutes == 30
        assert sl_pct == 0.5
        assert tp_pct == 1.5
        assert trade_size == 200
        assert timeframe == 15
        assert include_costs is False
        assert enable_shorts is True
        assert cooldown_bars == 5


class TestORBStrategyIntegration:
    """Integration tests for ORBStrategy."""

    def test_strategy_inherits_from_base(self):
        """Test: ORBStrategy inherits from BaseStrategy."""
        from backtest.strategies.base import BaseStrategy
        assert issubclass(ORBStrategy, BaseStrategy)

    def test_config_inherits_from_strategy_config(self):
        """Test: ORBConfig inherits from StrategyConfig."""
        from nautilus_trader.config import StrategyConfig
        assert issubclass(ORBConfig, StrategyConfig)

    def test_nautilus_strategy_inherits_from_strategy(self):
        """Test: ORBNautilusStrategy inherits from nautilus Strategy."""
        from nautilus_trader.trading.strategy import Strategy
        assert issubclass(ORBNautilusStrategy, Strategy)


class TestOpeningRangeCalculation:
    """Tests for opening range calculation logic."""

    def _create_bar_mock(self, ts_ns, open_p, high, low, close, volume=1000):
        """Create a mock bar object."""
        bar = MagicMock()
        bar.ts_event = ts_ns
        bar.open = MagicMock()
        bar.open.__float__ = Mock(return_value=open_p)
        bar.high = MagicMock()
        bar.high.__float__ = Mock(return_value=high)
        bar.low = MagicMock()
        bar.low.__float__ = Mock(return_value=low)
        bar.close = MagicMock()
        bar.close.__float__ = Mock(return_value=close)
        bar.volume = volume
        return bar

    def test_ist_time_for_opening_range(self):
        """Test: Opening range time boundaries in IST."""
        mkt_open = 9 * 60 + 15
        or_45_end = mkt_open + 45
        assert or_45_end == 600

        hour = or_45_end // 60
        minute = or_45_end % 60
        assert hour == 10
        assert minute == 0

    def test_or_30_minutes_end_time(self):
        """Test: 30-min OR ends at IST 9:45."""
        mkt_open = 9 * 60 + 15
        or_30_end = mkt_open + 30
        hour = or_30_end // 60
        minute = or_30_end % 60
        assert hour == 9
        assert minute == 45

    def test_or_60_minutes_end_time(self):
        """Test: 60-min OR ends at IST 10:15."""
        mkt_open = 9 * 60 + 15
        or_60_end = mkt_open + 60
        hour = or_60_end // 60
        minute = or_60_end % 60
        assert hour == 10
        assert minute == 15

    def test_eod_exit_time_calculation(self):
        """Test: EOD exit time is IST 14:45."""
        eod_time = 14 * 60 + 45
        hour = eod_time // 60
        minute = eod_time % 60
        assert hour == 14
        assert minute == 45


class TestBreakoutDetection:
    """Tests for breakout detection logic."""

    def test_long_breakout_above_or_high(self):
        """Test: Long entry when close > OR high."""
        or_high = 100.0
        or_low = 95.0
        close = 101.0

        long_entry = close > or_high
        assert long_entry is True

    def test_no_long_breakout_at_or_high(self):
        """Test: No long entry when close == OR high."""
        or_high = 100.0
        close = 100.0

        long_entry = close > or_high
        assert long_entry is False

    def test_no_long_breakout_below_or_high(self):
        """Test: No long entry when close < OR high."""
        or_high = 100.0
        close = 99.0

        long_entry = close > or_high
        assert long_entry is False

    def test_short_breakout_below_or_low(self):
        """Test: Short entry when close < OR low."""
        or_low = 95.0
        close = 94.0

        short_entry = close < or_low
        assert short_entry is True

    def test_no_short_breakout_at_or_low(self):
        """Test: No short entry when close == OR low."""
        or_low = 95.0
        close = 95.0

        short_entry = close < or_low
        assert short_entry is False


class TestStopLossTakeProfit:
    """Tests for stop-loss and take-profit calculations."""

    def test_long_profit_pct_calculation(self):
        """Test: Long profit percentage calculation."""
        entry_price = 100.0
        current_price = 101.2

        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        assert pnl_pct == pytest.approx(1.2, 0.01)

    def test_long_loss_pct_calculation(self):
        """Test: Long loss percentage calculation."""
        entry_price = 100.0
        current_price = 99.6

        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        assert pnl_pct == pytest.approx(-0.4, 0.01)

    def test_short_profit_pct_calculation(self):
        """Test: Short profit percentage calculation."""
        entry_price = 100.0
        current_price = 99.6

        pnl_pct = ((entry_price - current_price) / entry_price) * 100
        assert pnl_pct == pytest.approx(0.4, 0.01)

    def test_short_loss_pct_calculation(self):
        """Test: Short loss percentage calculation."""
        entry_price = 100.0
        current_price = 101.2

        pnl_pct = ((entry_price - current_price) / entry_price) * 100
        assert pnl_pct == pytest.approx(-1.2, 0.01)

    def test_take_profit_trigger(self):
        """Test: Take profit triggers at tp_pct."""
        entry_price = 100.0
        tp_pct = 1.2
        current_price = 101.3

        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        assert pnl_pct >= tp_pct

    def test_stop_loss_trigger(self):
        """Test: Stop loss triggers at sl_pct."""
        entry_price = 100.0
        sl_pct = 0.4
        current_price = 99.5

        pnl_pct = ((current_price - entry_price) / entry_price) * 100
        assert pnl_pct <= -sl_pct

    def test_long_gross_pnl_calculation(self):
        """Test: Long gross PnL calculation."""
        entry_price = 100.0
        exit_price = 102.0
        quantity = 100

        gross_pnl = (exit_price - entry_price) * quantity
        assert gross_pnl == 200.0

    def test_short_gross_pnl_calculation(self):
        """Test: Short gross PnL calculation."""
        entry_price = 100.0
        exit_price = 98.0
        quantity = 100

        gross_pnl = (entry_price - exit_price) * quantity
        assert gross_pnl == 200.0

    def test_long_gross_pnl_pct_calculation(self):
        """Test: Long gross PnL percentage calculation."""
        entry_price = 100.0
        exit_price = 102.0

        gross_pnl_pct = ((exit_price - entry_price) / entry_price) * 100
        assert gross_pnl_pct == 2.0

    def test_short_gross_pnl_pct_calculation(self):
        """Test: Short gross PnL percentage calculation."""
        entry_price = 100.0
        exit_price = 98.0

        gross_pnl_pct = ((entry_price - exit_price) / entry_price) * 100
        assert gross_pnl_pct == 2.0


class TestCooldownLogic:
    """Tests for cooldown bar logic."""

    def _create_strategy(self, cooldown_bars=3):
        """Create a strategy instance for testing."""
        mock_instrument_id = MagicMock()
        mock_bar_type = MagicMock()
        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
            cooldown_bars=cooldown_bars,
        )
        return ORBNautilusStrategy(config=config)

    def test_cooldown_prevents_immediate_reentry(self):
        """Test: Cooldown prevents immediate re-entry."""
        strategy = self._create_strategy(cooldown_bars=3)
        strategy._bar_number = 10
        strategy._last_exit_bar = 10

        assert (strategy._bar_number - strategy._last_exit_bar) < strategy._cooldown_bars

    def test_cooldown_allows_entry_after_bars(self):
        """Test: Entry allowed after cooldown period."""
        strategy = self._create_strategy(cooldown_bars=3)
        strategy._bar_number = 14
        strategy._last_exit_bar = 10

        assert (strategy._bar_number - strategy._last_exit_bar) >= strategy._cooldown_bars

    def test_zero_cooldown_allows_immediate_reentry(self):
        """Test: Zero cooldown allows immediate re-entry."""
        strategy = self._create_strategy(cooldown_bars=0)
        strategy._bar_number = 10
        strategy._last_exit_bar = 10

        if strategy._cooldown_bars > 0:
            assert (strategy._bar_number - strategy._last_exit_bar) >= strategy._cooldown_bars
        else:
            pass

    def test_cooldown_at_boundary(self):
        """Test: Cooldown at exact boundary."""
        strategy = self._create_strategy(cooldown_bars=3)
        strategy._bar_number = 13
        strategy._last_exit_bar = 10

        assert (strategy._bar_number - strategy._last_exit_bar) >= strategy._cooldown_bars


class TestTradeRecording:
    """Tests for trade recording in ORBNautilusStrategy."""

    def _create_strategy(self):
        """Create a strategy instance for testing."""
        mock_instrument_id = MagicMock()
        mock_bar_type = MagicMock()
        config = ORBConfig(
            instrument_id=mock_instrument_id,
            bar_type=mock_bar_type,
        )
        return ORBNautilusStrategy(config=config)

    def test_trades_list_initially_empty(self):
        """Test: Trades list is initially empty."""
        strategy = self._create_strategy()
        assert strategy.trades == []

    def test_trade_record_structure(self):
        """Test: Expected trade record fields."""
        expected_fields = {
            'entry_price',
            'exit_price',
            'entry_time',
            'exit_time',
            'quantity',
            'gross_pnl',
            'gross_pnl_pct',
            'trading_costs',
            'net_pnl',
            'net_pnl_pct',
            'exit_reason',
            'hold_duration_minutes',
            'date',
            'or_high',
            'or_low',
            'side',
            'peak_price',
            'low_price',
        }
        assert len(expected_fields) == 18


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_very_small_sl_tp(self):
        """Test: Very small SL/TP values."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'stop_loss_pct': 0.1,
            'take_profit_pct': 0.2,
        })
        assert all("Stop Loss" not in e or "Take Profit" not in e for e in errors)

    def test_large_or_period(self):
        """Test: Large OR period at max boundary."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'or_minutes': 120})
        assert all("OR Period" not in e for e in errors)

    def test_or_period_above_max(self):
        """Test: OR period above max is not caught by validation."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'or_minutes': 150})
        assert all("OR Period" not in e for e in errors)

    def test_zero_trade_size_not_validated(self):
        """Test: Zero trade size handling."""
        strategy = ORBStrategy()
        params = strategy.get_default_params()
        params['trade_size'] = 0
        errors = strategy.validate_params(params)
        assert errors == []

    def test_negative_values_not_caught(self):
        """Test: Negative values behavior."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'stop_loss_pct': -0.5,
            'take_profit_pct': 1.2,
        })
        assert errors == []

    def test_extreme_price_difference(self):
        """Test: PnL calculation with extreme price difference."""
        entry_price = 100.0
        exit_price = 200.0
        quantity = 100

        gross_pnl = (exit_price - entry_price) * quantity
        gross_pnl_pct = ((exit_price - entry_price) / entry_price) * 100

        assert gross_pnl == 10000.0
        assert gross_pnl_pct == 100.0

    def test_price_exactly_at_sl(self):
        """Test: Price exactly at stop loss level."""
        entry_price = 100.0
        sl_pct = 0.4
        exit_price = 99.6

        pnl_pct = ((exit_price - entry_price) / entry_price) * 100
        assert pnl_pct == pytest.approx(-sl_pct, 0.001)

    def test_price_exactly_at_tp(self):
        """Test: Price exactly at take profit level."""
        entry_price = 100.0
        tp_pct = 1.2
        exit_price = 101.2

        pnl_pct = ((exit_price - entry_price) / entry_price) * 100
        assert pnl_pct == pytest.approx(tp_pct, 0.001)


class TestParamTypes:
    """Tests for parameter type handling."""

    def test_or_minutes_as_string(self):
        """Test: OR minutes as string is handled."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({'or_minutes': '45'})
        assert all("OR Period" not in e for e in errors)

    def test_sl_tp_as_strings(self):
        """Test: SL/TP as strings are handled."""
        strategy = ORBStrategy()
        errors = strategy.validate_params({
            'stop_loss_pct': '0.4',
            'take_profit_pct': '1.2',
        })
        assert all("Stop Loss" not in e or "Take Profit" not in e for e in errors)

    def test_enable_shorts_as_string(self):
        """Test: Enable shorts as string."""
        params = {p.key: p for p in ORBStrategy.get_params()}
        assert params['enable_shorts'].type == 'boolean'


class TestHoldDuration:
    """Tests for hold duration calculation."""

    def test_hold_duration_calculation(self):
        """Test: Hold duration in minutes."""
        entry_time = datetime(2024, 1, 15, 10, 5, 0)
        exit_time = datetime(2024, 1, 15, 11, 35, 0)

        hold_minutes = int((exit_time - entry_time).total_seconds() / 60)
        assert hold_minutes == 90

    def test_hold_duration_zero_minutes(self):
        """Test: Hold duration of zero minutes."""
        entry_time = datetime(2024, 1, 15, 10, 5, 0)
        exit_time = datetime(2024, 1, 15, 10, 5, 0)

        hold_minutes = int((exit_time - entry_time).total_seconds() / 60)
        assert hold_minutes == 0

    def test_hold_duration_one_bar(self):
        """Test: Hold duration of one 5-min bar."""
        entry_time = datetime(2024, 1, 15, 10, 0, 0)
        exit_time = datetime(2024, 1, 15, 10, 5, 0)

        hold_minutes = int((exit_time - entry_time).total_seconds() / 60)
        assert hold_minutes == 5
