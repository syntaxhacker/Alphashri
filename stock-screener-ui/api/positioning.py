"""Options Positioning — pure delta-weighted OI math.

No HTTP imports. Plain dicts in/out so the logic is unit-testable
without FastAPI, Upstox, or auth.

Conventions (v2):
- ``chain_rows`` are ``/chain``-shaped rows: ``{strike, ce|None, pe|None}``.
- Each contract carries ``market_data: {oi, prev_oi}``,
  ``option_greeks: {delta, ...} | None`` and ``sentiment: {type}``.
- ``dOI = oi - prev_oi`` where Upstox ``prev_oi`` is the prior-session
  close OI, so "since open" ≈ "vs prev close" (documented in the endpoint).
- A contract is *readable* when the greeks object is present AND delta
  is not None. delta == 0 with greeks present counts readable (contributes 0).
- Units: ``/api/options/positioning`` is fed by ``_fetch_chain_rows`` →
  ``transform_option_contract``, i.e. the Upstox ``/option/chain`` payload,
  whose ``market_data.oi`` is already in **units (shares)**. Crore conversion
  is therefore ``signed_delta * oi * spot / 1e7``; applying the lot size would
  inflate every figure 65× (same defect fixed in ``reports_api/nifty_positioning.py``).
  ``lot_size`` stays in the signature for callers but is not applied.

Two conventions, never mixed
-----------------------------
``initiated`` used to be the **signed-delta** net (calls +, puts −) here while
the Nifty report's ``initiated`` was **class-weighted** (each leg signed by its
buildup/unwind class). For the same chain the two disagreed in sign
(2026-10-21 15:29: +26,352 Cr vs −50,145 Cr) — one field, two meanings.

This module now emits the **class-weighted** numbers as ``initiated`` (same
sign and same meaning as ``/api/reports/nifty``'s positioning block) and keeps
the signed-delta net as ``flow``:

* ``state``  — signed-delta book: Σ ``OI × signed delta`` (calls +, puts −).
* ``flow``   — signed-delta change: Σ ``dOI × signed delta``.
* ``initiated`` / ``initiated_cr`` — **class-weighted**: each leg signed by its
  class (see :func:`class_sign`), ``|dOI|`` because the class already carries
  the direction. ``initiated_cr`` is the signed net, ``initiated`` the gross
  bullish/bearish split (both **positive magnitudes**).
* ``flow_class`` — today's dOI read through the same class signs: the
  like-for-like companion of ``initiated`` and the only valid confirmation for
  the verdict (the signed-delta ``flow`` and the class-weighted ``initiated``
  agree in sign on only ~6% of a session).

The house class convention (put writing is bullish) is documented in
:mod:`api.reports_api.nifty_positioning` and mirrored by the frontend badges.
"""

from typing import Any, Dict, List, Optional, Tuple

CRORE = 1e7

#: Relative noise floor: the class-weighted initiation must be at least this
#: share of the gross two-way activity to read as a verdict. A fixed Cr floor
#: is arbitrary — 1 Cr was pure noise on a 58,000 Cr book and 50 Cr is noise on
#: a 200 Cr book — so the threshold scales with the book. On the 2026-10-21
#: Nifty chain (gross ≈ 58,000 Cr) the effective floor is ≈ 2,900 Cr.
VERDICT_EPS_FRACTION = 0.05
#: Absolute floor (Cr). The effective threshold is
#: ``max(VERDICT_EPS_FRACTION * gross_cr, VERDICT_EPS_CR)`` — the relative
#: share carries the verdict on a real chain; this floor only stops a
#: rounding-level number (or a tiny book) from reading as a direction.
VERDICT_EPS_CR = 50.0

#: Classes read as bullish / bearish per side (the house convention — mirrors
#: ``getUnusualSentimentTone`` in the frontend and
#: :mod:`api.reports_api.nifty_positioning`).
BULLISH_CLASS: Dict[str, frozenset] = {
    "CE": frozenset({"LB", "SC"}),
    "PE": frozenset({"SB", "SC"}),
}
BEARISH_CLASS: Dict[str, frozenset] = {
    "CE": frozenset({"SB", "LU"}),
    "PE": frozenset({"LB", "LU"}),
}

#: Full class names → their 2-letter code (the chain stores either form).
CLASS_CODES: Dict[str, str] = {
    "LONG BUILDUP": "LB",
    "SHORT BUILDUP": "SB",
    "SHORT COVER": "SC",
    "SHORT COVERING": "SC",
    "LONG UNWIND": "LU",
    "LONG UNWINDING": "LU",
}


def sentiment_code(value: Any) -> str:
    """Normalise a chain sentiment to its 2-letter code (``LB``/``SB``/``SC``/``LU``).

    ``value`` is a mapping like ``{"type": "Short Buildup", "label": "SB"}``
    (what the chain stores) or a plain string. Full names are mapped to
    codes; unknown/neutral values return ``""``.
    """
    if isinstance(value, dict):
        raw = value.get("label") or value.get("type") or ""
    else:
        raw = value or ""
    code = str(raw).strip().upper()
    if code in ("LB", "SB", "SC", "LU"):
        return code
    return CLASS_CODES.get(code, "")


def class_sign(sentiment: Any, side: str) -> int:
    """Direction of a leg's class: +1 bullish, -1 bearish, 0 neutral/unknown."""
    code = sentiment_code(sentiment)
    if code in BULLISH_CLASS.get(side, ()):
        return 1
    if code in BEARISH_CLASS.get(side, ()):
        return -1
    return 0


def _flow_label(side: str, sentiment_type: str) -> str:
    """Human label for the biggest single-contract flow."""
    if sentiment_type == "Neutral":
        return "unclassified flow (today)"
    if side == "CE":
        return {
            "Short Buildup": "call writers opened (today)",
            "Long Buildup": "call buyers opened (today)",
            "Short Covering": "call writers closed (today)",
            "Long Unwinding": "call buyers closed (today)",
        }.get(sentiment_type, "unclassified flow (today)")
    return {
        "Short Buildup": "put writers opened (today)",
        "Long Buildup": "put buyers opened (today)",
        "Short Covering": "put writers closed (today)",
        "Long Unwinding": "put buyers closed (today)",
    }.get(sentiment_type, "unclassified flow (today)")


def _contract_flow(contract: Optional[Dict[str, Any]], side: str, lot_size: int, spot: float):
    """Return per-contract positioning facts or None when contract missing.

    Returns (dOI_units, state_cr, flow_cr, readable, sentiment_type).
    Unreadable contracts still report dOI_units (denominator for read%).
    ``lot_size`` is accepted but not applied: Upstox OI is already in units.
    """
    if not contract:
        return None
    md = contract.get("market_data", {}) or {}
    oi = md.get("oi", 0) or 0
    prev_oi = md.get("prev_oi", 0) or 0
    d_oi = oi - prev_oi
    d_oi_units = d_oi

    sentiment = contract.get("sentiment") or {}
    sentiment_type = sentiment.get("type") or "Neutral"

    greeks = contract.get("option_greeks")
    readable = greeks is not None and greeks.get("delta") is not None
    if not readable:
        return (d_oi_units, None, None, False, sentiment_type)

    delta = greeks.get("delta")
    signed_delta = abs(delta) if side == "CE" else -abs(delta)
    state_cr = signed_delta * oi * spot / CRORE
    flow_cr = signed_delta * d_oi * spot / CRORE
    return (d_oi_units, state_cr, flow_cr, True, sentiment_type)


def _class_initiated(contract: Optional[Dict[str, Any]], side: str,
                     spot: float) -> Tuple[float, float]:
    """``(initiated_cr, flow_class_cr)`` for one leg, signed by its class.

    ``initiated_cr`` uses ``|dOI|`` (the class already carries the direction:
    a short-covering unwind is bullish even though dOI is negative).
    ``flow_class_cr`` keeps dOI's own sign and is the like-for-like companion
    used to confirm the verdict.
    """
    if not contract:
        return (0.0, 0.0)
    md = contract.get("market_data", {}) or {}
    oi = md.get("oi", 0) or 0
    prev_oi = md.get("prev_oi", 0) or 0
    d_oi = oi - prev_oi
    greeks = contract.get("option_greeks")
    if greeks is None or greeks.get("delta") is None:
        return (0.0, 0.0)
    delta = abs(greeks.get("delta") or 0.0)
    sign = class_sign(contract.get("sentiment"), side)
    if not sign:
        return (0.0, 0.0)
    initiated = sign * abs(d_oi) * delta * spot / CRORE
    flow_class = sign * d_oi * delta * spot / CRORE
    return (initiated, flow_class)


def positioning_verdict(initiated_cr: float, flow_class_cr: float = 0.0,
                        gross_cr: float = 0.0) -> str:
    """Directional verdict from the **class-weighted** aggregates only.

    ``initiated_cr`` and ``flow_class_cr`` must share the class convention.
    The signed-delta book is deliberately not a confirmation: it mixes
    conventions with the class-weighted initiation and made the verdict
    "neutral" almost all day.

    A verdict needs a non-noise ``initiated_cr`` (relative floor
    :data:`VERDICT_EPS_FRACTION` of the gross activity, absolute floor
    :data:`VERDICT_EPS_CR`) AND a ``flow_class_cr`` that confirms the same
    direction.
    """
    floor = VERDICT_EPS_CR
    if gross_cr > 0:
        floor = max(VERDICT_EPS_FRACTION * gross_cr, VERDICT_EPS_CR)
    if abs(initiated_cr) <= floor:
        return "neutral"
    direction = 1 if initiated_cr > 0 else -1
    if flow_class_cr * direction <= 0:
        return "neutral"
    return "bullish" if direction > 0 else "bearish"


def compute_positioning(chain_rows: List[Dict[str, Any]], spot: float, lot_size: int) -> Dict[str, Any]:
    """Delta-weighted options positioning from chain-shaped rows."""
    state_calls = 0.0
    state_puts = 0.0
    flow_calls = 0.0
    flow_puts = 0.0
    flow_class_total = 0.0
    initiated_total = 0.0
    bearish_cr = 0.0
    bullish_cr = 0.0
    readable_shares = 0
    total_shares = 0
    biggest = None  # (abs_cr, strike, side, sentiment_type, flow_cr)
    rows: List[Dict[str, Any]] = []

    for row in chain_rows or []:
        strike = row.get("strike")
        out_row: Dict[str, Any] = {"strike": strike}
        net = 0.0
        net_known = False
        net_init = 0.0
        net_init_known = False
        for side, key in (("CE", "ce"), ("PE", "pe")):
            facts = _contract_flow(row.get(key), side, lot_size, spot)
            if facts is None:
                out_row[f"{key}_class"] = "—"
                out_row[f"{key}_doi_shares"] = None
                out_row[f"{key}_cr"] = None
                out_row[f"{key}_init_cr"] = None
                continue
            d_oi_units, state_cr, flow_cr, readable, sentiment_type = facts
            total_shares += abs(d_oi_units)
            out_row[f"{key}_class"] = sentiment_type or "—"
            out_row[f"{key}_doi_shares"] = d_oi_units
            init_cr, flow_class_cr = _class_initiated(row.get(key), side, spot)
            out_row[f"{key}_init_cr"] = init_cr
            if not readable:
                out_row[f"{key}_cr"] = None
                continue
            readable_shares += abs(d_oi_units)
            out_row[f"{key}_cr"] = flow_cr
            net += flow_cr
            net_known = True
            net_init += init_cr
            net_init_known = True
            if side == "CE":
                state_calls += state_cr
                flow_calls += flow_cr
            else:
                state_puts += state_cr
                flow_puts += flow_cr
            flow_class_total += flow_class_cr
            initiated_total += init_cr
            if init_cr >= 0:
                bullish_cr += init_cr
            else:
                bearish_cr += -init_cr
            magnitude = abs(flow_cr)
            if biggest is None or magnitude > biggest[0]:
                biggest = (magnitude, strike, side, sentiment_type, flow_cr)
        out_row["net_cr"] = net if net_known else None
        out_row["net_init_cr"] = net_init if net_init_known else None
        rows.append(out_row)

    verdict = positioning_verdict(initiated_total, flow_class_total,
                                  bullish_cr + bearish_cr)
    if verdict == "bullish":
        initiated_note = "▲ Long Δ · bullish"
    elif verdict == "bearish":
        initiated_note = "▼ Short Δ · bearish"
    else:
        initiated_note = "■ Neutral"

    gross = bearish_cr + bullish_cr
    lean_pct = abs(initiated_total) / gross * 100 if gross else 0.0

    state_note = "puts outweigh calls" if abs(state_puts) > abs(state_calls) else "calls outweigh puts"
    flow_note = "puts outweigh calls" if abs(flow_puts) > abs(flow_calls) else "calls outweigh puts"

    read_pct = readable_shares / total_shares * 100 if total_shares else 0.0

    if biggest is None:
        biggest_move = None
    else:
        _, b_strike, b_side, b_sent, b_cr = biggest
        biggest_move = {
            "strike": b_strike,
            "side": b_side,
            "sentiment": b_sent,
            "label": _flow_label(b_side, b_sent),
            "cr": b_cr,
        }

    # Only the emitted totals are rounded; the per-row figures stay exact.
    return {
        "verdict": verdict,
        "initiated_cr": round(initiated_total, 2),
        "flow_class_cr": round(flow_class_total, 2),
        "lean_pct": round(lean_pct, 2),
        "state": {"calls_cr": round(state_calls, 2), "puts_cr": round(state_puts, 2), "note": state_note},
        "flow": {"calls_cr": round(flow_calls, 2), "puts_cr": round(flow_puts, 2), "note": flow_note},
        "initiated": {"bearish_cr": round(bearish_cr, 2), "bullish_cr": round(bullish_cr, 2),
                      "note": initiated_note},
        "split": {
            "bearish_cr": round(bearish_cr, 2),
            "bearish_pct": round(bearish_cr / gross * 100, 2) if gross else 0.0,
            "bullish_cr": round(bullish_cr, 2),
            "bullish_pct": round(bullish_cr / gross * 100, 2) if gross else 0.0,
        },
        "read": {"pct": round(read_pct, 2), "readable_shares": readable_shares, "total_shares": total_shares},
        "biggest_move": biggest_move,
        "rows": rows,
    }
