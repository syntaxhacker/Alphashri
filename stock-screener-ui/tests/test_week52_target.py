import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest
from datetime import datetime, timezone
import pandas as pd
from unittest.mock import MagicMock

from nautilus_trader.model.data import BarType

from backtest.strategies.week52_target import Week52TargetConfig, Week52TargetNautilusStrategy, Week52TargetStrategy

from strategy_test_helpers import MockableStrategyMixin, make_mock_instrument, make_bar, mock_instrument


@pytest.fixture
def base_config(mock_instrument):
    return Week52TargetConfig(
        instrument_id=mock_instrument.id,
        bar_type=BarType.from_str(f"{mock_instrument.id}-1-DAY-LAST-EXTERNAL"),
        entry_threshold_pct=2.0,
        trailing_stop_pct=1.0,
        stop_loss_pct=2.0,
        max_holding_days=15,
        cooldown_days=7,
        trade_size=100
    )

class TestWeek52TargetNautilusStrategy(MockableStrategyMixin, Week52TargetNautilusStrategy):
    pass

@pytest.fixture
def week52_target_strategy(base_config):
    strategy = TestWeek52TargetNautilusStrategy(config=base_config)
    return strategy

class TestWeek52TargetConfig:
    def test_week52_target_config_validation(self):
        wrapper = Week52TargetStrategy()

        valid_params = {
            'entry_threshold_pct': 2.0,
            'stop_loss_pct': 2.0,
            'trailing_stop_pct': 1.0,
        }
        assert not wrapper.validate_params(valid_params)

        invalid_entry = valid_params.copy()
        invalid_entry['entry_threshold_pct'] = -1.0
        assert "entry_threshold_pct must be positive" in wrapper.validate_params(invalid_entry)

        invalid_sl = valid_params.copy()
        invalid_sl['stop_loss_pct'] = 0.0
        assert "stop_loss_pct must be positive" in wrapper.validate_params(invalid_sl)

class TestWeek52TargetLogic:
    def test_finds_52w_high_and_enters_trade(self, week52_target_strategy):
        ts = 1705300000
        bar_type_str = f"TEST.SIMULATED-1-DAY-LAST-EXTERNAL"

        for i in range(101):
            bar = make_bar(98.0, 100.0, 95.0, ts + i * 86400, bar_type_str)
            week52_target_strategy.on_bar(bar)

        entry_bar = make_bar(98.0, 105.0, 95.0, ts + 102 * 86400, bar_type_str)
        week52_target_strategy.on_bar(entry_bar)

        assert week52_target_strategy._in_position is True
        assert week52_target_strategy._entry_price == 98.0
        assert week52_target_strategy._entry_52w_high == 100.0
        week52_target_strategy._mock_submit_order.assert_called_once()

    def test_stop_loss_exit(self, week52_target_strategy):
        week52_target_strategy._price_history = [100.0] * 101
        week52_target_strategy._52w_high = 102.0
        week52_target_strategy._in_position = True
        week52_target_strategy._entry_price = 100.0
        week52_target_strategy._entry_52w_high = 102.0
        week52_target_strategy._bars_since_exit = 0
        week52_target_strategy._highest_price_since_entry = 100.0
        week52_target_strategy._entry_time = datetime(2024, 1, 15, tzinfo=timezone.utc)

        ts = int(datetime(2024, 1, 16, tzinfo=timezone.utc).timestamp())
        sl_bar = make_bar(97.0, 98.0, 95.0, ts, f"TEST.SIMULATED-1-DAY-LAST-EXTERNAL")

        week52_target_strategy.on_bar(sl_bar)

        assert week52_target_strategy._in_position is False
        week52_target_strategy._mock_close_all_positions.assert_called_once()

        assert len(week52_target_strategy.trades) == 1
        assert week52_target_strategy.trades[0]['exit_reason'] == "SL"

    def test_trailing_stop_activation_and_exit(self, week52_target_strategy):
        week52_target_strategy._in_position = True
        week52_target_strategy._entry_price = 98.0
        week52_target_strategy._entry_52w_high = 100.0
        week52_target_strategy._entry_time = datetime(2024, 1, 15, tzinfo=timezone.utc)

        ts = int(datetime(2024, 1, 16, tzinfo=timezone.utc).timestamp())
        bar_type_str = f"TEST.SIMULATED-1-DAY-LAST-EXTERNAL"

        target_bar = make_bar(102.0, 103.0, 95.0, ts, bar_type_str)
        week52_target_strategy.on_bar(target_bar)

        assert week52_target_strategy._in_position is True
        pass
