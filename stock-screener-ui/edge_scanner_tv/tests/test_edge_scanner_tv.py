"""Tests for edge_scanner_tv (no network: fake feed + synthetic bars)."""
import sys
from datetime import date, datetime

import pandas as pd
import pytest

sys.path.insert(0, ".")

from edge_scanner_tv import markets as M
from edge_scanner_tv.scanner import ALERT_COOLDOWN_SEC, EdgeScannerTV
from edge_scanner_tv.triggers import (
    ema,
    session_vwap,
    trigger_ema_cross,
    trigger_hod_breakout,
    trigger_momentum,
    trigger_orb,
    trigger_rvol_spike,
    trigger_vwap,
)
from edge_scanner_tv.tv_feed import (
    TradingViewFeed,
    normalize_yf_frame,
    subscribe_minute_bars_once,
)


def bar(symbol, close, high=None, low=None, open_=None, volume=1000, ts="t"):
    c = close
    return {
        "symbol": symbol, "timestamp": ts,
        "open": open_ if open_ is not None else c,
        "high": high if high is not None else c + 0.5,
        "low": low if low is not None else c - 0.5,
        "close": c, "volume": volume, "vwap": c,
    }


# ── markets ───────────────────────────────────────────────────────────────

class TestMarkets:
    def test_resolve(self):
        assert [m.key for m in M.resolve_markets("india")] == ["india"]
        assert [m.key for m in M.resolve_markets("both")] == ["india", "america"]

    def test_resolve_unknown(self):
        with pytest.raises(ValueError):
            M.resolve_markets("europe")

    def test_yf_symbol_india_suffix(self):
        assert M.to_yf_symbol("RELIANCE", M.INDIA) == "RELIANCE.NS"
        assert M.to_yf_symbol("RELIANCE.NS", M.INDIA) == "RELIANCE.NS"
        assert M.to_yf_symbol("AAPL", M.AMERICA) == "AAPL"

    def test_strip_tv_prefix(self):
        assert M.strip_tv_prefix("NSE:RELIANCE", M.INDIA) == "RELIANCE"
        assert M.strip_tv_prefix("AAPL", M.AMERICA) == "AAPL"

    def test_normalize_dash(self):
        assert M.normalize_symbol("bajaj-auto") == "BAJAJ_AUTO"


# ── feed helpers ──────────────────────────────────────────────────────────

class TestFeedHelpers:
    def test_normalize_empty(self):
        out = normalize_yf_frame(pd.DataFrame())
        assert list(out.columns) == ["open", "high", "low", "close", "volume", "vwap", "trade_count"]

    def test_normalize_utc_index(self):
        idx = pd.to_datetime(["2026-01-05", "2026-01-06"])
        df = pd.DataFrame({"Open": [1, 2], "High": [2, 3], "Low": [1, 1],
                           "Close": [2, 2], "Volume": [10, 20]}, index=idx)
        out = normalize_yf_frame(df)
        assert str(out.index.tz) == "UTC"
        assert out["close"].tolist() == [2.0, 2.0]


# ── triggers ──────────────────────────────────────────────────────────────

class TestTriggers:
    def test_ema_none_when_short(self):
        assert ema([1.0, 2.0], 5) is None

    def test_hod_breakout_fires_once(self):
        bars = [bar("X", 10, high=10), bar("X", 11, high=12)]
        a = trigger_hod_breakout(bars, "long")
        assert a and a.setup == "hod_breakout" and a.direction == "long"

    def test_hod_no_fire_first_bar(self):
        assert trigger_hod_breakout([bar("X", 10)], "long") is None

    def test_lod_breakdown(self):
        bars = [bar("X", 10, low=9), bar("X", 8, low=7)]
        a = trigger_hod_breakout(bars, "short")
        assert a and a.direction == "short"

    def test_vwap_reclaim(self):
        bars = [bar("X", 98, volume=100) for _ in range(3)] + [bar("X", 105, volume=100)]
        a = trigger_vwap(bars, lookback=3)
        assert a and a.setup == "vwap_reclaim"

    def test_vwap_insufficient_bars(self):
        assert trigger_vwap([bar("X", 100)], lookback=3) is None

    def test_ema_cross_bull(self):
        bars = [bar("X", 10) for _ in range(9)] + [bar("X", 20)]
        a = trigger_ema_cross(bars)
        assert a and a.direction == "long"

    def test_orb_breakout(self):
        bars = [bar("X", 100) for _ in range(15)] + [bar("X", 110)]
        a = trigger_orb(bars, or_minutes=15)
        assert a and a.setup == "orb15_breakout"

    def test_orb_needs_full_window(self):
        assert trigger_orb([bar("X", 100)] * 5, or_minutes=15) is None

    def test_momentum_long_and_rvol_gate(self):
        bars = [bar("X", 100, volume=100) for _ in range(5)] + [bar("X", 103, volume=100)]
        a = trigger_momentum(bars, window=5, min_move_pct=1.0)
        assert a and a.direction == "long"
        blocked = trigger_momentum(bars, window=5, min_move_pct=1.0,
                                   min_rvol=50.0, avg_vol=100.0)
        assert blocked is None

    def test_rvol_spike(self):
        bars = [bar("X", 100, volume=100), bar("X", 101, volume=500)]
        a = trigger_rvol_spike(bars, avg_vol=100.0, factor=2.0)
        assert a and a.setup == "rvol_spike"

    def test_rvol_zero_avg(self):
        assert trigger_rvol_spike([bar("X", 100)], avg_vol=0.0) is None

    def test_session_vwap_empty(self):
        assert session_vwap([]) is None


# ── scanner ───────────────────────────────────────────────────────────────

class FakeFeed(TradingViewFeed):
    def __init__(self, market, snaps=None, daily=None):
        super().__init__(market)
        self._snaps = snaps or {}
        self._daily = daily

    def get_snapshot(self, symbols, tv_tickers=None):
        return {s: self._snaps[s] for s in symbols if s in self._snaps}

    def get_historical_daily(self, symbol, start: date, end: date):
        if self._daily is not None:
            return self._daily
        idx = pd.date_range("2026-01-01", periods=30, tz="UTC")
        return pd.DataFrame({"open": 100.0, "high": 102.0, "low": 99.0,
                             "close": 101.0, "volume": 1e6,
                             "vwap": 101.0, "trade_count": 0.0}, index=idx)


def snap(close=100.0, change=4.0, rvol=2.0, high52=101.0):
    return {"close": close, "open": 99.0, "high": close, "low": 99.0,
            "volume": 2e6, "change": change, "rsi": 60.0, "adx": 25.0,
            "atr": 2.0, "rvol": rvol, "mcap": 1e11, "sector": "Tech",
            "high_52w": high52, "low_52w": 50.0, "perf_w": 3.0, "gap": 0.5}


class TestScanner:
    def test_warmup_builds_ctx(self):
        feed = FakeFeed(M.INDIA)
        sc = EdgeScannerTV(["RELIANCE"], feed, M.INDIA)
        sc.warmup(history_days=30)
        assert "RELIANCE" in sc.daily_ctx
        assert sc.daily_ctx["RELIANCE"]["avg_vol"] > 0

    def test_scan_snapshot_momentum_and_52w(self):
        feed = FakeFeed(M.INDIA, snaps={"RELIANCE": snap()})
        sc = EdgeScannerTV(["RELIANCE"], feed, M.INDIA,
                           setups=["momentum", "rvol", "52w"])
        sc.warmup(history_days=30)
        alerts = sc.scan_snapshot()
        setups = {a["setup"] for a in alerts}
        assert "momentum_day" in setups
        assert "near_52w_high" in setups

    def test_scan_snapshot_quiet(self):
        feed = FakeFeed(M.AMERICA, snaps={"AAPL": snap(change=0.1, rvol=0.8, high52=150.0)})
        sc = EdgeScannerTV(["AAPL"], feed, M.AMERICA)
        assert sc.scan_snapshot() == []

    def test_on_bar_dedupe(self):
        """Direction-aware cooldown: same setup+direction suppressed in
        window, opposite direction fires, reset_session() refires."""
        feed = FakeFeed(M.INDIA)
        sc = EdgeScannerTV(["X"], feed, M.INDIA, setups=["breakout"])
        sc.on_bar(bar("X", 10, high=10, low=9))
        first = sc.on_bar(bar("X", 11, high=12, low=9.5))
        assert any(a.setup == "hod_breakout" for a in first)
        # Same setup+direction within cooldown → suppressed.
        repeat = sc.on_bar(bar("X", 12, high=13, low=9.5))
        assert all(a.setup != "hod_breakout" for a in repeat)
        # Opposite direction (new LOD) must NOT be suppressed.
        opp = sc.on_bar(bar("X", 8, high=13, low=7))
        assert any(a.setup == "lod_breakdown" and a.direction == "short"
                   for a in opp)
        # After reset_session(), the same long setup refires.
        sc.reset_session()
        sc.on_bar(bar("X", 10, high=10, low=9))
        refired = sc.on_bar(bar("X", 11, high=12, low=9.5))
        assert any(a.setup == "hod_breakout" for a in refired)

    def test_reset_session_keeps_daily_ctx(self):
        feed = FakeFeed(M.INDIA)
        sc = EdgeScannerTV(["X"], feed, M.INDIA, setups=["breakout"])
        sc.warmup(history_days=30)
        assert "X" in sc.daily_ctx
        sc.on_bar(bar("X", 10, high=10, low=9))
        sc.reset_session()
        assert sc.bars == {"X": []}
        assert sc._last_fire == {}
        assert "X" in sc.daily_ctx  # warmup ctx preserved

    def test_alert_schema_evaluate_has_ts_and_id(self):
        feed = FakeFeed(M.INDIA)
        sc = EdgeScannerTV(["X"], feed, M.INDIA, setups=["breakout"])
        sc.on_bar(bar("X", 10, high=10, low=9))
        sc.on_bar(bar("X", 11, high=12, low=9.5))
        assert sc.alerts, "expected at least one evaluate() alert"
        ids = []
        for a in sc.alerts:
            assert isinstance(a["id"], int)
            assert isinstance(a["ts"], str) and a["ts"]
            datetime.fromisoformat(a["ts"])  # UTC ISO parseable
            ids.append(a["id"])
        assert ids == sorted(ids)  # monotonic
        assert len(set(ids)) == len(ids)

    def test_alert_schema_snapshot_has_ts_and_id(self):
        feed = FakeFeed(M.INDIA, snaps={"RELIANCE": snap()})
        sc = EdgeScannerTV(["RELIANCE"], feed, M.INDIA,
                           setups=["momentum", "rvol", "breakout"])
        sc.warmup(history_days=30)
        alerts = sc.scan_snapshot()
        assert alerts, "expected snapshot alerts"
        ids = []
        for a in alerts:
            assert isinstance(a["id"], int)
            assert isinstance(a["ts"], str) and a["ts"]
            datetime.fromisoformat(a["ts"])
            ids.append(a["id"])
        assert ids == sorted(ids)
        assert len(set(ids)) == len(ids)
        # ids shared across both paths on one instance: snapshot ids
        # continue the same monotonic counter (no reset to 1).
        sc.on_bar(bar("RELIANCE", 100, high=100, low=99))
        sc.on_bar(bar("RELIANCE", 105, high=106, low=99))
        for a in sc.alerts[len(alerts):]:
            assert a["id"] > max(ids)

    def test_cooldown_expiry_refires(self):
        feed = FakeFeed(M.INDIA)
        sc = EdgeScannerTV(["X"], feed, M.INDIA, setups=["breakout"])
        sc.on_bar(bar("X", 10, high=10, low=9))
        assert sc.on_bar(bar("X", 11, high=12, low=9.5))
        suppressed = sc.on_bar(bar("X", 12, high=13, low=9.5))
        assert all(a.setup != "hod_breakout" for a in suppressed)
        # Expire the cooldown by back-dating _last_fire.
        for k in list(sc._last_fire):
            sc._last_fire[k] -= (ALERT_COOLDOWN_SEC + 1)
        refired = sc.on_bar(bar("X", 13, high=14, low=9.5))
        assert any(a.setup == "hod_breakout" for a in refired)

    def test_snapshot_cooldown_suppresses_repeat(self):
        feed = FakeFeed(M.INDIA, snaps={"RELIANCE": snap()})
        sc = EdgeScannerTV(["RELIANCE"], feed, M.INDIA,
                           setups=["momentum", "rvol", "breakout"])
        first = sc.scan_snapshot()
        assert first
        second = sc.scan_snapshot()
        assert second == []  # all within cooldown

    def test_tv_tickers_plumbed_to_snapshot(self):
        seen: dict = {}

        class SpyFeed(FakeFeed):
            def get_snapshot(self, symbols, tv_tickers=None):
                seen.update(tv_tickers or {})
                return super().get_snapshot(symbols, tv_tickers)

        feed = SpyFeed(M.AMERICA, snaps={"AAPL": snap()})
        sc = EdgeScannerTV(["AAPL"], feed, M.AMERICA,
                           setups=["momentum"], tv_tickers={"AAPL": "NASDAQ:AAPL"})
        sc.scan_snapshot()
        assert seen == {"AAPL": "NASDAQ:AAPL"}


# ── subscribe_minute_bars_once delta volumes ──────────────────────────

class TestOnceDeltaVolume:
    def _feed(self, volume: float, close: float = 100.0):
        s = snap(close=close)
        s["volume"] = volume
        return FakeFeed(M.INDIA, snaps={"X": s})

    def test_prev_none_gives_zero_not_cumulative(self):
        feed = self._feed(volume=2e6)
        bars = subscribe_minute_bars_once(feed, ["X"])
        assert len(bars) == 1
        assert bars[0]["volume"] == 0.0

    def test_delta_and_prev_updated_in_place(self):
        feed = self._feed(volume=1000.0)
        prev: dict = {}
        first = subscribe_minute_bars_once(feed, ["X"], prev)
        assert first[0]["volume"] == pytest.approx(1000.0)
        assert prev == {"X": pytest.approx(1000.0)}
        # Same cumulative → zero delta.
        again = subscribe_minute_bars_once(feed, ["X"], prev)
        assert again[0]["volume"] == pytest.approx(0.0)
        # Cumulative jump → delta only.
        feed._snaps["X"]["volume"] = 1500.0
        jumped = subscribe_minute_bars_once(feed, ["X"], prev)
        assert jumped[0]["volume"] == pytest.approx(500.0)
        assert prev == {"X": pytest.approx(1500.0)}

    def test_shared_prev_across_rounds(self):
        feed = self._feed(volume=1000.0)
        prev: dict = {}
        subscribe_minute_bars_once(feed, ["X"], prev)
        feed._snaps["X"]["volume"] = 1200.0
        second = subscribe_minute_bars_once(feed, ["X"], prev)
        assert second[0]["volume"] == pytest.approx(200.0)
