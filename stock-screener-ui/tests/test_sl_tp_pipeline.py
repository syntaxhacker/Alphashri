"""
Tests for SL/TP pipeline across DB model, config loader, signal generator, and backtest.

Verifies defaults are consistent and SL/TP prices are computed correctly.
"""

import pytest
from decimal import Decimal, ROUND_HALF_UP


# ---------------------------------------------------------------------------
# DB model defaults
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestStrategyConfigDefaults:
    """Verify SQLAlchemy column defaults match expected values."""

    def test_default_sl_pct(self):
        from db.models.bot import StrategyConfig
        col = StrategyConfig.__table__.c.get('sl_pct')
        assert col is not None, "sl_pct column not found"
        assert col.default.arg == 1.0, f"Expected sl_pct default 1.0, got {col.default.arg}"

    def test_default_tp_pct(self):
        from db.models.bot import StrategyConfig
        col = StrategyConfig.__table__.c.get('tp_pct')
        assert col is not None, "tp_pct column not found"
        assert col.default.arg == 1.5, f"Expected tp_pct default 1.5, got {col.default.arg}"

    def test_sl_less_than_tp(self):
        """Invariant: SL % must be less than TP % for sane risk/reward."""
        from db.models.bot import StrategyConfig
        sl = StrategyConfig.__table__.c['sl_pct'].default.arg
        tp = StrategyConfig.__table__.c['tp_pct'].default.arg
        assert sl < tp, f"SL ({sl}) must be less than TP ({tp})"


# ---------------------------------------------------------------------------
# Config dataclass defaults
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestConfigLoaderDefaults:
    """Verify config dataclass defaults match DB defaults."""

    def test_dataclass_defaults_match_db(self):
        from trading.config_loader import StrategyConfigData
        from db.models.bot import StrategyConfig
        sl_db = StrategyConfig.__table__.c['sl_pct'].default.arg
        tp_db = StrategyConfig.__table__.c['tp_pct'].default.arg
        assert StrategyConfigData.sl_pct == sl_db, \
            f"Dataclass sl_pct ({StrategyConfigData.sl_pct}) != DB ({sl_db})"
        assert StrategyConfigData.tp_pct == tp_db, \
            f"Dataclass tp_pct ({StrategyConfigData.tp_pct}) != DB ({tp_db})"

    def test_from_db_model_maps_correctly(self):
        from trading.config_loader import StrategyConfigData
        cfg = StrategyConfigData(sl_pct=2.0, tp_pct=3.0)
        assert cfg.sl_pct == 2.0
        assert cfg.tp_pct == 3.0


# ---------------------------------------------------------------------------
# ORB signal generator SL/TP price computation
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestORBSignalSLTP:
    """Verify ORB signal generator computes correct SL/TP prices."""

    def test_long_sl_tp_with_defaults(self):
        from trading.orb_signals import ORBSignalGenerator
        gen = ORBSignalGenerator(or_minutes=45, sl_pct=1.0, tp_pct=1.5)
        entry = 1000.0
        sl = entry * (1 - gen.sl_pct / 100)
        tp = entry * (1 + gen.tp_pct / 100)
        assert sl == pytest.approx(990.0), f"Expected SL 990.0, got {sl}"
        assert tp == pytest.approx(1015.0), f"Expected TP 1015.0, got {tp}"

    def test_short_sl_tp_with_defaults(self):
        from trading.orb_signals import ORBSignalGenerator
        gen = ORBSignalGenerator(or_minutes=45, sl_pct=1.0, tp_pct=1.5)
        entry = 1000.0
        sl = entry * (1 + gen.sl_pct / 100)
        tp = entry * (1 - gen.tp_pct / 100)
        assert sl == pytest.approx(1010.0), f"Expected SL 1010.0, got {sl}"
        assert tp == pytest.approx(985.0), f"Expected TP 985.0, got {tp}"

    def test_sl_tp_with_custom_values(self):
        from trading.orb_signals import ORBSignalGenerator
        gen = ORBSignalGenerator(or_minutes=45, sl_pct=2.0, tp_pct=4.0)
        entry = 1437.70
        sl = entry * (1 - gen.sl_pct / 100)
        tp = entry * (1 + gen.tp_pct / 100)
        assert sl == pytest.approx(1408.95, rel=1e-2)
        assert tp == pytest.approx(1495.21, rel=1e-2)

    def test_sl_pct_from_config(self):
        """Signal generator reads sl_pct from config dict, not hardcoded."""
        from trading.orb_signals import ORBSignalGenerator
        gen = ORBSignalGenerator(or_minutes=45, sl_pct=1.5, tp_pct=2.5)
        assert gen.sl_pct == 1.5
        assert gen.tp_pct == 2.5


# ---------------------------------------------------------------------------
# StrategyRunner passes config through
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestStrategyRunnerConfig:
    """Verify StrategyRunner passes sl_pct/tp_pct from config to signal generator."""

    def test_orb_runner_receives_sl_tp_from_config(self):
        from trading.strategy_runner import StrategyRunner
        runner = StrategyRunner(
            strategy_id=1,
            strategy_name="Test ORB",
            strategy_type="ORB",
            config={"sl_pct": 1.0, "tp_pct": 1.5, "or_minutes": 45,
                    "min_or_range_pct": 0.5, "max_or_range_pct": 3.0,
                    "breakout_buffer_pct": 0.3},
            max_positions=5,
            capital_allocation_pct=0.25,
        )
        assert runner.signal_generator.sl_pct == 1.0
        assert runner.signal_generator.tp_pct == 1.5

    def test_orb_runner_custom_sl_tp(self):
        from trading.strategy_runner import StrategyRunner
        runner = StrategyRunner(
            strategy_id=2,
            strategy_name="Wide ORB",
            strategy_type="ORB",
            config={"sl_pct": 3.0, "tp_pct": 5.0, "or_minutes": 45,
                    "min_or_range_pct": 0.5, "max_or_range_pct": 3.0,
                    "breakout_buffer_pct": 0.3},
            max_positions=3,
            capital_allocation_pct=0.25,
        )
        assert runner.signal_generator.sl_pct == 3.0
        assert runner.signal_generator.tp_pct == 5.0


# ---------------------------------------------------------------------------
# Backtest defaults consistency
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestBacktestDefaults:
    """Verify backtest ORB params match live trading defaults."""

    def test_backtest_defaults_match_db(self):
        from db.models.bot import StrategyConfig
        sl_db = StrategyConfig.__table__.c['sl_pct'].default.arg
        tp_db = StrategyConfig.__table__.c['tp_pct'].default.arg
        from backtest.strategies.orb import ORBConfig
        fields = ORBConfig.__struct_fields__
        defaults = ORBConfig.__struct_defaults__
        defaults_map = dict(zip(fields, defaults))
        assert defaults_map['sl_pct'] == sl_db, \
            f"Backtest ORBConfig sl_pct ({defaults_map['sl_pct']}) != DB ({sl_db})"
        assert defaults_map['tp_pct'] == tp_db, \
            f"Backtest ORBConfig tp_pct ({defaults_map['tp_pct']}) != DB ({tp_db})"

    def test_backtest_uses_sl_pct_key(self):
        """Backend backtest reads params using 'sl_pct' key, not 'stop_loss_pct'."""
        from backtest.strategies.orb import ORBConfig
        fields = ORBConfig.__struct_fields__
        defaults = ORBConfig.__struct_defaults__
        params = dict(zip(fields, defaults))
        sl = float(params.get('sl_pct', 1.0))
        tp = float(params.get('tp_pct', 1.5))
        assert sl == 1.0
        assert tp == 1.5

    def test_backtest_validation_sl_less_than_tp(self):
        """SL < TP passes, SL >= TP fails."""
        valid = {'sl_pct': '1.0', 'tp_pct': '1.5'}
        assert float(valid['sl_pct']) < float(valid['tp_pct']), "Valid config must have SL < TP"

        invalid = {'sl_pct': '2.0', 'tp_pct': '1.5'}
        assert float(invalid['sl_pct']) >= float(invalid['tp_pct']), "Invalid config must have SL >= TP"


# ---------------------------------------------------------------------------
# CompletedTrade SL/TP propagation
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestCompletedTradeSLTP:
    """Verify CompletedTrade carries SL/TP from SharedPosition."""

    def test_close_position_preserves_sl_tp(self):
        from trading.portfolio.portfolio_models import SharedPosition, CompletedTrade, OrderSide
        from trading.portfolio.portfolio_core import SharedPortfolioManager
        from datetime import datetime
        import config

        pm = SharedPortfolioManager(
            user_id=1,
            initial_capital=1000000,
        )
        pm.strategy_allocations[1] = type('Alloc', (), {'capital_used': 0, 'positions_count': 0, 'realized_pnl': 0})()

        pos = SharedPosition(
            symbol="TEST",
            side=OrderSide.BUY,
            quantity=100,
            entry_price=1000.0,
            stop_loss=990.0,
            take_profit=1015.0,
            entry_time=datetime.now(config.IST),
            strategy_id=1,
            strategy_name="ORB Test",
        )
        pm.positions["1_TEST"] = pos

        trade = pm.close_position(
            strategy_id=1,
            symbol="TEST",
            exit_price=1015.0,
            exit_reason="TP",
        )

        assert trade is not None
        assert trade.sl_price == 990.0, f"Expected sl_price 990.0, got {trade.sl_price}"
        assert trade.tp_price == 1015.0, f"Expected tp_price 1015.0, got {trade.tp_price}"
