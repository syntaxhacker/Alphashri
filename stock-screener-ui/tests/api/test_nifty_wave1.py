"""Post-close Wave 1 for the Nifty report.

Covers the four contract points:

1. the snapshot build reuses the 10s chain poller's frame (and falls back to
   the REST chain when there is no FRESH frame),
2. the WS overlay replaces walls/positioning (not just spot/vix) without
   writing a snapshot,
3. wall relocations are alerted only with hysteresis (side flip or >= 2
   strikes), and
4. the cached breadth strip is attached read-only (never fetched inline).

Pure/unit level: every network path is mocked, snapshot writes go to tmp_path.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
import types
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

import api.reports_api.nifty as nifty
from api.reports_api import chain10s


# ---------------------------------------------------------------------------
# fixtures / builders
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_state(monkeypatch, tmp_path):
    monkeypatch.setattr(chain10s, "ENABLED", True)
    monkeypatch.setattr(chain10s, "LAST_FULL",
                        {"t": None, "ts": None, "spot": None,
                         "expiry": None, "rows": None})
    # Breadth persistence must never touch the repo's experiments/data in a
    # test, and the snapshot/tape parse caches must not leak across cases.
    monkeypatch.setattr(nifty, "_BREADTH_LAST_PATH",
                        tmp_path / "breadth_last.json")
    monkeypatch.setattr(nifty, "_BREADTH_LAST",
                        {"loaded": True, "block": None})
    nifty._SNAPSHOT_READ_CACHE.clear()
    nifty._DERIVED_SNAPSHOT_CACHE.clear()
    nifty._TAPE_READ_CACHE.clear()
    nifty._live_ws_cache.clear()
    nifty._live_cache.clear()
    yield
    nifty._live_ws_cache.clear()
    nifty._live_cache.clear()
    nifty._SNAPSHOT_READ_CACHE.clear()
    nifty._DERIVED_SNAPSHOT_CACHE.clear()
    nifty._TAPE_READ_CACHE.clear()


def _full_rows(base: float = 23500.0, n: int = 21,
               call_wall: float | None = None,
               put_wall: float | None = None) -> list[dict]:
    """A parsed chain (greeks + prev_oi) around ``base``, one strike per 50."""
    start = base - (n // 2) * 50
    rows = []
    for i in range(n):
        strike = start + i * 50
        ce_oi = 1_000_000 if strike == call_wall else 10_000 + i
        pe_oi = 1_000_000 if strike == put_wall else 8_000 + i
        rows.append({
            "strike": float(strike),
            "ce": {"ltp": 10.0 + i, "oi": ce_oi, "prev_oi": ce_oi - 500,
                   "volume": 100, "delta": 0.4, "gamma": 0.002,
                   "iv": 12.0, "oi_change": 500,
                   "sentiment": {"type": "Neutral"}},
            "pe": {"ltp": 20.0 + i, "oi": pe_oi, "prev_oi": pe_oi - 400,
                   "volume": 90, "delta": -0.4, "gamma": 0.002,
                   "iv": 13.0, "oi_change": 400,
                   "sentiment": {"type": "Neutral"}},
        })
    return rows


def _ws_snapshot(rows: list[dict], spot: float = 23500.0,
                 age_sec: float = 1.0, vix=13.5) -> dict:
    legs: dict[str, dict] = {}
    for row in rows:
        for side in ("ce", "pe"):
            leg = row[side]
            legs[f"{row['strike']}:{side}"] = {
                "ltp": leg["ltp"], "oi": leg["oi"], "volume": leg["volume"],
                "delta": leg["delta"], "gamma": leg["gamma"], "iv": leg["iv"],
            }
    return {"spot": spot, "expiry": "2026-11-05", "vix": vix,
            "legs": legs, "legs_ts": time.time() - age_sec}


# ---------------------------------------------------------------------------
# 1. chain10s frame reuse
# ---------------------------------------------------------------------------

class TestChain10sReuse:
    def test_fresh_frame_is_none_until_the_poller_has_run(self):
        assert chain10s.fresh_frame() is None

    def test_fresh_frame_returns_copied_rows(self):
        rows = _full_rows()
        chain10s.LAST_FULL.update({"t": "2026-11-02T14:00:00+05:30",
                                   "ts": time.time(), "spot": 23500.0,
                                   "expiry": "2026-11-05", "rows": rows})
        frame = chain10s.fresh_frame()
        assert frame is not None
        assert frame["expiry"] == "2026-11-05"
        assert len(frame["rows"]) == len(rows)
        frame["rows"][0]["strike"] = 1.0  # must not touch the cache
        assert chain10s.LAST_FULL["rows"][0]["strike"] == rows[0]["strike"]

    def test_stale_frame_is_rejected(self):
        chain10s.LAST_FULL.update({"ts": time.time() - 120, "spot": 23500.0,
                                   "expiry": "2026-11-05",
                                   "rows": _full_rows()})
        assert chain10s.fresh_frame(max_age_sec=30) is None

    def test_disabled_poller_never_reuses(self, monkeypatch):
        monkeypatch.setattr(chain10s, "ENABLED", False)
        chain10s.LAST_FULL.update({"ts": time.time(), "spot": 23500.0,
                                   "expiry": "2026-11-05",
                                   "rows": _full_rows()})
        assert chain10s.fresh_frame() is None

    def test_explicit_expiry_does_not_get_the_front_week_frame(self):
        chain10s.LAST_FULL.update({"ts": time.time(), "spot": 23500.0,
                                   "expiry": "2026-11-05",
                                   "rows": _full_rows()})
        assert nifty._chain10s_chain("2026-11-12") is None
        assert nifty._chain10s_chain("2026-11-05") is not None

    def test_all_zero_oi_frame_is_not_a_chain(self):
        rows = _full_rows()
        for row in rows:
            row["ce"]["oi"] = row["ce"]["prev_oi"] = 0
            row["pe"]["oi"] = row["pe"]["prev_oi"] = 0
        chain10s.LAST_FULL.update({"ts": time.time(), "spot": 23500.0,
                                   "expiry": "2026-11-05", "rows": rows})
        assert nifty._chain10s_chain() is None

    async def test_compute_live_reuses_the_frame_without_a_rest_call(self):
        rows = _full_rows()
        chain10s.LAST_FULL.update({"ts": time.time(), "spot": 23500.0,
                                   "expiry": "2026-11-05", "rows": rows})
        boom = AsyncMock(side_effect=AssertionError("REST chain must not be called"))
        with patch.object(nifty, "_fetch_chain_payload", boom):
            rep = await nifty._compute_live(None, with_verdicts=False,
                                            with_candles=False)
        boom.assert_not_awaited()
        assert rep["chain_source"] == "chain10s"
        assert rep["expiry"] == "2026-11-05"
        assert len(rep["strikes"]) == len(rows)
        assert rep["walls"]["calls"]  # built from the reused rows

    async def test_compute_live_falls_back_to_rest_when_no_frame(self):
        payload = {
            "underlying_spot_price": 22363.35,
            "data": [
                {"expiry": "2026-11-05", "strike_price": 22350.0,
                 "call_options": {"market_data": {"ltp": 50, "oi": 1000,
                                                  "prev_oi": 900, "volume": 10}},
                 "put_options": {"market_data": {"ltp": 60, "oi": 2000,
                                                 "prev_oi": 1800, "volume": 20}}},
            ],
        }
        with patch("api.options.get_expiries",
                   AsyncMock(return_value={"expiries": [{"date": "2026-11-05"}]})), \
             patch("api.options.fetch_upstox", AsyncMock(return_value=payload)):
            rep = await nifty._compute_live(None, with_verdicts=False,
                                            with_candles=False)
        assert rep["chain_source"] == "rest"


# ---------------------------------------------------------------------------
# 2. WS overlay
# ---------------------------------------------------------------------------

class TestWsOverlay:
    def test_overlay_replaces_walls_positioning_and_spot(self):
        base = {
            "spot": 23000.0,
            "walls": {"calls": [{"strike": 23100.0, "oi": 1}],
                      "puts": [{"strike": 22900.0, "oi": 1}]},
            "positioning": {"delta_flip": 23000.0, "flow_class": "old"},
            "gex": {"regime": "flat"},
            "vix": {"ltp": 12.0, "change_pct": -1.0},
            "control": {"verdict": "old"},
        }
        snap = _ws_snapshot(_full_rows(call_wall=23600.0, put_wall=23400.0))
        out = nifty._overlay_ws_blocks(base, snap, market_open=True)
        assert out["spot"] == 23500.0
        assert out["walls"]["calls"][0]["strike"] == 23600.0
        assert out["walls"]["puts"][0]["strike"] == 23400.0
        assert out["positioning"]["flow_class"] != "old"
        assert out["gex"]
        assert out["vix"]["ltp"] == 13.5
        assert out["vix"]["change_pct"] == -1.0  # merged, not replaced
        # No control/strikes in the snapshot -> the saved blocks survive.
        assert out["control"] == {"verdict": "old"}
        # The input report is never mutated.
        assert base["walls"]["calls"][0]["strike"] == 23100.0

    def test_overlay_uses_explicit_control_and_strikes_when_present(self):
        base = {"spot": 23000.0, "control": {"verdict": "old"},
                "strikes": [{"strike": 1.0}]}
        snap = _ws_snapshot(_full_rows())
        snap["control"] = {"verdict": "ws"}
        snap["strikes"] = [{"strike": 2.0}]
        out = nifty._overlay_ws_blocks(base, snap)
        assert out["control"] == {"verdict": "ws"}
        assert out["strikes"] == [{"strike": 2.0}]

    def test_stale_ws_legs_do_not_replace_the_chain_blocks(self):
        base = {"spot": 23000.0,
                "walls": {"calls": [{"strike": 23100.0}], "puts": []}}
        snap = _ws_snapshot(_full_rows(), age_sec=60)
        out = nifty._overlay_ws_blocks(base, snap, market_open=True)
        # Spot/vix still tick, but a frozen option stream is not a chain.
        assert out["spot"] == 23500.0
        assert out["walls"]["calls"][0]["strike"] == 23100.0
        assert "live_overlay" not in out

    def test_overlay_is_a_noop_for_an_empty_snapshot(self):
        base = {"spot": 1.0}
        assert nifty._overlay_ws_blocks(base, {}) == base
        assert nifty._overlay_ws_blocks(base, None) == base

    def test_get_nifty_reflects_a_ws_wall_change_without_writing(
            self, tmp_path, monkeypatch):
        """Acceptance proof: a WS wall move is served by GET /nifty, no write."""
        monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path)
        monkeypatch.setattr(nifty, "_cached_breadth", lambda: None)
        today = nifty._today_str()
        path = tmp_path / f"{today}.json"
        saved = {
            "spot": 23000.0,
            "walls": {"calls": [{"strike": 23100.0, "oi": 1}],
                      "puts": [{"strike": 22900.0, "oi": 1}]},
            "positioning": {"delta_flip": 23000.0, "flow_class": "saved"},
            "strikes": _full_rows(base=23000.0, call_wall=23100.0,
                                  put_wall=22900.0),
        }
        path.write_text(json.dumps(saved))
        before = path.read_text()
        mtime = path.stat().st_mtime_ns

        snap = _ws_snapshot(_full_rows(call_wall=23600.0, put_wall=23400.0))

        class _Md:
            @staticmethod
            def is_live():
                return True

            @staticmethod
            def snapshot():
                return snap

        monkeypatch.setattr(nifty, "_nifty_md", lambda: _Md)
        monkeypatch.setattr(nifty, "_market_open", lambda: True)
        out = nifty.get_nifty_report(date=today)

        assert out["walls"]["calls"][0]["strike"] == 23600.0
        assert out["walls"]["puts"][0]["strike"] == 23400.0
        assert out["spot"] == 23500.0
        assert out["positioning"]["flow_class"] != "saved"
        # The saved snapshot was not rewritten by the read.
        assert path.read_text() == before
        assert path.stat().st_mtime_ns == mtime


# ---------------------------------------------------------------------------
# 2b. post-close spot vs candle close, and 1-minute candle gaps
# ---------------------------------------------------------------------------

def _candle(time_str: str, o: float, h: float, l: float, c: float) -> dict:
    return {"time": time_str, "open": o, "high": h, "low": l, "close": c}


_DAY = "2026-11-03"
_T = _DAY + "T{}:00+05:30"


class TestClosedMarketSpot:
    def test_overlay_does_not_use_the_ws_spot_after_the_close(self):
        """2026-11-03: WS/chain spot 23,810.85 vs last 1-min close 23,731.85."""
        base = {
            "spot": 23810.85,
            "intraday": [
                _candle(_T.format("15:26"), 23731.85, 23731.85, 23731.85, 23731.85),
                _candle(_T.format("15:27"), 23731.85, 23731.85, 23731.85, 23731.85),
            ],
        }
        snap = _ws_snapshot(_full_rows(base=23800.0), spot=23810.85)
        out = nifty._overlay_ws_blocks(base, snap, market_open=False)
        assert out["spot"] == 23731.85
        assert out["spot_source"] == "last_candle_close"
        assert out["spot_chain"] == 23810.85
        assert out["live_overlay"]["source"] == "ws_closed"

    def test_overlay_still_uses_the_ws_spot_while_open(self):
        base = {"spot": 23000.0,
                "intraday": [_candle(_T.format("10:00"), 23490, 23500, 23480, 23499)]}
        snap = _ws_snapshot(_full_rows(), spot=23500.0)
        out = nifty._overlay_ws_blocks(base, snap, market_open=True)
        assert out["spot"] == 23500.0
        assert out["live_overlay"]["source"] == "ws"

    def test_closed_spot_is_clamped_to_the_days_range(self):
        candles = [
            _candle(_T.format("10:00"), 100.0, 120.0, 90.0, 95.0),
            # last close outside the printed range -> clamp to the high
            _candle(_T.format("10:01"), 95.0, 125.0, 94.0, 140.0),
        ]
        assert nifty.closed_market_spot(candles) == 125.0

    def test_null_candles_are_ignored_by_the_close(self):
        candles = [
            _candle(_T.format("15:20"), 23700.0, 23750.0, 23690.0, 23731.85),
            {"time": _T.format("15:21"), "open": None, "high": None,
             "low": None, "close": None},
        ]
        assert nifty.closed_market_spot(candles) == 23731.85
        assert nifty.closed_market_spot([]) is None

    def test_get_nifty_serves_the_candle_close_after_the_close(
            self, tmp_path, monkeypatch):
        monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path)
        monkeypatch.setattr(nifty, "_cached_breadth", lambda: None)
        monkeypatch.setattr(nifty, "_market_open", lambda: False)
        today = nifty._today_str()
        saved = {
            "spot": 23810.85,
            "intraday": [_candle(f"{today}T15:27:00+05:30",
                                 23731.85, 23731.85, 23731.85, 23731.85)],
        }
        (tmp_path / f"{today}.json").write_text(json.dumps(saved))
        out = nifty.get_nifty_report(date=today)
        assert out["spot"] == 23731.85
        assert out["spot_source"] == "last_candle_close"

    def test_get_nifty_keeps_the_chain_spot_while_open(self, tmp_path, monkeypatch):
        monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path)
        monkeypatch.setattr(nifty, "_cached_breadth", lambda: None)
        monkeypatch.setattr(nifty, "_market_open", lambda: True)
        today = nifty._today_str()
        saved = {
            "spot": 23810.85,
            "intraday": [_candle(f"{today}T15:27:00+05:30",
                                 23731.85, 23731.85, 23731.85, 23731.85)],
        }
        (tmp_path / f"{today}.json").write_text(json.dumps(saved))
        out = nifty.get_nifty_report(date=today)
        assert out["spot"] == 23810.85
        assert "spot_source" not in out


class TestCandleGapFill:
    def test_null_ohlc_rows_are_dropped_not_forward_filled(self):
        candles = [
            _candle(_T.format("09:15"), 23500, 23510, 23490, 23505),
            _candle(_T.format("09:16"), 23505, 23512, 23500, 23508),
            {"time": _T.format("09:17"), "open": None, "high": None,
             "low": None, "close": None},
            {"time": _T.format("09:18"), "open": None, "high": None,
             "low": None, "close": None},
            _candle(_T.format("09:19"), 23508, 23520, 23506, 23518),
        ]
        out = nifty.fill_candle_gaps(candles)
        assert [c["time"][11:16] for c in out] == ["09:15", "09:16", "09:19"]
        # The surviving bar was not widened to cover the hole.
        assert out[-1]["high"] == 23520

    def test_gap_is_filled_one_flat_bar_per_minute_from_the_tape(self):
        candles = [
            _candle(_T.format("09:15"), 23500, 23510, 23490, 23500),
            _candle(_T.format("09:20"), 23510, 23520, 23505, 23510),
        ]
        tape = [{"t": f"{_DAY}T{m}:30+05:30", "spot": s} for m, s in
                (("09:16", 23502), ("09:17", 23504), ("09:18", 23506),
                 ("09:19", 23508))]
        out = nifty.fill_candle_gaps(candles, tape)
        assert [c["time"][11:16] for c in out] == [
            "09:15", "09:16", "09:17", "09:18", "09:19", "09:20"]
        filled = [c for c in out if c.get("synthetic")]
        assert len(filled) == 4
        for bar in filled:
            assert bar["open"] == bar["high"] == bar["low"] == bar["close"]
            assert bar["volume"] == 0
        # Every bar is a one-minute bar: no bar spans the hole.
        assert out[-1]["high"] == 23520 and out[-1]["low"] == 23505

    def test_missing_tape_minutes_are_skipped_not_widened(self):
        candles = [
            _candle(_T.format("09:15"), 23500, 23510, 23490, 23500),
            _candle(_T.format("09:20"), 23510, 23520, 23505, 23510),
        ]
        tape = [{"t": _T.format("09:16"), "spot": 23502}]
        out = nifty.fill_candle_gaps(candles, tape)
        assert [c["time"][11:16] for c in out] == ["09:15", "09:16", "09:20"]
        assert out[-1]["open"] == 23510  # untouched, not stretched back

    def test_tape_spot_far_from_the_series_is_not_filled(self):
        """2026-11-03: chain underlying 23,810.85 vs candle close 23,731.85."""
        candles = [_candle(_T.format("15:27"), 23731.85, 23731.85,
                           23731.85, 23731.85)]
        tape = [{"t": _T.format("15:28"), "spot": 23731.85},
                {"t": _T.format("15:29"), "spot": 23810.85}]
        out = nifty.fill_candle_gaps(candles, tape)
        assert [c["time"][11:16] for c in out] == ["15:27", "15:28"]
        assert out[-1]["close"] == 23731.85

    def test_empty_candles_stay_empty(self):
        assert nifty.fill_candle_gaps([]) == []
        assert nifty.fill_candle_gaps(None, [{"t": _T.format("09:16"), "spot": 1}]) == []


# ---------------------------------------------------------------------------
# 3. wall hysteresis
# ---------------------------------------------------------------------------

def _frame(t: str, spot: float, call_wall: float, put_wall: float) -> dict:
    return {"t": t, "spot": spot, "call_wall": call_wall,
            "put_wall": put_wall, "walls": {"calls": [], "puts": []}}


class TestWallMoveHysteresis:
    def test_one_strike_wobble_is_not_an_alert(self):
        rows = [
            _frame("2026-11-02T10:00:00+05:30", 23500, 23600, 23400),
            _frame("2026-11-02T10:01:00+05:30", 23520, 23650, 23400),
            _frame("2026-11-02T10:02:00+05:30", 23510, 23600, 23400),
        ]
        assert nifty.detect_wall_moves(rows) == []

    def test_two_strike_migration_alerts_with_from_to(self):
        rows = [
            _frame("2026-11-02T10:00:00+05:30", 23500, 23600, 23400),
            _frame("2026-11-02T10:01:00+05:30", 23520, 23700, 23400),
        ]
        out = nifty.detect_wall_moves(rows)
        assert len(out) == 1
        alert = out[0]
        assert alert["kind"] == "wall"
        assert alert["type"] == "wall"
        assert alert["side"] == "call"
        assert alert["from"] == 23600
        assert alert["to"] == 23700
        assert alert["migration_strikes"] == 2.0
        assert alert["severity"] == "watch"

    def test_side_flip_alerts_even_without_migration(self):
        # The old put wall becomes the new call wall: support -> resistance.
        rows = [
            _frame("2026-11-02T10:00:00+05:30", 23500, 23600, 23500),
            _frame("2026-11-02T10:01:00+05:30", 23510, 23500, 23300),
        ]
        out = nifty.detect_wall_moves(rows)
        calls = [a for a in out if a["side"] == "call"]
        assert calls and calls[0]["flip"] is True
        assert calls[0]["severity"] == "alert"

    def test_gap_is_never_a_one_minute_migration(self):
        rows = [
            _frame("2026-11-02T10:00:00+05:30", 23500, 23600, 23400),
            _frame("2026-11-02T10:06:00+05:30", 23520, 23900, 23400),
        ]
        assert nifty.detect_wall_moves(rows) == []

    def test_legacy_walls_list_is_used_when_the_scalar_is_absent(self):
        rows = [
            {"t": "2026-11-02T10:00:00+05:30", "spot": 23500,
             "walls": {"calls": [{"strike": 23600}], "puts": [{"strike": 23400}]}},
            {"t": "2026-11-02T10:01:00+05:30", "spot": 23520,
             "walls": {"calls": [{"strike": 23800}], "puts": [{"strike": 23400}]}},
        ]
        out = nifty.detect_wall_moves(rows)
        assert len(out) == 1 and out[0]["to"] == 23800

    def test_tape_row_records_scalar_walls(self, tmp_path, monkeypatch):
        monkeypatch.setattr(nifty, "write_snapshot", lambda *a, **k: None)
        monkeypatch.setattr(nifty, "_append_minute_snapshot", AsyncMock())
        rows = _full_rows(call_wall=23600.0, put_wall=23400.0)
        report = {
            "spot": 23500.0, "pcr_oi": 1.1, "pcr_vol": 1.0,
            "max_pain": 23500.0, "gex": {"degraded": True},
            "strikes": rows,
            "walls_near": {"calls": [{"strike": 23600.0, "oi": 1_000_000}],
                           "puts": [{"strike": 23400.0, "oi": 1_000_000}]},
        }
        ts = nifty.datetime.now(nifty.config.IST)
        row = asyncio.run(nifty._write_tape_row(
            report, nifty._today_str(), ts.isoformat(), ts,
            tmp_path / "tape.jsonl", ts.strftime("%H:%M")))
        assert row is not None
        assert row["call_wall"] == 23600.0
        assert row["put_wall"] == 23400.0
        # The detector works from the written frame alone.
        assert nifty._frame_wall(row, "call") == 23600.0
        assert nifty._frame_wall(row, "put") == 23400.0

    def test_bursts_feed_emits_wall_kind(self, tmp_path, monkeypatch):
        monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path)
        monkeypatch.setattr(nifty, "_ensure_tape_task", lambda: None)
        monkeypatch.setattr(nifty, "_snapshot_oi_context",
                            lambda _d: (None, 0.0))
        # The recall journal must never write into the repo's experiments/.
        from api.reports_api import nifty_wall_events as wall_events
        monkeypatch.setattr(wall_events, "EVENTS_DIR", tmp_path / "events")
        monkeypatch.setattr(nifty, "notify_telegram", lambda _a: False)
        monkeypatch.setattr(nifty, "notify_new_bursts",
                            lambda *_a, **_k: 0)
        date_str = "2026-11-02"
        frames = [
            _frame(f"{date_str}T10:00:00+05:30", 23500, 23600, 23400),
            _frame(f"{date_str}T10:01:00+05:30", 23520, 23800, 23400),
        ]
        for f in frames:
            f.update({"ce_oi": 1000, "pe_oi": 900, "ce_vol": 10,
                      "pe_vol": 9, "strikes_top": [{"strike": 23500}]})
        with open(tmp_path / f"{date_str}.jsonl", "w") as fh:
            for f in frames:
                fh.write(json.dumps(f) + "\n")
        out = nifty.get_nifty_bursts(date=date_str, window=15, min_abs=0)
        walls = [b for b in out["bursts"] if b.get("kind") == "wall"]
        assert walls and walls[0]["from"] == 23600 and walls[0]["to"] == 23800


# ---------------------------------------------------------------------------
# 4. breadth attach
# ---------------------------------------------------------------------------

class TestBreadthAttach:
    def test_cold_cache_is_omitted(self, monkeypatch):
        from api.reports_api import breadth
        monkeypatch.setattr(breadth, "_cache", {"at": 0.0, "payload": None})
        assert nifty._cached_breadth() is None

    def test_stale_cache_is_dropped(self, monkeypatch):
        from api.reports_api import breadth
        monkeypatch.setattr(breadth, "_cache", {
            "at": time.time() - nifty._BREADTH_MAX_AGE_SEC - 1,
            "payload": {"available": True, "up": 3, "count": 5, "rows": []},
        })
        assert nifty._cached_breadth() is None

    def test_warm_cache_is_projected(self, monkeypatch):
        from api.reports_api import breadth
        payload = {"available": True, "up": 3, "count": 5,
                   "rows": [{"label": "NIFTY", "change_pct": 0.4}],
                   "fetched_at": "2026-11-02T15:00:00+0530"}
        monkeypatch.setattr(breadth, "_cache",
                            {"at": time.time(), "payload": payload})
        assert nifty._cached_breadth() == {
            "up": 3, "count": 5, "rows": payload["rows"],
            "fetched_at": payload["fetched_at"],
        }

    def test_get_attaches_breadth_for_today_only(self, tmp_path, monkeypatch):
        monkeypatch.setattr(nifty, "SNAPSHOT_DIR", tmp_path)
        monkeypatch.setattr(nifty, "_nifty_md", lambda: None)
        monkeypatch.setattr(nifty, "_cached_breadth",
                            lambda: {"up": 3, "count": 5, "rows": []})
        monkeypatch.setattr(nifty, "_cached_rotation_breadth", lambda: 61.2)
        today = nifty._today_str()
        (tmp_path / f"{today}.json").write_text(json.dumps({"spot": 23500}))
        (tmp_path / "2026-01-05.json").write_text(json.dumps({"spot": 23000}))

        today_rep = nifty.get_nifty_report(date=today)
        past_rep = nifty.get_nifty_report(date="2026-01-05")
        assert today_rep["breadth"]["up"] == 3
        assert today_rep["breadth"]["advances_pct"] == 61.2
        assert "breadth" not in past_rep

    def test_rotation_breadth_is_read_from_a_fresh_overview_cache(
            self, monkeypatch):
        from api import rotation
        now = time.monotonic()
        monkeypatch.setattr(rotation, "_overview_cache", {
            ("us", "sector", "1D", 5, 20):
                (now - 1, {"regime": {"breadth": 44.0}}),
            ("india", "sector", "1D", 5, 20):
                (now + 60, {"regime": {"breadth": 61.2},
                            "last_updated": "2026-11-02T14:00:00+05:30"}),
        })
        assert nifty._cached_rotation_breadth() == 61.2

    def test_rotation_breadth_ignores_expired_or_missing_cache(
            self, monkeypatch):
        from api import rotation
        monkeypatch.setattr(rotation, "_overview_cache", {
            ("india", "sector", "1D", 5, 20):
                (time.monotonic() - 1, {"regime": {"breadth": 61.2}}),
        })
        assert nifty._cached_rotation_breadth() is None
        monkeypatch.setattr(rotation, "_overview_cache", {})
        assert nifty._cached_rotation_breadth() is None

    def test_rotation_breadth_never_borrows_another_market(
            self, monkeypatch, tmp_path):
        """The 19% bug: a US overview was served as Nifty breadth.

        The rotation cache is keyed by market; a cold India entry must not fall
        back to a fresh ``america`` one. The strip would label a US risk-off
        print as Indian advance/decline.
        """
        from api import rotation
        monkeypatch.setattr(rotation, "_overview_cache", {
            ("america", "sector", "1D", 5, 20):
                (time.monotonic() + 60, {"regime": {"breadth": 19.0}}),
        })
        monkeypatch.setattr(nifty, "_BREADTH_LAST_PATH",
                            tmp_path / "last.json")
        monkeypatch.setattr(nifty, "_BREADTH_LAST",
                            {"loaded": True, "block": None})
        assert nifty._cached_rotation_breadth() is None
        assert nifty._breadth_block() is None

    def test_expired_rotation_breadth_is_served_as_stale_last_known(
            self, monkeypatch, tmp_path):
        from api import rotation
        monkeypatch.setattr(nifty, "_cached_breadth", lambda: None)
        monkeypatch.setattr(nifty, "_BREADTH_LAST_PATH",
                            tmp_path / "last.json")
        monkeypatch.setattr(nifty, "_BREADTH_LAST",
                            {"loaded": True, "block": None})
        monkeypatch.setattr(rotation, "_frame_cache", {})
        monkeypatch.setattr(rotation, "_overview_cache", {
            ("india", "sector", "1D", 5, 20):
                (time.monotonic() - 1,
                 {"regime": {"breadth": 61.2},
                  "last_updated": "2026-11-02T14:00:00+05:30"}),
        })

        block = nifty._breadth_block()

        assert block["advances_pct"] == 61.2
        assert block["stale"] is True
        assert block["as_of"] == "2026-11-02T14:00:00+05:30"
        # A stale reading is not written over the persisted last-known one.

    def test_fresh_breadth_carries_the_sample_size(self, monkeypatch, tmp_path):
        import pandas as pd
        from api import rotation
        monkeypatch.setattr(nifty, "_cached_breadth", lambda: None)
        monkeypatch.setattr(nifty, "_BREADTH_LAST_PATH",
                            tmp_path / "last.json")
        monkeypatch.setattr(nifty, "_BREADTH_LAST",
                            {"loaded": True, "block": None})
        frame = pd.DataFrame({
            "name": ["A", "B", "C", "D", "E"],
            "change": [1.0, 2.0, -1.0, -2.0, 0.0],
        })
        monkeypatch.setattr(rotation, "_frame_cache",
                            {"india": (time.monotonic() + 60, frame)})
        monkeypatch.setattr(rotation, "_overview_cache", {
            ("india", "sector", "1D", 5, 20):
                (time.monotonic() + 60,
                 {"regime": {"breadth": 50.0},
                  "last_updated": "2026-11-02T14:00:00+05:30"}),
        })

        block = nifty._breadth_block()

        # 2 up / 2 down over 4 traded names — the 5th has no change and is
        # outside the denominator.
        assert block["advances_pct"] == 50.0
        assert (block["advances"], block["declines"], block["total"]) == (2, 2, 4)
        assert block["stale"] is False
        assert (tmp_path / "last.json").exists()

    def test_persisted_breadth_survives_a_cold_process(self, monkeypatch, tmp_path):
        """A restart empties every cache; the last fresh read is still served."""
        import json as _json
        from api import rotation

        path = tmp_path / "last.json"
        path.write_text(_json.dumps({
            "at": time.time(),
            "block": {"advances_pct": 61.2, "advances": 1200,
                      "declines": 700, "total": 1900, "up": 3, "count": 5,
                      "rows": [], "fetched_at": "2026-11-02T15:00:00+0530",
                      "as_of": "2026-11-02T14:00:00+05:30", "stale": False},
        }))
        monkeypatch.setattr(nifty, "_BREADTH_LAST_PATH", path)
        monkeypatch.setattr(nifty, "_BREADTH_LAST",
                            {"loaded": False, "block": None})
        monkeypatch.setattr(nifty, "_cached_breadth", lambda: None)
        monkeypatch.setattr(rotation, "_overview_cache", {})
        monkeypatch.setattr(rotation, "_frame_cache", {})

        block = nifty._breadth_block()

        assert block["advances_pct"] == 61.2
        assert block["stale"] is True
        assert block["as_of"] == "2026-11-02T14:00:00+05:30"



class TestIvTerm:
    async def test_two_expiries_reach_the_term_structure(self, monkeypatch):
        """``expiries=`` is the documented way a caller supplies a curve."""
        from api.reports_api import nifty_verdicts as nv
        monkeypatch.setattr(nifty, "read_tape", lambda date: [])
        monkeypatch.setattr(nv, "get_baseline_range",
                            AsyncMock(return_value=None))
        monkeypatch.setattr(nv, "get_vix_block", AsyncMock(return_value=None))
        monkeypatch.setattr(nv, "get_intraday_candles",
                            AsyncMock(return_value=None))

        near = _full_rows()          # all legs 12/13 IV -> ATM 12.5
        far = _full_rows()           # all legs 20 IV  -> ATM 20.0
        for row in far:
            row["ce"]["iv"] = 20.0
            row["pe"]["iv"] = 20.0
        report = {"spot": 23500.0, "expiry": "2026-11-05",
                  "pivots": {"prev": {"close": 23400.0}}}

        await nifty._attach_verdicts(
            report, near, 23500.0, nifty._today_str(),
            expiries={"2026-11-12": far, "2026-11-05": near})

        term = report["iv_surface"]["term"]
        assert [entry["expiry"] for entry in term] == [
            "2026-11-05", "2026-11-12"]
        assert term[0]["atm_iv"] == pytest.approx(12.5)
        assert term[1]["atm_iv"] == pytest.approx(20.0)

    async def test_no_expiries_keeps_term_empty(self, monkeypatch):
        from api.reports_api import nifty_verdicts as nv
        monkeypatch.setattr(nifty, "read_tape", lambda date: [])
        monkeypatch.setattr(nv, "get_baseline_range",
                            AsyncMock(return_value=None))
        monkeypatch.setattr(nv, "get_vix_block", AsyncMock(return_value=None))
        monkeypatch.setattr(nv, "get_intraday_candles",
                            AsyncMock(return_value=None))
        report = {"spot": 23500.0, "expiry": "2026-11-05",
                  "pivots": {"prev": {"close": 23400.0}}}

        await nifty._attach_verdicts(
            report, _full_rows(), 23500.0, nifty._today_str())

        assert report["iv_surface"]["term"] == []

    async def test_compute_live_forwards_the_expiry_map(self, monkeypatch):
        rows = _full_rows()
        chain10s.LAST_FULL.update({"ts": time.time(), "spot": 23500.0,
                                   "expiry": "2026-11-05", "rows": rows})
        seen: dict = {}

        async def fake_attach(report, rows, spot, for_date, expiries=None):
            seen["expiries"] = expiries

        monkeypatch.setattr(nifty, "_attach_verdicts", fake_attach)
        monkeypatch.setattr(nifty, "get_pivots_block",
                            AsyncMock(return_value=None))
        expiries = {"2026-11-12": rows}

        await nifty._compute_live(None, with_candles=False, expiries=expiries)

        assert seen["expiries"] is expiries

    async def test_cached_live_bypasses_the_ttl_for_an_expiry_map(
            self, monkeypatch):
        """The 5s cache cannot describe the map, so a map never reads it."""
        compute = AsyncMock(return_value={"spot": 1.0})
        monkeypatch.setattr(nifty, "_compute_live", compute)
        nifty._live_cache["default"] = {"ts": time.time(),
                                        "data": {"spot": 2.0}}

        out = await nifty.get_cached_live(None, expiries={"2026-11-12": []})

        assert out["spot"] == 1.0
        assert compute.await_count == 1
        assert nifty._live_cache["default"]["data"]["spot"] == 2.0


# ---------------------------------------------------------------------------
# 5. snapshot cadence
# ---------------------------------------------------------------------------

class TestSnapshotCadence:
    def test_target_is_inside_35_seconds(self):
        assert nifty.SNAPSHOT_REFRESH_SEC <= 35

    def test_task_sleeps_against_a_wall_clock_target(self, monkeypatch):
        """The old loop slept a fixed 60s AFTER the build; this one subtracts.

        Captures the sleeps of three iterations with a fast (mocked) build: each
        must be ~SNAPSHOT_REFRESH_SEC, i.e. the cadence is the target, not
        target + build.
        """
        sleeps: list[float] = []
        writes: list[dict] = []

        real_sleep = asyncio.sleep

        async def _fake_sleep(sec):
            sleeps.append(sec)
            if len(sleeps) >= 3:
                raise asyncio.CancelledError()
            await real_sleep(0)

        async def _fake_compute(*a, **k):
            await real_sleep(0)
            return {"spot": 23500}

        monkeypatch.setattr(nifty.asyncio, "sleep", _fake_sleep)
        monkeypatch.setattr(nifty, "_compute_live", _fake_compute)
        monkeypatch.setattr(nifty, "write_snapshot",
                            lambda d, s: writes.append(s))
        monkeypatch.setattr("trading.utils.is_market_open", lambda: True)

        with pytest.raises(asyncio.CancelledError):
            asyncio.run(nifty.nifty_snapshot_task())

        assert len(writes) == 3
        assert all(s > 0 for s in sleeps[:3])
        assert all(s <= nifty.SNAPSHOT_REFRESH_SEC for s in sleeps[:3])
        assert [s for s in sleeps[:3]] == pytest.approx(
            [nifty.SNAPSHOT_REFRESH_SEC] * 3, abs=1.0)
        stamps = [w["snapshot_at"] for w in writes]
        assert all(isinstance(s, str) and "T" in s for s in stamps)


# ---------------------------------------------------------------------------
# 6. tape watchdog + Telegram fan-out
# ---------------------------------------------------------------------------

def _tape_row(hhmm: str, spot: float = 23_700.0) -> dict:
    return {"t": f"{_DAY}T{hhmm}:30+05:30", "spot": spot}


class TestTapeWatchdog:
    def test_stale_tape_is_critical(self):
        rows = [_tape_row("10:00"), _tape_row("10:05")]
        now = datetime.fromisoformat(f"{_DAY}T10:08:00+05:30")
        alert = nifty.detect_data_stale(rows, now=now, market_open=True)
        assert alert["type"] == "data_stale"
        assert alert["severity"] == "critical"
        assert alert["t"] == rows[-1]["t"]
        assert alert["age_sec"] == 150.0
        assert "2.5 min old" in alert["detail"]

    def test_fresh_tape_is_silent(self):
        rows = [_tape_row("10:00"), _tape_row("10:05")]
        now = datetime.fromisoformat(f"{_DAY}T10:06:00+05:30")
        assert nifty.detect_data_stale(rows, now=now, market_open=True) is None

    def test_closed_market_never_alerts(self):
        """After 15:30 the tape is SUPPOSED to stop."""
        rows = [_tape_row("15:29")]
        now = datetime.fromisoformat(f"{_DAY}T16:20:00+05:30")
        assert nifty.detect_data_stale(rows, now=now, market_open=False) is None

    def test_empty_or_junk_rows_never_raise(self):
        now = datetime.fromisoformat(f"{_DAY}T10:08:00+05:30")
        assert nifty.detect_data_stale([], now=now, market_open=True) is None
        assert nifty.detect_data_stale(None, now=now, market_open=True) is None
        assert nifty.detect_data_stale(
            [{"t": "not-a-date"}], now=now, market_open=True) is None

    def test_dedupe_suppresses_the_second_poll_within_5_minutes(self):
        rows = [_tape_row("10:00")]
        state: dict[str, float] = {}
        t0 = datetime.fromisoformat(f"{_DAY}T10:05:00+05:30")
        first = nifty.data_stale_alert(rows, _DAY, now=t0, market_open=True,
                                       state=state)
        assert first is not None
        later = datetime.fromisoformat(f"{_DAY}T10:08:00+05:30")
        assert nifty.data_stale_alert(rows, _DAY, now=later, market_open=True,
                                      state=state) is None
        after = datetime.fromisoformat(f"{_DAY}T10:11:00+05:30")
        assert nifty.data_stale_alert(rows, _DAY, now=after, market_open=True,
                                      state=state) is not None


class TestTelegramFanout:
    def _fake_notifier(self, monkeypatch):
        sent: list[tuple[str, str]] = []
        module = types.ModuleType("trading.telegram_notifier")

        def send_alert(message, cooldown_key=None):
            sent.append((message, cooldown_key))

        module.send_alert = send_alert
        monkeypatch.setitem(sys.modules, "trading.telegram_notifier", module)
        return sent

    def test_critical_alert_is_sent(self, monkeypatch):
        sent = self._fake_notifier(monkeypatch)
        alert = {"type": "data_stale", "severity": "critical",
                 "t": f"{_DAY}T10:00:30+05:30", "label": "TAPE STALE",
                 "detail": "recorder down"}
        assert nifty.notify_telegram(alert) is True
        assert sent and "TAPE STALE" in sent[0][0]
        assert sent[0][1] == f"nifty:data_stale:{alert['t']}"

    def test_watch_and_info_severities_are_not_sent(self, monkeypatch):
        sent = self._fake_notifier(monkeypatch)
        for severity in ("watch", "info", None):
            assert nifty.notify_telegram(
                {"type": "wall_test", "severity": severity}) is False
        assert sent == []

    def test_broken_notifier_never_raises(self, monkeypatch):
        module = types.ModuleType("trading.telegram_notifier")

        def send_alert(*a, **k):
            raise RuntimeError("telegram down")

        module.send_alert = send_alert
        monkeypatch.setitem(sys.modules, "trading.telegram_notifier", module)
        assert nifty.notify_telegram(
            {"type": "data_stale", "severity": "critical"}) is False

    def test_only_the_current_minute_is_pushed_and_only_once(self, monkeypatch):
        sent = self._fake_notifier(monkeypatch)
        bursts = [
            {"type": "rejection", "severity": "alert", "side": "call",
             "t": f"{_DAY}T11:54:30+05:30"},
            {"type": "data_stale", "severity": "critical",
             "t": f"{_DAY}T15:29:30+05:30"},
            {"type": "wall_test", "severity": "watch",
             "t": f"{_DAY}T15:29:30+05:30"},
        ]
        latest = f"{_DAY}T15:29:30+05:30"
        assert nifty.notify_new_bursts(bursts, "test-day", latest) == 1
        # A second poll of the same feed must not page again.
        assert nifty.notify_new_bursts(bursts, "test-day", latest) == 0
        assert len(sent) == 1
