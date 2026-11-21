"""Contract tests for the pure-Python nautilus_trader shim (no network/DB)."""

import sys

import numpy as np
import pandas as pd
import pytest

from backtest.sim import install, is_installed, uninstall


@pytest.fixture(scope="module", autouse=True)
def shim():
    install()
    assert is_installed()
    yield
    uninstall()
    assert not is_installed()


@pytest.fixture(scope="module")
def bars_df():
    index = pd.date_range("2026-01-05T03:45:00Z", periods=30, freq="1min", tz="UTC").as_unit("ns")
    closes = 100.0 + np.arange(30, dtype=float)
    return pd.DataFrame(
        {
            "open": closes - 0.25,
            "high": closes + 0.75,
            "low": closes - 0.75,
            "close": closes,
            "volume": np.full(30, 1000, dtype=np.int64),
        },
        index=index,
    )


def test_a_install_and_wrangler_preserves_nanoseconds(bars_df):
    import nautilus_trader
    from nautilus_trader.persistence.wranglers import BarDataWrangler

    assert getattr(nautilus_trader, "_SIM_SHIM", False) is True
    assert sys.modules["nautilus_trader"] is nautilus_trader

    bars = BarDataWrangler().process(bars_df)
    assert len(bars) == 30
    assert [bar.ts_event for bar in bars] == [int(v) for v in bars_df.index.asi8]
    assert [bar.ts_init for bar in bars] == [int(v) for v in bars_df.index.asi8]
    assert float(bars[0].close) == 100.0
    assert float(bars[-1].close) == 129.0


def test_b_engine_runs_strategy_with_position_lifecycle(bars_df):
    from nautilus_trader.backtest.config import BacktestEngineConfig
    from nautilus_trader.backtest.engine import BacktestEngine
    from nautilus_trader.model.enums import OrderSide
    from nautilus_trader.model.objects import Quantity
    from nautilus_trader.persistence.wranglers import BarDataWrangler
    from nautilus_trader.trading.strategy import Strategy

    class Recorder(Strategy):
        def __init__(self, config):
            super().__init__(config)
            self.events = []
            self.started_at = None

        def on_start(self):
            self.started_at = len(self.events)
            self.subscribe_bars("ANY.SIMULATED-1-MINUTE-LAST-EXTERNAL")

        def on_bar(self, bar):
            index = len(self.events)
            if index == 3:
                order = self.order_factory.market(
                    instrument_id="TEST.SIMULATED",
                    order_side=OrderSide.BUY,
                    quantity=Quantity.from_str("10"),
                )
                self.submit_order(order)
            elif index == 5:
                self.close_all_positions("TEST.SIMULATED")
            self.events.append(
                (bar.ts_event, float(bar.close), bool(self.cache.positions_open()))
            )

    bars = BarDataWrangler().process(bars_df)
    strategy = Recorder(config=None)
    engine = BacktestEngine(config=BacktestEngineConfig())
    engine.add_venue(venue=None)
    engine.add_instrument(None)
    engine.add_data(bars)
    engine.add_strategy(strategy=strategy)
    engine.run()
    engine.dispose()

    assert strategy.started_at == 0
    assert len(strategy.events) == 30
    expected = [
        (int(ts), float(close), 3 <= i <= 4)
        for i, (ts, close) in enumerate(
            zip(bars_df.index.asi8, bars_df["close"].to_numpy())
        )
    ]
    assert strategy.events == expected

    with pytest.raises(RuntimeError, match="only be called once"):
        engine.run()


def test_c_numeric_objects_match_strategy_usage():
    from nautilus_trader.model import Money
    from nautilus_trader.model.currencies import INR
    from nautilus_trader.model.objects import Price, Quantity

    price = Price.from_str("105.25")
    qty = Quantity.from_str("10")

    assert float(price) == 105.25
    assert int(price) == 105
    assert int(float(qty)) == 10
    assert float(qty) == 10.0
    assert str(price) == "105.25"
    assert str(Quantity.from_str("1")) == "1"

    assert price > 100.0
    assert price >= 105.25
    assert 100.0 < price
    assert price == 105.25
    assert price + 5.0 == 110.25
    assert 5.0 + price == 110.25
    assert price - 5.0 == 100.25
    assert 110.25 - price == 5.0
    assert price * 2 == 210.5
    assert 2 * price == 210.5
    assert price + qty == 115.25
    assert qty * 10 == 100.0
    assert float(Money(1_000_000, INR)) == 1_000_000.0
    assert str(Money(1_000_000, INR)) == "1000000 INR"


def test_install_replaces_already_imported_real_submodules():
    uninstall()
    try:
        try:
            import nautilus_trader.backtest.engine as real_engine
        except ImportError:
            pytest.skip("real nautilus_trader is not installed")

        real = sys.modules["nautilus_trader.backtest.engine"]
        assert getattr(real_engine, "_SIM_SHIM", False) is not True

        install()
        assert is_installed()
        replacement = sys.modules["nautilus_trader.backtest.engine"]
        assert replacement is not real
        assert getattr(replacement, "_SIM_SHIM", False) is True

        uninstall()
        assert not is_installed()
        assert sys.modules.get("nautilus_trader.backtest.engine") is real
    finally:
        if not is_installed():
            install()
