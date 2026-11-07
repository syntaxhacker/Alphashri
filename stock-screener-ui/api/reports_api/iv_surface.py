"""IV-surface summary for the Nifty / SENSEX option chain.

The desk's question is not "what is IV?" but "where is the surface bent?".
Three readings, all derived from the same rows the report already carries:

* ``atm`` — IV at the strike nearest spot (call, put and their mean). This is
  the level the rest of the surface is measured against.
* ``skew`` — the 25-delta put IV minus the 25-delta call IV. Positive means
  puts are bid over calls: downside insurance is the expensive side. Both legs
  are picked by **nearest ``|delta|`` to 0.25**, never by moneyness, because
  delta already absorbs spot, vol and time to expiry.
* ``term`` — ATM IV per expiry when the caller supplies ``expiries`` (a
  mapping ``expiry -> rows``). Empty when only one chain is known.

Conventions worth keeping explicit:

* A leg's IV is usable only when it is **finite, inside
  :data:`IV_MIN`..:data:`IV_MAX` (1%..100%), and the leg carries open interest
  (``oi > 0``)**. Upstox emits ``0`` for dead strikes and ``None`` when Greeks
  have not been computed yet; both are missing, not a 0% vol print. On
  2026-11-03 the chain returned ``281.25%`` on the 23,950 CE (a dead strike
  with delta 0.0053) and the block published it as "25Δ call IV" with a
  ``−246`` skew. An IV outside the band, or on a strike nobody holds, is an
  artefact: it is dropped, not reported.
* The 25-delta wing is only named when a leg's ``|delta|`` actually lands in
  :data:`DELTA_MIN`..:data:`DELTA_MAX` (0.15..0.35). A chain whose nearest leg
  to 0.25 is a 0.005-delta lottery ticket has **no** 25-delta leg — it is
  reported as unavailable (``degraded``), never as a wing.
* **No interpolation across a missing IV.** The nearest 25-delta strike is
  used as-is when it has an IV. A linear-in-delta interpolation is allowed
  only when the strike sits *between* two bracketing legs that both carry an
  IV (and no other leg in between is missing one). Otherwise the side is
  reported as unavailable and the block is flagged ``degraded``.
* ``degraded`` is True when the ATM level or either 25-delta leg cannot be
  computed. Callers should render the numbers they do have and hide the rest
  rather than inventing a surface.
* ``coverage`` counts the rows handed in (including rows a caller may have
  filtered) so a thin chain is obvious: 3 of 80 rows carrying IV is not a
  surface, it is a few prints.

Pure functions only — no I/O, no pandas, no network. The rows are the exact
shape produced by :func:`api.reports_api.nifty.parse_chain_payload`.
"""

from __future__ import annotations

import math
from statistics import median
from typing import Any, Iterable, Mapping, Optional

from api.reports_api._numeric import safe_opt_float

__all__ = ["DELTA_MAX", "DELTA_MIN", "IV_MAX", "IV_MIN", "SKEW_DELTA",
           "attach_iv_surface", "iv_summary"]

#: Delta whose IV defines a wing of the skew. 0.25 is the desk convention
#: ("25-delta put" / "25-delta call"), not a tunable.
SKEW_DELTA = 0.25

#: A leg only counts as a 25-delta wing when its ``|delta|`` lands in this
#: band. Without it, the "nearest leg to 0.25" on a chain with a hole is a
#: 0.005-delta strike whose IV is pure noise (2026-11-03: 281%).
DELTA_MIN = 0.15
DELTA_MAX = 0.35

#: Usable implied-vol band, in vol points. Below 1% the print is a dead
#: strike; above 100% it is a bad greek or a stale quote, not a surface.
IV_MIN = 1.0
IV_MAX = 100.0


def _num(value: Any) -> Optional[float]:
    """Finite float or ``None`` (non-finite values are not data here)."""
    out = safe_opt_float(value)
    return out if out is not None and math.isfinite(out) else None


def _iv(value: Any, oi: Any = None) -> Optional[float]:
    """Usable implied vol: finite, within the band, on a leg with OI.

    ``oi`` is required: a strike with no open interest has no market, so its
    IV (however plausible it looks) is not a price anyone can trade against.
    """
    out = _num(value)
    if out is None or not (IV_MIN <= out <= IV_MAX):
        return None
    held = _num(oi)
    if held is None or held <= 0.0:
        return None
    return out


def _leg(row: Any, side: str) -> Mapping[str, Any]:
    """The ``ce``/``pe`` mapping of a row, or an empty one."""
    if not isinstance(row, dict):
        return {}
    leg = row.get(side)
    return leg if isinstance(leg, dict) else {}


def _strike(row: Any) -> Optional[float]:
    """Positive strike of a row, or ``None`` for a malformed row."""
    if not isinstance(row, dict):
        return None
    out = _num(row.get("strike"))
    return out if out is not None and out > 0.0 else None


def _collect(rows: Iterable[Any]) -> list[dict[str, Any]]:
    """Normalise raw chain rows into sorted, typed leg records.

    Rows without a usable strike are dropped from the maths (they cannot be
    placed on the surface) but still count towards ``coverage.rows``.
    """
    out: list[dict[str, Any]] = []
    for row in rows or ():
        strike = _strike(row)
        if strike is None:
            continue
        ce, pe = _leg(row, "ce"), _leg(row, "pe")
        out.append({
            "strike": strike,
            "ce_iv": _iv(ce.get("iv"), ce.get("oi")),
            "pe_iv": _iv(pe.get("iv"), pe.get("oi")),
            "ce_delta": _num(ce.get("delta")),
            "pe_delta": _num(pe.get("delta")),
        })
    out.sort(key=lambda entry: entry["strike"])
    return out


def _nearest_strike(strikes: Iterable[float], target: float) -> Optional[float]:
    """Strike closest to ``target``; ties go to the lower strike."""
    pool = list(strikes)
    if not pool:
        return None
    return min(pool, key=lambda strike: (abs(strike - target), strike))


def _empty_atm() -> dict[str, Optional[float]]:
    return {"strike": None, "ce_iv": None, "pe_iv": None, "avg_iv": None}


def _atm(entries: list[dict[str, Any]], spot: Optional[float]) -> dict[str, Any]:
    """ATM block: nearest strike to spot, else the median IV-bearing strike.

    The chosen strike is reported even when its IV is missing — that is how a
    caller tells "no chain at all" apart from "the ATM strike is dead".
    """
    if not entries:
        return _empty_atm()

    if spot is not None and spot > 0.0:
        strike = _nearest_strike((entry["strike"] for entry in entries), spot)
    else:
        with_iv = [entry["strike"] for entry in entries
                   if entry["ce_iv"] is not None or entry["pe_iv"] is not None]
        if not with_iv:
            return _empty_atm()
        # Median may fall between two listed strikes on an even chain; snap to
        # the nearest real strike that actually carries an IV.
        strike = _nearest_strike(with_iv, median(with_iv))

    chosen = next(entry for entry in entries if entry["strike"] == strike)
    ce_iv, pe_iv = chosen["ce_iv"], chosen["pe_iv"]
    parts = [iv for iv in (ce_iv, pe_iv) if iv is not None]
    return {
        "strike": strike,
        "ce_iv": ce_iv,
        "pe_iv": pe_iv,
        "avg_iv": round(sum(parts) / len(parts), 4) if parts else None,
    }


def _wing_iv(
    entries: list[dict[str, Any]], side: str
) -> tuple[Optional[float], Optional[float]]:
    """``(strike, iv)`` for the leg whose ``|delta|`` is nearest 0.25.

    Only legs whose ``|delta|`` sits inside :data:`DELTA_MIN`..:data:`DELTA_MAX`
    are candidates at all: a chain with a hole between 0.5 and 0.005 has no
    25-delta leg, and naming the 0.005 one (2026-11-03: 281% IV) mis-states
    the wing. When nothing lands in the band the side is ``(None, None)``.

    Uses the nearest strike's own IV. When that strike's IV is missing, a
    linear interpolation in delta is allowed **only** if a leg below and a leg
    above 0.25 both carry an IV and no other intervening leg is missing one.
    There is no "skip to the next strike with an IV" fallback: that silently
    substitutes a different wing and mis-states the skew.
    """
    iv_key, delta_key = f"{side}_iv", f"{side}_delta"
    all_cands = [
        (entry["strike"], abs(entry[delta_key]), entry[iv_key])
        for entry in entries
        if entry[delta_key] is not None
    ]
    cands = [cand for cand in all_cands
             if DELTA_MIN <= cand[1] <= DELTA_MAX]
    if not cands:
        return None, None

    best = min(cands, key=lambda cand: (abs(cand[1] - SKEW_DELTA), cand[0]))
    if best[2] is not None:
        return best[0], best[2]

    # Bracketing legs may sit outside the band (a 0.38 leg still brackets
    # 0.25 honestly); only the *named* wing has to be inside it.
    below = [cand for cand in all_cands
             if cand[1] < SKEW_DELTA and cand[2] is not None]
    above = [cand for cand in all_cands
             if cand[1] > SKEW_DELTA and cand[2] is not None]
    if not below or not above:
        return best[0], None

    lo = max(below, key=lambda cand: cand[1])   # nearest leg further OTM
    hi = min(above, key=lambda cand: cand[1])   # nearest leg closer to ATM
    if hi[1] == lo[1]:
        return best[0], None
    between = [cand for cand in all_cands
               if lo[1] < cand[1] < hi[1] and cand[0] != best[0]]
    if any(cand[2] is None for cand in between):
        return best[0], None

    interpolated = lo[2] + (hi[2] - lo[2]) * (SKEW_DELTA - lo[1]) / (hi[1] - lo[1])
    return best[0], round(interpolated, 4)


def _empty_skew() -> dict[str, Optional[float]]:
    return {
        "strike_ce25": None,
        "ce_25d_iv": None,
        "strike_pe25": None,
        "pe_25d_iv": None,
        "skew_25d": None,
    }


def _skew(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """25-delta skew block: put wing minus call wing (positive = put skew)."""
    strike_ce, ce_iv = _wing_iv(entries, "ce")
    strike_pe, pe_iv = _wing_iv(entries, "pe")
    return {
        "strike_ce25": strike_ce,
        "ce_25d_iv": ce_iv,
        "strike_pe25": strike_pe,
        "pe_25d_iv": pe_iv,
        "skew_25d": round(pe_iv - ce_iv, 4)
        if pe_iv is not None and ce_iv is not None else None,
    }


def _term(
    expiries: Mapping[Any, Iterable[Any]], spot: Optional[float]
) -> list[dict[str, Any]]:
    """ATM IV per expiry, ordered by expiry label."""
    out = []
    for expiry, rows in expiries.items():
        atm = _atm(_collect(rows), spot)
        out.append({"expiry": str(expiry), "atm_iv": atm["avg_iv"]})
    out.sort(key=lambda entry: entry["expiry"])
    return out


def _coverage(rows: Iterable[Any], entries: list[dict[str, Any]]) -> dict[str, int]:
    """How much of the chain is actually usable."""
    return {
        "rows": len(list(rows or ())),
        "with_ce_iv": sum(1 for entry in entries if entry["ce_iv"] is not None),
        "with_pe_iv": sum(1 for entry in entries if entry["pe_iv"] is not None),
        "with_delta": sum(
            1 for entry in entries
            if entry["ce_delta"] is not None or entry["pe_delta"] is not None
        ),
    }


def _summarise(
    rows: Iterable[Any],
    spot: Optional[float],
    expiries: Optional[Mapping[Any, Iterable[Any]]] = None,
) -> dict[str, Any]:
    rows = list(rows or ())
    entries = _collect(rows)
    atm = _atm(entries, spot)
    skew = _skew(entries)
    degraded = (
        atm["avg_iv"] is None
        or skew["ce_25d_iv"] is None
        or skew["pe_25d_iv"] is None
    )
    return {
        "atm": atm,
        "skew": skew,
        "term": _term(expiries, spot) if expiries else [],
        "coverage": _coverage(rows, entries),
        "degraded": degraded,
    }


def iv_summary(rows: Iterable[Any], spot: Optional[float] = None) -> dict[str, Any]:
    """Core IV-surface summary for one expiry's chain.

    ``spot`` anchors the ATM strike. Without it the ATM strike is the median
    strike that carries an IV, which keeps the block meaningful for trimmed
    chains and for callers that only have the rows.
    """
    return _summarise(rows, spot)


def attach_iv_surface(
    report: dict,
    rows: list[dict],
    *,
    expiries: Optional[Mapping[Any, Iterable[Any]]] = None,
) -> dict:
    """Attach the IV-surface block to ``report`` and return that block.

    The result is also stored as ``report["iv_surface"]`` so the serialised
    response carries it. ``report["spot"]`` anchors the ATM strike (the median
    strike is used when spot is absent or zero). ``expiries`` is an optional
    ``expiry -> rows`` mapping used only for the term-structure entry.

    Pure: nothing is fetched and ``report`` is the only object touched.
    """
    spot = _num(report.get("spot")) if isinstance(report, dict) else None
    surface = _summarise(rows, spot, expiries)
    if isinstance(report, dict):
        report["iv_surface"] = surface
    return surface
