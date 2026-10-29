"""Delta positioning read for the Nifty option chain.

Answers the desk question *"who is being initiated today?"* by converting each
leg's OI (and its session change) into rupee delta exposure, in crore.

Conventions (kept explicit so the numbers stay auditable):

* ``state`` — Σ ``OI × |delta|`` with **calls counted positive and puts
  negative** ("every contract counted as bought"). Signed Cr: positive = a net
  long-delta / bullish tilt. This is the **signed-delta** book: a different
  convention from ``initiated`` and NOT a valid confirmation for it.
* ``flow`` — the same signed-delta sum over the session's ΔOI (today's added
  OI), so it reads the *change* in that signed tilt. Signed-delta convention.
* ``flow_class`` — today's ΔOI read through the **same class convention** as
  ``initiated`` (``class_sign × ΔOI × |delta|``). This is the like-for-like
  companion of ``initiated``: the signed-delta ``flow`` and the class-weighted
  ``initiated`` agree in sign on only ~6% of a session (measured on the
  2026-10-21 replay log: 22 of 375 frames), so comparing them is meaningless.
  Recomputed with the class signs they agree on 99.7% of frames.
* ``initiated`` — ``ΔOI × |delta|`` signed by the **class** each leg was read as
  (long buildup / short cover = bullish, short buildup / long unwind =
  bearish). This is the directional "initiated" flow; positive = bullish.
  ``|ΔOI|`` is used because the class already encodes direction — an unwind has
  negative ΔOI but its sign is carried by the class, not the delta.
  Per-side convention, mirrored from the frontend's
  ``getUnusualSentimentTone`` (``NiftyUnusualVolume.tsx``):

  * calls — ``LB``/``SC`` bullish, ``SB``/``LU`` bearish
  * puts — ``SB``/``SC`` bullish, ``LB``/``LU`` bearish

  Note that the put side is intentionally the *house* convention (put short
  covering read as bullish, put long unwinding as bearish); changing it here
  without changing the badge colours would make the panel contradict itself.
* ``bull_cr`` / ``bear_cr`` — gross magnitude of the bullish / bearish
  initiated legs; ``split_pct`` is the dominant side's share. These are gross
  legs and intentionally carry no net direction. Both are **positive
  magnitudes**.
* ``delta_flip`` — strike where the cumulative per-strike ``net_state``
  (open-interest delta exposure, ascending strikes) crosses from negative to
  positive **and does not finish net short**. Below it the book is put-heavy,
  above it call-heavy. A book that ends net short has no pivot (wing wobbles
  and put walls return ``None``). ``net_state`` is also emitted per strike for
  callers that want the raw profile.
* ``verdict`` — sign of ``initiated`` gated by agreement with the
  **class-weighted** flow ``flow_class`` (like-for-like). A positive
  ``initiated`` only reads bullish when ``flow_class`` is also positive (and a
  negative one only reads bearish when it is negative). The signed-delta
  ``state`` is deliberately NOT a confirmation: it mixes conventions with
  ``initiated`` and made the verdict "balanced" almost all day.

Units: Upstox reports option OI in **units (shares)**, not lots, so the crore
conversion is ``OI × delta × spot / 1e7`` — multiplying by the lot size again
would inflate every value 65×.

Pure functions only — no I/O, directly unit-testable.
"""

from __future__ import annotations

from typing import Optional

from api.reports_api._numeric import safe_float as _f
from api.reports_api._numeric import safe_int as _i

# The house class convention (put writing is bullish) has ONE definition, in
# the low-level options module — re-exported here so both endpoints agree.
from api.positioning import class_sign, sentiment_code

#: NIFTY lot size. Kept in the payload for clients, but never applied to OI:
#: Upstox already reports option OI in units (shares), so the lot is not a
#: factor in the crore conversion.
NIFTY_LOT_SIZE = 65

__all__ = [
    "NIFTY_LOT_SIZE",
    "class_sign",
    "compute_positioning",
    "delta_flip_level",
    "positioning_verdict",
    "sentiment_code",
]


#: Relative noise floor: the initiated bias must be at least this share of the
#: gross two-way initiated activity to read as a verdict. A fixed Cr floor is
#: arbitrary — 1 Cr was pure noise on a 58,000 Cr book (2026-10-21) and 50 Cr
#: is noise on a 200 Cr book — so the threshold scales with the book. On the
#: 2026-10-21 chain (gross ≈ 58,000 Cr) the effective floor is ≈ 2,900 Cr.
VERDICT_EPS_FRACTION = 0.05
#: Absolute floor (Cr). The effective threshold is
#: ``max(VERDICT_EPS_FRACTION * gross_cr, VERDICT_EPS_CR)`` — the relative
#: share carries the verdict on a real chain and this floor only stops a
#: rounding-level number (or a tiny book) from reading as a direction.
#: 50 Cr is the level below which a number carries no information: it is
#: 0.09 % of a 58,000 Cr book and a quarter of a 200 Cr one.
VERDICT_EPS_CR = 50.0


def positioning_verdict(initiated_cr: float, flow_cr: float = 0.0,
                        gross_cr: float = 0.0) -> str:
    """Directional verdict from the **class-weighted** aggregates only.

    ``initiated_cr`` is today's class-weighted initiation and ``flow_cr`` the
    class-weighted flow (:func:`compute_positioning` emits both). They MUST
    share the class convention: a class-weighted number compared against the
    signed-delta number is meaningless — on the 2026-10-21 replay log
    ``sign(initiated)`` matched the signed ``flow`` on only 22 of 375 frames
    (5.9%), so the verdict read "balanced" almost all day. Recomputed with the
    class signs the two agree on 99.7% of frames.

    The signed-delta ``state`` is intentionally NOT accepted here: it is a
    different convention and cannot confirm a class-weighted number.

    A verdict needs a non-noise ``initiated_cr`` (relative floor
    :data:`VERDICT_EPS_FRACTION` of ``gross_cr``, absolute floor
    :data:`VERDICT_EPS_CR`) AND a ``flow_cr`` that confirms the same
    direction.
    """
    floor = VERDICT_EPS_CR
    if gross_cr > 0:
        floor = max(VERDICT_EPS_FRACTION * gross_cr, VERDICT_EPS_CR)
    if abs(initiated_cr) <= floor:
        return "balanced"
    direction = 1 if initiated_cr > 0 else -1
    if flow_cr * direction <= 0:
        return "balanced"
    return "bullish" if direction > 0 else "bearish"


def delta_flip_level(strikes: list[dict], spot: Optional[float] = None) -> Optional[float]:
    """Strike where the cumulative book turns from short to long delta.

    Walk strikes low→high adding each strike's ``net_state`` (calls +, puts −).
    Only a **negative → positive** cross is a flip: below it the book is
    put-heavy (short delta), above it calls dominate (long delta). A
    positive → negative cross is a put wall, not the pivot, so it is ignored.

    A cross only counts when it is sustained: the cumulative book must not
    finish net short. A thin wing that ticks positive and then falls deeply
    negative leaves the book short overall, so there is no pivot and the
    function returns ``None``. When ``spot`` is known the sustained cross
    closest to spot wins; without it the first cross is returned.
    """
    cum = 0.0
    prev: Optional[float] = None
    crossings: list[float] = []
    for s in sorted(strikes or [], key=lambda r: _f(r.get("strike"))):
        cum = round(cum + _f(s.get("net_state")), 2)
        if prev is not None and prev < 0 <= cum:
            crossings.append(_f(s.get("strike")))
        prev = cum
    if not crossings or cum < 0:
        return None
    spot_f = _f(spot)
    if spot_f > 0:
        return min(crossings, key=lambda level: abs(level - spot_f))
    return crossings[0]


def compute_positioning(rows: list[dict], spot: float,
                        lot_size: int = NIFTY_LOT_SIZE) -> dict:
    """Aggregate per-leg delta exposure into the positioning block.

    Returns signed Cr values (``state`` / ``flow`` / ``flow_class`` /
    ``initiated``), the gross ``bull_cr`` / ``bear_cr`` split, the day's
    per-side ΔOI in units, and a per-strike breakdown for the table.
    Empty/partial rows degrade to zeros rather than raising.

    ``lot_size`` is echoed in the payload for clients but not applied: Upstox
    OI is already in units (shares), so applying the lot would 65×-inflate
    every Cr figure.

    Two conventions live side by side and are never mixed:

    * **signed delta** — calls positive, puts negative: ``state`` (the book)
      and ``flow`` (today's change in that book).
    * **class-weighted** — each leg signed by its buildup/unwind class:
      ``initiated`` (today's initiation) and ``flow_class`` (today's flow read
      the same way). The verdict is computed from the class-weighted pair
      only, because the two conventions disagree in sign almost all day.
    """
    spot_f = _f(spot)
    factor = spot_f / 1e7 if spot_f else 0.0

    state = 0.0
    flow = 0.0
    flow_class = 0.0
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

        # Per-strike open-interest delta exposure, same sign convention as
        # ``state``: calls positive, puts negative. The cumulative sum across
        # strikes is what carries the flip level below.
        ce_state = ce_oi * ce_d * factor
        pe_state = -pe_oi * pe_d * factor
        state += ce_state + pe_state
        flow += (ce_doi * ce_d - pe_doi * pe_d) * factor

        ce_sign = class_sign(ce.get("sentiment"), "CE")
        pe_sign = class_sign(pe.get("sentiment"), "PE")
        ce_init = ce_sign * abs(ce_doi) * ce_d * factor
        pe_init = pe_sign * abs(pe_doi) * pe_d * factor
        initiated += ce_init + pe_init
        # Like-for-like companion of ``initiated``: today's ΔOI read through
        # the same class signs (see the module docstring).
        flow_class += (ce_sign * ce_doi * ce_d + pe_sign * pe_doi * pe_d) * factor
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
            "net_state": round(ce_state + pe_state, 2),
        })

    total = bull + bear
    split_pct = round(100.0 * max(bull, bear) / total, 1) if total > 0 else 0.0
    return {
        "verdict": positioning_verdict(initiated, flow_class, total),
        "state": round(state, 2),
        "flow": round(flow, 2),
        "flow_class": round(flow_class, 2),
        "initiated": round(initiated, 2),
        "bull_cr": round(bull, 2),
        "bear_cr": round(bear, 2),
        "split_pct": split_pct,
        "ce_doi": ce_doi_total,
        "pe_doi": pe_doi_total,
        "lot_size": int(lot_size),
        "delta_flip": delta_flip_level(strikes, spot_f),
        "strikes": strikes,
    }
