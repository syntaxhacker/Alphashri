"""Delta positioning read for the Nifty option chain.

Answers the desk question *"who is being initiated today?"* by converting each
leg's OI (and its session change) into rupee delta exposure, in crore.

Conventions (kept explicit so the numbers stay auditable):

* ``state`` — Σ ``OI × |delta|`` with **calls counted positive and puts
  negative** ("every contract counted as bought"). Signed Cr: positive = a net
  long-delta / bullish tilt.
* ``flow`` — the same sum over the session's ΔOI (today's added OI), so it reads
  the *change* in that tilt.
* ``initiated`` — ``ΔOI × |delta|`` signed by the **class** each leg was read as
  (long buildup / short cover = bullish, short buildup / long unwind =
  bearish). This is the directional "initiated" flow; positive = bullish.
  ``|ΔOI|`` is used because the class already encodes direction — an unwind has
  negative ΔOI but its sign is carried by the class, not the delta.
* ``bull_cr`` / ``bear_cr`` — gross magnitude of the bullish / bearish
  initiated legs; ``split_pct`` is the dominant side's share.
* ``verdict`` uses the same asymmetric 25% dominance rule as the control block.

Pure functions only — no I/O, directly unit-testable.
"""

from __future__ import annotations

from typing import Any, Optional

#: NIFTY lot size (the report is Nifty-specific; SENSEX uses a different lot).
NIFTY_LOT_SIZE = 65

#: Classes read as bullish / bearish per side. Mirrors the repo's
#: ``getUnusualSentimentTone`` convention (calls rise on buying → LB/SC bullish;
#: puts rise on fear → SB/SC bullish).
_BULLISH_CLASS: dict[str, set[str]] = {
    "CE": {"LB", "SC"},
    "PE": {"SB", "SC"},
}
_BEARISH_CLASS: dict[str, set[str]] = {
    "CE": {"SB", "LU"},
    "PE": {"LB", "LU"},
}

#: Full class names → their 2-letter code (the chain stores either form).
_CLASS_CODES: dict[str, str] = {
    "LONG BUILDUP": "LB",
    "SHORT BUILDUP": "SB",
    "SHORT COVER": "SC",
    "SHORT COVERING": "SC",
    "LONG UNWIND": "LU",
    "LONG UNWINDING": "LU",
}


def sentiment_code(value: Any) -> str:
    """Normalise a chain sentiment to its 2-letter code (``LB``/``SB``/``SC``/``LU``).

    ``build_leg`` stores the raw ``get_option_sentiment`` result, which is a
    mapping like ``{"type": "Short Buildup", "label": "SB"}`` — but a plain
    string may also arrive. Full names are mapped to codes; unknown/neutral
    values return ``""``.
    """
    if isinstance(value, dict):
        raw = value.get("label") or value.get("type") or ""
    else:
        raw = value or ""
    code = str(raw).strip().upper()
    if code in ("LB", "SB", "SC", "LU"):
        return code
    return _CLASS_CODES.get(code, "")


def _f(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _i(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def class_sign(sentiment: Any, side: str) -> int:
    """Direction of a leg's class: +1 bullish, -1 bearish, 0 neutral/unknown."""
    code = sentiment_code(sentiment)
    if code in _BULLISH_CLASS.get(side, ()):
        return 1
    if code in _BEARISH_CLASS.get(side, ()):
        return -1
    return 0


def positioning_verdict(bull_cr: float, bear_cr: float) -> str:
    """Asymmetric 25% dominance, matching ``control_verdict``."""
    if bull_cr > bear_cr * 1.25:
        return "bullish"
    if bear_cr > bull_cr * 1.25:
        return "bearish"
    return "balanced"


def compute_positioning(rows: list[dict], spot: float,
                        lot_size: int = NIFTY_LOT_SIZE) -> dict:
    """Aggregate per-leg delta exposure into the positioning block.

    Returns signed Cr values (``state`` / ``flow`` / ``initiated``), the gross
    ``bull_cr`` / ``bear_cr`` split, the day's per-side ΔOI in contracts, and a
    per-strike breakdown for the table. Empty/partial rows degrade to zeros
    rather than raising.
    """
    spot_f = _f(spot)
    factor = (float(lot_size) * spot_f) / 1e7 if spot_f else 0.0

    state = 0.0
    flow = 0.0
    initiated = 0.0
    bull = 0.0
    bear = 0.0
    ce_doi_total = 0
    pe_doi_total = 0
    strikes: list[dict] = []

    for r in rows or []:
        if not isinstance(r, dict):
            continue
        strike = _f(r.get("strike"))
        ce = r.get("ce") or {}
        pe = r.get("pe") or {}

        ce_d = abs(_f(ce.get("delta")))
        pe_d = abs(_f(pe.get("delta")))
        ce_oi = _i(ce.get("oi"))
        pe_oi = _i(pe.get("oi"))
        ce_doi = _i(ce.get("oi_change"))
        pe_doi = _i(pe.get("oi_change"))

        state += (ce_oi * ce_d - pe_oi * pe_d) * factor
        flow += (ce_doi * ce_d - pe_doi * pe_d) * factor

        ce_init = class_sign(ce.get("sentiment"), "CE") * abs(ce_doi) * ce_d * factor
        pe_init = class_sign(pe.get("sentiment"), "PE") * abs(pe_doi) * pe_d * factor
        initiated += ce_init + pe_init
        if ce_init > 0:
            bull += ce_init
        else:
            bear += -ce_init
        if pe_init > 0:
            bull += pe_init
        else:
            bear += -pe_init

        ce_doi_total += ce_doi
        pe_doi_total += pe_doi
        strikes.append({
            "strike": strike,
            "ce": {"class": sentiment_code(ce.get("sentiment")) or "Neutral",
                   "doi": ce_doi, "initiated": round(ce_init, 2)},
            "pe": {"class": sentiment_code(pe.get("sentiment")) or "Neutral",
                   "doi": pe_doi, "initiated": round(pe_init, 2)},
            "net_initiated": round(ce_init + pe_init, 2),
        })

    total = bull + bear
    split_pct = round(100.0 * max(bull, bear) / total, 1) if total > 0 else 0.0
    return {
        "verdict": positioning_verdict(bull, bear),
        "state": round(state, 2),
        "flow": round(flow, 2),
        "initiated": round(initiated, 2),
        "bull_cr": round(bull, 2),
        "bear_cr": round(bear, 2),
        "split_pct": split_pct,
        "ce_doi": ce_doi_total,
        "pe_doi": pe_doi_total,
        "lot_size": int(lot_size),
        "strikes": strikes,
    }
