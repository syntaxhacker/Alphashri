"""The ONE per-minute tape-row builder (NIFTY and every generic underlying).

``options_recorder._build_tape_row`` was a copy of the NIFTY row and then
drifted: it wrote 23 of the 30 fields the NIFTY tape writes, so the heatmap /
radar / bursts rebuild for SENSEX or a stock silently lost the wall scalars,
the day-change OI and the fetch/write stamps.

The field **order** is part of the on-disk contract — the day files are
diffed, replayed and compared by consumers — so the order lives here once and
``nifty._write_tape_row`` delegates to it. NIFTY-only additions (``cas`` /
``spot_frozen``) stay in ``nifty.py``; a generic row adds ``underlying`` via
``extra``.
"""

from __future__ import annotations

from typing import Optional

from api.reports_api._numeric import safe_float, safe_int
from api.reports_api._time import now_iso


def _nifty():
    """The NIFTY module — the pure snapshot helpers are reused verbatim."""
    from api.reports_api import nifty

    return nifty


def _spot_differs(spot: float, spot_chain: Optional[float]) -> bool:
    """Did reconciliation move the spot enough to be worth recording?"""
    if spot_chain is None:
        return False
    return round(safe_float(spot), 2) != round(safe_float(spot_chain), 2)


def build_tape_row(report: dict, *, spot: float, t_iso: str,
                   spot_chain: Optional[float] = None,
                   t_write: Optional[str] = None,
                   extra: Optional[dict] = None) -> dict:
    """One tape row for ``report``, in the frozen NIFTY field order.

    ``spot`` is the already-reconciled value (see ``nifty.reconcile_spot`` /
    ``options_recorder._write_minute``), so the ATM/wall/chain snapshots all
    derive from one trustworthy print. ``spot_chain`` is the raw chain value:
    when it differs, the row keeps it as ``spot_raw`` — otherwise the two are
    trivially equal and the key is absent.

    ``t``/``t_fetch`` are the fetch START (the minute the data describes);
    ``t_write`` makes the build latency auditable instead of invisible.
    ``extra`` appends caller-specific keys (the generic recorder's
    ``underlying``) at the end of the row.
    """
    nifty = _nifty()
    strikes = report.get("strikes") or []
    gex = report.get("gex") or {}

    ce_oi = sum(safe_int((r.get("ce") or {}).get("oi")) for r in strikes)
    pe_oi = sum(safe_int((r.get("pe") or {}).get("oi")) for r in strikes)
    ce_vol = sum(safe_int((r.get("ce") or {}).get("volume")) for r in strikes)
    pe_vol = sum(safe_int((r.get("pe") or {}).get("volume")) for r in strikes)

    # Day-change OI (oi - prev_oi, summed over the chain) vs the interval delta
    # the tape derives between rows. They answer different questions and used
    # to be conflated: ``call_doi`` is vs the day's FIRST recorded row,
    # ``ce_oi_change_day`` is vs yesterday's close.
    ce_oi_change_day = sum(
        safe_int((r.get("ce") or {}).get("oi"))
        - safe_int((r.get("ce") or {}).get("prev_oi"))
        for r in strikes)
    pe_oi_change_day = sum(
        safe_int((r.get("pe") or {}).get("oi"))
        - safe_int((r.get("pe") or {}).get("prev_oi"))
        for r in strikes)

    atm_strike, atm_ce_ltp, atm_pe_ltp = nifty._atm_premium_snapshot(strikes, spot)
    # Per-minute ATM IV so the UI can chart the ATM IV / straddle series
    # without re-fetching history.
    try:
        from api.reports_api.nifty_verdicts import atm_ivs

        atm_ce_iv, atm_pe_iv = atm_ivs(strikes, spot)
    except Exception:
        atm_ce_iv, atm_pe_iv = None, None

    # NEAR walls: the wall-migration/squeeze detectors compare the wall strike
    # minute-to-minute, so an unrestricted ranking would "migrate" whenever a
    # far mega-wall outranks the near one.
    walls_near = (report.get("walls_near") or report.get("walls")
                  or {"calls": [], "puts": []})

    row = {
        "t": t_iso,
        "t_fetch": t_iso,
        "t_write": t_write or now_iso(),
        "spot": spot,
        # Raw chain spot when reconciliation moved it; otherwise absent so the
        # two are trivially equal.
        **({"spot_raw": spot_chain} if _spot_differs(spot, spot_chain) else {}),
        "ce_oi": ce_oi,
        "pe_oi": pe_oi,
        "ce_vol": ce_vol,
        "pe_vol": pe_vol,
        "ce_oi_change_day": ce_oi_change_day,
        "pe_oi_change_day": pe_oi_change_day,
        "pcr_oi": safe_float(report.get("pcr_oi")),
        "pcr_vol": safe_float(report.get("pcr_vol")),
        "max_pain": safe_float(report.get("max_pain")),
        # The live report prefers Upstox's OFFICIAL max pain (a 30-min bucket)
        # and only falls back to the computed value; store the computed value
        # beside it so "did price pin to max pain" studies never mix two
        # definitions.
        "max_pain_computed": nifty.compute_max_pain([
            {"strike": safe_float(r.get("strike")) or 0.0,
             "ce_oi": safe_int((r.get("ce") or {}).get("oi")),
             "pe_oi": safe_int((r.get("pe") or {}).get("oi"))}
            for r in strikes
        ]) if strikes else None,
        # A degraded GEX block is an OI proxy, not a gamma profile: its flip /
        # net_gex are artefacts and are not written into the day's log.
        "flip": None if gex.get("degraded") else gex.get("zero_cross"),
        "net_gex": None if gex.get("degraded") else gex.get("net_total"),
        "gex_degraded": bool(gex.get("degraded")),
        "walls": walls_near,
        # Scalar top-of-book walls: the wall-change detector diffs TWO FRAMES
        # (this row vs the previous minute), so the strike is stored directly.
        # ``null`` when the chain had no walls (never 0).
        "call_wall": nifty._top_wall_strike(walls_near, "calls"),
        "put_wall": nifty._top_wall_strike(walls_near, "puts"),
        "expiry": report.get("expiry", ""),
        "atm_strike": atm_strike,
        "atm_ce_ltp": atm_ce_ltp,
        "atm_pe_ltp": atm_pe_ltp,
        "atm_ce_iv": atm_ce_iv,
        "atm_pe_iv": atm_pe_iv,
        # ATM +/-3 strikes with both legs' OI — lets an alert name the exact
        # strike instead of only the index total.
        "strikes_top": nifty._strike_oi_snapshot(strikes, spot),
        # EVERY strike: CE/PE LTP + OI + volume per strike. Lets the options
        # paper engine mark a position at the contract it actually bought (the
        # ATM drifts), and lets walls/PCR be rebuilt per strike later.
        "chain": nifty._premium_chain_snapshot(strikes, spot),
    }
    if extra:
        row.update(extra)
    return row
