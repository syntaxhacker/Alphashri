"""Shared blast detector for 10-second chain OI/volume bursts.

Extracted from both ``ticks._chain_blasts`` (NIFTY) and
``options_history._chain_blasts`` (generic underlyings) so the adaptive
threshold logic lives in one place. Both callers pass their own scale-dependent
floor/multiplier constants.
"""

from __future__ import annotations

import statistics
from datetime import datetime
from typing import Any, Optional

from api.reports_api import chain10s
from api.reports_api._numeric import safe_float as _safe_float


def _epoch(value: Any) -> float:
    """Epoch seconds from an ISO string (0.0 when unparseable)."""
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def _median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def chain_blasts(
    *,
    date_str: str,
    lookback_min: int,
    oi_floor_m: float,
    oi_mult: float,
    vol_floor_m: float,
    vol_mult: float,
    get_snaps: callable,
    is_today: bool,
    strike_step: Optional[float] = 50.0,
) -> list[dict]:
    """OI + volume blasts from a 10-second chain with adaptive thresholds.

    Parameters
    ----------
    date_str : str
        Session date in YYYY-MM-DD (IST).
    lookback_min : int
        How many minutes back to scan.
    oi_floor_m : float
        Absolute OI floor in millions (e.g. 2.0 for NIFTY, 0.25 for stocks).
    oi_mult : float
        Multiplier on the window median (e.g. 6).
    vol_floor_m : float
        Absolute volume floor in millions (e.g. 15.0 for NIFTY, 0.5 for stocks).
    vol_mult : float
        Multiplier on the window median (e.g. 8).
    get_snaps : callable
        Function(date_str) -> list[snapshot] to fetch raw chain snapshots.
        For NIFTY this reads ``chain10s.RECENT`` or ``chain10s._read_day``.
        For generic it reads from the symbol's chain10s JSONL.
    is_today : bool
        Whether ``date_str`` is today's session (controls RECENT vs file read).
    strike_step : float or None, optional
        Strike grid step for ``chain10s.summarise_snapshots``. Default 50.0
        (NIFTY grid). Pass ``None`` for symbols with non-50-pt strike ladders
        (e.g. RELIANCE trades 2.5/5/10-pt strikes).

    Returns
    -------
    list[dict]
        Blast records with keys: kind, t, side, delta, label, detail, severity, bias.
        ``kind`` is "oi" or "volume". ``bias`` is always "neutral".
    """
    snaps = list(get_snaps(date_str)) if is_today else get_snaps(date_str)[-240:]
    if not snaps:
        snaps = get_snaps(date_str)[-240:]
    if len(snaps) < 2:
        return []
    cutoff = _epoch(snaps[-1].get("t")) - lookback_min * 60
    snaps = [s for s in snaps if _epoch(str(s.get("t") or "")) >= cutoff]
    if len(snaps) < 3:
        return []

    summary = chain10s.summarise_snapshots(snaps, strike_step=strike_step)
    times = [_epoch(p.get("t")) for p in summary]

    samples: list[dict] = []
    for i in range(1, len(summary)):
        j = i
        while j > 0 and times[i] - times[j] < 10:
            j -= 1
        if j >= i:
            continue
        dt = times[i] - times[j]
        if dt <= 0:
            continue
        samples.append({
            "i": i,
            "dt": dt,
            "ce_oi": (_safe_float(summary[i].get("ce_oi")) - _safe_float(summary[j].get("ce_oi"))) / 1e6,
            "pe_oi": (_safe_float(summary[i].get("pe_oi")) - _safe_float(summary[j].get("pe_oi"))) / 1e6,
            "ce_vol": (_safe_float(summary[i].get("ce_vol")) - _safe_float(summary[j].get("ce_vol"))) / 1e6,
            "pe_vol": (_safe_float(summary[i].get("pe_vol")) - _safe_float(summary[j].get("pe_vol"))) / 1e6,
        })
    if not samples:
        return []

    oi_med = _median([max(abs(x["ce_oi"]), abs(x["pe_oi"])) for x in samples])
    vol_med = _median([max(abs(x["ce_vol"]), abs(x["pe_vol"])) for x in samples])
    oi_thr = max(oi_floor_m, oi_mult * oi_med)
    vol_thr = max(vol_floor_m, vol_mult * vol_med)

    out: list[dict] = []
    for x in samples:
        for side, oi_key, vol_key in (("CE", "ce_oi", "ce_vol"), ("PE", "pe_oi", "pe_vol")):
            doi = x[oi_key]
            dvol = x[vol_key]
            if abs(doi) >= oi_thr:
                out.append({
                    "kind": "oi",
                    "t": summary[x["i"]]["t"],
                    "side": side,
                    "delta": round(doi, 2),
                    "label": f"{'CALL' if side == 'CE' else 'PUT'} OI {doi:+.2f}M / {round(x['dt'])}s",
                    "detail": (f"{'call' if side == 'CE' else 'put'} OI moved {doi:+.2f}M "
                               f"in {round(x['dt'])}s (gate {oi_thr:.2f}M)"),
                    "severity": "critical",
                    "bias": "neutral",
                })
            if abs(dvol) >= vol_thr:
                out.append({
                    "kind": "volume",
                    "t": summary[x["i"]]["t"],
                    "side": side,
                    "delta": round(dvol, 2),
                    "label": f"{side} VOL {dvol:,.2f}M / {round(x['dt'])}s",
                    "detail": (f"{'call' if side == 'CE' else 'put'} volume {dvol:,.2f}M "
                               f"in {round(x['dt'])}s (gate {vol_thr:,.2f}M)"),
                    "severity": "warning",
                    "bias": "neutral",
                })
    return out


