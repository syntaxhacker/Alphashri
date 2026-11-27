"""One minute must never print the same option plan on both sides.

Regression for the live SENSEX 2026-11-26 09:55 tape: a call burst (buyers →
CE) and a put burst (writers → CE) were both given the identical CE 84400
plan, so the desk saw one trade idea twice as two alerts.
"""

from __future__ import annotations

import json
from datetime import datetime

import pytest

import api.reports_api.nifty as nifty
from api.reports_api.nifty import get_nifty_bursts

DATE = "2026-10-13"
SPOT = 84400.0
STRIKE = 84400.0
NOW = datetime.fromisoformat(f"{DATE}T09:19:30+05:30")


@pytest.fixture()
def _tape(tmp_path, monkeypatch):
    tape_dir = tmp_path / "nifty_tape"
    monkeypatch.setattr(nifty, "TAPE_DIR", tape_dir)
    return tape_dir


@pytest.fixture()
def _snapshots(tmp_path, monkeypatch):
    snap_dir = tmp_path / "nifty_reports"
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", snap_dir)
    return snap_dir


def _row(hhmm, ce_oi, pe_oi, ce_ltp, pe_ltp, spot):
    return {
        "t": f"{DATE}T{hhmm}:00+05:30",
        "ce_oi": ce_oi, "pe_oi": pe_oi,
        "ce_vol": 0, "pe_vol": 0,
        "spot": spot,
        "atm_strike": STRIKE,
        "atm_ce_ltp": ce_ltp, "atm_pe_ltp": pe_ltp,
        "pcr_oi": 1.0,
    }


def _tape_rows(ce_ltp_end, pe_ltp_end):
    """Three quiet minutes, then a +20K build on BOTH sides in one minute.

    CE premium rises and PE premium falls → call buyers (CE) and put writers
    (fade with CE). Both are fresh fuel, so both get a plan unless the
    attachment dedupes them.
    """
    return [
        _row("09:15", 1000, 5000, 200.0, 180.0, 84390.0),
        _row("09:16", 1100, 5100, 200.0, 180.0, 84392.0),
        _row("09:17", 1200, 5200, 200.0, 180.0, 84394.0),
        _row("09:18", 1300, 5300, 200.0, 180.0, 84396.0),
        _row("09:19", 21300, 25300, ce_ltp_end, pe_ltp_end, SPOT),
    ]


def _write_tape(tape_dir, rows):
    tape_dir.mkdir(parents=True, exist_ok=True)
    (tape_dir / f"{DATE}.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in rows)
    )


def _write_snapshot(snap_dir, strikes, spot=SPOT):
    snap_dir.mkdir(parents=True, exist_ok=True)
    (snap_dir / f"{DATE}.json").write_text(
        json.dumps({"spot": spot, "strikes": strikes})
    )


def _chain():
    return [{"strike": STRIKE, "ce": {"ltp": 220.35}, "pe": {"ltp": 160.0}}]


def _plan_key(signal):
    """The trade idea itself — basis prose is deliberately not part of it."""
    if not isinstance(signal, dict) or signal.get("leg") is None:
        return None
    return (signal["leg"], signal["strike"], signal["entry"], signal["sl"],
            signal["target"], signal["qty"], signal["lots"])


def _expected_leg(burst):
    """What the burst's own side + flow imply, independent of the attachment."""
    call = burst.get("side") == "call"
    flow = burst.get("flow")
    if flow == "buyers":
        return "CE" if call else "PE"
    if flow == "writers":
        return "PE" if call else "CE"
    if flow == "covering":
        return "CE"
    if flow == "liquidation":
        return "PE"
    building = (burst.get("delta") or 0) > 0
    return "PE" if call == building else "CE"


def _fetch(_tape, _snapshots, ce_ltp_end, pe_ltp_end):
    _write_tape(_tape, _tape_rows(ce_ltp_end, pe_ltp_end))
    _write_snapshot(_snapshots, _chain())
    return get_nifty_bursts(date=DATE, window=3, min_abs=1000, _now=NOW)


def test_same_minute_call_and_put_never_share_one_plan(_tape, _snapshots):
    out = _fetch(_tape, _snapshots, ce_ltp_end=220.0, pe_ltp_end=160.0)
    assert out["count"] == 2
    assert {b["side"] for b in out["bursts"]} == {"call", "put"}
    assert len({str(b["t"])[:16] for b in out["bursts"]}) == 1

    plans = [_plan_key(b.get("signal")) for b in out["bursts"]]
    assert len([p for p in plans if p is not None]) == 1, (
        f"one trade idea per minute, not one per side: {plans}"
    )
    for b in out["bursts"]:
        signal = b.get("signal")
        if signal is None:
            assert b.get("plan_suppressed") is True, (
                "a suppressed duplicate must say why there is no plan"
            )
            continue
        assert signal["leg"] == _expected_leg(b)
        # The surviving plan trades the leg that actually moved on that side.
        assert (signal["leg"] == "CE") == (b["side"] == "call")
    survivor = next(b for b in out["bursts"] if b.get("signal"))
    assert survivor["signal"]["strike"] == STRIKE


def test_only_the_side_with_a_valid_plan_gets_one(_tape, _snapshots):
    """PE buyers on a rising tape are counter-trend → only CE gets a plan."""
    out = _fetch(_tape, _snapshots, ce_ltp_end=220.0, pe_ltp_end=190.0)
    assert out["count"] == 2
    by_side = {b["side"]: b for b in out["bursts"]}

    call_signal = by_side["call"].get("signal")
    assert call_signal is not None
    assert call_signal["leg"] == _expected_leg(by_side["call"]) == "CE"

    put_signal = by_side["put"].get("signal")
    # The endpoint's honest no-plan marker is either null or the leg-less
    # placeholder with plan_suppressed; never a tradeable plan.
    assert _plan_key(put_signal) is None
    assert by_side["put"].get("plan_suppressed") is True
