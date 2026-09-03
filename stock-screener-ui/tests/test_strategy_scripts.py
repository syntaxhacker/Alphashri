"""Tests for scripts/nq_ticks.py, scripts/htf_bias.py, trading/smc_chop.py, trading/risk.py.

Synthetic bars/ticks only — no network. yfinance and tick fetches are mocked.
Style follows tests/test_smc_ifvg.py (plain classes, dict bars/ticks).
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

import scripts.nq_ticks as nq_ticks
from scripts.htf_bias import bias_for
from trading.smc_chop import SMCChopEngine
import trading.risk as risk_mod


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

BASIS = 46.0
DAY = "2026-09-01"
BASE_SEC = int(pd.Timestamp(DAY, tz="UTC").timestamp())  # hour-aligned UTC midnight


def _last_mid_per_bucket(ticks, span):
    ref = {}
    for t in ticks:
        k = int(t["timestamp"] // 1000 // span) * span
        ref[k] = (t["bidPrice"] + t["askPrice"]) / 2.0
    return ref


def _ticks_1m(n_min=70, per_min=3, base_px=23000.0):
    """~200 ticks over n_min distinct minute buckets."""
    ticks = []
    for m in range(n_min):
        for k in range(per_min):
            ts = (BASE_SEC + m * 60 + 5 + k * 18) * 1000
            bid = base_px + m * 0.1 + k * 0.01
            ticks.append({"timestamp": ts, "bidPrice": bid, "askPrice": bid + 1.0})
    return ticks


def _ticks_multi_hour(n_hours=13, per_hour=5, base_px=23000.0):
    ticks = []
    for h in range(n_hours):
        for k in range(per_hour):
            ts = (BASE_SEC + h * 3600 + k * 60 + 5) * 1000
            bid = base_px + h * 0.5 + k * 0.01
            ticks.append({"timestamp": ts, "bidPrice": bid, "askPrice": bid + 1.0})
    return ticks


def _df_1m_from_ticks(ticks, basis=46.0):
    ref = _last_mid_per_bucket(ticks, 60)
    idx = pd.to_datetime(sorted(ref), unit="s", utc=True)
    closes = [ref[int(ts.timestamp())] + basis for ts in idx]
    return pd.DataFrame({"Close": closes}, index=idx)


def _df_1h_from_ticks(ticks, basis=46.0):
    ref = _last_mid_per_bucket(ticks, 3600)
    idx = pd.to_datetime(sorted(ref), unit="s", utc=True)
    closes = [ref[int(ts.timestamp())] + basis for ts in idx]
    return pd.DataFrame({"Close": closes}, index=idx)


def _patch_nq_isolation(monkeypatch):
    monkeypatch.setattr(nq_ticks, "_load_basis_cache", lambda: {})
    monkeypatch.setattr(nq_ticks, "_save_basis_cache", lambda cache: None)


def _daily_df(highs, lows):
    n = len(highs)
    idx = pd.date_range("2026-01-01", periods=n, freq="D")
    return pd.DataFrame({"High": highs, "Low": lows,
                         "Close": [(h + l) / 2 for h, l in zip(highs, lows)]}, index=idx)


def _chop_bar(t, o, h, l, c):
    return {"time": t, "open": o, "high": h, "low": l, "close": c}


def _chop_fixture():
    """40 1m bars: range with overhead pivot high 120 (bar 5), breakdown wick (bar 25)."""
    t0 = 23400  # IST minute 720 (12:00), inside default session window
    bars = [_chop_bar(t0 + i * 60, 100, 100.5, 99.5, 100) for i in range(40)]
    bars[5] = _chop_bar(t0 + 5 * 60, 100, 120, 99.5, 100)      # fractal pivot high -> TP
    bars[25] = _chop_bar(t0 + 25 * 60, 100, 100, 95, 99.8)     # breakdown wick + rejection
    ticks = [{"timestamp": b["time"] * 1000 + 1000,
              "bidPrice": b["close"] - 0.25, "askPrice": b["close"] + 0.25} for b in bars]
    return bars, ticks


def _trade(t_in, t_out, pnl, entry=100.0, sl=95.0):
    return {"t_in": t_in, "t_out": t_out, "entry": entry, "sl": sl, "pnl": pnl}


# ---------------------------------------------------------------------------
# 1. scripts/nq_ticks.fetch_nq_ticks
# ---------------------------------------------------------------------------

class TestFetchNQTicks:
    def test_1m_basis_shift_preserves_microstructure(self, monkeypatch):
        ticks = _ticks_1m()
        df = _df_1m_from_ticks(ticks)
        monkeypatch.setattr(nq_ticks, "fetch_ticks", lambda date: ticks)
        monkeypatch.setattr("yfinance.download", lambda *a, **k: df)
        _patch_nq_isolation(monkeypatch)

        out, stats = nq_ticks.fetch_nq_ticks(DAY)

        assert stats["method"] == "1m"
        assert stats["median"] == round(BASIS, 2)
        assert stats["n"] >= 60
        assert stats["ticks"] == len(ticks) == len(out)
        assert stats["stdev"] == 0.0
        for k in ("median", "method", "n", "ticks"):
            assert k in stats
        # constant shift by the median basis ...
        for o, t in zip(out, ticks):
            assert o["bidPrice"] == t["bidPrice"] + stats["median"]
            assert o["askPrice"] == t["askPrice"] + stats["median"]
            # ... microstructure bit-for-bit: relative spreads unchanged
            assert (o["askPrice"] - o["bidPrice"]) == (t["askPrice"] - t["bidPrice"])

    def test_hourly_fallback(self, monkeypatch):
        ticks = _ticks_multi_hour()
        df_1h = _df_1h_from_ticks(ticks)
        empty = pd.DataFrame({"Close": []},
                             index=pd.DatetimeIndex([], tz="UTC"))

        def fake_download(*a, **k):
            return df_1h if k.get("interval") == "1h" else empty

        monkeypatch.setattr(nq_ticks, "fetch_ticks", lambda date: ticks)
        monkeypatch.setattr("yfinance.download", fake_download)
        _patch_nq_isolation(monkeypatch)

        out, stats = nq_ticks.fetch_nq_ticks(DAY)

        assert stats["method"] == "1h"
        assert stats["median"] == round(BASIS, 2)
        assert stats["ticks"] == len(ticks)
        for o, t in zip(out, ticks):
            assert o["bidPrice"] == t["bidPrice"] + stats["median"]
            assert (o["askPrice"] - o["bidPrice"]) == (t["askPrice"] - t["bidPrice"])

    def test_none_path(self, monkeypatch):
        ticks = _ticks_1m()
        empty = pd.DataFrame({"Close": []},
                             index=pd.DatetimeIndex([], tz="UTC"))
        monkeypatch.setattr(nq_ticks, "fetch_ticks", lambda date: ticks)
        monkeypatch.setattr("yfinance.download", lambda *a, **k: empty)
        _patch_nq_isolation(monkeypatch)

        out, stats = nq_ticks.fetch_nq_ticks(DAY)

        assert stats["method"] == "none"
        assert stats["median"] == 0.0
        assert stats["ticks"] == len(ticks)
        for o, t in zip(out, ticks):
            assert o["bidPrice"] == t["bidPrice"]
            assert o["askPrice"] == t["askPrice"]


# ---------------------------------------------------------------------------
# 2. scripts/htf_bias.bias_for
# ---------------------------------------------------------------------------

class TestHtfBias:
    def _bull(self):
        highs = [100.0] * 15
        lows = [90.0] * 15
        highs[5] = 110.0
        highs[10] = 120.0   # HH
        lows[4] = 80.0
        lows[9] = 85.0      # HL
        return _daily_df(highs, lows)

    def _bear(self):
        highs = [100.0] * 15
        lows = [90.0] * 15
        highs[5] = 120.0
        highs[10] = 110.0   # LH
        lows[4] = 85.0
        lows[9] = 80.0      # LL
        return _daily_df(highs, lows)

    def _mixed(self):
        highs = [100.0] * 15
        lows = [90.0] * 15
        highs[5] = 110.0
        highs[10] = 120.0   # HH but ...
        lows[4] = 85.0
        lows[9] = 80.0      # ... LL
        return _daily_df(highs, lows)

    def test_hh_hl_is_bull(self):
        df = self._bull()
        assert bias_for(df, df.index[-1].date().isoformat()) == 1

    def test_lh_ll_is_bear(self):
        df = self._bear()
        assert bias_for(df, df.index[-1].date().isoformat()) == -1

    def test_mixed_is_neutral(self):
        df = self._mixed()
        assert bias_for(df, df.index[-1].date().isoformat()) == 0

    def test_unknown_date_is_neutral(self):
        df = self._bull()
        assert bias_for(df, "1999-01-01") == 0

    def test_unconfirmed_boundary_swing_does_not_count(self):
        df = self._bull()  # second HH/HL at j=10 / j=9
        early = df.index[11].date().isoformat()  # j=10 needs j+2 < 11 -> excluded
        assert bias_for(df, early) == 0           # only one H/L confirmed -> neutral
        late = df.index[-1].date().isoformat()
        assert bias_for(df, late) == 1            # history-only check passes later


# ---------------------------------------------------------------------------
# 3. trading/smc_chop.SMCChopEngine
# ---------------------------------------------------------------------------

class TestSMCChopEngine:
    def test_breakdown_failure_long(self):
        bars, ticks = _chop_fixture()
        eng = SMCChopEngine()
        trades = eng.run(bars, ticks)
        assert len(trades) >= 1
        longs = [t for t in trades if t["side"] == "LONG"]
        assert longs, "expected at least one LONG breakdown-failure trade"
        t = longs[0]
        assert t["sl"] < 95.0      # SL below the wick extreme
        assert t["tp"] > t["entry"]  # structural TP overhead

    def test_no_lookahead_prefix_entry_matches(self):
        bars, ticks = _chop_fixture()
        full = SMCChopEngine().run(bars, ticks)
        assert full, "fixture must produce a trade"
        pre_bars, pre_ticks = bars[:27], ticks[:27]  # just past the fill bar (26)
        pre = SMCChopEngine().run(pre_bars, pre_ticks)
        assert pre, "prefix must already contain the signal"
        for k in ("side", "entry", "sl", "tp"):
            assert pre[0][k] == full[0][k]

    def test_no_lookahead_future_mutation_irrelevant(self):
        bars, _ = _chop_fixture()
        mut = [dict(b) for b in bars]
        for k in range(26, 40):  # scramble everything after the signal bar
            mut[k] = dict(mut[k], high=500.0, low=-500.0, close=0.01)
        eng_a, eng_b = SMCChopEngine(), SMCChopEngine()
        for i in range(26):  # step both through identical history only
            eng_a.on_close(bars, i)
            eng_b.on_close(mut, i)
            pa = None if eng_a.pending is None else dict(eng_a.pending)
            pb = None if eng_b.pending is None else dict(eng_b.pending)
            assert pa == pb


# ---------------------------------------------------------------------------
# 4. trading/risk.py
# ---------------------------------------------------------------------------

class TestRiskPublicAPI:
    def test_public_functions_listed(self):
        pubs = [n for n in dir(risk_mod) if not n.startswith("_")]
        for name in ("trade_risk_pts", "trade_r_pts", "should_flatten",
                     "stop_from_running_avg", "pass_risk_cap", "apply_day_stop",
                     "apply_max_concurrent", "day_min_cum", "max_loss_streak"):
            assert name in pubs, f"missing public function {name}"
            assert callable(getattr(risk_mod, name))


class TestRiskScalars:
    def test_trade_risk_pts(self):
        assert risk_mod.trade_risk_pts(100.0, 95.0) == 5.0
        assert risk_mod.trade_risk_pts(95.0, 100.0) == 5.0

    def test_trade_r_pts_and_zero_guard(self):
        assert risk_mod.trade_r_pts(10.0, 5.0) == 2.0
        assert risk_mod.trade_r_pts(-4.0, 2.0) == -2.0
        assert risk_mod.trade_r_pts(10.0, 0.0) == 0.0

    def test_should_flatten_inclusive(self):
        assert risk_mod.should_flatten(-10.0, 10.0) is True
        assert risk_mod.should_flatten(-10.01, 10.0) is True
        assert risk_mod.should_flatten(-9.99, 10.0) is False
        assert risk_mod.should_flatten(5.0, 10.0) is False

    def test_stop_from_running_avg(self):
        assert risk_mod.stop_from_running_avg(5.0) == 10.0
        assert risk_mod.stop_from_running_avg(5.0, k=3.0) == 15.0

    def test_pass_risk_cap(self):
        assert risk_mod.pass_risk_cap(10.0, 4.0) is True    # 10 <= 5*4
        assert risk_mod.pass_risk_cap(25.0, 4.0) is False
        assert risk_mod.pass_risk_cap(1.0, 0.0) is False    # fail-closed
        assert risk_mod.pass_risk_cap(1.0, None) is False


class TestApplyDayStop:
    def _day(self):
        return [_trade(0, 10, 5.0), _trade(20, 30, -8.0),
                _trade(40, 50, -10.0), _trade(60, 70, 20.0)]

    def test_flatten_truncates_breach_and_drops_rest(self):
        kept, net = risk_mod.apply_day_stop(self._day(), 10.0, flatten=True)
        assert [t["pnl"] for t in kept] == [5.0, -8.0, -7.0]  # -10-(-3)
        assert kept[-1]["flattened"] is True
        assert net == -10.0
        assert "flattened" not in self._day()[2]  # input untouched

    def test_entry_block_only_keeps_breach_whole(self):
        kept, net = risk_mod.apply_day_stop(self._day(), 10.0, flatten=False)
        assert [t["pnl"] for t in kept] == [5.0, -8.0, -10.0]
        assert net == -13.0

    def test_no_breach_keeps_all(self):
        kept, net = risk_mod.apply_day_stop([_trade(0, 1, 2.0)], 10.0)
        assert len(kept) == 1 and net == 2.0


class TestConcurrencyAndStreaks:
    def test_apply_max_concurrent_drops_overlap(self):
        day = [_trade(0, 100, 1.0), _trade(50, 150, 1.0), _trade(200, 300, 1.0)]
        kept = risk_mod.apply_max_concurrent(day, max_n=1)
        assert [t["t_in"] for t in kept] == [0, 200]

    def test_apply_max_concurrent_serial_is_noop(self):
        day = [_trade(0, 10, 1.0), _trade(20, 30, 1.0)]
        assert len(risk_mod.apply_max_concurrent(day, max_n=1)) == 2

    def test_day_min_cum(self):
        assert risk_mod.day_min_cum([_trade(0, 1, 5.0), _trade(2, 3, -8.0)]) == -3.0
        assert risk_mod.day_min_cum([_trade(0, 1, 5.0)]) == 0.0

    def test_max_loss_streak(self):
        assert risk_mod.max_loss_streak([5.0, -1.0, -2.0, 3.0, -1.0]) == 2
        assert risk_mod.max_loss_streak([5.0, -1.0, -2.0, -3.0, 4.0]) == 3
        assert risk_mod.max_loss_streak([]) == 0
