"""OI-by-strike positioning analytics for the options dashboard.

Pure shaping: chain rows + spot in, a plain camelCase dict out. No FastAPI, no
network, no DB — a route or any in-process caller can reuse it. The chain rows
are the ``/option/chain`` shape produced by
:func:`api.options.transform_option_contract`:

    {"strike": 23000.0,
     "ce": {"market_data": {"oi": ..., "prev_oi": ..., "volume": ..., "ltp": ...},
            ...},
     "pe": {...}}

Conventions
-----------
* **LTP-side OI/volume**: OI, prior OI and volume are read from each leg's own
  ``market_data`` (the quote that carries LTP), never from a parent/summary or
  from greeks.
* **Nullable, never zero-filled**: a missing leg, a missing ``market_data`` or a
  missing field stays ``None`` end to end. Zero is a real quote (an untraded
  strike), not a sentinel for "no data" — a UI cannot render the two the same.
* **ΔOI = oi - prev_oi**, and it is ``None`` when either operand is missing
  (Upstox ``prev_oi`` is the prior-session close). No baseline is invented.
* **PCR is the desk-standard put/call ratio ``pe / ce``** (matching
  ``summary.pcr`` and ``optionsMath.pcr()``). ``pcrByStrike`` is peOi/ceOi per
  strike and the headline ``pcr`` is total peOi / total ceOi; both are ``None``
  when the CE denominator is 0 or absent. ``pcrVolumeByStrike`` / ``pcrVolume``
  apply the same ratio to LTP-side volume.
* **Max pain reuses the shared formula** in :mod:`api.options_levels`
  (``_payouts`` / ``compute_max_pain``) — there is no second copy here.
"""

from __future__ import annotations

import math
from typing import Any, Optional

from api.options_levels import _payouts, compute_max_pain, normalize_strikes, top_walls
from api.options_math import put_call as _put_call


def _finite(value: Any) -> Optional[float]:
    """A finite number or ``None`` — bools, NaN and inf are not data."""
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return out if math.isfinite(out) else None


def _leg_metrics(leg: Any) -> dict:
    """LTP-side OI/prior-OI/volume for one leg, with nulls preserved.

    Accepts the nested chain shape (``market_data``) and the flat
    ``ce.oi``/``ce.volume`` shape; ``present`` tells a missing quote apart from
    a real quote that happens to print zero.
    """
    md = leg.get("market_data") if isinstance(leg, dict) else None
    if not isinstance(md, dict):
        md = leg if isinstance(leg, dict) else {}
    present = isinstance(md, dict) and any(
        key in md for key in ("oi", "prev_oi", "volume", "ltp")
    )
    return {
        "present": bool(present),
        "oi": _finite(md.get("oi")),
        "prev_oi": _finite(md.get("prev_oi")),
        "volume": _finite(md.get("volume")),
    }


def _delta(metrics: dict) -> Optional[float]:
    """``oi - prev_oi`` or ``None`` when the baseline is missing."""
    oi, prev = metrics["oi"], metrics["prev_oi"]
    if oi is None or prev is None:
        return None
    return oi - prev


def _sum(values: list) -> Optional[float]:
    """Sum the present values; ``None`` when there is nothing to total."""
    present = [v for v in values if v is not None]
    return float(sum(present)) if present else None


def positioning_block(rows: Any, spot: Any) -> dict:
    """Build the dashboard's positioning block from an option chain.

    ``rows`` is the chain array (list of ``{strike, ce, pe}``). Every output
    array is parallel to ``strikes`` and sorted by strike. Empty or partial
    chains return empty arrays / ``None`` scalars plus warning codes instead of
    raising.
    """
    warnings: list[str] = []
    records: list[tuple[float, dict, dict]] = []
    for row in (rows or []):
        if not isinstance(row, dict):
            continue
        strike = _finite(row.get("strike"))
        if strike is None:
            continue
        records.append((strike, _leg_metrics(row.get("ce")), _leg_metrics(row.get("pe"))))
    records.sort(key=lambda r: r[0])

    if not records:
        warnings.append("empty_chain")
        return {
            "strikes": [],
            "ceOi": [], "peOi": [],
            "ceOiChange": [], "peOiChange": [],
            "ceVolume": [], "peVolume": [],
            "pcrByStrike": [],
            "pcr": None,
            "pcrVolumeByStrike": [],
            "pcrVolume": None,
            "maxPainCurve": [],
            "maxPain": None,
            "walls": {"callWall": None, "putWall": None},
            "totals": {"ceOi": None, "peOi": None, "ceVolume": None, "peVolume": None},
            "warnings": warnings,
        }

    strikes = [r[0] for r in records]
    ce_oi = [r[1]["oi"] for r in records]
    pe_oi = [r[2]["oi"] for r in records]
    ce_doi = [_delta(r[1]) for r in records]
    pe_doi = [_delta(r[2]) for r in records]
    ce_vol = [r[1]["volume"] for r in records]
    pe_vol = [r[2]["volume"] for r in records]

    pcr_by_strike = [_put_call(ce, pe) for ce, pe in zip(ce_oi, pe_oi)]
    pcr_volume_by_strike = [_put_call(ce, pe) for ce, pe in zip(ce_vol, pe_vol)]

    totals = {
        "ceOi": _sum(ce_oi),
        "peOi": _sum(pe_oi),
        "ceVolume": _sum(ce_vol),
        "peVolume": _sum(pe_vol),
    }
    pcr = _put_call(totals["ceOi"], totals["peOi"])
    pcr_volume = _put_call(totals["ceVolume"], totals["peVolume"])

    # Max pain / payout curve: feed the SHARED formula null-safe OI (a missing
    # quote contributes no exposure), so there is exactly one payout definition.
    norm = normalize_strikes([
        {"strike": s, "ce_oi": ce or 0, "pe_oi": pe or 0}
        for s, ce, pe in zip(strikes, ce_oi, pe_oi)
    ])
    max_pain_curve = [
        {"strike": s, "payout": round(payout, 2)}
        for s, payout in _payouts(norm)
    ]
    max_pain = compute_max_pain(norm)

    spot_f = _finite(spot)
    call_top = top_walls(norm, "ce", spot_f, n=1)
    put_top = top_walls(norm, "pe", spot_f, n=1)

    if any(not r[1]["present"] or not r[2]["present"] for r in records):
        warnings.append("missing_quotes")
    if any(
        (r[1]["present"] and r[1]["prev_oi"] is None)
        or (r[2]["present"] and r[2]["prev_oi"] is None)
        for r in records
    ):
        warnings.append("missing_prev_oi")
    if not any((ce or 0) > 0 or (pe or 0) > 0 for ce, pe in zip(ce_oi, pe_oi)):
        warnings.append("no_oi")
    if spot_f is None or spot_f <= 0:
        warnings.append("invalid_spot")

    return {
        "strikes": strikes,
        "ceOi": ce_oi,
        "peOi": pe_oi,
        "ceOiChange": ce_doi,
        "peOiChange": pe_doi,
        "ceVolume": ce_vol,
        "peVolume": pe_vol,
        "pcrByStrike": pcr_by_strike,
        "pcr": pcr,
        "pcrVolumeByStrike": pcr_volume_by_strike,
        "pcrVolume": pcr_volume,
        "maxPainCurve": max_pain_curve,
        "maxPain": max_pain,
        "walls": {
            "callWall": call_top[0] if call_top else None,
            "putWall": put_top[0] if put_top else None,
        },
        "totals": totals,
        "warnings": warnings,
    }
