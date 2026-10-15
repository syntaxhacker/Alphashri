"""Tests for the server bar path: yfinance 1-min bars -> real triggers.

Covers the trigger->setup-group mapping (so dashboard filters match), the
frame->bar conversion, and the seed-then-feed-on-new-bars behaviour of
``_feed_minute_bars`` (no network: frames are synthetic).
"""
import sys
from types import SimpleNamespace

import pandas as pd
import pytest

sys.path.insert(0, ".")

from edge_scanner_tv.server import _feed_minute_bars, _frame_to_bars, _pct_change_5m, to_alert
from edge_scanner_tv.triggers import setup_group


def _frame(rows):
    """rows: list of (ts_iso, open, high, low, close, volume)."""
    idx = pd.to_datetime([r[0] for r in rows], utc=True)
    return pd.DataFrame(
        {"open": [r[1] for r in rows], "high": [r[2] for r in rows],
         "low": [r[3] for r in rows], "close": [r[4] for r in rows],
         "volume": [r[5] for r in rows]}, index=idx)


class _OpenMarket:
    key = "india"

    def is_open(self):
        return True


class _RecScanner:
    """Records bars handed to on_bar; emits no alerts."""

    def __init__(self):
        self.bars: dict = {}
        self.fed: list[dict] = []

    def on_bar(self, bar):
        self.bars.setdefault(bar["symbol"], []).append(bar)
        self.fed.append(bar)
        return []


class _FakeFeed:
    def __init__(self, frames):
        self._frames = frames

    def get_intraday_minute_frames(self, symbols):
        return self._frames


def _state(frames):
    return SimpleNamespace(
        scanner=_RecScanner(), feed=_FakeFeed(frames),
        market=_OpenMarket(), symbols=["X"], last_bar_ts={},
    )


class TestPctChange5m:
    def test_none_when_insufficient(self):
        assert _pct_change_5m([]) is None
        assert _pct_change_5m([{"close": 1.0}] * 5) is None

    def test_basic_five_bar_move(self):
        bars = [{"close": c} for c in (100, 100, 100, 100, 100, 105)]
        assert _pct_change_5m(bars) == pytest.approx(5.0)

    def test_bad_base(self):
        bars = [{"close": c} for c in (0, 1, 1, 1, 1, 1)]
        assert _pct_change_5m(bars) is None


class TestSetupGroup:
    @pytest.mark.parametrize("trigger,group", [
        ("hod_breakout", "breakout"), ("lod_breakdown", "breakout"),
        ("near_52w_high", "52w"), ("near_52w_low", "52w"),
        ("vwap_reclaim", "vwap"), ("vwap_reject", "vwap"),
        ("above_vwap_proxy", "vwap"),
        ("ema3_9_bull", "ema"), ("ema3_9_bear", "ema"),
        ("orb15_breakout", "orb"), ("orb15_breakdown", "orb"),
        ("momentum_5m", "momentum"), ("momentum_day", "momentum"),
        ("rvol_spike", "rvol"),
    ])
    def test_known(self, trigger, group):
        assert setup_group(trigger) == group

    def test_unknown_passthrough(self):
        assert setup_group("mystery_setup") == "mystery_setup"

    def test_empty(self):
        assert setup_group("") == "unknown"


class TestToAlertGrouping:
    def test_breakout_is_grouped_and_labelled(self):
        a = to_alert({"symbol": "x", "setup": "hod_breakout",
                      "direction": "long", "price": 10.0}, {}, 1)
        assert a["setup"] == "breakout"          # filter matches group code
        assert a["setup_label"] == "HOD Breakout"  # badge shows the trigger
        assert a["trigger"] == "hod_breakout"

    def test_ema_snapshot_proxy_grouped(self):
        a = to_alert({"symbol": "AAPL", "setup": "near_52w_high",
                      "direction": "long", "price": 5.0}, {}, 2)
        assert a["setup"] == "52w"
        assert a["setup_label"] == "Near 52W High"


class TestFrameToBars:
    def test_basic_conversion(self):
        df = _frame([
            ("2026-01-05T09:16:00+00:00", 1, 2, 0.5, 1.5, 100),
            ("2026-01-05T09:17:00+00:00", 2, 3, 1.5, 2.5, 200),
        ])
        bars = _frame_to_bars("X", df)
        assert len(bars) == 2
        assert bars[0]["symbol"] == "X"
        assert bars[1]["close"] == 2.5 and bars[1]["volume"] == 200

    def test_nan_close_skipped(self):
        df = _frame([
            ("2026-01-05T09:16:00+00:00", 1, 2, 0.5, float("nan"), 100),
            ("2026-01-05T09:17:00+00:00", 2, 3, 1.5, 2.5, 200),
        ])
        bars = _frame_to_bars("X", df)
        assert [b["close"] for b in bars] == [2.5]


class TestFeedMinuteBars:
    def test_first_call_seeds_without_emitting(self):
        st = _state({"X": _frame([
            ("2026-01-05T09:16:00+00:00", 1, 2, 0.5, 1.5, 100),
            ("2026-01-05T09:17:00+00:00", 2, 3, 1.5, 2.5, 200),
        ])})
        assert _feed_minute_bars(st) == []
        assert st.scanner.fed == []                       # nothing evaluated
        assert len(st.scanner.bars["X"]) == 2             # seeded for context
        assert st.last_bar_ts["X"].startswith("2026-01-05")

    def test_new_bar_is_fed_once(self):
        st = _state({"X": _frame([
            ("2026-01-05T09:16:00+00:00", 1, 2, 0.5, 1.5, 100),
        ])})
        _feed_minute_bars(st)                             # seed
        st.feed._frames["X"] = _frame([
            ("2026-01-05T09:16:00+00:00", 1, 2, 0.5, 1.5, 100),
            ("2026-01-05T09:17:00+00:00", 2, 3, 1.5, 2.5, 200),
        ])
        _feed_minute_bars(st)
        assert [b["close"] for b in st.scanner.fed] == [2.5]
        # Same frame again -> nothing new.
        _feed_minute_bars(st)
        assert len(st.scanner.fed) == 1

    def test_new_session_reseeds_without_emitting(self):
        st = _state({"X": _frame([
            ("2026-01-05T09:16:00+00:00", 1, 2, 0.5, 1.5, 100),
        ])})
        _feed_minute_bars(st)                             # seed day 1
        st.feed._frames["X"] = _frame([
            ("2026-01-06T09:16:00+00:00", 5, 6, 4, 5.5, 300),
            ("2026-01-06T09:17:00+00:00", 6, 7, 5, 6.5, 400),
        ])
        _feed_minute_bars(st)
        assert st.scanner.fed == []                       # reseeded silently
        assert len(st.scanner.bars["X"]) == 2
        assert st.last_bar_ts["X"].startswith("2026-01-06")
