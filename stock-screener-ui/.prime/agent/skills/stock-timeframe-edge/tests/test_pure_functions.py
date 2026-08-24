"""Known-answer tests for pure helpers + simulation functions.

Run:  source .venv/bin/activate && python -m pytest .prime/agent/skills/stock-timeframe-edge/tests/ -v
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import generate_timeframe_edge_report as gte  # noqa: E402


def make_bars(prices, freq_min=5):
    """Synthetic OHLCV bars from a close-price path; open=prev close, high/low bracket both."""
    p = np.asarray(prices, dtype=float)
    o = np.concatenate([[p[0]], p[:-1]])
    hi = np.maximum(o, p) * 1.0005
    lo = np.minimum(o, p) * 0.9995
    start = pd.Timestamp("2025-01-06 09:15", tz=gte.IST)
    ts = []
    day = 0
    for i in range(len(p)):
        d = pd.Timedelta(days=day)
        t = start + d + pd.Timedelta(minutes=freq_min * i)
        if freq_min * i >= gte.MARKET_MINUTES:  # roll to next trading day
            day += 1
            t = start + pd.Timedelta(days=day) + pd.Timedelta(minutes=freq_min * (i % (gte.MARKET_MINUTES // freq_min)))
        ts.append(t.tz_convert("UTC"))
    idx = pd.DatetimeIndex(ts, name="ts")
    return pd.DataFrame({"open": o, "high": hi, "low": lo, "close": p,
                         "volume": np.full(len(p), 1000.0)}, index=idx)


# ---------------------------------------------------------------- pure helpers
class TestProfitFactor:
    def test_basic_ratio(self):
        assert gte.profit_factor([0.02, -0.01, 0.03]) == pytest.approx(5.0)

    def test_no_losses_is_inf(self):
        assert gte.profit_factor([0.01, 0.02]) == float("inf")

    def test_all_losses(self):
        assert gte.profit_factor([-0.01, -0.02]) == 0.0

    def test_empty_nan(self):
        assert np.isnan(gte.profit_factor([]))
        assert np.isnan(gte.profit_factor([]))


class TestWinRate:
    def test_half(self):
        assert gte.win_rate([0.01, -0.01]) == pytest.approx(50.0)

    def test_zero_return_not_a_win(self):
        assert gte.win_rate([0.0, 0.01]) == pytest.approx(50.0)


class TestClassifyEntrySession:
    def test_open_bucket(self):
        assert gte.classify_entry_session(9 * 60 + 20) == "open"
        assert gte.classify_entry_session(10 * 60 + 29) == "open"

    def test_boundary_75min(self):
        assert gte.classify_entry_session(9 * 60 + 15 + 75 - 1) == "open"
        assert gte.classify_entry_session(9 * 60 + 15 + 75) == "midday"

    def test_close_bucket(self):
        assert gte.classify_entry_session(14 * 60) == "close"
        assert gte.classify_entry_session(15 * 60 + 29) == "close"

    def test_offhours(self):
        assert gte.classify_entry_session(8 * 60) == "offhours"
        assert gte.classify_entry_session(16 * 60) == "offhours"


class TestAnchoredResample:
    def _day_bars(self, n=75):
        """One full trading day of 5m bars (75 bars), flat prices."""
        start = pd.Timestamp("2025-01-06 09:15", tz=gte.IST)
        ts = [start + pd.Timedelta(minutes=5 * i) for i in range(n)]
        idx = pd.DatetimeIndex(ts).tz_convert("UTC")
        return pd.DataFrame({"open": 100.0, "high": 101.0, "low": 99.0,
                             "close": 100.0, "volume": 10.0}, index=idx)

    def test_4h_two_blocks_per_day(self):
        out = gte.anchored_resample(self._day_bars(), 240)
        assert len(out) == 2
        assert list(out["volume"]) == [480.0, 270.0]  # 48 bars + 27 bars per block

    def test_block_aggregation_values(self):
        out = gte.anchored_resample(self._day_bars(), 60)
        assert len(out) == 7  # 6 full hours + 15-min remainder
        assert out["open"].iloc[0] == 100.0 and out["close"].iloc[-1] == 100.0

    def test_outside_market_hours_dropped(self):
        df = self._day_bars()
        extra = df.copy()
        extra.index = extra.index + pd.Timedelta(hours=16)
        out = gte.anchored_resample(pd.concat([df, extra]), 240)
        assert len(out) == 2


# ---------------------------------------------------------------- simulations
class TestSimulateTrades:
    def test_rising_series_positive_pf(self):
        bars = make_bars(np.linspace(100, 200, 300))
        rets, entries = gte.simulate_trades(bars, 1, cost_rt=0.0)
        assert len(rets) > 100
        assert gte.profit_factor(rets) == float("inf")
        assert (rets > 0).mean() > 0.99

    def test_costs_subtracted(self):
        bars = make_bars(np.linspace(100, 110, 50))
        r_net, _ = gte.simulate_trades(bars, 1, cost_rt=0.0012)
        r_gross, _ = gte.simulate_trades(bars, 1, cost_rt=0.0)
        assert np.allclose(r_net, r_gross - 0.0012)

    def test_same_day_enforced(self):
        bars = make_bars(np.linspace(100, 200, 160))  # crosses into day 2 at bar 75+
        rets, _ = gte.simulate_trades(bars, 3, cost_rt=0.0)
        # every trade's window must stay inside one day -> count < all possible windows
        assert len(rets) < len(bars) - 2

    def test_stop_loss_triggers_at_level(self):
        # entry open=100, then a bar that dips to 98.9 -> 1% stop (99.0) fills at 99.0
        p = [100.0]
        o = [99.99]
        bars = make_bars([100.0])
        idx = [bars.index[0]]
        rows = [{"open": 100.0, "high": 100.1, "low": 99.9, "close": 100.0, "volume": 1}]
        rows.append({"open": 100.0, "high": 100.2, "low": 97.0, "close": 99.5, "volume": 1})
        rows.append({"open": 99.5, "high": 99.6, "low": 99.0, "close": 99.3, "volume": 1})
        start = pd.Timestamp("2025-01-06 09:15", tz=gte.IST)
        idx = pd.DatetimeIndex([(start + pd.Timedelta(minutes=5 * i)).tz_convert("UTC") for i in range(3)])
        bars = pd.DataFrame(rows, index=idx)
        rets, _ = gte.simulate_trades(bars, 3, cost_rt=0.0, stop=0.01)
        assert rets[0] == pytest.approx(-0.01)

    def test_gap_through_stop_fills_at_worse_open(self):
        rows = [{"open": 100.0, "high": 100.1, "low": 99.9, "close": 100.0, "volume": 1},
                {"open": 95.0, "high": 95.2, "low": 94.8, "close": 95.0, "volume": 1}]
        start = pd.Timestamp("2025-01-06 09:15", tz=gte.IST)
        idx = pd.DatetimeIndex([(start + pd.Timedelta(minutes=5 * i)).tz_convert("UTC") for i in range(2)])
        bars = pd.DataFrame(rows, index=idx)
        rets, _ = gte.simulate_trades(bars, 2, cost_rt=0.0, stop=0.01)
        assert rets[0] == pytest.approx(-0.05)  # filled at the 95.0 gap open, not at 99.0

    def test_take_profit_triggers(self):
        rows = [{"open": 100.0, "high": 100.1, "low": 99.9, "close": 100.0, "volume": 1},
                {"open": 100.0, "high": 103.0, "low": 99.9, "close": 102.0, "volume": 1},
                {"open": 102.0, "high": 102.1, "low": 101.9, "close": 101.0, "volume": 1}]
        start = pd.Timestamp("2025-01-06 09:15", tz=gte.IST)
        idx = pd.DatetimeIndex([(start + pd.Timedelta(minutes=5 * i)).tz_convert("UTC") for i in range(3)])
        bars = pd.DataFrame(rows, index=idx)
        rets, _ = gte.simulate_trades(bars, 3, cost_rt=0.0, tp=0.02)
        assert rets[0] == pytest.approx(0.02)


class TestDailySims:
    def _daily(self):
        idx = pd.bdate_range("2025-01-01", periods=30)
        return pd.DataFrame({
            "open": np.linspace(100, 130, 30),
            "high": np.linspace(101, 131, 30),
            "low": np.linspace(99, 129, 30),
            "close": np.linspace(100.5, 130.5, 30),
            "volume": np.full(30, 1e6),
        }, index=idx)

    def test_daily_horizon_count(self):
        rets, entries = gte.simulate_daily_trades(self._daily(), 5, cost_rt=0.0)
        assert len(rets) == 26

    def test_overnight_pairs_adjacent_days(self):
        rets, entries = gte.simulate_overnight_trades(self._daily(), cost_rt=0.0)
        assert len(rets) == 29
        d = self._daily()
        expect = d["open"].iloc[1] / d["close"].iloc[0] - 1
        assert rets[0] == pytest.approx(expect)


class TestStats:
    def test_trade_stats_fields(self):
        s = gte.trade_stats("1d", np.array([0.02, -0.01, 0.03, 0.01]), holding_days=1.0, cost_rt=0.0)
        assert s["n"] == 4
        assert s["win_pct"] == 75.0
        assert s["pf"] == pytest.approx(6.0)
        assert np.isfinite(s["t_stat"])

    def test_mc_sample_deterministic_and_full(self):
        r = np.arange(100, dtype=float)
        s1 = gte.mc_sample(r, 50, seed=7)
        s2 = gte.mc_sample(r, 50, seed=7)
        assert len(s1) == 50 and np.array_equal(np.sort(s1), np.sort(s2))
        assert len(gte.mc_sample(r, 500, seed=7)) == 100  # returns everything when fewer entries

    def test_bootstrap_ci_brackets_point_estimate(self):
        rng = np.random.default_rng(0)
        r = rng.normal(0.001, 0.01, 400)
        lo, hi = gte.bootstrap_pf_ci(r, n_boot=300, seed=1)
        pf = gte.profit_factor(r)
        assert lo <= pf <= hi


class TestSessionBuckets:
    def test_chain_reproduces_day_move(self):
        # one day of 75 5m bars rising linearly 100->105
        n = 75
        closes = np.linspace(100, 105, n)
        bars = make_bars(closes)
        sess = gte.session_daily_table(bars)
        assert len(sess) == 1
        chain = (1 + sess["open_ret"].iloc[0]) * (1 + sess["mid_ret"].iloc[0]) * (1 + sess["close_ret"].iloc[0])
        day_move = closes[-1] / closes[0]
        assert chain == pytest.approx(day_move, rel=1e-6)

    def test_volume_shares_sum_to_one(self):
        bars = make_bars(np.linspace(100, 105, 75))
        sess = gte.session_daily_table(bars)
        total = sess[["vol_open", "vol_mid", "vol_close"]].iloc[0].sum()
        assert total == pytest.approx(1.0)


class TestRegimeSplit:
    def test_up_down_split(self):
        idx = pd.bdate_range("2025-01-01", periods=10)
        daily = pd.DataFrame({"close": np.concatenate([np.full(5, 90.0), np.full(5, 110.0)])}, index=idx)
        reg = gte.regime_series(daily, window=4)
        entries = pd.DatetimeIndex(idx[3:])
        rets = np.array([0.01, -0.02, -0.01, 0.005, 0.02, 0.03, 0.01])
        up_pf, dn_pf = gte.regime_split_pf(reg, rets, entries)
        # first entries land down-regime (prev close 90 vs SMA~90), later ones up-regime
        assert np.isfinite(dn_pf) and dn_pf < 1.0
        assert up_pf == float("inf")  # all up-regime trades are wins

    def test_tz_entries_handled(self):
        idx = pd.bdate_range("2025-01-01", periods=10)
        daily = pd.DataFrame({"close": np.linspace(100, 120, 10)}, index=idx)
        reg = gte.regime_series(daily, window=3)
        entries = pd.DatetimeIndex([t.tz_localize(gte.IST) for t in idx[4:]])
        rets = np.array([0.01, -0.005, 0.02, -0.001, 0.03, 0.01])
        up_pf, dn_pf = gte.regime_split_pf(reg, rets, entries)
        assert np.isfinite(up_pf) or np.isfinite(dn_pf)
