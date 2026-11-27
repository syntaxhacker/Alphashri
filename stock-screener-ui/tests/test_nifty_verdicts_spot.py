"""A writer verdict must agree with the short-window spot move.

The 2026-11-26 NIFTY tape printed ``put_writers`` with spot −25.3 in 15
minutes: the chain's falling put premium produced a bullish premium-flow bias,
but nothing checked the index itself. These tests pin the spot gate on both
report paths and on the burst feed's squeeze setup labels.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

import api.reports_api.nifty as nifty
import api.reports_api.nifty_verdicts as nv
import api.reports_api.options_report as options_report

DATE = "2026-11-26"
SPOT = 25_879.9
MINUTE = "11:45"


def _moved_tape(rise: bool) -> list[dict]:
    """16 one-minute tape rows; the 15m window spans −25.3 / +25.3 points."""
    first = datetime.fromisoformat(f"{DATE}T11:30:00+05:30")
    out = []
    for i in range(16):
        spot = SPOT + (i * 25.3 / 15) if rise else SPOT + 25.3 - (i * 25.3 / 15)
        out.append({
            "t": (first + timedelta(minutes=i)).isoformat(),
            "spot": round(spot, 2),
            "ce_oi": 1_000 + i,
            "pe_oi": 2_000 + i,
        })
    return out


def _chain_rows(call_writers: bool = False) -> list[dict]:
    """Put-dominant (or call-dominant) build with premium confirming a writer."""
    if call_writers:
        ce = {"oi": 2_000_000, "prev_oi": 1_000_000, "delta": 0.5,
              "price_change": -4.0, "iv": 15.0}
        pe = {"oi": 1_100_000, "prev_oi": 1_000_000, "delta": 0.4,
              "price_change": 6.0, "iv": 14.0}
    else:
        ce = {"oi": 1_100_000, "prev_oi": 1_000_000, "delta": 0.5,
              "price_change": 4.0, "iv": 14.0}
        pe = {"oi": 2_000_000, "prev_oi": 1_000_000, "delta": 0.4,
              "price_change": -6.0, "iv": 15.0}
    return [{"strike": 25_850.0, "ce": ce, "pe": pe}]


def _positioning() -> dict:
    """Raw signed flow is bearish; the class-weighted figure is not."""
    return {"flow": -18_182.03, "initiated": 120_000.0}


class TestSpotChangeFromTape:
    def test_falling_15m_window_uses_the_windows_strip_anchor(self):
        assert nv.spot_change_from_tape(_moved_tape(rise=False)) == pytest.approx(
            -25.3, abs=0.02)

    def test_rising_15m_window(self):
        assert nv.spot_change_from_tape(_moved_tape(rise=True)) == pytest.approx(
            25.3, abs=0.02)

    def test_missing_spot_or_timestamp_is_unknown(self):
        assert nv.spot_change_from_tape([{"spot": SPOT}, {"spot": SPOT - 10}]) is None
        assert nv.spot_change_from_tape([{"t": f"{DATE}T11:30:00+05:30"}]) is None
        assert nv.spot_change_from_tape([]) is None


class TestControlVerdictSpotGate:
    @pytest.mark.parametrize("ce_doi,pe_doi,bias,spot_change,expected", [
        (100, 1_000, 1_000.0, -25.3, "net_put_build"),
        (100, 1_000, 1_000.0, 25.3, "put_writers"),
        (1_000, 100, -1_000.0, 25.3, "net_call_build"),
        (1_000, 100, -1_000.0, -25.3, "call_writers"),
        # A flat tape cannot contradict a writer — mirror verify_burst_flow's
        # strict ``spot_change != 0`` rule instead of inventing a direction.
        (100, 1_000, 1_000.0, 0.0, "put_writers"),
        (1_000, 100, -1_000.0, 0.0, "call_writers"),
        # No spot evidence at all keeps the old behaviour (old snapshots).
        (100, 1_000, 1_000.0, None, "put_writers"),
        (1_000, 100, -1_000.0, None, "call_writers"),
        # Buyers keep their label: the gate is for writers only.
        (100, 1_000, -1_000.0, 25.3, "put_buyers"),
        (1_000, 100, 1_000.0, -25.3, "call_buyers"),
    ])
    def test_writer_direction_needs_spot_agreement(
            self, ce_doi, pe_doi, bias, spot_change, expected):
        assert nv.control_verdict(ce_doi, pe_doi, bias,
                                  spot_change=spot_change) == expected


class TestComputeControlSpotGate:
    def test_falling_spot_neutralizes_premium_confirmed_put_writing(self):
        out = nv.compute_control(_chain_rows(), spot=SPOT,
                                 flow_bias=-18_182.03, spot_change=-25.3)
        assert out["flow_bias"] > 0  # the chain still says "put writing"
        assert out["verdict"] == "net_put_build"
        assert set(out) == {"verdict", "ce_doi", "pe_doi", "flow_bias",
                            "atm_ce_iv", "atm_pe_iv", "skew", "put_skew",
                            "gex_regime"}

    def test_rising_spot_keeps_the_confirmed_verdict(self):
        out = nv.compute_control(_chain_rows(), spot=SPOT,
                                 flow_bias=-18_182.03, spot_change=25.3)
        assert out["verdict"] == "put_writers"

    def test_call_writers_are_neutralized_by_a_rising_spot(self):
        out = nv.compute_control(_chain_rows(call_writers=True), spot=SPOT,
                                 flow_bias=18_182.03, spot_change=25.3)
        assert out["flow_bias"] < 0
        assert out["verdict"] == "net_call_build"


async def _attach_nifty(tape: list[dict], monkeypatch) -> dict:
    monkeypatch.setattr(nv, "get_baseline_range", AsyncMock(return_value=None))
    monkeypatch.setattr(nv, "get_vix_block", AsyncMock(return_value=None))
    monkeypatch.setattr(nv, "get_intraday_candles", AsyncMock(return_value=None))
    monkeypatch.setattr(nifty, "read_tape", lambda date: tape)
    monkeypatch.setattr(nifty, "_today_str", lambda: DATE)
    report: dict = {"candles": [], "gex": {"regime": "flat"},
                    "positioning": _positioning()}
    await nifty._attach_verdicts(report, _chain_rows(), SPOT, DATE)
    return report


class TestNiftyReportPath:
    async def test_put_writers_neutralized_when_spot_falls(self, monkeypatch):
        report = await _attach_nifty(_moved_tape(rise=False), monkeypatch)
        assert report["control"]["flow_bias"] > 0
        assert report["control"]["verdict"] == "net_put_build"

    async def test_put_writers_retained_when_spot_rises(self, monkeypatch):
        report = await _attach_nifty(_moved_tape(rise=True), monkeypatch)
        assert report["control"]["verdict"] == "put_writers"


async def _attach_generic(tape: list[dict], monkeypatch) -> dict:
    monkeypatch.setattr(options_report, "get_daily_context",
                        AsyncMock(return_value={}))
    monkeypatch.setattr(options_report, "read_tape",
                        lambda symbol, date: tape)
    monkeypatch.setattr(nv, "get_vix_block", AsyncMock(return_value=None))
    report: dict = {"date": DATE, "spot": SPOT, "strikes": _chain_rows(),
                    "gex": {"regime": "flat"}, "positioning": _positioning()}
    await options_report._attach_analytics("SENSEX", report, [])
    return report


class TestGenericReportPath:
    async def test_sensex_put_writers_neutralized_when_spot_falls(self, monkeypatch):
        report = await _attach_generic(_moved_tape(rise=False), monkeypatch)
        assert report["control"]["flow_bias"] > 0
        assert report["control"]["verdict"] == "net_put_build"

    async def test_sensex_put_writers_retained_when_spot_rises(self, monkeypatch):
        report = await _attach_generic(_moved_tape(rise=True), monkeypatch)
        assert report["control"]["verdict"] == "put_writers"


BURST = {
    "id": f"{DATE}T{MINUTE}:00+05:30-squeeze-call",
    "t": f"{DATE}T{MINUTE}:00+05:30",
    "side": "call", "type": "squeeze", "delta": 20_000.0,
    "premChg": 5.0, "spot": SPOT, "wall": 25_900.0, "score": 3.0,
    "severity": "critical",
}


def _run_bursts(monkeypatch, *, verified: bool) -> dict:
    monkeypatch.setattr(nifty, "_ensure_tape_task", lambda: None)
    monkeypatch.setattr(nifty, "read_tape",
                        lambda date: [{"t": BURST["t"], "spot": SPOT}])
    monkeypatch.setattr(nifty, "derive_tape_rows", lambda raw: raw)
    for name in ("detect_squeezes", "detect_strike_bursts", "detect_premium_moves",
                 "detect_coiling", "detect_wall_moves", "_wall_event_alerts"):
        monkeypatch.setattr(nifty, name, lambda *a, **k: [])
    monkeypatch.setattr(nifty, "detect_oi_bursts",
                        lambda *a, **k: [dict(BURST)])
    monkeypatch.setattr(nifty, "data_stale_alert", lambda *a, **k: None)
    monkeypatch.setattr(nifty, "notify_new_bursts", lambda *a, **k: None)
    monkeypatch.setattr(nifty, "_snapshot_oi_context", lambda date: ([], None))
    monkeypatch.setattr(nifty, "read_snapshot", lambda date: {})
    monkeypatch.setattr(nifty, "session_trend", lambda *a, **k: "up")
    monkeypatch.setattr(nifty, "_cached_chain10s_minute_frames",
                        lambda date: {BURST["t"][:16]: {}})
    def fake_verify(burst, *a, **k):
        if not verified:  # the real gate marks the burst before returning False
            burst["plan_suppressed"] = True
        return verified

    monkeypatch.setattr(nifty, "verify_burst_flow", fake_verify)
    out = nifty.get_nifty_bursts(
        date=DATE, _now=datetime.fromisoformat(f"{DATE}T11:46:00+05:30"))
    assert out["count"] == 1, out["bursts"]
    return out["bursts"][0]


class TestUnconfirmedSqueezeSetup:
    def test_unconfirmed_squeeze_has_no_setup_label(self, monkeypatch):
        b = _run_bursts(monkeypatch, verified=False)
        assert b.get("plan_suppressed") is True
        assert not b.get("setup"), b
        assert not b.get("setup_label"), b

    def test_confirmed_squeeze_keeps_its_setup_label(self, monkeypatch):
        b = _run_bursts(monkeypatch, verified=True)
        assert b["setup"] == "wall_squeeze"
        assert b["setup_label"] == "WALL SQUEEZE"
