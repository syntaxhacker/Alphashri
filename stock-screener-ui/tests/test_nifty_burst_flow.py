"""Buyer/writer classification for Nifty OI bursts (pure, no network).

ΔOI alone cannot tell a writer from a buyer: a put build is bullish only when
premium FELL (writers sold the puts). On 2026-10-21 the live chain showed put
builds as "Long Buildup" (buyers) and CE as "Short Buildup" (writers), so the
old "put build -> bullish" rule scored a +640K put build the wrong way round.
These tests pin the eight OI/premium combinations and the wiring into the
detectors + the evaluator's fallback.
"""

import importlib.util
from pathlib import Path

import pytest

from api.reports_api.nifty_bursts import (
    FLOW_BUYERS,
    FLOW_COVERING,
    FLOW_LIQUIDATION,
    FLOW_WRITERS,
    classify_flow,
    detect_oi_bursts,
    detect_strike_bursts,
)

#: (side, ΔOI, premium change, expected flow, expected bearish)
FLOW_CASES = [
    ("put", 640_000, +2.5, FLOW_BUYERS, True),        # put buyers -> bearish
    ("put", 640_000, -2.5, FLOW_WRITERS, False),      # put writers -> bullish
    ("put", -640_000, +2.5, FLOW_COVERING, False),    # short covering -> bullish
    ("put", -640_000, -2.5, FLOW_LIQUIDATION, True),  # long liquidation -> bearish
    ("call", 640_000, +2.5, FLOW_BUYERS, False),      # call buyers -> bullish
    ("call", 640_000, -2.5, FLOW_WRITERS, True),      # call writers -> bearish
    ("call", -640_000, +2.5, FLOW_COVERING, False),   # short covering -> bullish
    ("call", -640_000, -2.5, FLOW_LIQUIDATION, True),  # long liquidation -> bearish
]


@pytest.mark.parametrize("side,delta,premium,flow,bearish", FLOW_CASES)
def test_classify_flow_eight_combinations(side, delta, premium, flow, bearish):
    out = classify_flow(side, delta, premium)
    assert out == {"flow": flow, "bearish": bearish}


@pytest.mark.parametrize("premium", [None, 0, 0.0, float("nan"), "n/a"])
def test_classify_flow_undecidable_premium_returns_nothing(premium):
    """No premium direction -> no label, so callers keep the OI-only fallback."""
    assert classify_flow("put", 640_000, premium) == {}


def test_classify_flow_zero_or_unknown_side_returns_nothing():
    assert classify_flow("put", 0, 2.5) == {}
    assert classify_flow(None, 640_000, 2.5) == {}
    assert classify_flow("straddle", 640_000, 2.5) == {}


# ------------------------------------------------------------------ wiring

def _side_tape(put_doi, atm_pe_ltp, atm_strikes=None):
    """Index-total tape rows: quiet OI, then the last minute bursts."""
    n = len(put_doi)
    strikes = atm_strikes or [22600.0] * n
    return [
        {
            "t": f"2026-10-21T12:{30 + i:02d}:00+05:30",
            "spot": 22600.0,
            "call_doi": 0,
            "put_doi": p,
            "call_tick": 0,
            "put_tick": 0,
            "atm_strike": strikes[i],
            "atm_ce_ltp": 100.0,
            "atm_pe_ltp": q,
        }
        for i, (p, q) in enumerate(zip(put_doi, atm_pe_ltp))
    ]


QUIET_PUT = [0, 5_000, -4_000, 3_000, -2_000, 1_500, 700_000]
QUIET_PE = [120.0, 120.5, 120.0, 120.5, 120.0, 120.5, 126.0]


def _find_last(out):
    assert out, "expected a burst"
    return [b for b in out if b["side"] == "put"][-1]


def test_side_burst_reads_atm_put_premium_rise_as_buyers():
    out = detect_oi_bursts(_side_tape(QUIET_PUT, QUIET_PE), min_abs=20_000)
    b = _find_last(out)
    assert b["flow"] == FLOW_BUYERS
    assert b["bearish"] is True


def test_side_burst_reads_atm_put_premium_fall_as_writers():
    falling = [120.0, 120.5, 120.0, 120.5, 120.0, 120.5, 114.0]
    out = detect_oi_bursts(_side_tape(QUIET_PUT, falling), min_abs=20_000)
    b = _find_last(out)
    assert b["flow"] == FLOW_WRITERS
    assert b["bearish"] is False


def test_side_burst_without_premium_has_no_flow_fields():
    rows = _side_tape(QUIET_PUT, [0.0] * len(QUIET_PE))
    for r in rows:
        r.pop("atm_pe_ltp")
        r.pop("atm_ce_ltp")
    b = _find_last(detect_oi_bursts(rows, min_abs=20_000))
    assert "flow" not in b and "bearish" not in b


def test_side_burst_ignores_premium_across_an_atm_roll():
    """Consecutive atm_*_ltp values from different strikes are not a trade."""
    rolls = [22600.0] * 6 + [22650.0]
    rows = _side_tape(QUIET_PUT, QUIET_PE, atm_strikes=rolls)
    b = _find_last(detect_oi_bursts(rows, min_abs=20_000))
    assert "flow" not in b and "bearish" not in b


# ---------------------------------------------------------- strike bursts

STRIKE = 22600.0


def _strike_tape(pe_oi, pe_ltp_by_strike):
    """Per-strike tape: ``chain`` carries LTPs, ``strikes_top`` carries OI."""
    return [
        {
            "t": f"2026-10-21T12:{30 + i:02d}:00+05:30",
            "spot": 22600.0,
            "strikes_top": [{"strike": STRIKE, "ce_oi": 1_000_000, "pe_oi": oi}],
            # ATM premium moves the OPPOSITE way, to prove the burst uses its
            # own strike's premium rather than the ATM's.
            "atm_strike": STRIKE,
            "atm_ce_ltp": 100.0,
            "atm_pe_ltp": 100.0 - i,
            "chain": {
                str(int(STRIKE)): [100.0, ltp, 1_000_000, oi, 0, 0],
                "22650": [100.0, 100.0 - i, 1_000_000, 1_000_000, 0, 0],
            },
        }
        for i, (oi, ltp) in enumerate(zip(pe_oi, pe_ltp_by_strike))
    ]


QUIET_PE_OI = [0, 20_000, -15_000, 10_000, -5_000, 800_000]


def test_strike_burst_uses_that_strikes_own_premium():
    rising = [40.0, 40.2, 40.1, 40.3, 40.2, 46.0]
    out = detect_strike_bursts(_strike_tape(QUIET_PE_OI, rising))
    b = [x for x in out if x["strike"] == STRIKE and x["leg"] == "PE"][-1]
    assert b["flow"] == FLOW_BUYERS
    assert b["bearish"] is True


def test_strike_burst_falls_back_to_atm_premium_for_the_atm_strike():
    """Tapes before ``chain`` existed still rate the ATM strike itself."""
    rows = _strike_tape(QUIET_PE_OI, [40.0] * len(QUIET_PE_OI))
    for r in rows:
        r.pop("chain")
    rows[-2]["atm_pe_ltp"] = 40.0
    rows[-1]["atm_pe_ltp"] = 46.0
    b = [x for x in detect_strike_bursts(rows) if x["leg"] == "PE"][-1]
    assert b["flow"] == FLOW_BUYERS and b["bearish"] is True


def test_strike_burst_without_any_premium_has_no_flow_fields():
    rows = _strike_tape(QUIET_PE_OI, [40.0] * len(QUIET_PE_OI))
    for r in rows:
        r.pop("chain")
        r.pop("atm_pe_ltp")
        r.pop("atm_ce_ltp")
    b = [x for x in detect_strike_bursts(rows) if x["leg"] == "PE"][-1]
    assert "flow" not in b and "bearish" not in b


# ------------------------------------------------------- evaluator usage

def _load_evaluator():
    path = Path(__file__).resolve().parents[1] / "scripts" / "eval_oi_bursts.py"
    spec = importlib.util.spec_from_file_location("eval_oi_bursts", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_evaluator_prefers_flow_bearish_over_the_old_rule():
    ev = _load_evaluator()
    burst = {"side": "put", "delta": 640_000, "flow": FLOW_BUYERS, "bearish": True}
    assert ev.signal_is_bullish(burst) is False  # old rule said bullish
    assert ev.flow_classified(burst) is True


def test_evaluator_falls_back_to_oi_only_rule_without_flow():
    ev = _load_evaluator()
    burst = {"side": "put", "delta": 640_000}
    assert ev.signal_is_bullish(burst) is True
    assert ev.flow_classified(burst) is False


def test_evaluator_keeps_momentum_events_on_the_leg_that_moved():
    ev = _load_evaluator()
    squeeze = {"type": "squeeze", "side": "put", "leg": "PE",
               "delta": -9_000_000, "flow": FLOW_COVERING, "bearish": False}
    assert ev.signal_is_bullish(squeeze) is False
