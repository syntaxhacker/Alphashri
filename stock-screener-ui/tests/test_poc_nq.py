"""Unit tests for api/poc_nq.py (tick-replay / smc-ifvg / nq endpoints).

All data-layer access is mocked; no network calls.
Call endpoint functions directly, passing every Query param explicitly
(FastAPI Query defaults are Param objects when called outside HTTP).
"""

import pandas as pd
import pytest
from datetime import datetime
from unittest.mock import patch

from config import IST
import api.poc_nq as poc_nq
from api.poc_nq import get_tick_replay, get_smc_ifvg, get_nq
from scripts.smc_tick_eval import build_1m_bars as real_build_1m_bars
from trading.vwap_orb import compute_or_window

BASE_SEC = 1750000000 // 60 * 60  # minute-aligned unix sec
BASIS = {"median": 46.0, "method": "1m"}


@pytest.fixture(autouse=True)
def _clear_cache():
    poc_nq._cache.clear()
    yield
    poc_nq._cache.clear()


def _make_ticks(n_minutes=20, start_price=100.0):
    """Two ticks per minute (s=5 open-ish, s=35 close-ish), rising tape."""
    ticks = []
    for m in range(n_minutes):
        for s in (5, 35):
            ts = (BASE_SEC + m * 60 + s) * 1000
            px = start_price + m * 0.5 + (0.1 if s == 35 else 0.0)
            ticks.append({
                "timestamp": ts, "bidPrice": px, "askPrice": px + 0.25,
                "bidVolume": 2, "askVolume": 2,
            })
    return ticks


def _ist_ms(date_s, hh, mm):
    y, m, d = map(int, date_s.split("-"))
    return int(datetime(y, m, d, hh, mm, tzinfo=IST).timestamp() * 1000)


def _canned_ifvg_trade(t_in_ms, kind="inv", side="LONG"):
    return {
        "t_in": t_in_ms, "t_out": t_in_ms + 5 * 60 * 1000,
        "side": side, "kind": kind,
        "entry": 100.0, "sl": 94.0, "tp": 112.0, "exit": 106.0,
        "result": "TP", "pnl": 6.0, "rr": 1.0,
    }


class _FakeIfvgEngine:
    """Entries-aware fake: run() honours the entries ctor arg like the real engine."""

    canned = []
    last_entries = None
    last_kwargs = None

    def __init__(self, entries="both", **kw):
        self.entries = entries
        self.kw = kw
        type(self).last_entries = entries
        type(self).last_kwargs = kw

    def run(self, bars, ticks):
        if self.entries == "both":
            return list(type(self).canned)
        return [t for t in type(self).canned if t["kind"] == self.entries]


def _patch_ifvg(canned):
    _FakeIfvgEngine.canned = list(canned)
    _FakeIfvgEngine.last_entries = None
    _FakeIfvgEngine.last_kwargs = None
    bars = [
        {"time": BASE_SEC + i * 60, "open": 100 + i, "high": 101 + i,
         "low": 99 + i, "close": 100.5 + i}
        for i in range(5)
    ]
    p1 = patch("scripts.nq_ticks.fetch_nq_ticks", return_value=(_make_ticks(5), BASIS))
    p2 = patch("scripts.smc_tick_eval.build_1m_bars", return_value=bars)
    p3 = patch("trading.smc_ifvg.SMCIFVGEngine", _FakeIfvgEngine)
    return p1, p2, p3


# ---------------- get_tick_replay ----------------

class TestGetTickReplay:

    def test_bundle_shape(self):
        ticks = _make_ticks(20)
        with patch("scripts.nq_ticks.fetch_nq_ticks", return_value=(ticks, BASIS)):
            res = get_tick_replay(date="2026-01-05", secs=2, orb=15, hist=0)
        assert "error" not in res
        for key in ("candles", "subs", "vwap", "or_high", "or_low",
                    "or_minutes", "or_end", "trades", "basis", "symbol"):
            assert key in res, f"missing {key}"
        assert res["symbol"] == "NQ=F"
        assert res["basis"] == BASIS["median"]
        assert res["or_minutes"] == 15
        assert len(res["candles"]) == 20
        assert len(res["subs"]) > 0
        assert len(res["vwap"]) == len(res["candles"])
        assert res["count"] == len(res["trades"])

    def test_or_levels_from_first_n_bars(self):
        ticks = _make_ticks(20)
        with patch("scripts.nq_ticks.fetch_nq_ticks", return_value=(ticks, BASIS)):
            res = get_tick_replay(date="2026-01-05", secs=2, orb=15, hist=0)
        bars = real_build_1m_bars(ticks)
        exp_high, exp_low, exp_end = compute_or_window(bars, 15)
        assert res["or_high"] == round(exp_high, 2)
        assert res["or_low"] == round(exp_low, 2)
        assert res["or_end"] == exp_end
        # levels come from the first 15 bars only
        assert exp_high == max(b["high"] for b in bars[:15])
        assert exp_low == min(b["low"] for b in bars[:15])

    def test_orb_param_changes_or_end(self):
        ticks = _make_ticks(20)
        with patch("scripts.nq_ticks.fetch_nq_ticks", return_value=(ticks, BASIS)):
            r5 = get_tick_replay(date="2026-01-05", secs=2, orb=5, hist=0)
            r15 = get_tick_replay(date="2026-01-05", secs=2, orb=15, hist=0)
        assert r5["or_minutes"] == 5
        assert r15["or_minutes"] == 15
        assert r5["or_end"] != r15["or_end"]
        bars = real_build_1m_bars(ticks)
        assert r5["or_end"] == bars[4]["time"] + 60
        assert r15["or_end"] == bars[14]["time"] + 60

    def test_trade_times_floored_to_containing_minute(self):
        ticks = _make_ticks(20)
        base = real_build_1m_bars(ticks)[0]["time"]
        t_in = base * 1000 + 23 * 1000 + 456  # 23.456s into the minute
        t_out = base * 1000 + 90 * 1000 + 789
        canned = [{"t_in": t_in, "t_out": t_out, "side": "LONG",
                   "entry": 100.0, "sl": 99.0, "tp": 102.0, "exit": 101.0,
                   "result": "TP", "pnl": 1.0, "rr": 1.0}]

        class _FakeOrb:
            def __init__(self, or_bars=15):
                pass

            def run(self, bars, ticks, hist=None):
                return list(canned)

        with patch("scripts.nq_ticks.fetch_nq_ticks", return_value=(ticks, BASIS)), \
                patch("trading.vwap_orb.VWAPORBEngine", _FakeOrb):
            res = get_tick_replay(date="2026-01-05", secs=2, orb=15, hist=0)
        assert len(res["trades"]) == 1
        tr = res["trades"][0]
        assert tr["time"] == t_in // 60000 * 60 == base
        assert tr["exit_time"] == t_out // 60000 * 60 == base + 60
        assert tr["time"] % 60 == 0
        assert tr["exit_time"] % 60 == 0

    def test_error_path_fetch_raises(self):
        with patch("scripts.nq_ticks.fetch_nq_ticks",
                   side_effect=RuntimeError("boom")):
            res = get_tick_replay(date="2026-01-05", secs=2, orb=15, hist=0)
        assert res["trades"] == []
        assert res["candles"] == []
        assert "error" in res
        assert "boom" in res["error"]


# ---------------- get_smc_ifvg ----------------

class TestGetSmcIfvg:

    def test_entries_param_routes_to_engines(self):
        date = "2026-01-05"
        canned = [_canned_ifvg_trade(_ist_ms(date, 10, 0), kind="inv"),
                  _canned_ifvg_trade(_ist_ms(date, 11, 0), kind="retest")]
        p1, p2, p3 = _patch_ifvg(canned)
        with p1, p2, p3:
            r_inv = get_smc_ifvg(date=date, from_ist=None, to_ist=None,
                                 entries="inv", flip=None)
            r_retest = get_smc_ifvg(date=date, from_ist=None, to_ist=None,
                                    entries="retest", flip=None)
            r_both = get_smc_ifvg(date=date, from_ist=None, to_ist=None,
                                  entries="both", flip=None)
        assert {t["kind"] for t in r_inv["trades"]} == {"inv"}
        assert {t["kind"] for t in r_retest["trades"]} == {"retest"}
        assert {t["kind"] for t in r_both["trades"]} == {"inv", "retest"}
        assert len(r_both["trades"]) == 2

    def test_window_filtering(self):
        date = "2026-01-05"
        canned = [_canned_ifvg_trade(_ist_ms(date, 10, 0)),
                  _canned_ifvg_trade(_ist_ms(date, 12, 0)),
                  _canned_ifvg_trade(_ist_ms(date, 14, 0))]
        p1, p2, p3 = _patch_ifvg(canned)
        with p1, p2, p3:
            all_r = get_smc_ifvg(date=date, from_ist=None, to_ist=None,
                                 entries="both", flip=None)
            win_r = get_smc_ifvg(date="2026-01-06", from_ist="11:00", to_ist="13:00",
                                 entries="both", flip=None)
            from_r = get_smc_ifvg(date="2026-01-07", from_ist="13:00", to_ist=None,
                                  entries="both", flip=None)
        assert len(all_r["trades"]) == 3
        assert len(win_r["trades"]) == 1
        assert win_r["trades"][0]["time"] == _ist_ms(date, 12, 0) // 60000 * 60
        assert len(from_r["trades"]) == 1  # only the 14:00 trade

    def test_flip_passthrough(self):
        date = "2026-01-05"
        canned = [_canned_ifvg_trade(_ist_ms(date, 12, 0))]
        p1, p2, p3 = _patch_ifvg(canned)
        with p1, p2, p3:
            r_plain = get_smc_ifvg(date=date, from_ist=None, to_ist=None,
                                   entries="both", flip=None)
            kw_plain = dict(_FakeIfvgEngine.last_kwargs)
            r_flip = get_smc_ifvg(date="2026-01-06", from_ist=None, to_ist=None,
                                  entries="both", flip=5.0)
            kw_flip = dict(_FakeIfvgEngine.last_kwargs)
        assert "error" not in r_plain
        assert "error" not in r_flip
        assert "inv_flip_margin" not in kw_plain
        assert kw_flip.get("inv_flip_margin") == 5.0

    def test_error_path_fetch_raises(self):
        with patch("scripts.nq_ticks.fetch_nq_ticks",
                   side_effect=RuntimeError("no ticks")):
            res = get_smc_ifvg(date="2026-01-05", from_ist=None, to_ist=None,
                               entries="both", flip=None)
        assert res["trades"] == []
        assert "error" in res
        assert "no ticks" in res["error"]


# ---------------- get_nq ----------------

class TestGetNq:

    def test_empty_dataframe_returns_error(self):
        with patch("yfinance.download", return_value=pd.DataFrame()):
            res = get_nq(period="5d", interval="15m", date=None)
        assert res["bars"] == []
        assert "error" in res

    def test_date_single_day_empty_returns_error(self):
        with patch("yfinance.download", return_value=pd.DataFrame()):
            res = get_nq(period="1d", interval="1m", date="2026-01-05")
        assert res["bars"] == []
        assert "error" in res

    def test_success_shape(self):
        idx = pd.date_range("2026-01-05 09:30", periods=3, freq="15min", tz="UTC")
        df = pd.DataFrame({
            "Open": [100.0, 101.0, 102.0],
            "High": [101.0, 102.0, 103.0],
            "Low": [99.0, 100.0, 101.0],
            "Close": [100.5, 101.5, 102.5],
            "Volume": [10, 20, 30],
        }, index=idx)
        with patch("yfinance.download", return_value=df):
            res = get_nq(period="5d", interval="15m", date=None)
        assert "error" not in res
        assert res["count"] == 3
        assert len(res["bars"]) == 3
        assert res["bars"][0]["open"] == 100.0
        assert res["bars"][0]["time"] == int(idx[0].timestamp())
