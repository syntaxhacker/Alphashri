#!/usr/bin/env python3
"""One-screen, read-only desk check for the NIFTY options desk.

Prints the whole trading picture in ~30 lines: spot/ATM/straddle/VIX, vol and
GEX, a selected-strike ladder, index breadth, open ledger positions and
realised/open P&L.

Read-only by construction: it never trades, never writes a file and opens the
database with ``mode=ro``. Market context comes from the local
``GET /api/reports/nifty/live`` endpoint (falling back to the Upstox option
chain via ``scripts.agent_desk_manager``), breadth from Upstox
market-quote/historical candles, and P&L from SQLite + the manual ledger.

Usage
-----
    .venv/bin/python scripts/desk_check.py
    .venv/bin/python scripts/desk_check.py --date 2026-10-21
    .venv/bin/python scripts/desk_check.py --strikes 22600,22700,22800 --no-breadth
    .venv/bin/python scripts/desk_check.py --unusual
    .venv/bin/python scripts/desk_check.py --json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sqlite3
import statistics
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import desk_common  # noqa: E402
from scripts import upstox_common  # noqa: E402
from scripts.indicators import ATR_TRUE_PERIOD, candle_field as _candle_field  # noqa: E402
from scripts.indicators import atr_true as atr  # noqa: E402
from scripts.upstox_common import as_float as _as_float  # noqa: E402

DEFAULT_BASE_URL = "http://localhost:8765"
DEFAULT_STRIKES = (22500, 22600, 22700, 22750, 22800, 22850, 23000, 23300)

LTP_URL = "https://api.upstox.com/v2/market-quote/ltp"
HIST_URL = "https://api.upstox.com/v2/historical-candle/{key}/day/{to}/{frm}"

# (verdict key, display label, Upstox instrument key)
BREADTH_KEYS = (
    ("NIFTY", "NIFTY", "NSE_INDEX|Nifty 50"),
    ("BANK", "BANK", "NSE_INDEX|Nifty Bank"),
    ("MIDCAP", "MID", "NSE_INDEX|NIFTY MIDCAP 150"),
    ("SMALLCAP", "SMALL", "NSE_INDEX|Nifty Smallcap 500"),
    ("BROAD", "500", "NSE_INDEX|Nifty 500"),
)

RICH_IV_RV = 1.15
CHEAP_IV_RV = 0.85
SKEW_DELTA_LOW = 0.15
SKEW_DELTA_HIGH = 0.35
SKEW_TARGET = 0.25

# unusual-activity thresholds (chain-wide scan, --unusual only)
UNUSUAL_OI_ABS = 2_000_000       # absolute OI build, contracts
UNUSUAL_OI_PCT = 0.15            # OI build vs prior OI
UNUSUAL_TURNOVER_MULT = 2.0      # vol/OI vs chain median
UNUSUAL_IV_MULT = 1.5            # IV vs ATM IV
UNUSUAL_IV_Z = 2.0               # neighbour-relative IV jump
UNUSUAL_NEW_WALL_TOP = 3         # top-N OI per side = "wall"
UNUSUAL_MAX_LINES = 12           # compact block cap


# ---------------------------------------------------------------------------
# formatting
# ---------------------------------------------------------------------------
def fmt_num(value, dec: int = 2, dash: str = "—") -> str:
    try:
        if value is None:
            return dash
        return f"{float(value):,.{dec}f}"
    except (TypeError, ValueError):
        return dash


def fmt_signed(value, dec: int = 2, dash: str = "—") -> str:
    try:
        if value is None:
            return dash
        return f"{float(value):+,.{dec}f}"
    except (TypeError, ValueError):
        return dash


def fmt_pct(value, dec: int = 1, dash: str = "—") -> str:
    try:
        if value is None:
            return dash
        return f"{float(value):+.{dec}f}%"
    except (TypeError, ValueError):
        return dash


def fmt_rupees(value, dec: int = 0, dash: str = "—") -> str:
    try:
        if value is None:
            return dash
        return f"₹{float(value):+,.{dec}f}"
    except (TypeError, ValueError):
        return dash


def fmt_millions(value, dec: int = 2, dash: str = "—") -> str:
    """Compact signed millions: ``"+4.63M"`` / ``"-1.20M"`` / ``"—"``."""
    try:
        if value is None:
            return dash
        return f"{float(value) / 1_000_000:+,.{dec}f}M"
    except (TypeError, ValueError):
        return dash


# ---------------------------------------------------------------------------
# pure analytics (unit-tested, no network)
# ---------------------------------------------------------------------------
def iv_rv_ratio(iv, rv):
    """IV / RV ratio, or None when either leg is missing/non-positive."""
    try:
        iv_f, rv_f = float(iv), float(rv)
    except (TypeError, ValueError):
        return None
    if iv_f <= 0 or rv_f <= 0:
        return None
    return iv_f / rv_f


def fmt_iv_rv(iv, rv) -> str:
    """``"1.19x rich"`` / ``"0.83x cheap"`` / ``"1.00x fair"`` / ``"n/a"``."""
    ratio = iv_rv_ratio(iv, rv)
    if ratio is None:
        return "n/a"
    if ratio >= RICH_IV_RV:
        tag = "rich"
    elif ratio <= CHEAP_IV_RV:
        tag = "cheap"
    else:
        tag = "fair"
    return f"{ratio:.2f}x {tag}"


def _closest_to_25_delta(legs):
    """Pick the leg nearest |delta| 0.25 inside the 0.15–0.35 band.

    ``legs`` yields ``(strike, delta, iv)``. Returns ``(strike, iv)`` or None.
    """
    best = None
    for strike, delta, iv in legs:
        try:
            d, iv_f = abs(float(delta)), float(iv)
        except (TypeError, ValueError):
            continue
        if iv_f <= 0 or not (SKEW_DELTA_LOW <= d <= SKEW_DELTA_HIGH):
            continue
        score = abs(d - SKEW_TARGET)
        if best is None or score < best[0]:
            best = (score, strike, iv_f)
    if best is None:
        return None
    return best[1], best[2]


def skew_25d(strikes):
    """25-delta put IV minus 25-delta call IV, in vol points.

    Positive = downside put skew (the desk's existing ``control.skew`` sign).
    Returns None when either wing has no contract in the delta band.
    """
    calls, puts = [], []
    for row in strikes or []:
        strike = row.get("strike")
        ce = row.get("ce") or {}
        pe = row.get("pe") or {}
        calls.append((strike, ce.get("delta"), ce.get("iv")))
        puts.append((strike, pe.get("delta"), pe.get("iv")))
    call = _closest_to_25_delta(calls)
    put = _closest_to_25_delta(puts)
    if call is None or put is None:
        return None
    return put[1] - call[1]


def breadth_verdict(pcts):
    """Turn per-index % moves into ``(verdict, detail)``.

    ``pcts`` maps NIFTY/BANK/MIDCAP/SMALLCAP/BROAD to a percent move. Missing
    keys are ignored so a partially-failed fetch still produces a verdict.
    """
    vals = {}
    for key, value in (pcts or {}).items():
        try:
            if value is not None:
                vals[str(key).upper()] = float(value)
        except (TypeError, ValueError):
            continue
    if not vals:
        return "unavailable", "no breadth data"

    n = len(vals)
    pos = sum(1 for v in vals.values() if v > 0)
    score = pos / n
    nifty = vals.get("NIFTY")
    core = [vals[k] for k in ("MIDCAP", "SMALLCAP") if k in vals]
    core_avg = sum(core) / len(core) if core else None

    if score >= 0.8 and (nifty is None or nifty > 0) and (core_avg is None or core_avg > 0):
        verdict = "risk-on"
    elif score <= 0.2:
        verdict = "risk-off"
    elif nifty is not None and core_avg is not None and nifty < 0 and core_avg < 0 and score <= 0.4:
        verdict = "risk-off"
    elif nifty is not None and core_avg is not None and nifty > 0 and core_avg > 0 and score >= 0.6:
        verdict = "risk-on"
    else:
        verdict = "mixed"

    leader = max(vals.items(), key=lambda kv: kv[1])
    laggard = min(vals.items(), key=lambda kv: kv[1])
    bits = [f"{pos}/{n} up"]
    if core_avg is not None:
        bits.append(f"mid/small {core_avg:+.1f}%")
    bits.append(f"leader {leader[0]} {leader[1]:+.1f}%")
    if n > 1:
        bits.append(f"laggard {laggard[0]} {laggard[1]:+.1f}%")
    return verdict, ", ".join(bits)


def classify_symbol(symbol) -> str:
    """Manual ledger symbols carry a space (``NIFTY 2026-10-27 22700PE``)."""
    return "manual" if " " in str(symbol or "").strip() else "coded"


def realised_split(rows) -> dict:
    """Split ``[{symbol, net_pnl}, ...]`` into manual / coded / total."""
    out = {"manual": 0.0, "coded": 0.0, "total": 0.0, "manual_n": 0, "coded_n": 0}
    for row in rows or []:
        try:
            value = float(row.get("net_pnl") or 0)
        except (TypeError, ValueError):
            value = 0.0
        book = classify_symbol(row.get("symbol"))
        out[book] += value
        out[f"{book}_n"] += 1
        out["total"] += value
    return out


def mark_premium(position, strikes):
    """Live premium for one ledger position from the report strike ladder."""
    try:
        strike = float(position.get("strike") or 0)
    except (TypeError, ValueError):
        return None
    row = next(
        (r for r in strikes or [] if abs(float(r.get("strike") or 0) - strike) < 1),
        None,
    )
    if row is None:
        return None
    ce = (row.get("ce") or {}).get("ltp")
    pe = (row.get("pe") or {}).get("ltp")
    opt = str(position.get("opt") or "").upper()
    if opt == "STRADDLE":
        if ce is None or pe is None:
            return None
        return float(ce) + float(pe)
    leg = ce if opt == "CE" else pe
    return None if leg is None else float(leg)


def position_pnl(position, mark):
    """Signed P&L for a ledger position at ``mark`` (None when unmarkable)."""
    try:
        entry = float(position.get("entry_premium") or 0)
        qty = int(position.get("qty") or 0)
    except (TypeError, ValueError):
        return None
    if mark is None or entry <= 0 or qty <= 0:
        return None
    sign = -1 if str(position.get("direction") or "LONG").upper() == "SHORT" else 1
    return (float(mark) - entry) * qty * sign


def prev_close_from_candles(candles, today_str: str):
    """Last completed daily close strictly before ``today_str`` (YYYY-MM-DD)."""
    best = None
    for candle in candles or []:
        try:
            stamp, close = str(candle[0])[:10], float(candle[4])
        except (TypeError, ValueError, IndexError):
            continue
        if stamp < today_str and (best is None or stamp > best[0]):
            best = (stamp, close)
    return best[1] if best else None


def nearest_strike(strikes, spot):
    rows = [r for r in strikes or [] if r.get("strike") is not None]
    if not rows or not spot:
        return None
    return min(rows, key=lambda r: abs(float(r["strike"]) - float(spot)))


# ---------------------------------------------------------------------------
# unusual-activity scan (chain-wide, --unusual)
# ---------------------------------------------------------------------------
_SENTIMENT_ALIASES = {
    "long buildup": "LB",
    "short buildup": "SB",
    "short covering": "SC",
    "long unwinding": "LU",
    "neutral": "Neutral",
}

_SENTIMENT_TAGS = {
    ("ce", "SB"): "CE-writers",
    ("pe", "SB"): "PE-writers",
    ("pe", "LB"): "PE-buyers",
    ("ce", "LB"): "CE-buyers",
}

_SUMMARY_KEYS = {
    "CE-writers": "ce_writers",
    "PE-writers": "pe_writers",
    "PE-buyers": "pe_buyers",
    "CE-buyers": "ce_buyers",
}


def sentiment_label(leg) -> str:
    """``"LB"`` / ``"SB"`` / ``"SC"`` / ``"LU"``, tolerating missing sentiment."""
    sent = (leg or {}).get("sentiment")
    if isinstance(sent, dict):
        raw = sent.get("label") or sent.get("type")
    else:
        raw = sent
    if raw is None:
        return ""
    text = str(raw).strip()
    if not text:
        return ""
    return _SENTIMENT_ALIASES.get(text.lower(), text)


def sentiment_tag(side, label) -> str:
    """Desk-facing role tag for one leg, or ``""`` when not SB/LB."""
    return _SENTIMENT_TAGS.get((str(side or "").lower(), str(label or "").upper()), "")


def leg_rows(strikes) -> list[dict]:
    """Flatten the report ladder into one normalised row per strike/side.

    ``strikes`` is the ``/api/reports/nifty/live`` ``strikes`` list. Missing
    ``oi_change`` is derived from ``oi - prev_oi`` when possible; ``oi=0``,
    missing volume/IV and absent sentiment degrade to ``None``/``""`` instead
    of raising.
    """
    rows: list[dict] = []
    for row in strikes or []:
        if not isinstance(row, dict):
            continue
        strike = _as_float(row.get("strike"))
        if strike is None:
            continue
        for side in ("ce", "pe"):
            leg = row.get(side)
            if not isinstance(leg, dict):
                leg = {}
            oi = _as_float(leg.get("oi"))
            oi_change = _as_float(leg.get("oi_change"))
            if oi_change is None:
                prev_oi = _as_float(leg.get("prev_oi"))
                if oi is not None and prev_oi is not None:
                    oi_change = oi - prev_oi
            iv = _as_float(leg.get("iv"))
            if iv is not None and iv <= 0:
                iv = None
            volume = _as_float(leg.get("volume"))
            label = sentiment_label(leg)
            ratio = None
            if volume is not None and oi is not None:
                ratio = volume / max(oi, 1)
            rows.append(
                {
                    "strike": strike,
                    "side": side,
                    "oi": oi,
                    "oi_change": oi_change,
                    "volume": volume,
                    "iv": iv,
                    "ratio": ratio,
                    "label": label,
                    "tag": sentiment_tag(side, label),
                }
            )
    rows.sort(key=lambda r: (r["strike"], r["side"]))
    return rows


def atm_iv_value(strikes, atm=None, spot=None):
    """Mean of ATM CE/PE IV (falls back to the strike nearest ``spot``)."""
    target = _as_float(atm)
    if target is None:
        target = _as_float(spot)
    rows = [r for r in strikes or [] if isinstance(r, dict) and _as_float(r.get("strike")) is not None]
    if target is None or not rows:
        return None
    row = min(rows, key=lambda r: abs(_as_float(r.get("strike")) - target))
    ivs = []
    for side in ("ce", "pe"):
        leg = row.get(side) if isinstance(row.get(side), dict) else {}
        iv = _as_float(leg.get("iv"))
        if iv is not None and iv > 0:
            ivs.append(iv)
    return sum(ivs) / len(ivs) if ivs else None


def iv_neighbour_z(leg, same_side, window: int = 3):
    """Z-score of ``leg``'s IV against the ``window`` nearest same-side strikes."""
    iv = (leg or {}).get("iv")
    if iv is None:
        return None
    strike = leg.get("strike")
    others = [
        o for o in same_side or [] if o is not leg and o.get("iv") is not None and o.get("strike") is not None
    ]
    others.sort(key=lambda o: (abs(o["strike"] - strike), o["strike"]))
    near = others[:window]
    if len(near) < 2:
        return None
    vals = [o["iv"] for o in near]
    mean = sum(vals) / len(vals)
    var = sum((v - mean) ** 2 for v in vals) / len(vals)
    if var <= 0:
        return None
    return (iv - mean) / var**0.5


def top_oi_strikes(legs, side, n: int = UNUSUAL_NEW_WALL_TOP) -> set:
    """Strikes holding the top-``n`` OI for one side today."""
    ranked = sorted(
        (l for l in legs or [] if l["side"] == side and l["oi"] is not None and l["oi"] > 0),
        key=lambda l: l["oi"],
        reverse=True,
    )
    return {l["strike"] for l in ranked[:n]}


def unusual_flags(strikes, atm=None, spot=None) -> list[dict]:
    """Every strike/side with unusual OI, turnover, IV or a fresh wall.

    Pure: sorted by absolute OI change (desc); the renderer caps the output.
    """
    legs = leg_rows(strikes)
    if not legs:
        return []

    ratios = [l["ratio"] for l in legs if l["ratio"] is not None and l["ratio"] > 0]
    median_ratio = statistics.median(ratios) if len(ratios) >= 3 else None
    atm_iv = atm_iv_value(strikes, atm=atm, spot=spot)
    side_legs = {
        "ce": [l for l in legs if l["side"] == "ce"],
        "pe": [l for l in legs if l["side"] == "pe"],
    }
    walls = {side: top_oi_strikes(legs, side) for side in ("ce", "pe")}

    flags: list[dict] = []
    for leg in legs:
        tags: list[str] = []
        oi, oi_change = leg["oi"], leg["oi_change"]
        prior_oi = oi - oi_change if oi is not None and oi_change is not None else None

        if oi_change is not None:
            if oi_change >= UNUSUAL_OI_ABS:
                tags.append("OI build")
            elif prior_oi is not None and prior_oi > 0 and oi_change >= UNUSUAL_OI_PCT * prior_oi:
                tags.append("OI build")

        ratio = leg["ratio"]
        if (
            ratio is not None
            and ratio > 0
            and median_ratio is not None
            and ratio > UNUSUAL_TURNOVER_MULT * median_ratio
        ):
            tags.append("turnover")

        if atm_iv is not None and leg["iv"] is not None and leg["iv"] > UNUSUAL_IV_MULT * atm_iv:
            tags.append("IV spike")
        else:
            z = iv_neighbour_z(leg, side_legs[leg["side"]])
            if z is not None and abs(z) >= UNUSUAL_IV_Z:
                tags.append("IV jump")

        if leg["strike"] in walls[leg["side"]] and oi_change is not None and oi_change > 0:
            tags.append("new wall")

        if not tags:
            continue
        flags.append(
            {
                "strike": leg["strike"],
                "side": leg["side"].upper(),
                "oi": oi,
                "oi_change": oi_change,
                "volume": leg["volume"],
                "iv": leg["iv"],
                "ratio": ratio,
                "label": leg["label"],
                "tag": leg["tag"],
                "tags": tags,
                "score": abs(oi_change or 0.0),
            }
        )

    flags.sort(key=lambda f: f["score"], reverse=True)
    return flags


def new_walls(strikes) -> list[dict]:
    """Top-3 OI strikes per side that also gained OI today, strongest first."""
    legs = leg_rows(strikes)
    out: list[dict] = []
    for side in ("ce", "pe"):
        top = top_oi_strikes(legs, side)
        for leg in legs:
            if leg["side"] != side or leg["strike"] not in top:
                continue
            if leg["oi_change"] is not None and leg["oi_change"] > 0:
                out.append(
                    {
                        "strike": leg["strike"],
                        "side": side.upper(),
                        "oi_change": leg["oi_change"],
                    }
                )
    out.sort(key=lambda w: w["oi_change"], reverse=True)
    return out


def unusual_summary(strikes) -> dict:
    """OI-change sums by writer/buyer bucket + today's fresh walls."""
    buckets = {"ce_writers": 0.0, "pe_writers": 0.0, "pe_buyers": 0.0, "ce_buyers": 0.0}
    for leg in leg_rows(strikes):
        key = _SUMMARY_KEYS.get(leg["tag"])
        if key is None or leg["oi_change"] is None:
            continue
        buckets[key] += leg["oi_change"]
    return {**buckets, "new_walls": new_walls(strikes)}


def render_unusual(unusual: dict) -> list[str]:
    """Compact ``UNUSUAL`` block: flagged strikes + one summary line."""
    flags = list((unusual or {}).get("flags") or [])
    summary = (unusual or {}).get("summary") or {}
    shown = flags[:UNUSUAL_MAX_LINES]
    if len(shown) < len(flags):
        head = f"UNUSUAL ({len(shown)} of {len(flags)})"
    else:
        head = f"UNUSUAL ({len(shown)})"

    lines = ["", head]
    for flag in shown:
        ratio = flag.get("ratio")
        ratio_txt = f"{ratio:.2f}x" if ratio is not None else "—"
        label = flag.get("label") or "—"
        tag = flag.get("tag") or "—"
        lines.append(
            f"  {fmt_num(flag.get('strike'), 0):>7} {flag.get('side', ''):<2}  "
            f"ΔOI {fmt_millions(flag.get('oi_change')):>9}  "
            f"vol/OI {ratio_txt:>7}  IV {fmt_num(flag.get('iv')):>5}  "
            f"{label:<7} {tag:<10}  [{', '.join(flag.get('tags') or [])}]"
        )

    lines.append(
        f"  CE writers {fmt_millions(summary.get('ce_writers'))}"
        f" | PE writers {fmt_millions(summary.get('pe_writers'))}"
        f" | PE buyers {fmt_millions(summary.get('pe_buyers'))}"
        f" | CE buyers {fmt_millions(summary.get('ce_buyers'))}"
    )
    walls = summary.get("new_walls") or []
    if walls:
        parts = [
            f"{fmt_num(w.get('strike'), 0).replace(',', '')}{w.get('side', '')} "
            f"{fmt_millions(w.get('oi_change'))}"
            for w in walls
        ]
    else:
        parts = ["none"]
    lines.append("  new walls: " + ", ".join(parts))
    return lines



# ---------------------------------------------------------------------------
# momentum speed (pure, unit-tested)
# ---------------------------------------------------------------------------
# NSE Closing Auction Session (since 3 Aug 2026): continuous F&O-stock
# trading ends at 15:15 IST, the index print is frozen 15:15–15:30 (no
# continuous matching), and the official close is the CAS print (~15:30).
CAS_START_MIN = 15 * 60 + 15
CAS_END_MIN = 15 * 60 + 30  # exclusive
CAS_WARNING = "CAS: index print frozen (15:15–15:30); official close from OHLC"


def is_cas_window(now=None) -> bool:
    """True when ``now`` (IST) falls in the 15:15–15:30 CAS freeze window.

    Naive datetimes are assumed IST; aware ones are converted to IST.
    ``None`` checks the current IST time. Never raises.
    """
    try:
        ts = now if now is not None else _now_ist()
        if ts.tzinfo is None:
            import config

            ts = ts.replace(tzinfo=config.IST)
        else:
            ts = ts.astimezone(_now_ist().tzinfo)
        return CAS_START_MIN <= ts.hour * 60 + ts.minute < CAS_END_MIN
    except Exception:
        return False
# Was the tape moving fast enough to justify paying premium? ATR is a SIMPLE
# mean of true ranges (not Wilder smoothing) so short/partial series behave
# sanely. RVOL compares the last N-minute volume bucket against the median of
# the preceding non-overlapping N-minute buckets. Report intraday candles
# carry no volume (normalised to {time,open,high,low,close}), so live RVOL is
# usually None and the verdict falls back to ATR only.
SPEED_ATR_PERIOD = ATR_TRUE_PERIOD
SPEED_SHORT_MINUTES = 5
SPEED_LONG_MINUTES = 15
SPEED_RVOL_MINUTES = 5
SPEED_RVOL_MIN_WINDOWS = 2  # baseline N-min windows needed for a median
SPEED_FAST_ATR = 1.0        # |5m ROC| >= 1.0 ATR ...
SPEED_FAST_RVOL = 1.2       # ... AND RVOL >= 1.2x -> FAST
SPEED_SLOW_ATR = 0.5        # |5m ROC| < 0.5 ATR ...
SPEED_SLOW_RVOL = 0.8       # ... OR RVOL < 0.8x -> SLOW


def _candle_time(candle):
    """ISO timestamp of a dict (``time``) or list (index 0) candle, or None."""
    raw = (candle or {}).get("time") if isinstance(candle, dict) else (candle[0] if candle else None)
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _closes_in_order(candles) -> list[tuple]:
    """``[(time, close), ...]`` sorted ascending, dropping unparseable rows."""
    rows = []
    for c in candles or []:
        ts, close = _candle_time(c), _candle_field(c, "close", 4)
        if ts is None or close is None or close <= 0:
            continue
        rows.append((ts, close))
    rows.sort(key=lambda r: r[0])
    return rows


def roc_points(candles, minutes: int):
    """``close_now - close`` at/before ``(last_time - minutes)``, else None."""
    rows = _closes_in_order(candles)
    if len(rows) < 2:
        return None
    end = rows[-1][0]
    target = end - dt.timedelta(minutes=minutes)
    base = None
    for ts, close in rows:
        if ts <= target:
            base = close
        else:
            break
    if base is None:
        return None
    return rows[-1][1] - base


def roc_atr(candles, minutes: int, atr_value):
    """``roc_points / atr_value`` — signed ATR multiples, None-safe."""
    try:
        atr_f = float(atr_value)
    except (TypeError, ValueError):
        return None
    if not atr_f or atr_f <= 0:
        return None
    points = roc_points(candles, minutes)
    if points is None:
        return None
    return points / atr_f


def rvol(candles, minutes: int = SPEED_RVOL_MINUTES):
    """Last-N-bar volume vs the median of prior non-overlapping N-bar windows.

    Returns None when volume is absent (every bar missing/zero) or when fewer
    than ``SPEED_RVOL_MIN_WINDOWS`` baseline windows exist.
    """
    vols: list[float] = []
    for c in candles or []:
        v = _candle_field(c, "volume", 5)
        vols.append(v if v is not None and v > 0 else 0.0)
    if not any(v > 0 for v in vols):
        return None
    if len(vols) < minutes * (SPEED_RVOL_MIN_WINDOWS + 1):
        return None
    current = sum(vols[-minutes:])
    baselines = []
    start = len(vols) - minutes
    while start - minutes >= 0:
        start -= minutes
        baselines.append(sum(vols[start:start + minutes]))
    if len(baselines) < SPEED_RVOL_MIN_WINDOWS:
        return None
    med = statistics.median(baselines)
    if med <= 0:
        return None
    return current / med


def speed_verdict(roc5_atr, rvol5=None) -> str:
    """FAST / NORMAL / SLOW from the 5-minute ATR multiple (+ optional RVOL).

    RVOL None (no volume on the feed) judges on ATR only. ``roc5_atr`` None
    (no usable candles) yields ``"n/a"``.
    """
    try:
        mag = abs(float(roc5_atr))
    except (TypeError, ValueError):
        return "n/a"
    try:
        rv = None if rvol5 is None else float(rvol5)
    except (TypeError, ValueError):
        rv = None
    if mag >= SPEED_FAST_ATR and (rv is None or rv >= SPEED_FAST_RVOL):
        return "FAST"
    if mag < SPEED_SLOW_ATR or (rv is not None and rv < SPEED_SLOW_RVOL):
        return "SLOW"
    return "NORMAL"


def speed_from_candles(candles) -> dict:
    """Full SPEED read: ATR, 5m/15m ROC in points + ATR units, RVOL, verdict."""
    atr14 = atr(candles)
    roc5 = roc_points(candles, SPEED_SHORT_MINUTES)
    roc15 = roc_points(candles, SPEED_LONG_MINUTES)
    rvol5 = rvol(candles)
    roc5_atr = (roc5 / atr14) if (roc5 is not None and atr14) else None
    roc15_atr = (roc15 / atr14) if (roc15 is not None and atr14) else None
    return {
        "atr14": atr14,
        "roc5": roc5,
        "roc5_atr": roc5_atr,
        "roc15": roc15,
        "roc15_atr": roc15_atr,
        "rvol5": rvol5,
        "verdict": speed_verdict(roc5_atr, rvol5),
    }


def load_tape_spots(date_str: str) -> list[dict]:
    """Spot-only fallback: ``{time, close}`` rows from the nifty tape jsonl."""
    path = ROOT / "experiments" / "data" / "nifty_tape" / f"{date_str}.jsonl"
    if not path.exists():
        return []
    rows: list[dict] = []
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue  # gaps file may interleave; skip bad lines
                try:
                    spot = float(row.get("spot") or 0)
                except (TypeError, ValueError):
                    continue
                if spot > 0 and row.get("t"):
                    rows.append({"time": row["t"], "close": spot})
    except OSError:
        return []
    rows.sort(key=lambda r: r["time"])
    return rows



# ---------------------------------------------------------------------------
# live sources
# ---------------------------------------------------------------------------
def _now_ist() -> dt.datetime:
    import config

    return dt.datetime.now(config.IST)


def _get_json(url: str, timeout: float) -> dict:
    import requests

    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def fetch_report(date_str: str, base_url: str, timeout: float) -> tuple[dict, str]:
    """Report for ``date_str``: (payload, "snapshot"|"live").

    A past date prefers its saved snapshot and falls back to the live report
    when no snapshot exists, so the header never lies about freshness.
    """
    if date_str != desk_common.today_ist():
        try:
            return _get_json(f"{base_url}/api/reports/nifty?date={date_str}", timeout), "snapshot"
        except Exception:
            pass  # no snapshot for that date — fall back to live
    return _get_json(f"{base_url}/api/reports/nifty/live", timeout), "live"


def _report_from_chain(chain: dict, expiry: str) -> dict:
    """Project a raw Upstox v2 chain into the report's ``strikes`` shape."""
    strikes = []
    for row in chain.get("rows") or []:
        ce = (row.get("call_options") or {}).get("market_data") or {}
        pe = (row.get("put_options") or {}).get("market_data") or {}
        strikes.append(
            {
                "strike": row.get("strike_price"),
                "ce": {k: ce.get(k) for k in ("ltp", "bid_price", "ask_price", "iv", "delta", "oi")},
                "pe": {k: pe.get(k) for k in ("ltp", "bid_price", "ask_price", "iv", "delta", "oi")},
            }
        )
    return {"spot": chain.get("spot"), "strikes": strikes, "expiry": expiry, "source": "upstox-chain"}


def fetch_chain_report(expiry: str) -> dict:
    """Reuse ``agent_desk_manager``'s token + chain primitive with our expiry."""
    from scripts import agent_desk_manager as adm

    previous = adm.EXPIRY
    resolved = str(expiry or previous)
    if resolved:
        adm.EXPIRY = resolved
    try:
        chain = adm._chain(adm._token(), resolved)
    finally:
        adm.EXPIRY = previous
    return _report_from_chain(chain, resolved)


def _upstox_token() -> str:
    return upstox_common.token()


def fetch_breadth(timeout: float = 10.0, today: str | None = None) -> list[dict]:
    """Last price + % vs previous daily close for the five benchmark indices."""
    import requests

    token = _upstox_token()
    if not token:
        raise RuntimeError("no Upstox token")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    today = today or desk_common.today_ist()
    from_date = (dt.date.fromisoformat(today) - dt.timedelta(days=4)).isoformat()

    keys = [key for _, _, key in BREADTH_KEYS]
    resp = requests.get(
        LTP_URL,
        params={"instrument_key": ",".join(keys)},
        headers=headers,
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json().get("data") or {}
    by_token = {v.get("instrument_token"): v for v in data.values()}
    if not by_token:
        raise RuntimeError("empty ltp payload")

    rows = []
    for verdict_key, label, instrument_key in BREADTH_KEYS:
        last = (by_token.get(instrument_key) or {}).get("last_price")
        prev = None
        try:
            url = HIST_URL.format(
                key=urllib.parse.quote(instrument_key, safe=""), to=today, frm=from_date
            )
            hist = requests.get(url, headers=headers, timeout=timeout)
            hist.raise_for_status()
            candles = (hist.json().get("data") or {}).get("candles") or []
            prev = prev_close_from_candles(candles, today)
        except Exception:
            prev = None  # one index failing must not blank the whole panel
        pct = ((float(last) / prev - 1) * 100) if last and prev else None
        rows.append(
            {
                "key": verdict_key,
                "label": label,
                "last": float(last) if last is not None else None,
                "prev": prev,
                "pct": pct,
            }
        )
    return rows


def load_positions() -> list:
    from options_paper import manual

    return list(manual._load())


def load_realised(date_str: str) -> dict:
    """Realised options P&L for ``date_str`` from a read-only SQLite handle."""
    db = desk_common.db_path()
    if not db.exists():
        raise FileNotFoundError(str(db))
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "select symbol, net_pnl from trades "
            "where date(entry_time) = ? and source like 'options_paper%'",
            (date_str,),
        ).fetchall()
    finally:
        con.close()
    return realised_split([{"symbol": s, "net_pnl": n} for s, n in rows])


# ---------------------------------------------------------------------------
# payload
# ---------------------------------------------------------------------------
def build_payload(args) -> dict:
    errors: list[str] = []

    def fail(source: str, exc: BaseException) -> None:
        msg = f"{type(exc).__name__}: {exc}".strip()
        if len(msg) > 90:  # keep one line; never cut mid-URL
            msg = type(exc).__name__
        errors.append(f"unavailable: {source} ({msg})")

    report = None
    source = "nifty-report"
    try:
        report, source = fetch_report(args.date, args.base_url, args.timeout)
    except Exception as exc:  # noqa: BLE001
        fail("nifty-report", exc)

    expiry = (report or {}).get("expiry") or ""
    if report is None or not report.get("strikes"):
        try:
            chain_report = fetch_chain_report(expiry)
            if report is None:
                report = chain_report
            else:
                report = {
                    **report,
                    "spot": report.get("spot") or chain_report.get("spot"),
                    "strikes": chain_report.get("strikes") or [],
                    "expiry": expiry or chain_report.get("expiry"),
                }
        except Exception as exc:  # noqa: BLE001
            fail("upstox-chain", exc)

    expiry = (report or {}).get("expiry") or expiry
    report = report or {}
    strikes = report.get("strikes") or []
    try:
        spot = float(report.get("spot") or 0) or None
    except (TypeError, ValueError):
        spot = None
    atm_row = nearest_strike(strikes, spot)
    atm = float(atm_row["strike"]) if atm_row else None
    if atm_row:
        ce_ltp = (atm_row.get("ce") or {}).get("ltp")
        pe_ltp = (atm_row.get("pe") or {}).get("ltp")
        straddle = (
            float(ce_ltp) + float(pe_ltp)
            if ce_ltp is not None and pe_ltp is not None
            else None
        )
    else:
        straddle = None

    control = report.get("control") or {}
    gex = report.get("gex") or {}
    levels = gex.get("levels") or {}
    regime = report.get("regime") or {}
    atm_ce_iv = control.get("atm_ce_iv")
    atm_pe_iv = control.get("atm_pe_iv")
    if atm_ce_iv is None and atm_row:
        atm_ce_iv = (atm_row.get("ce") or {}).get("iv")
    if atm_pe_iv is None and atm_row:
        atm_pe_iv = (atm_row.get("pe") or {}).get("iv")

    breadth_rows: list[dict] = []
    breadth = {"verdict": "skipped", "detail": "--no-breadth"}
    if not args.no_breadth:
        try:
            breadth_rows = fetch_breadth(args.timeout)
            pcts = {r["key"]: r["pct"] for r in breadth_rows if r["pct"] is not None}
            verdict, detail = breadth_verdict(pcts)
            breadth = {"verdict": verdict, "detail": detail}
        except Exception as exc:  # noqa: BLE001
            fail("breadth", exc)
            breadth = {"verdict": "unavailable", "detail": "fetch failed"}

    try:
        positions = load_positions()
    except Exception as exc:  # noqa: BLE001
        fail("ledger", exc)
        positions = []

    open_rows = []
    open_pnl = 0.0
    for pos in positions:
        mark = mark_premium(pos, strikes)
        pnl = position_pnl(pos, mark)
        if pnl is not None:
            open_pnl += pnl
        open_rows.append(
            {
                "opt": pos.get("opt"),
                "strike": pos.get("strike"),
                "direction": str(pos.get("direction") or "LONG").upper(),
                "entry": pos.get("entry_premium"),
                "mark": mark,
                "pnl": pnl,
                "stop": pos.get("stop"),
                "target": pos.get("target"),
                "qty": pos.get("qty"),
                "tag": pos.get("tag") or "",
            }
        )

    realised = {"manual": None, "coded": None, "total": None, "manual_n": 0, "coded_n": 0}
    try:
        realised = load_realised(args.date)
    except Exception as exc:  # noqa: BLE001
        fail("pnl-db", exc)

    all_in = None
    if realised.get("total") is not None:
        all_in = realised["total"] + open_pnl

    selected = []
    wanted = getattr(args, "strike_list", None) or list(DEFAULT_STRIKES)
    for strike in wanted:
        row = next((r for r in strikes if r.get("strike") is not None and abs(float(r["strike"]) - strike) < 1), None)
        selected.append(
            {
                "strike": strike,
                "ce": (row or {}).get("ce") or {},
                "pe": (row or {}).get("pe") or {},
                "found": row is not None,
            }
        )

    vix = report.get("vix")
    if isinstance(vix, dict):
        vix_block = {
            "ltp": vix.get("ltp"),
            "prev_close": vix.get("prev_close"),
            "change_pct": vix.get("change_pct"),
        }
    else:
        vix_block = {"ltp": vix, "prev_close": None, "change_pct": None}

    unusual = None
    if getattr(args, "unusual", False):
        unusual = {
            "flags": unusual_flags(strikes, atm=atm, spot=spot),
            "summary": unusual_summary(strikes),
        }

    speed_candles = report.get("intraday") or report.get("candles") or []
    speed_source = "intraday" if report.get("intraday") else ("candles" if report.get("candles") else "tape")
    if not speed_candles:
        speed_candles = load_tape_spots(args.date)
        speed_source = "tape" if speed_candles else "none"
    speed = speed_from_candles(speed_candles)
    speed["source"] = speed_source

    payload = {
        "ts": _now_ist().isoformat(timespec="seconds"),
        "date": args.date,
        "expiry": expiry,
        "source": report.get("source") or source,
        "spot": spot,
        "atm": atm,
        "straddle": straddle,
        "vix": vix_block,
        "vol": {
            "atm_ce_iv": atm_ce_iv,
            "atm_pe_iv": atm_pe_iv,
            "rv": regime.get("rv"),
            "iv": regime.get("iv"),
            "iv_rv": fmt_iv_rv(regime.get("iv") or atm_ce_iv, regime.get("rv")),
            "skew_25d": skew_25d(strikes),
            "skew_ctl": control.get("skew"),
        },
        "gex": {
            "regime": gex.get("regime"),
            "flip": gex.get("zero_cross"),
            "resistance": (levels.get("resistance") or {}).get("strike"),
            "support": (levels.get("support") or {}).get("strike"),
            "fuel_down": (levels.get("fuel_down") or {}).get("strike"),
            "fuel_up": (levels.get("fuel_up") or {}).get("strike"),
        },
        "pcr_oi": report.get("pcr_oi"),
        "pcr_vol": report.get("pcr_vol"),
        "max_pain": report.get("max_pain"),
        "positioning": (report.get("positioning") or {}).get("verdict"),
        "strikes": selected,
        "breadth": {"rows": breadth_rows, **breadth},
        "positions": open_rows,
        "pnl": {
            "realised_manual": realised.get("manual"),
            "realised_coded": realised.get("coded"),
            "realised_total": realised.get("total"),
            "realised_manual_n": realised.get("manual_n", 0),
            "realised_coded_n": realised.get("coded_n", 0),
            "open_manual": open_pnl,
            "all_in": all_in,
        },
        "errors": errors,
    }
    if unusual is not None:
        payload["unusual"] = unusual
    payload["speed"] = speed
    return payload


# ---------------------------------------------------------------------------
# rendering
# ---------------------------------------------------------------------------
def _level(value) -> str:
    return fmt_num(value, 0)


def render_speed(speed: dict) -> str:
    """One-line momentum read: 5m/15m ROC in points (ATR multiples) + RVOL."""
    verdict = (speed or {}).get("verdict") or "n/a"
    if verdict == "n/a":
        return "SPEED  n/a (no candles)"
    roc5, roc5_atr = speed.get("roc5"), speed.get("roc5_atr")
    roc15, roc15_atr = speed.get("roc15"), speed.get("roc15_atr")
    rvol5 = speed.get("rvol5")

    def _atr_mult(points, mult) -> str:
        if points is None or mult is None:
            return "n/a"
        return f"({abs(mult):.1f} ATR)"

    rvol_txt = f"{rvol5:.1f}x" if rvol5 is not None else "n/a"
    line = (
        f"SPEED 5m {fmt_signed(roc5)} {_atr_mult(roc5, roc5_atr)}  |  "
        f"15m {fmt_signed(roc15)} {_atr_mult(roc15, roc15_atr)}  |  "
        f"RVOL {rvol_txt}  |  {verdict}"
    )
    if rvol5 is None:
        line += " (no vol)"
    return line


def render(payload: dict, now=None) -> str:
    vol = payload["vol"]
    gex = payload["gex"]
    vix = payload["vix"]
    lines: list[str] = []

    stamp = payload["ts"][11:19] if "T" in payload["ts"] else payload["ts"]
    expiry = payload.get("expiry") or "n/a"
    lines.append(f"DESK CHECK  {payload['date']} {stamp} IST  |  expiry {expiry}  |  {payload['source']}")
    lines.append(
        f"SPOT {fmt_num(payload['spot'])}  ATM {_level(payload['atm'])}  "
        f"STRADDLE {fmt_num(payload['straddle'])}  "
        f"VIX {fmt_num(vix.get('ltp'))} {fmt_pct(vix.get('change_pct'))}"
    )

    lines.append(
        f"VOL  ATM IV CE {fmt_num(vol['atm_ce_iv'])} / PE {fmt_num(vol['atm_pe_iv'])}  "
        f"RV {fmt_num(vol['rv'])}  IV/RV {vol['iv_rv']}  "
        f"SKEW25 {fmt_signed(vol['skew_25d'])}  ctl {fmt_num(vol['skew_ctl'], 2)}"
    )
    lines.append(
        f"     GEX {gex.get('regime') or 'n/a'}  flip {_level(gex.get('flip'))}  "
        f"resist {_level(gex.get('resistance'))}  fuel↓ {_level(gex.get('fuel_down'))}  "
        f"PCR {fmt_num(payload['pcr_oi'], 2)} OI / {fmt_num(payload['pcr_vol'], 2)} vol  "
        f"maxpain {_level(payload['max_pain'])}"
    )
    lines.append(render_speed(payload.get("speed") or {}))
    if is_cas_window(now):
        lines.append(CAS_WARNING)

    lines.append("")
    lines.append(
        f"  {'STRIKE':>7}  {'CE BID':>7}/{'ASK':>7}  {'CE IV':>6}  "
        f"{'PE BID':>7}/{'ASK':>7}  {'PE IV':>6}  {'PEΔ':>6}"
    )
    for row in payload["strikes"]:
        ce, pe = row["ce"], row["pe"]
        if not row["found"]:
            lines.append(f"  {fmt_num(row['strike'], 0):>7}  {'not listed':^56}")
            continue
        lines.append(
            f"  {fmt_num(row['strike'], 0):>7}  "
            f"{fmt_num(ce.get('bid_price')):>7}/{fmt_num(ce.get('ask_price')):>7}  "
            f"{fmt_num(ce.get('iv')):>6}  "
            f"{fmt_num(pe.get('bid_price')):>7}/{fmt_num(pe.get('ask_price')):>7}  "
            f"{fmt_num(pe.get('iv')):>6}  "
            f"{fmt_signed(pe.get('delta'), 3):>6}"
        )

    lines.append("")
    breadth = payload["breadth"]
    if breadth.get("verdict") not in ("skipped",):
        if breadth.get("rows"):
            parts = [
                f"{r['label']} {fmt_num(r['last'])} {fmt_pct(r['pct'])}"
                for r in breadth["rows"]
            ]
            lines.append("BREADTH  " + " | ".join(parts))
            lines.append(f"     {breadth['verdict']}: {breadth['detail']}")
        else:
            lines.append(f"BREADTH  unavailable: {breadth.get('detail')}")
    else:
        lines.append("BREADTH  skipped")

    lines.append("")
    positions = payload["positions"]
    if positions:
        lines.append(f"POSITIONS ({len(positions)} open)")
        for p in positions:
            tag = f"  [{p['tag']}]" if p.get("tag") else ""
            lines.append(
                f"  {p['direction']} {p['opt']} {_level(p['strike'])}  "
                f"@ {fmt_num(p['entry'])} -> {fmt_num(p['mark'])}  "
                f"P&L {fmt_rupees(p['pnl'])}  "
                f"stop {fmt_num(p['stop'])} / tgt {fmt_num(p['target'])}{tag}"
            )
    else:
        lines.append("POSITIONS  none open")

    pnl = payload["pnl"]
    lines.append(
        f"P&L  realised manual {fmt_rupees(pnl['realised_manual'])} "
        f"({pnl['realised_manual_n']})  |  coded {fmt_rupees(pnl['realised_coded'])} "
        f"({pnl['realised_coded_n']})  |  total {fmt_rupees(pnl['realised_total'])}"
    )
    lines.append(
        f"     open manual {fmt_rupees(pnl['open_manual'])}  |  "
        f"all-in {fmt_rupees(pnl['all_in'])}"
    )

    if payload.get("unusual") is not None:
        lines.extend(render_unusual(payload["unusual"]))

    for err in payload["errors"]:
        lines.append(err)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------
def _parse_strikes(raw: str) -> list[int]:
    out = []
    for token in str(raw or "").split(","):
        token = token.strip()
        if not token:
            continue
        out.append(int(round(float(token))))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="desk_check",
        description="Read-only one-screen NIFTY options desk check.",
    )
    ap.add_argument("--date", default=None, help="session date YYYY-MM-DD (default today)")
    ap.add_argument(
        "--strikes",
        default=",".join(str(s) for s in DEFAULT_STRIKES),
        help="comma-separated strikes for the ladder",
    )
    ap.add_argument("--no-breadth", action="store_true", help="skip the Upstox breadth fetch")
    ap.add_argument("--unusual", action="store_true", help="append the chain-wide unusual-activity scan")
    ap.add_argument("--json", action="store_true", help="dump the assembled payload as JSON")
    ap.add_argument("--timeout", type=float, default=10.0, help="HTTP timeout in seconds (default 10)")
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL, help="local API base URL")
    args = ap.parse_args(argv)

    args.date = args.date or desk_common.today_ist()
    args.strike_list = _parse_strikes(args.strikes)
    if not args.strike_list:
        ap.error("--strikes must contain at least one strike")

    payload = build_payload(args)
    if args.json:
        print(json.dumps(payload, indent=2, default=str))
    else:
        print(render(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
