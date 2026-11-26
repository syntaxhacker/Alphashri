"""Stop claiming buyer/writer from OI (or an ATM proxy) alone.

A chain10s frame carries per-strike OI and premium. The burst minute's frame
and the previous minute's frame must agree with the claimed flow direction on
the SAME strike, and the tape's spot must agree too. Otherwise the burst stays
on the feed as an observation, but it carries no flow verdict and no plan.
"""

from __future__ import annotations

import json
from datetime import datetime

import pytest

import api.reports_api.chain10s as chain10s
import api.reports_api.nifty as nifty
import api.reports_api.options_history as oh
from api.reports_api.nifty import get_nifty_bursts

DATE = "2026-11-30"
SPOT = 25000.0
STRIKE = 25000.0
MINUTES = ("09:14", "09:15", "09:16", "09:17", "09:18")
BURST_MINUTE = "09:18"
NOW = datetime.fromisoformat(f"{DATE}T09:19:00+05:30")


def _t(mm: str) -> str:
    return f"{DATE}T{mm}:00+05:30"


def _frame(mm: str, *, ce_oi: float, ce_ltp: float,
           expiry: str = "") -> dict:
    """One slim chain10s snapshot: [strike, ceLtp, ceOi, ceVol, peLtp, peOi, peVol]."""
    return {
        "t": f"{DATE}T{mm}:10:00+05:30",
        "spot": SPOT,
        "expiry": expiry,
        "rows": [
            [24950.0, 200.0, 1_000.0, 0.0, 50.0, 2_000.0, 0.0],
            [STRIKE, ce_ltp, ce_oi, 0.0, 80.0, 2_000.0, 0.0],
            [25050.0, 60.0, 1_000.0, 0.0, 130.0, 2_000.0, 0.0],
        ],
    }


def _tape_row(mm: str, *, ce_oi: float, ce_ltp: float, spot: float) -> dict:
    return {
        "t": _t(mm), "spot": spot,
        "ce_oi": ce_oi, "pe_oi": 5_000,
        "ce_vol": 0, "pe_vol": 0, "pcr_oi": 1.0,
        "atm_strike": STRIKE, "atm_ce_ltp": ce_ltp, "atm_pe_ltp": 80.0,
    }


@pytest.fixture()
def run_bursts(tmp_path, monkeypatch):
    """Write synthetic tape + chain10s + snapshot, then call the feed."""
    tape_dir = tmp_path / "tape"
    snap_dir = tmp_path / "snapshots"
    chain_dir = tmp_path / "chain10s"
    monkeypatch.setattr(nifty, "TAPE_DIR", tape_dir)
    monkeypatch.setattr(nifty, "SNAPSHOT_DIR", snap_dir)
    monkeypatch.setattr(chain10s, "_dir", lambda: chain_dir)

    def run(*, ce_oi, ce_ltp, spot,
            chain_oi=None, chain_ltp=None, expiry="", omit_minutes=()):
        chain_oi = ce_oi if chain_oi is None else chain_oi
        chain_ltp = ce_ltp if chain_ltp is None else chain_ltp

        tape_dir.mkdir(parents=True, exist_ok=True)
        (tape_dir / f"{DATE}.jsonl").write_text(
            "".join(json.dumps(_tape_row(mm, ce_oi=ce_oi[i], ce_ltp=ce_ltp[i],
                                         spot=spot[i])) + "\n"
                    for i, mm in enumerate(MINUTES)),
            encoding="utf-8",
        )
        snap_dir.mkdir(parents=True, exist_ok=True)
        (snap_dir / f"{DATE}.json").write_text(json.dumps({
            "spot": spot[-1], "max_pain": 24990.0,
            "strikes": [{"strike": STRIKE, "ce": {"ltp": ce_ltp[-1]},
                         "pe": {"ltp": 80.0}}],
        }), encoding="utf-8")
        chain_dir.mkdir(parents=True, exist_ok=True)
        (chain_dir / f"{DATE}.jsonl").write_text(
            "".join(json.dumps(_frame(mm, ce_oi=chain_oi[i],
                                      ce_ltp=chain_ltp[i], expiry=expiry)) + "\n"
                    for i, mm in enumerate(MINUTES) if mm not in omit_minutes),
            encoding="utf-8",
        )
        out = get_nifty_bursts(date=DATE, window=3, min_abs=1000, _now=NOW)
        matches = [b for b in out["bursts"]
                   if str(b.get("t") or "")[:16] == _t(BURST_MINUTE)[:16]
                   and str(b.get("side") or "") == "call"]
        assert len(matches) == 1, out["bursts"]
        return matches[0]

    return run


def _build_case():
    """A +20K call build: ATM premium up, same-strike premium up, spot up."""
    return {
        "ce_oi": [1000.0, 1000.0, 1000.0, 1000.0, 21000.0],
        "ce_ltp": [120.0, 120.0, 120.0, 120.0, 126.0],
        "spot": [25000.0, 25000.0, 25000.0, 25000.0, 25010.0],
    }


def test_confirmed_same_strike_and_spot_keeps_plan(run_bursts):
    b = run_bursts(**_build_case())
    assert b["flow"] == "buyers"
    assert b["bearish"] is False
    c = b["confirmation"]
    assert c["same_strike"] == STRIKE
    assert c["strike_oi_delta"] == pytest.approx(20_000.0)
    assert c["strike_premium_change"] == pytest.approx(6.0)
    assert c["spot_change"] == pytest.approx(10.0)
    assert c["reasons"] == []
    assert b.get("plan_suppressed") is not True
    assert b["signal"] is not None
    assert b["signal"]["leg"] == "CE"


def test_atm_buyers_but_flat_same_strike_premium_is_unconfirmed(run_bursts):
    case = _build_case()
    # The ATM tape still says "buyers"; the contract that actually moved did
    # not reprice at all. No verified direction -> no flow claim, no plan.
    b = run_bursts(**case, chain_ltp=[120.0] * 5)
    assert b["flow"] == "unconfirmed"
    assert b["fuel_state"] is None
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    c = b["confirmation"]
    assert c["strike_premium_change"] == pytest.approx(0.0)
    assert c["strike_oi_delta"] == pytest.approx(20_000.0)
    assert "same_strike_premium_undecidable" in c["reasons"]


def test_atm_buyers_but_opposite_same_strike_premium_is_unconfirmed(run_bursts):
    b = run_bursts(**_build_case(), chain_ltp=[120.0, 120.0, 120.0, 120.0, 114.0])
    assert b["flow"] == "unconfirmed"
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    assert "same_strike_premium_disagrees" in b["confirmation"]["reasons"]


def test_spot_contradiction_suppresses_the_plan(run_bursts):
    case = _build_case()
    case["spot"] = [25000.0, 25000.0, 25000.0, 25000.0, 24990.0]
    b = run_bursts(**case)
    assert b["flow"] == "unconfirmed"
    assert b["fuel_state"] is None
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    c = b["confirmation"]
    assert c["spot_change"] == pytest.approx(-10.0)
    assert "spot_disagrees" in c["reasons"]


def test_missing_chain10s_frame_is_unconfirmed(run_bursts):
    b = run_bursts(**_build_case(), omit_minutes=(BURST_MINUTE,))
    assert b["flow"] == "unconfirmed"
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    c = b["confirmation"]
    assert c["same_strike"] is None
    assert c["strike_oi_delta"] is None
    assert c["strike_premium_change"] is None
    assert c["spot_change"] == pytest.approx(10.0)
    assert "missing_chain10s_frame" in c["reasons"]


def test_flat_spot_is_neutral_not_a_contradiction(run_bursts):
    case = _build_case()
    case["spot"] = [25010.0] * 5  # spot frozen inside the CAS window
    b = run_bursts(**case)
    assert b["flow"] == "buyers"
    assert b["confirmation"]["spot_change"] == pytest.approx(0.0)
    assert b["signal"] is not None
    assert b["signal"]["leg"] == "CE"


def test_zero_dte_expiry_unwind_suppresses_plan_without_changing_type(run_bursts):
    unwind = {
        "ce_oi": [21000.0, 21000.0, 21000.0, 21000.0, 1000.0],
        "ce_ltp": [126.0, 126.0, 126.0, 126.0, 120.0],
        "spot": [25010.0, 25010.0, 25010.0, 25010.0, 25000.0],
    }
    control = run_bursts(**unwind, expiry="2026-12-04")
    # The identical move on a normal expiry is confirmed and planned.
    assert control["flow"] == "liquidation"
    assert control.get("context") != "expiry_unwind"
    assert control["signal"] is not None
    assert control["signal"]["leg"] == "PE"

    b = run_bursts(**unwind, expiry=DATE)
    assert b["context"] == "expiry_unwind"
    assert b["flow"] != "unconfirmed"  # still a real unwind, just not a plan
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    assert b["confirmation"]["strike_oi_delta"] == pytest.approx(-20_000.0)
    assert "expiry_unwind" in b["confirmation"]["reasons"]
    # Detection is untouched: only the directional plan is withheld.
    assert b.get("type") == control.get("type")
    assert b["severity"] == control["severity"]
    assert b["delta"] == control["delta"]


def test_zero_dte_unwind_is_tagged_even_without_premium_confirmation(run_bursts):
    unwind = {
        "ce_oi": [21000.0, 21000.0, 21000.0, 21000.0, 1000.0],
        "ce_ltp": [126.0] * 5,
        "spot": [25010.0, 25010.0, 25010.0, 25010.0, 25000.0],
    }
    b = run_bursts(**unwind, chain_ltp=[120.0] * 5, expiry=DATE)
    assert b["context"] == "expiry_unwind"
    assert b.get("flow") in (None, "unconfirmed")
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    assert "expiry_unwind" in b["confirmation"]["reasons"]


# ---------------------------------------------------------------- generic path
# SENSEX uses /api/reports/options/{underlying}/bursts, a SEPARATE enrichment
# loop with its own per-symbol chain10s day file. The same gate must run there.

GEN_DATE = "2026-11-27"
GEN_SYMBOL = "SENSEX"
GEN_SPOT = 84000.0
GEN_STRIKE = 84000.0


def _gen_tape_row(mm: str, *, ce_oi: float, ce_ltp: float, spot: float) -> dict:
    return {
        "t": f"{GEN_DATE}T{mm}:00+05:30", "spot": spot,
        "ce_oi": ce_oi, "pe_oi": 5_000,
        "ce_vol": 0, "pe_vol": 0, "pcr_oi": 1.0,
        "atm_strike": GEN_STRIKE, "atm_ce_ltp": ce_ltp, "atm_pe_ltp": 80.0,
    }


def _gen_frame(mm: str, *, ce_oi: float, ce_ltp: float) -> dict:
    return {
        "t": f"{GEN_DATE}T{mm}:10:00+05:30",
        "spot": GEN_SPOT,
        "expiry": "2026-12-04",
        "rows": [
            [83950.0, 200.0, 1_000.0, 0.0, 50.0, 2_000.0, 0.0],
            [GEN_STRIKE, ce_ltp, ce_oi, 0.0, 80.0, 2_000.0, 0.0],
            [84050.0, 60.0, 1_000.0, 0.0, 130.0, 2_000.0, 0.0],
        ],
    }


@pytest.fixture()
def run_generic_bursts(tmp_path, monkeypatch):
    """Write SENSEX-shaped tape/snapshot/symbol-chain10s, then call its feed."""
    root = tmp_path / "experiments" / "data"
    monkeypatch.setattr(oh, "DATA_ROOT", root)
    oh._SLIM_CACHE.clear()

    def run(*, ce_oi, ce_ltp, spot, chain_oi=None, chain_ltp=None,
            omit_minutes=()):
        chain_oi = ce_oi if chain_oi is None else chain_oi
        chain_ltp = ce_ltp if chain_ltp is None else chain_ltp
        for kind, suffix, rows in (
            (oh.TAPE_DIR, ".jsonl", [
                _gen_tape_row(mm, ce_oi=ce_oi[i], ce_ltp=ce_ltp[i], spot=spot[i])
                for i, mm in enumerate(MINUTES)]),
            (oh.CHAIN10S_DIR, ".jsonl", [
                _gen_frame(mm, ce_oi=chain_oi[i], ce_ltp=chain_ltp[i])
                for i, mm in enumerate(MINUTES) if mm not in omit_minutes]),
            (oh.SNAPSHOTS_DIR, ".json", {
                "spot": spot[-1], "max_pain": 83990.0, "lot_size": 500,
                "strikes": [{"strike": GEN_STRIKE,
                             "ce": {"ltp": ce_ltp[-1]}, "pe": {"ltp": 80.0}}],
            }),
        ):
            path = root / kind / GEN_SYMBOL / f"{GEN_DATE}{suffix}"
            path.parent.mkdir(parents=True, exist_ok=True)
            if suffix == ".json":
                path.write_text(json.dumps(rows), encoding="utf-8")
            else:
                path.write_text("".join(json.dumps(r) + "\n" for r in rows),
                                encoding="utf-8")
        out = oh.get_options_bursts(GEN_SYMBOL, date=GEN_DATE,
                                    window=3, min_abs=1000)
        matches = [b for b in out["bursts"]
                   if str(b.get("t") or "")[:16] == f"{GEN_DATE}T{BURST_MINUTE}"
                   and str(b.get("side") or "") == "call"]
        assert len(matches) == 1, out["bursts"]
        return matches[0]

    yield run
    oh._SLIM_CACHE.clear()


def _generic_build():
    return {
        "ce_oi": [1000.0, 1000.0, 1000.0, 1000.0, 21000.0],
        "ce_ltp": [120.0, 120.0, 120.0, 120.0, 126.0],
        "spot": [84000.0, 84000.0, 84000.0, 84000.0, 84010.0],
    }


def test_generic_unconfirmed_when_same_strike_premium_conflicts(run_generic_bursts):
    b = run_generic_bursts(**_generic_build(), chain_ltp=[120.0] * 5)
    assert b["flow"] == "unconfirmed"
    assert b["fuel_state"] is None
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    assert b["confirmation"]["same_strike"] == GEN_STRIKE
    assert b["confirmation"]["strike_oi_delta"] == pytest.approx(20_000.0)
    assert b["confirmation"]["strike_premium_change"] == pytest.approx(0.0)
    assert "same_strike_premium_undecidable" in b["confirmation"]["reasons"]


def test_generic_confirmed_plan_retains_symbol_lot_sizing(run_generic_bursts):
    b = run_generic_bursts(**_generic_build())
    c = b["confirmation"]
    assert c["same_strike"] == GEN_STRIKE
    assert c["strike_premium_change"] == pytest.approx(6.0)
    assert c["spot_change"] == pytest.approx(10.0)
    assert c["reasons"] == []
    assert b["flow"] == "buyers"
    assert b.get("plan_suppressed") is not True
    assert b["signal"] is not None
    assert b["signal"]["leg"] == "CE"
    # Lot re-sizing must still happen for a confirmed generic plan.
    assert b["signal"]["lot_size"] == 500
    assert b["signal"]["lot_size_verified"] is True
    assert b["signal"]["qty"] == b["signal"]["lots"] * 500
    assert b["signal"]["qty"] % 500 == 0


def test_generic_missing_burst_minute_frame_is_unconfirmed(run_generic_bursts):
    b = run_generic_bursts(**_generic_build(), omit_minutes=(BURST_MINUTE,))
    assert b["flow"] == "unconfirmed"
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    assert b["confirmation"]["same_strike"] is None
    assert "missing_chain10s_frame" in b["confirmation"]["reasons"]


def test_generic_spot_contradiction_suppresses_the_plan(run_generic_bursts):
    case = _generic_build()
    case["spot"] = [84000.0, 84000.0, 84000.0, 84000.0, 83990.0]
    b = run_generic_bursts(**case)
    assert b["flow"] == "unconfirmed"
    assert b["signal"] is None
    assert b["plan_suppressed"] is True
    assert b["confirmation"]["spot_change"] == pytest.approx(-10.0)
    assert "spot_disagrees" in b["confirmation"]["reasons"]
