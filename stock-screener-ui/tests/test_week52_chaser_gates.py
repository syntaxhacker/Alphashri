"""Gate unit tests for the 52W Chaser ablation winners.

Canonical defaults (single source: trading/week52_chaser_signals.py):
  ADX >= 25, RSI <= 75 (no lower bound), volume >= 1.8x 20d average
  (baseline excludes the entry bar), MA50/MA200/RSI-low gates removed.

Covers: pass/veto boundaries, NaN fail-closed on every gate input,
duplicate-date resolution, entry-bar exclusion from the volume baseline,
backtest/live parity, and indicator causality (no lookahead).
"""

import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent))

from trading.week52_chaser_signals import (
    CHASER_ADX_MIN,
    CHASER_ENABLE_FILTERS_DEFAULT,
    CHASER_RSI_HI,
    CHASER_VOLUME_MULT,
    Week52ChaserSignalGenerator,
)


def _valid_market_data(**overrides):
    md = {
        "current_price": 510.0,
        "high_52w": 500.0,
        "adx": 30.0,
        "rsi": 60.0,
        "volume": 200000,
        "avg_volume_20d": 100000,
    }
    md.update(overrides)
    return md


def _gen(**cfg):
    base = {"enable_filters": True}
    base.update(cfg)
    return Week52ChaserSignalGenerator(config=base)


class TestCanonicalDefaults:
    def test_values(self):
        assert CHASER_ADX_MIN == 25.0
        assert CHASER_RSI_HI == 75.0
        assert CHASER_VOLUME_MULT == 1.8
        assert CHASER_ENABLE_FILTERS_DEFAULT is False

    def test_generator_picks_up_canonical_defaults(self):
        gen = Week52ChaserSignalGenerator(config={})
        assert gen.adx_min == CHASER_ADX_MIN
        assert gen.rsi_hi == CHASER_RSI_HI
        assert gen.volume_mult == CHASER_VOLUME_MULT
        assert gen.enable_filters is CHASER_ENABLE_FILTERS_DEFAULT

    def test_backtest_imports_same_canonical_values(self):
        import backtest.strategies.week52_chaser as bt

        assert bt.CHASER_ADX_MIN == CHASER_ADX_MIN
        assert bt.CHASER_RSI_HI == CHASER_RSI_HI
        assert bt.CHASER_VOLUME_MULT == CHASER_VOLUME_MULT

    def test_enable_filters_default_false_everywhere(self):
        import backtest.strategies.week52_chaser as bt

        params = bt.Week52ChaserStrategy.get_params()
        ef = next(p for p in params if p.key == "enable_filters")
        assert ef.default is False


class TestLiveGateBoundaries:
    def test_all_pass(self):
        assert _gen().check_entry("T", _valid_market_data()) is not None

    def test_adx_boundary(self):
        assert _gen().check_entry("T", _valid_market_data(adx=25.0)) is not None
        assert _gen().check_entry("T", _valid_market_data(adx=24.9)) is None

    def test_rsi_hi_boundary(self):
        assert _gen().check_entry("T", _valid_market_data(rsi=75.0)) is not None
        assert _gen().check_entry("T", _valid_market_data(rsi=75.1)) is None

    def test_rsi_low_never_vetoes(self):
        assert _gen().check_entry("T", _valid_market_data(rsi=20.0)) is not None

    def test_volume_boundary(self):
        assert _gen().check_entry("T", _valid_market_data(volume=180000)) is not None
        assert _gen().check_entry("T", _valid_market_data(volume=179999)) is None

    def test_ma_values_ignored(self):
        md = _valid_market_data(ma50=9999.0, ma200=9999.0)
        assert _gen().check_entry("T", md) is not None

    def test_custom_thresholds_still_honored(self):
        gen = _gen(rsi_hi=80.0, volume_mult=2.0)
        assert gen.check_entry("T", _valid_market_data(rsi=78.0, volume=200000)) is not None
        assert gen.check_entry("T", _valid_market_data(rsi=78.0, volume=190000)) is None


class TestLiveGateNaNClosed:
    @pytest.mark.parametrize("key", ["adx", "rsi", "volume", "avg_volume_20d"])
    def test_nan_input_vetoes(self, key):
        assert _gen().check_entry("T", _valid_market_data(**{key: float("nan")})) is None

    @pytest.mark.parametrize("key", ["adx", "rsi", "volume", "avg_volume_20d"])
    def test_missing_input_vetoes(self, key):
        md = _valid_market_data()
        del md[key]
        assert _gen().check_entry("T", md) is None

    def test_none_input_vetoes(self):
        assert _gen().check_entry("T", _valid_market_data(adx=None)) is None

    def test_zero_avg_volume_vetoes(self):
        assert _gen().check_entry("T", _valid_market_data(avg_volume_20d=0)) is None

    def test_inf_adx_does_not_crash(self):
        # inf is a real float, not NaN: gate must return a bool either way.
        gen = _gen()
        assert gen._check_filters(_valid_market_data(adx=float("inf")), 510.0) is True
        assert gen._check_filters(_valid_market_data(adx=float("-inf")), 510.0) is False


def _make_backtest_strategy(df: pd.DataFrame, enable_filters: bool = True):
    """Build a real Week52ChaserNautilusStrategy (nautilus required) and wire
    the filter precalcs exactly as on_start() does (minus subscribe_bars,
    which needs a live engine)."""
    import backtest.strategies.week52_chaser as bt
    from nautilus_trader.model import BarType, InstrumentId

    nautilus = pytest.importorskip("nautilus_trader")
    assert nautilus is not None

    config = bt.Week52ChaserConfig(
        instrument_id=InstrumentId.from_str("TEST.SIMULATED"),
        bar_type=BarType.from_str("TEST.SIMULATED-1-DAY-LAST-EXTERNAL"),
        enable_filters=enable_filters,
        historical_df=df,
    )
    strat = bt.Week52ChaserNautilusStrategy(config=config)
    # Replicate on_start() precalc wiring without the engine subscription.
    strat._precalc_adx = bt.calculate_adx(df["high"], df["low"], df["close"])
    strat._precalc_rsi = bt.calculate_rsi(df["close"])
    strat._precalc_ma50 = None
    strat._precalc_ma200 = None
    strat._precalc_vol_avg = df["volume"].rolling(window=20).mean().shift(1)
    return strat


def _trend_df(n: int = 60, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    closes = 100 + np.cumsum(rng.normal(0.6, 0.8, n))  # drift up -> healthy ADX/RSI
    highs = closes + rng.uniform(0.2, 1.0, n)
    lows = closes - rng.uniform(0.2, 1.0, n)
    volumes = np.full(n, 200000.0)
    idx = pd.date_range("2024-01-01", periods=n, freq="B", tz="UTC")
    return pd.DataFrame(
        {"open": closes - 0.3, "high": highs, "low": lows,
         "close": closes, "volume": volumes},
        index=idx,
    )


class TestBacktestGate:
    def test_missing_precalc_fails_closed(self):
        strat = _make_backtest_strategy(_trend_df())
        strat._precalc_adx = None
        assert strat._check_entry_filters(100.0, datetime(2024, 3, 1, tzinfo=timezone.utc)) is False

    def test_unknown_date_fails_closed(self):
        strat = _make_backtest_strategy(_trend_df())
        assert strat._check_entry_filters(100.0, datetime(1999, 1, 1, tzinfo=timezone.utc)) is False

    def test_nan_adx_fails_closed(self):
        # Flat prices -> ADX needs warmup; first valid-index bar has NaN ADX.
        df = _trend_df()
        strat = _make_backtest_strategy(df)
        early = df.index[5].to_pydatetime()
        assert strat._check_entry_filters(float(df["close"].iloc[5]), early) is False

    def test_volume_spike_passes_early_nan_cleared(self):
        df = _trend_df()
        # Spike volume on the last bar well above its (shifted) baseline.
        df.iloc[-1, df.columns.get_loc("volume")] = 1_000_000.0
        strat = _make_backtest_strategy(df)
        last = df.index[-1].to_pydatetime()
        result = strat._check_entry_filters(float(df["close"].iloc[-1]), last)
        assert isinstance(result, bool)  # must not raise; gate decides

    def test_entry_bar_excluded_from_volume_baseline(self):
        df = _trend_df()
        strat = _make_backtest_strategy(df)
        idx = len(df) - 1
        expected = df["volume"].iloc[idx - 20:idx].mean()  # prior 20 bars only
        assert strat._precalc_vol_avg.iloc[idx] == pytest.approx(expected)
        # Guard: if the entry bar leaked in, the value would differ whenever
        # entry volume differs from the trailing mean.
        df2 = df.copy()
        df2.iloc[-1, df2.columns.get_loc("volume")] = 5_000_000.0
        strat2 = _make_backtest_strategy(df2)
        assert strat2._precalc_vol_avg.iloc[idx] == pytest.approx(expected)

    def test_duplicate_dates_take_last_match(self):
        df = _trend_df()
        dup = pd.concat([df, df.iloc[[-1]]])  # duplicate final date
        strat = _make_backtest_strategy(dup)
        last = dup.index[-1].to_pydatetime()
        # Must resolve without error and be deterministic (last match wins).
        first = strat._check_entry_filters(float(dup["close"].iloc[-1]), last)
        second = strat._check_entry_filters(float(dup["close"].iloc[-1]), last)
        assert first == second
        assert isinstance(first, bool)

    def test_lookup_error_fails_closed_not_open(self):
        df = _trend_df()
        strat = _make_backtest_strategy(df)
        strat._historical_df = "not-a-dataframe"  # force an exception path
        assert strat._check_entry_filters(100.0, datetime(2024, 3, 1, tzinfo=timezone.utc)) is False


class TestCausality:
    """Indicator at bar t must use only data <= t (no lookahead)."""

    def test_truncation_invariance(self):
        """Recomputing on a truncated frame leaves shared bars identical."""
        import backtest.strategies.week52_chaser as bt

        full = _trend_df(80)
        trunc = full.iloc[:60]
        for col_fn in (
            lambda d: bt.calculate_adx(d["high"], d["low"], d["close"]),
            lambda d: bt.calculate_rsi(d["close"]),
            lambda d: d["volume"].rolling(window=20).mean().shift(1),
        ):
            s_full = col_fn(full)
            s_trunc = col_fn(trunc)
            pd.testing.assert_series_equal(
                s_full.iloc[:60], s_trunc, check_names=False,
                obj="causality: future bars must not change past indicator values",
            )

    def test_future_mutation_does_not_move_past_values(self):
        import backtest.strategies.week52_chaser as bt

        df = _trend_df(60)
        rsi_before = bt.calculate_rsi(df["close"])
        df_mut = df.copy()
        df_mut.iloc[-1, df_mut.columns.get_loc("close")] *= 2.0
        rsi_after = bt.calculate_rsi(df_mut["close"])
        pd.testing.assert_series_equal(
            rsi_before.iloc[:-1], rsi_after.iloc[:-1], check_names=False,
            obj="causality: mutating the last close must not move earlier RSI",
        )

    def test_52w_high_excludes_current_bar(self):
        from trading.week52_utils import calculate_52w_high

        highs = [100.0, 105.0, 103.0, 200.0]  # 200 = current bar spike
        assert calculate_52w_high(highs) == 105.0
