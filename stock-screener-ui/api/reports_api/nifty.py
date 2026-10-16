"""Nifty options report backend.

Endpoints (all under the shared ``/api/reports`` prefix):
  - ``GET  /api/reports/nifty/live?expiry=YYYY-MM-DD`` — on-demand report built
    from the live Upstox option chain (5s in-memory TTL).
  - ``GET  /api/reports/nifty?date=YYYY-MM-DD`` — serve a saved snapshot from
    ``experiments/data/nifty_reports/{date}.json`` (404 envelope when missing).
  - ``POST /api/reports/nifty/snapshot`` — build a snapshot (same computation
    as live, plus timeline skeleton / snapshot_at / source) and persist it.
  - ``GET  /api/reports/nifty/replay?date=YYYY-MM-DD[&t=ISO]`` — per-minute
    FULL report snapshots recorded by the background tape tick into
    ``experiments/data/nifty_snapshots/{date}.jsonl`` (replay source).

Upstox access goes through :mod:`api.options` helpers, imported lazily inside
the handlers so this module stays import-light (and cycle-free).
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import config
from api.auth import get_current_user
from api.reports_api.nifty_bursts import (
    NEWS_WINDOW_MIN,
    OI_BURST_MIN_ABS,
    OI_BURST_WINDOW,
    attach_news,
    coalesce_bursts,
    derive_oi_signal,
    detect_coiling,
    detect_oi_bursts,
    detect_premium_moves,
    detect_squeezes,
    detect_strike_bursts,
    session_trend,
)
from api.reports_api.nifty_positioning import compute_positioning

router = APIRouter(prefix="/api/reports", tags=["reports-nifty"])

# stock-screener-ui/api/reports_api/nifty.py -> parents[2] == stock-screener-ui
SNAPSHOT_DIR = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "nifty_reports"

_LIVE_TTL = 5
_live_cache: dict[str, dict] = {}
_sensex_cache: dict[str, dict] = {}
#: yfinance 15m candles change at most once per 15-min bar, so a 5s report TTL
#: must NOT refetch Yahoo every 5s (slow + rate-limited). 60s is plenty.
_CANDLES_TTL = 60
_candles_cache: dict[str, dict] = {}

_MAX_PAIN_WINDOW = 1500.0
_TOP_WALLS = 3


# ---------------------------------------------------------------------------
# Pure helpers (unit-testable, no I/O)
# ---------------------------------------------------------------------------

def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def get_sentiment(price_change: float, oi_change: int) -> dict:
    """Map price/OI changes to a buildup label (delegates to api.options)."""
    from api.options import get_option_sentiment
    return get_option_sentiment(price_change, oi_change)


def compute_pcr(pe_total: float, ce_total: float) -> float:
    """Put-call ratio, guarded against zero call base."""
    if not ce_total:
        return 0.0
    return round(pe_total / ce_total, 2)


def compute_max_pain(strikes: list[dict]) -> float:
    """Max-pain strike over rows of ``{strike, ce_oi, pe_oi}``.

    Total writer payout if the underlying expired at each candidate strike;
    the minimum-payout strike wins. Ties resolve to the lowest strike.
    """
    if not strikes:
        return 0.0
    ordered = sorted(strikes, key=lambda r: r["strike"])
    best_strike = ordered[0]["strike"]
    min_loss = float("inf")
    for cand in ordered:
        t = cand["strike"]
        loss = 0.0
        for row in ordered:
            s = row["strike"]
            if t > s:
                loss += (t - s) * row.get("ce_oi", 0)
            elif t < s:
                loss += (s - t) * row.get("pe_oi", 0)
        if loss < min_loss:
            min_loss = loss
            best_strike = t
    return best_strike


def build_leg(market_data: dict, greeks: Optional[dict] = None) -> dict:
    """Flatten one side's Upstox ``market_data`` into the report leg shape.

    ``greeks`` is the sibling ``option_greeks`` mapping (``{delta, gamma,
    vega, theta, iv}``); only ``gamma`` is carried forward (safe float,
    default 0.0). When omitted, falls back to ``market_data["option_greeks"]``
    if present, else 0.0.
    """
    md = market_data or {}
    ltp = _safe_float(md.get("ltp"))
    close_price = _safe_float(md.get("close_price", ltp))
    oi = _safe_int(md.get("oi"))
    prev_oi = _safe_int(md.get("prev_oi"))
    volume = _safe_int(md.get("volume"))
    oi_change = oi - prev_oi
    price_change = round(ltp - close_price, 2)
    g = greeks if greeks is not None else (md.get("option_greeks") or {})
    gamma = _safe_float((g or {}).get("gamma"))
    # Delta is needed by the delta-positioning block (state/flow/initiated Δ).
    raw_delta = (g or {}).get("delta")
    try:
        delta: Optional[float] = float(raw_delta) if raw_delta is not None else None
    except (TypeError, ValueError):
        delta = None
    # IV is needed for the ATM skew / regime verdicts; None (not 0.0) when the
    # greeks block is absent so callers can distinguish "unknown" from "zero".
    raw_iv = (g or {}).get("iv")
    try:
        iv: Optional[float] = float(raw_iv) if raw_iv is not None else None
    except (TypeError, ValueError):
        iv = None
    return {
        "ltp": ltp,
        "close_price": close_price,
        "oi": oi,
        "prev_oi": prev_oi,
        "oi_change": oi_change,
        "volume": volume,
        "price_change": price_change,
        "sentiment": get_sentiment(price_change, oi_change),
        "gamma": gamma,
        "delta": delta,
        "iv": iv,
    }


def parse_chain_payload(payload: dict) -> tuple[str, float, list[dict]]:
    """Parse a raw Upstox ``/option/chain`` payload into (expiry, spot, rows)."""
    items = payload.get("data", []) or []
    expiry = items[0].get("expiry", "") if items else ""
    spot = _safe_float(payload.get("underlying_spot_price")) or (
        _safe_float(items[0].get("underlying_spot_price")) if items else 0.0
    )
    rows = []
    for item in items:
        strike = _safe_float(item.get("strike_price"))
        call_opts = item.get("call_options") or {}
        put_opts = item.get("put_options") or {}
        call_md = call_opts.get("market_data", {})
        put_md = put_opts.get("market_data", {})
        call_greeks = call_opts.get("option_greeks") or {}
        put_greeks = put_opts.get("option_greeks") or {}
        rows.append({"strike": strike,
                     "ce": build_leg(call_md, call_greeks),
                     "pe": build_leg(put_md, put_greeks)})
    rows.sort(key=lambda r: r["strike"])
    return expiry, spot, rows


def top_walls(rows: list[dict], side: str, n: int = _TOP_WALLS) -> list[dict]:
    """Top-``n`` strikes by OI for side ``'ce'`` / ``'pe'``."""
    ranked = sorted(rows, key=lambda r: r.get(side, {}).get("oi", 0), reverse=True)
    return [{"strike": r["strike"], "oi": r[side]["oi"]} for r in ranked[:n]]


def _fetch_nifty_candles(date_str: str, walkback_days: int = 0) -> list[dict]:
    """15m Nifty candles for ``date_str`` via yfinance (^NSEI).

    Upstox intraday endpoints return no rows for the NSE index, so the
    report chart uses yfinance. Never raises — returns [] on any failure.
    With ``walkback_days`` > 0, retries previous calendar days so a
    pre-market/holiday session still charts the latest trading day.
    """
    try:
        import yfinance as yf
    except ImportError:
        return []
    try:
        from datetime import timedelta
        day = datetime.strptime(date_str, "%Y-%m-%d")
        for back in range(walkback_days + 1):
            target = (day - timedelta(days=back)).strftime("%Y-%m-%d")
            nxt = (day - timedelta(days=back - 1)).strftime("%Y-%m-%d")
            df = yf.download("^NSEI", start=target, end=nxt,
                             interval="15m", progress=False, auto_adjust=False)
            if df is None or len(df) == 0:
                continue
            # Flatten MultiIndex columns (^NSEI single ticker)
            if hasattr(df.columns, "droplevel"):
                try:
                    df.columns = df.columns.droplevel(1)
                except (ValueError, IndexError):
                    pass
            out = []
            for ts, row in df.iterrows():
                out.append({
                    "time": ts.isoformat(),
                    "open": round(float(row["Open"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "close": round(float(row["Close"]), 2),
                    "volume": int(row.get("Volume", 0) or 0),
                })
            if out:
                return out
        return []
    except Exception:
        return []


def _fetch_nifty_candles_cached(date_str: str, walkback_days: int = 0) -> list[dict]:
    """``_fetch_nifty_candles`` behind a short TTL.

    The report TTL is 5s but the 15-minute candles only change once per bar,
    so without this Yahoo would be hit every 5s per report refresh.
    """
    key = f"{date_str}:{walkback_days}"
    now = time.time()
    hit = _candles_cache.get(key)
    if hit and now - hit["ts"] < _CANDLES_TTL:
        return hit["data"]
    data = _fetch_nifty_candles(date_str, walkback_days)
    _candles_cache[key] = {"ts": now, "data": data}
    return data


def compute_gex(rows: list[dict], spot: float, lot_size: int = 65) -> dict:
    """Simplified dealer gamma exposure (GEX) per strike, in Cr per point.

    Formula (per strike)::

        call_gex = gamma_ce * oi_ce * lot_size * spot / 1e7   (positive)
        put_gex  = -(gamma_pe * oi_pe * lot_size * spot / 1e7) (negative)
        net_gex  = call_gex + put_gex

    Convention: customer long puts leave dealers short gamma, so the put
    leg is expressed NEGATIVE and ``net_gex`` is the signed sum. ``net_total``
    is the sum of ``net_gex`` across strikes. ``regime`` is ``"long"`` when
    dealers are net long gamma (dampens moves / pins spot), ``"short"`` when
    net short (amplifies moves), and ``"flat"`` when ``|net_total| < 1.0``.
    ``top_positive`` (top-2 by net_gex) marks support magnets;
    ``top_negative`` (bottom-2) marks resistance / volatility fuel.
    ``zero_cross`` is the strike where cumulative net_gex (ascending) first
    crosses or touches zero, else None. Pure function, no network.
    All floats rounded to 2 decimals.
    """
    spot_f = _safe_float(spot)
    per = []
    for r in rows or []:
        ce = r.get("ce", {}) or {}
        pe = r.get("pe", {}) or {}
        g_ce = _safe_float(ce.get("gamma"))
        g_pe = _safe_float(pe.get("gamma"))
        oi_ce = _safe_int(ce.get("oi"))
        oi_pe = _safe_int(pe.get("oi"))
        call_gex = round(g_ce * oi_ce * lot_size * spot_f / 1e7, 2)
        put_gex = round(-g_pe * oi_pe * lot_size * spot_f / 1e7, 2)
        net_gex = round(call_gex + put_gex, 2)
        per.append({"strike": r.get("strike", 0.0), "call_gex": call_gex,
                    "put_gex": put_gex, "net_gex": net_gex})
    per.sort(key=lambda e: e["strike"])
    net_total = round(sum(e["net_gex"] for e in per), 2)
    if abs(net_total) < 1.0:
        regime = "flat"
    elif net_total > 0:
        regime = "long"
    else:
        regime = "short"
    by_desc = sorted(per, key=lambda e: e["net_gex"], reverse=True)
    by_asc = sorted(per, key=lambda e: e["net_gex"])
    top_positive = [{"strike": e["strike"], "net_gex": e["net_gex"]} for e in by_desc[:2]]
    top_negative = [{"strike": e["strike"], "net_gex": e["net_gex"]} for e in by_asc[:2]]
    zero_cross = None
    cum = 0.0
    prev = None
    for e in per:
        cum = round(cum + e["net_gex"], 2)
        if cum == 0:
            # Exact touch counts only after real exposure — leading dead
            # far-OTM strikes (0 + 0) must not fake a flip level.
            if prev is not None:
                zero_cross = e["strike"]
                break
            continue
        if prev is not None and (prev < 0) != (cum < 0):
            zero_cross = e["strike"]
            break
        prev = cum
    return {
        "strikes": per,
        "net_total": net_total,
        "regime": regime,
        "top_positive": top_positive,
        "top_negative": top_negative,
        "zero_cross": zero_cross,
    }


def market_block() -> dict:
    """Session gate for the UI: is the exchange open right now, and for which day.

    The report keeps working after hours (the chain returns the last close), so
    the UI needs an explicit signal to stop polling and stop labelling a stale
    snapshot as "live".
    """
    from trading.utils import is_market_open
    now = datetime.now(config.IST)
    try:
        is_open = bool(is_market_open())
    except Exception:
        is_open = False
    return {
        "is_open": is_open,
        "session_date": now.strftime("%Y-%m-%d"),
        "as_of": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# Previous-session pivot levels (classic)
# ---------------------------------------------------------------------------

#: NSE index instrument key for Nifty 50 daily candles (pivot source), same
#: form as ``NIFTY_KEY`` / ``VIX_KEY`` in :mod:`api.reports_api.nifty_verdicts`.
NIFTY_PIVOT_KEY = "NSE_INDEX|Nifty 50"
#: Calendar days to look back for the previous completed session's candle.
_PIVOT_LOOKBACK_DAYS = 15

#: One fetch per process day: the previous session's HLC only changes at the
#: day boundary, so the pivot block is memoised like nifty_verdicts' baseline
#: instead of being refetched on every 5s report rebuild.
_PIVOTS_CACHE: dict = {"date": None, "value": None}


def compute_pivots_from_candles(candles: Optional[list], today: str) -> Optional[dict]:
    """Pure: classic pivot levels from raw Upstox daily candle rows.

    Rows are ``[timestamp, open, high, low, close, volume, oi]`` and come
    newest-first, so the previous completed session is ``candles[1]`` — but the
    selection picks the newest row whose date is strictly less than ``today``
    to be resilient to ordering quirks. Returns the report ``pivots`` envelope
    (``type`` + ``pp/r1/r2/r3/s1/s2/s3`` + ``prev`` HLC) or ``None`` when no
    usable prior session exists. Never raises.
    """
    try:
        datetime.strptime(today, "%Y-%m-%d")  # an invalid reference date
        rows = [r for r in (candles or [])
                if isinstance(r, (list, tuple)) and len(r) >= 5
                and str(r[0])[:10] < today]
        if not rows:
            return None
        prev = max(rows, key=lambda r: str(r[0])[:10])
        high, low, close = float(prev[2]), float(prev[3]), float(prev[4])
        if not (high and low and close):
            return None
        from trading.pivot_utils import calculate_pivot_points
        pp = calculate_pivot_points(high, low, close, "classic")
        return {
            "type": "classic",
            "pp": round(pp.pp, 2),
            "r1": round(pp.r1, 2),
            "r2": round(pp.r2, 2),
            "r3": round(pp.r3, 2),
            "s1": round(pp.s1, 2),
            "s2": round(pp.s2, 2),
            "s3": round(pp.s3, 2),
            "prev": {
                "date": str(prev[0])[:10],
                "high": round(high, 2),
                "low": round(low, 2),
                "close": round(close, 2),
            },
        }
    except Exception:
        return None


def _extract_daily_candles(payload: Any) -> list:
    """``data.candles`` list from an Upstox historical-candle payload."""
    try:
        candles = ((payload or {}).get("data") or {}).get("candles") or []
        return candles if isinstance(candles, list) else []
    except Exception:
        return []


def compute_reference(tape_rows: Optional[list[dict]],
                      rows: Optional[list[dict]]) -> Optional[dict]:
    """Fixed-strike ATM reference for the premium-vs-spot read.

    The panel's rolling ATM leg re-anchors to the nearest strike every minute,
    so it looks flat even when a *fixed* strike gains — on 2026-10-16 the 23,150
    PE went 108 → 134 as spot fell 48 pts, while the rolling ATM read −2. This
    pins the day's FIRST ATM strike and reports its open premium (from the
    tape's first row) against its current premium (from the chain), so the
    directional move is visible instead of self-cancelling. Never raises.
    """
    try:
        first = next((r for r in (tape_rows or [])
                      if _safe_float(r.get("atm_strike")) > 0), None)
        if not first:
            return None
        strike = _safe_float(first.get("atm_strike"))
        ce_open = _safe_float(first.get("atm_ce_ltp")) or None
        pe_open = _safe_float(first.get("atm_pe_ltp")) or None
        row = next((r for r in (rows or [])
                    if _safe_float(r.get("strike")) == strike), None)
        if row is None:
            return None
        ce = _safe_float((row.get("ce") or {}).get("ltp")) or None
        pe = _safe_float((row.get("pe") or {}).get("ltp")) or None
        return {
            "strike": strike,
            "ce_open": ce_open, "pe_open": pe_open,
            "ce_ltp": ce, "pe_ltp": pe,
            "ce_change": round(ce - ce_open, 2) if (ce is not None and ce_open) else None,
            "pe_change": round(pe - pe_open, 2) if (pe is not None and pe_open) else None,
            "since": first.get("t"),
        }
    except Exception:
        return None


async def _fetch_pivots(today: str) -> Optional[dict]:
    """Previous-session pivots from the Upstox daily-candle endpoint.

    Same shape as ``nifty_verdicts._fetch_vix_prev_close``: daily candles come
    newest-first and the v2 endpoint has several interval spellings (``day`` is
    canonical; ``days/1`` and ``day/1`` both 404 with UDAPI100060). Tries each
    until one yields a usable prior session.
    """
    from api.options import fetch_upstox
    import urllib.parse
    enc = urllib.parse.quote(NIFTY_PIVOT_KEY, safe="")
    try:
        ref = datetime.strptime(today, "%Y-%m-%d")
    except ValueError:
        return None
    from_date = (ref - timedelta(days=_PIVOT_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    for interval in ("day", "days/1", "day/1"):
        try:
            payload = await fetch_upstox(
                f"/historical-candle/{enc}/{interval}/{today}/{from_date}")
        except Exception:
            continue
        value = compute_pivots_from_candles(_extract_daily_candles(payload), today)
        if value is not None:
            return value
    return None


async def get_pivots_block(today: Optional[str] = None) -> Optional[dict]:
    """Pivot block for ``today``, fetched at most once per process day.

    Only successful fetches are memoised (same policy as the VIX block) so a
    transient failure at 09:20 does not blank the levels for the whole day.
    Never raises — ``None`` on any failure (the UI renders nothing).
    """
    date_str = today or _today_str()
    if _PIVOTS_CACHE["date"] == date_str and _PIVOTS_CACHE["value"] is not None:
        return _PIVOTS_CACHE["value"]
    value: Optional[dict] = None
    try:
        value = await _fetch_pivots(date_str)
    except Exception:
        value = None
    if value is not None:
        _PIVOTS_CACHE["date"] = date_str
        _PIVOTS_CACHE["value"] = value
    return value


def build_report(expiry: str, spot: float, rows: list[dict], mode: str,
                 candles: Optional[list[dict]] = None) -> dict:
    """Assemble the report envelope shared by live and snapshot responses."""
    total_ce_oi = sum(r["ce"]["oi"] for r in rows)
    total_pe_oi = sum(r["pe"]["oi"] for r in rows)
    total_ce_vol = sum(r["ce"]["volume"] for r in rows)
    total_pe_vol = sum(r["pe"]["volume"] for r in rows)
    window = [r for r in rows if abs(r["strike"] - spot) <= _MAX_PAIN_WINDOW]
    pain_rows = [
        {"strike": r["strike"], "ce_oi": r["ce"]["oi"], "pe_oi": r["pe"]["oi"]}
        for r in (window or rows)
    ]
    return {
        "mode": mode,
        "expiry": expiry,
        "spot": spot,
        "fetched_at": datetime.now(config.IST).isoformat(),
        "pcr_oi": compute_pcr(total_pe_oi, total_ce_oi),
        "pcr_vol": compute_pcr(total_pe_vol, total_ce_vol),
        "max_pain": compute_max_pain(pain_rows),
        "walls": {"calls": top_walls(rows, "ce"), "puts": top_walls(rows, "pe")},
        "gex": compute_gex(rows, spot),
        "positioning": compute_positioning(rows, spot),
        "strikes": rows,
        "candles": candles or [],
    }


def build_timeline_skeleton(report: dict) -> list[dict]:
    """Minimal timeline derived from a freshly computed report."""
    return [
        {"time": report.get("fetched_at", ""), "event": "snapshot",
         "detail": f"Nifty spot {report.get('spot')} (expiry {report.get('expiry')})"},
        {"time": report.get("fetched_at", ""), "event": "max_pain",
         "detail": f"Max pain {report.get('max_pain')} over ±{_MAX_PAIN_WINDOW:.0f} window"},
        {"time": report.get("fetched_at", ""), "event": "pcr",
         "detail": f"PCR-OI {report.get('pcr_oi')} / PCR-Vol {report.get('pcr_vol')}"},
    ]


# ---------------------------------------------------------------------------
# Snapshot persistence
# ---------------------------------------------------------------------------

def snapshot_path(date_str: str) -> Path:
    return SNAPSHOT_DIR / f"{date_str}.json"


def read_snapshot(date_str: str) -> Optional[dict]:
    path = snapshot_path(date_str)
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def write_snapshot(date_str: str, data: dict) -> Path:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = snapshot_path(date_str)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return path


def _today_str() -> str:
    return datetime.now(config.IST).strftime("%Y-%m-%d")


def _validate_date(date_str: str) -> str:
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"bad date: {date_str!r}, want YYYY-MM-DD")
    return date_str


# ---------------------------------------------------------------------------
# Live computation (Upstox)
# ---------------------------------------------------------------------------

async def _attach_verdicts(report: dict, rows: list[dict], spot: float,
                           for_date: Optional[str]) -> None:
    """Attach the four session-verdict blocks to ``report`` in place.

    Reuses the already-fetched chain/GEX/candles; only pulls today's 1-minute
    spot, the once-a-day session baseline and VIX (all cached in
    :mod:`api.reports_api.nifty_verdicts`). Never raises — a failure leaves the
    blocks absent rather than breaking ``/live``.
    """
    try:
        from api.reports_api import nifty_verdicts as nv
    except Exception:
        return
    today = for_date or _today_str()
    is_today = today == _today_str()
    baseline: Optional[float] = None
    vix: Optional[dict] = None
    intraday: Optional[list] = None
    try:
        baseline, vix = await asyncio.gather(
            nv.get_baseline_range(today),
            nv.get_vix_block() if is_today else _async_none(),
            return_exceptions=True,
        )
        if isinstance(baseline, BaseException):
            baseline = None
        if isinstance(vix, BaseException):
            vix = None
        if is_today:
            intraday = await nv.get_intraday_candles(today)
    except Exception:
        pass
    # 1-minute today candles when available, else the report's own spot candles.
    candles = intraday or report.get("candles") or []
    tape = read_tape(today)
    # Fixed-strike ATM reference (see compute_reference) so the UI can show the
    # premium move instead of the self-cancelling rolling ATM leg.
    try:
        report["reference"] = compute_reference(tape, rows)
    except Exception:
        report["reference"] = None
    try:
        report.update(nv.build_verdicts(
            rows=rows, spot=spot, gex=report.get("gex"), candles=candles,
            tape_rows=tape, baseline=baseline, vix=vix))
    except Exception:
        pass
    # Structural shifts (wall flips, wall migration, max-pain drift, PCR regime
    # change, volume spikes, level breaks) are the "why" behind the tape's raw
    # numbers: on 2026-10-14 the drop was 22,700 support collapsing into
    # resistance while calls stacked above it. Most recent 12, newest last.
    try:
        from api.reports_api.nifty_structure import detect_structure_shifts
        report["structure"] = detect_structure_shifts(tape)[-12:]
    except Exception:
        report["structure"] = []
    # 1-minute intraday candles + index-aligned EMA9/EMA20 series for the UI
    # chart overlay. Degrades to [] so a failure never breaks /live.
    try:
        report["intraday"] = intraday or []
        if intraday:
            vals: list = []
            for c in intraday:
                v = (c or {}).get("close")
                if v is None:
                    vals.append(None)
                else:
                    try:
                        vals.append(float(v))
                    except (TypeError, ValueError):
                        vals.append(None)
            report["emas"] = [
                {"period": 9, "data": nv.ema_series(vals, 9)},
                {"period": 20, "data": nv.ema_series(vals, 20)},
            ]
        else:
            report["emas"] = []
    except Exception:
        try:
            report["intraday"] = intraday or []
        except Exception:
            report["intraday"] = []
        report["emas"] = []


async def _async_none() -> None:
    return None


async def _compute_live(expiry: Optional[str], for_date: Optional[str] = None,
                      walkback_days: int = 5, with_verdicts: bool = True,
                      with_candles: bool = True) -> dict:
    """Fetch the Upstox chain + spot and build a live report (no caching).

    ``with_verdicts`` attaches the four session-verdict blocks (live/snapshot).
    ``with_candles`` / ``with_verdicts`` are both off for the per-minute tape
    tick, which only reads chain aggregates and must stay yfinance-free.
    """
    # Lazy imports: keeps this module import-light and avoids import cycles.
    from api.options import fetch_upstox, get_instrument_key, get_spot_price
    from api.options import get_expiries as _get_expiries

    if not expiry:
        listing = await _get_expiries("NIFTY")
        expiries = listing.get("expiries", [])
        if not expiries:
            raise HTTPException(status_code=502, detail="no NIFTY expiries available")
        expiry = expiries[0]["date"]

    try:
        payload = await fetch_upstox("/option/chain", {
            "instrument_key": get_instrument_key("NIFTY"),
            "expiry_date": expiry,
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"option chain fetch failed: {e}")

    chain_expiry, spot, rows = parse_chain_payload(payload)
    if not spot:
        try:
            spot = (await get_spot_price("NIFTY")).get("spot", 0)
        except Exception:
            pass
    candles = (await asyncio.to_thread(_fetch_nifty_candles_cached,
                                          for_date or _today_str(),
                                          walkback_days)
               if with_candles else [])
    report = build_report(chain_expiry or expiry, spot, rows, mode="live",
                          candles=candles)
    report["market"] = market_block()
    # Previous-session pivot levels (classic), cached per process day. A
    # failure stores None so the chart simply renders no levels.
    try:
        report["pivots"] = await get_pivots_block(for_date or _today_str())
    except Exception:
        report["pivots"] = None
    if with_verdicts:
        await _attach_verdicts(report, rows, spot, for_date)
    return report


async def _compute_sensex_live() -> dict:
    """Build the small live Sensex context block used by the Nifty page.

    Sensex uses the same Upstox option-chain source as Nifty. Max pain comes
    from Upstox's dedicated endpoint when available because it accounts for
    the exchange's complete chain; the local chain calculation is only a
    fallback for older API deployments.
    """
    from api.options import fetch_upstox, get_instrument_key
    from api.options import get_expiries as _get_expiries

    listing = await _get_expiries("SENSEX")
    expiries = listing.get("expiries", [])
    if not expiries:
        raise HTTPException(status_code=502, detail="no SENSEX expiries available")
    expiry = expiries[0]["date"]
    instrument_key = get_instrument_key("SENSEX")
    try:
        payload = await fetch_upstox("/option/chain", {
            "instrument_key": instrument_key,
            "expiry_date": expiry,
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Sensex option chain fetch failed: {e}")

    chain_expiry, spot, rows = parse_chain_payload(payload)
    if not spot:
        raise HTTPException(status_code=502, detail="Sensex option chain has no spot price")

    total_ce_oi = sum(r["ce"]["oi"] for r in rows)
    total_pe_oi = sum(r["pe"]["oi"] for r in rows)
    total_ce_vol = sum(r["ce"]["volume"] for r in rows)
    total_pe_vol = sum(r["pe"]["volume"] for r in rows)
    pain_rows = [
        {"strike": r["strike"], "ce_oi": r["ce"]["oi"], "pe_oi": r["pe"]["oi"]}
        for r in rows
    ]
    max_pain = compute_max_pain(pain_rows)
    try:
        pain_payload = await fetch_upstox("/market/max-pain", {
            "instrument_key": instrument_key,
            "expiry": chain_expiry or expiry,
            "date": _today_str(),
            "bucket_interval": 30,
        })
        pain_data = pain_payload.get("data") or {}
        if isinstance(pain_data, list):
            pain_data = pain_data[0] if pain_data else {}
        official_pain = _safe_float(pain_data.get("max_pain"))
        if official_pain > 0:
            max_pain = official_pain
    except Exception:
        pass

    ohlc = {"open": spot, "high": spot, "low": spot, "close": spot}
    try:
        quote = await fetch_upstox("/market-quote/ohlc", {
            "instrument_key": instrument_key,
            "interval": "1d",
        })
        quote_data = quote.get("data") or {}
        quote_row = next(iter(quote_data.values()), {})
        # Upstox nests the OHLC fields under a child "ohlc" object; only
        # last_price sits at the row level. Reading open/high/low off the row
        # itself always returned None, which fell back to spot and shipped a
        # flat bar (open == high == low == spot).
        row_ohlc = quote_row.get("ohlc") or {}
        ohlc = {
            "open": _safe_float(row_ohlc.get("open"), spot),
            "high": _safe_float(row_ohlc.get("high"), spot),
            "low": _safe_float(row_ohlc.get("low"), spot),
            "close": _safe_float(quote_row.get("last_price") or row_ohlc.get("close"), spot),
        }
        spot = ohlc["close"] or spot
    except Exception:
        pass

    return {
        "symbol": "SENSEX",
        "expiry": chain_expiry or expiry,
        "spot": spot,
        "ohlc": ohlc,
        "fetched_at": datetime.now(config.IST).isoformat(),
        "pcr_oi": compute_pcr(total_pe_oi, total_ce_oi),
        "pcr_vol": compute_pcr(total_pe_vol, total_ce_vol),
        "max_pain": max_pain,
        "walls": {"calls": top_walls(rows, "ce"), "puts": top_walls(rows, "pe")},
        "market": market_block(),
    }


@router.get("/nifty/expiries")
async def get_nifty_expiries():
    """Available NIFTY expiry dates for the report expiry picker."""
    from api.options import get_expiries as _get_expiries
    try:
        listing = await _get_expiries("NIFTY")
        return {"expiries": listing.get("expiries", [])}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"expiries fetch failed: {e}")


async def get_cached_live(expiry: Optional[str] = None) -> dict:
    """Live report with the shared 5s in-memory TTL.

    The WS and the REST endpoint must both go through this: calling
    ``_compute_live`` directly regenerates ``fetched_at`` on every call, which
    made the WebSocket re-send the whole report every tick (heavy upstream
    fetches + a 60KB frame + a full re-parse/re-render every 1s).
    """
    key = expiry or "default"
    now = time.time()
    hit = _live_cache.get(key)
    if hit and now - hit["ts"] < _LIVE_TTL:
        return hit["data"]
    report = await _compute_live(expiry)
    _live_cache[key] = {"ts": now, "data": report}
    return report


# ---------------------------------------------------------------------------
# Live WS path (api.reports_api.nifty_md, optional) with REST fallback
# ---------------------------------------------------------------------------

#: Minimum distinct strikes for a WS snapshot to count as a real chain.
_MIN_LIVE_STRIKES = 20
#: Live-built reports are fresh for ~1s so multiple WS clients share one build.
_LIVE_WS_TTL = 1.0
_live_ws_cache: dict[str, dict] = {}


def _nifty_md() -> Optional[Any]:
    """Return the ``nifty_md`` module, or ``None`` when unavailable.

    The module is built in parallel — it may be missing, empty, or lack the
    expected attrs. Every caller must treat ``None`` as "use the REST path".
    """
    try:
        import importlib
        mod = importlib.import_module("api.reports_api.nifty_md")
    except Exception:
        return None
    if mod is None:
        return None
    for attr in ("is_live", "snapshot"):
        if not callable(getattr(mod, attr, None)):
            return None
    return mod


def build_report_from_live(snapshot: dict, expiry: Optional[str],
                           candles: Optional[list[dict]] = None) -> Optional[dict]:
    """Build the report envelope from a WS ``snapshot`` instead of REST rows.

    ``snapshot`` legs are keyed ``"<strike>:ce"`` / ``"<strike>:pe"`` with
    ``{oi, iv, ltp, volume, delta, gamma}``. Returns ``None`` when the legs
    hold fewer than ~20 distinct strikes (not a real chain — the caller
    falls back to REST). Never raises.
    """
    try:
        legs = (snapshot or {}).get("legs") or {}
        if not isinstance(legs, dict):
            return None
        grouped: dict[float, dict] = {}
        for key, leg in legs.items():
            try:
                strike_raw, side = str(key).rsplit(":", 1)
                strike = float(strike_raw)
                side = side.strip().lower()
                if side not in ("ce", "pe"):
                    continue
            except (TypeError, ValueError):
                continue
            if not isinstance(leg, dict):
                leg = {}
            grouped.setdefault(strike, {})[side] = leg
        if len(grouped) < _MIN_LIVE_STRIKES:
            return None

        def _leg(d: dict) -> dict:
            return {
                "ltp": _safe_float(d.get("ltp")),
                "oi": _safe_int(d.get("oi")),
                "volume": _safe_int(d.get("volume")),
                "oi_change": 0,
                "sentiment": {"type": "Neutral"},
                "gamma": _safe_float(d.get("gamma")),
                "delta": _safe_float(d.get("delta")) if d.get("delta") is not None else None,
                "iv": _safe_float(d.get("iv")) if d.get("iv") is not None else None,
            }

        rows = [
            {"strike": strike,
             "ce": _leg(sides.get("ce") or {}),
             "pe": _leg(sides.get("pe") or {})}
            for strike, sides in grouped.items()
        ]
        rows.sort(key=lambda r: r["strike"])
        spot = _safe_float((snapshot or {}).get("spot"))
        exp = expiry or (snapshot or {}).get("expiry") or ""
        report = build_report(exp, spot, rows, mode="live",
                              candles=candles or [])
        try:
            report["market"] = market_block()
        except Exception:
            pass
        return report
    except Exception:
        return None


async def get_live_report(expiry: Optional[str] = None) -> dict:
    """Live report, preferring the WS snapshot when it is live.

    When ``nifty_md.is_live()`` and the snapshot converts to a full report,
    it is built once per ~1s (shared across WS clients) with verdicts
    attached; otherwise this degrades to :func:`get_cached_live` (REST).
    Never raises anything the REST path wouldn't raise.
    """
    key = expiry or "default"
    try:
        now = time.time()
        hit = _live_ws_cache.get(key)
        if hit and now - hit["ts"] < _LIVE_WS_TTL:
            return hit["data"]
    except Exception:
        pass
    try:
        md = _nifty_md()
        if md is not None and bool(md.is_live()):
            snap = md.snapshot() or {}
            if isinstance(snap, dict) and isinstance(snap.get("legs"), dict):
                exp = expiry or snap.get("expiry") or ""
                if not exp:
                    try:
                        from api.options import get_expiries as _get_expiries
                        listing = await _get_expiries("NIFTY")
                        exps = (listing or {}).get("expiries", []) or []
                        if exps:
                            exp = exps[0].get("date", "")
                    except Exception:
                        exp = ""
                try:
                    candles = await asyncio.to_thread(
                        _fetch_nifty_candles_cached, _today_str(), 5)
                except Exception:
                    candles = []
                report = build_report_from_live(snap, exp, candles)
                if report is not None:
                    try:
                        await _attach_verdicts(
                            report, report.get("strikes", []),
                            report.get("spot", 0), None)
                    except Exception:
                        pass
                    # Prefer the WS VIX reading when present; _attach_verdicts
                    # already set report["vix"] to the REST block (or null).
                    try:
                        ws_vix = snap.get("vix")
                        if ws_vix is not None:
                            if isinstance(ws_vix, dict):
                                report["vix"] = ws_vix
                            elif isinstance(report.get("vix"), dict):
                                try:
                                    report["vix"] = {**report["vix"],
                                                     "ltp": float(ws_vix)}
                                except (TypeError, ValueError):
                                    pass
                            else:
                                report["vix"] = ws_vix
                    except Exception:
                        pass
                    # Previous-session pivot levels (classic), cached per
                    # process day; None keeps the chart level-free.
                    try:
                        report["pivots"] = await get_pivots_block(None)
                    except Exception:
                        report["pivots"] = None
                    try:
                        _live_ws_cache[key] = {"ts": time.time(), "data": report}
                    except Exception:
                        pass
                    return report
    except Exception:
        pass
    return await get_cached_live(expiry)


@router.get("/nifty/live")
async def get_nifty_live(expiry: Optional[str] = Query(default=None, description="Expiry YYYY-MM-DD (default: nearest)")):
    """On-demand Nifty report from the live Upstox option chain (5s TTL)."""
    _ensure_tape_task()
    if expiry:
        _validate_date(expiry)
    return await get_cached_live(expiry)


async def _get_cached_sensex() -> dict:
    """Sensex context block behind the shared 5s cache (endpoint + snapshot)."""
    now = time.time()
    hit = _sensex_cache.get("default")
    if hit and now - hit["ts"] < _LIVE_TTL:
        return hit["data"]
    report = await _compute_sensex_live()
    _sensex_cache["default"] = {"ts": now, "data": report}
    return report


@router.get("/nifty/sensex")
async def get_sensex_live():
    """Live Sensex levels for the Nifty report's cross-index context card."""
    return await _get_cached_sensex()


@router.get("/nifty")
def get_nifty_report(date: Optional[str] = Query(default=None, description="Snapshot date YYYY-MM-DD (default: today)")):
    """Serve the saved Nifty snapshot for ``date``; 404 envelope when missing."""
    date_str = _validate_date(date or _today_str())
    data = read_snapshot(date_str)
    if data is None:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "message": f"no Nifty snapshot for {date_str}",
        })
    return data


class NiftySnapshotRequest(BaseModel):
    date: Optional[str] = None
    expiry: Optional[str] = None


@router.post("/nifty/snapshot")
async def create_nifty_snapshot(body: NiftySnapshotRequest):
    """Build a snapshot from live data and persist it under ``date``."""
    date_str = _validate_date(body.date or _today_str())
    if body.expiry:
        _validate_date(body.expiry)
    report = await _compute_live(body.expiry, for_date=date_str, walkback_days=0)
    snapshot = {
        **report,
        "mode": "snapshot",
        "date": date_str,
        "snapshot_at": datetime.now(config.IST).isoformat(),
        "source": "upstox-option-chain",
        "timeline": build_timeline_skeleton(report),
    }
    write_snapshot(date_str, snapshot)
    return snapshot


# ---------------------------------------------------------------------------
# OI tape: per-minute time series of the Nifty chain
# ---------------------------------------------------------------------------

# stock-screener-ui/api/reports_api/nifty.py -> parents[2] == stock-screener-ui
TAPE_DIR = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "nifty_tape"
TAPE_INTERVAL_SEC = 60
# Keep one slow upstream request from pushing the next tape attempt into the
# following minute.  The loop is wall-clock paced below, so a timed-out tick
# leaves a short recovery window before the next scheduled attempt.
TAPE_TICK_TIMEOUT_SEC = 55


def tape_path(date_str: str) -> Path:
    return TAPE_DIR / f"{date_str}.jsonl"


def read_tape(date_str: str) -> list[dict]:
    """Raw tape rows for ``date_str`` (JSONL, one snapshot per line).

    Skips blank/corrupt lines; returns [] when the file is missing.
    """
    path = tape_path(date_str)
    if not path.exists():
        return []
    rows: list[dict] = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except (json.JSONDecodeError, ValueError):
                    continue
    except OSError:
        return []
    return rows


# ---------------------------------------------------------------------------
# Full per-minute replay snapshots (the exact report envelope the UI renders)
# ---------------------------------------------------------------------------

#: One JSONL line per minute: ``{"t", "fetched_at", "report", "sensex"}`` where
#: ``report`` is the FULL envelope ``/api/reports/nifty/live`` returns, so the
#: whole report screen can be replayed after the day ends (single source of
#: truth: recorded once per minute here, served by ``/nifty/replay``).
SNAPSHOT_LOG_DIR = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "nifty_snapshots"


def snapshot_log_path(date_str: str) -> Path:
    return SNAPSHOT_LOG_DIR / f"{date_str}.jsonl"


def read_snapshots(date_str: str) -> list[dict]:
    """Full replay snapshot lines for ``date_str`` (JSONL, appended per minute).

    Skips blank/corrupt/non-object lines; returns [] when the file is missing.
    Every line the recorder writes is a ``{"t", ..., "report": {...}}`` object,
    so anything else is corruption from an interrupted write.
    """
    path = snapshot_log_path(date_str)
    if not path.exists():
        return []
    rows: list[dict] = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if not isinstance(value, dict):
                    continue
                rows.append(value)
    except OSError:
        return []
    return rows


def _peek_last_snapshot_t(path: Path) -> Optional[str]:
    """The last snapshot line's ``t`` (minute dedupe anchor) — never raises."""
    try:
        if not path.exists():
            return None
        with open(path) as f:
            lines = [ln.strip() for ln in f if ln.strip()]
        if not lines:
            return None
        last = json.loads(lines[-1])
        t = last.get("t") if isinstance(last, dict) else None
        return str(t) if t else None
    except Exception:
        return None


async def _append_minute_snapshot(date_str: str, t_iso: str) -> Optional[dict]:
    """Append ONE full-report snapshot line for tick minute ``t_iso``.

    ``report`` comes from a second ``_compute_live`` pass with verdicts +
    candles ON — the exact envelope ``/nifty/live`` renders (strikes, gex,
    positioning, control/regime/vix/strength, pivots, reference, intraday,
    emas, market). The upstream fetchers behind it are cached (per-day
    baseline, TTL'd VIX/intraday/15m-candles), so the second pass costs no
    extra history round-trips. ``sensex`` reuses the cached Sensex helper
    (``null`` on failure).

    Deduped by minute (skipped when the file's last line carries the same
    ``t``) and NEVER raises — a snapshot failure must not stop the light tape
    row, which is written before this runs. Memory stays bounded: pure
    append-only JSONL, no in-memory accumulation.
    """
    try:
        if _peek_last_snapshot_t(snapshot_log_path(date_str)) == t_iso:
            return None
        report = await _compute_live(None, walkback_days=0, with_verdicts=True,
                                     with_candles=True)
        sensex: Optional[dict] = None
        try:
            sensex = await _get_cached_sensex()
        except Exception:
            sensex = None
        line = {
            "t": t_iso,
            "fetched_at": report.get("fetched_at"),
            "report": report,
            "sensex": sensex,
        }
        SNAPSHOT_LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(snapshot_log_path(date_str), "a") as f:
            f.write(json.dumps(line) + "\n")
        return line
    except Exception:
        return None


def drop_empty_chain_rows(rows: list[dict]) -> list[dict]:
    """Rows carrying no usable chain — a failed fetch, not a market state.

    On 2026-10-14 the recorder persisted rows with ``ce_oi = pe_oi = 0``,
    ``strikes_top`` empty and ``pcr_oi = 0.00`` (10:08 and 11:42). The next good
    row then difference against them and looked like a +121M one-minute OI
    build, which scored as a CRITICAL burst. An empty snapshot is not a data
    point, so it is dropped on read as well as no longer written.
    """
    out: list[dict] = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        strikes = r.get("strikes_top")
        total_oi = _safe_int(r.get("ce_oi")) + _safe_int(r.get("pe_oi"))
        # The observed corruption is an all-zero snapshot (no OI, no strikes);
        # `== 0` rather than `<= 0` so a synthetic negative is not swept up.
        if total_oi == 0 and not strikes:
            continue
        out.append(r)
    return out


def drop_implausible_spots(rows: list[dict]) -> list[dict]:
    """Drop single-row spot spikes that the market immediately retracts.

    On 2026-10-14 two rows recorded 22,363 while the real market was ~22,690
    (1.56% out), which skewed the displayed session range and the EMA20 trend
    gate every burst signal is filtered through.

    A plain "jump too big" test is WRONG: a recorder gap followed by a genuine
    move looks identical. On 2026-10-15 the tape missed 61 minutes and the real
    +0.98% re-open tripped the threshold, so the last *accepted* row never
    advanced and EVERY row after the gap was rejected — the tape silently ended
    at 09:23 while the file held 13 rows.

    A bad row is one the market RETRACTS. A row is dropped only when one of the
    next ``LOOKAHEAD`` rows comes back to within ``SPOT_JUMP_MAX`` of the last
    accepted value (the 10-14 pair needed lookahead because both rows were bad);
    a sustained move is kept and re-anchors the baseline.
    """
    src = [r for r in (rows or []) if isinstance(r, dict)]
    kept: list[dict] = []
    prev: Optional[float] = None
    i = 0
    while i < len(src):
        row = src[i]
        spot = _safe_float(row.get("spot")) or None
        if spot and prev and abs(spot - prev) / prev > SPOT_JUMP_MAX:
            retracted = False
            for nxt_row in src[i + 1:i + 1 + SPOT_LOOKAHEAD]:
                nxt = _safe_float(nxt_row.get("spot")) or None
                if nxt and abs(nxt - prev) / prev <= SPOT_JUMP_MAX:
                    retracted = True
                    break
            if retracted:
                i += 1
                continue  # a spike the market took back — drop it
        if spot:
            prev = spot
        kept.append(row)
        i += 1
    return kept


def derive_tape_rows(raw_rows: list[dict]) -> list[dict]:
    """Attach derived deltas to raw tape rows.

    Formulas (all deltas vs the day's FIRST row unless noted):
      - ``call_doi = ce_oi - first.ce_oi`` (whole contracts, int)
      - ``put_doi  = pe_oi - first.pe_oi`` (whole contracts, int)
      - ``net      = put_doi - call_doi`` (whole contracts, int;
        positive = put-side OI building faster than call-side)
      - ``net_pct  = 100 * net / (|call_doi| + |put_doi|)`` rounded 2dp;
        0.0 when the denominator is 0 (e.g. the first row). Absolute-share
        denominator: stays sane on expiry-day unwinding when total ΔOI
        itself goes negative.
      - ``call_tick = ce_vol - prev_row.ce_vol`` (0 for the first row;
        whole contracts, int; Upstox volume is cumulative so the diff
        is the minute's traded volume)
      - ``put_tick`` likewise for ``pe_vol``
      - ``pcr_doi  = pcr_oi - first.pcr_oi`` rounded 2dp
      - ``spot_flip = spot - flip`` rounded 2dp; None when ``flip`` is null
    Raw keys are preserved; derived keys are added.
    """
    raw_rows = drop_empty_chain_rows(drop_implausible_spots(raw_rows))
    if not raw_rows:
        return []
    first = raw_rows[0]
    f_ce = _safe_int(first.get("ce_oi"))
    f_pe = _safe_int(first.get("pe_oi"))
    f_pcr = _safe_float(first.get("pcr_oi"))
    out: list[dict] = []
    prev_ce_vol: Optional[int] = None
    prev_pe_vol: Optional[int] = None
    for i, r in enumerate(raw_rows):
        ce_oi = _safe_int(r.get("ce_oi"))
        pe_oi = _safe_int(r.get("pe_oi"))
        ce_vol = _safe_int(r.get("ce_vol"))
        pe_vol = _safe_int(r.get("pe_vol"))
        pcr_oi = _safe_float(r.get("pcr_oi"))
        spot = _safe_float(r.get("spot"))
        flip = r.get("flip")
        # OI deltas vs the day's first row (whole contracts).
        call_doi = ce_oi - f_ce
        put_doi = pe_oi - f_pe
        # Net build: put-side DOI minus call-side DOI.
        net = put_doi - call_doi
        # Net as % of absolute positioning flow; guarded against zero.
        denom = abs(call_doi) + abs(put_doi)
        net_pct = round(100.0 * net / denom, 2) if denom != 0 else 0.0
        # Per-minute traded volume = cumulative-volume diff vs prev row.
        if i == 0:
            call_tick = 0
            put_tick = 0
        else:
            call_tick = ce_vol - (prev_ce_vol if prev_ce_vol is not None else ce_vol)
            put_tick = pe_vol - (prev_pe_vol if prev_pe_vol is not None else pe_vol)
        # PCR-OI drift vs the day's first row.
        pcr_doi = round(pcr_oi - f_pcr, 2)
        # Distance of spot above/below the GEX flip level.
        try:
            spot_flip = round(spot - float(flip), 2) if flip is not None else None
        except (TypeError, ValueError):
            spot_flip = None
        out.append({**r,
                    "call_doi": call_doi, "put_doi": put_doi,
                    "net": net, "net_pct": net_pct,
                    "call_tick": call_tick, "put_tick": put_tick,
                    "pcr_doi": pcr_doi, "spot_flip": spot_flip})
        prev_ce_vol = ce_vol
        prev_pe_vol = pe_vol
    return out


def _atm_premium_snapshot(strikes: list, spot: float) -> tuple[Optional[float], Optional[float], Optional[float]]:
    """``(atm_strike, ce_ltp, pe_ltp)`` for the strike nearest spot.

    Skips strikes where BOTH legs are effectively dead (expiry-day < ₹1), and
    stores ``None`` for an individual dead leg, so the snapshot is always
    useful: on expiry day the ATM strike typically has one live leg.
    Returns ``(None, None, None)`` when nothing qualifies.
    """
    best = None
    for r in strikes or []:
        try:
            strike = _safe_float(r.get("strike"))
            ce = _safe_float((r.get("ce") or {}).get("ltp"))
            pe = _safe_float((r.get("pe") or {}).get("ltp"))
        except Exception:
            continue
        if not strike or (ce < 1.0 and pe < 1.0):
            continue
        dist = abs(strike - spot) if spot else 0.0
        if best is None or dist < best[0]:
            best = (dist, strike, ce if ce >= 1.0 else None, pe if pe >= 1.0 else None)
    if best is None:
        return None, None, None
    return best[1], best[2], best[3]


def _strike_oi_snapshot(strikes: list, spot: float, n: int = 3) -> list[dict]:
    """ATM ± ``n`` strikes with both legs' OI, for per-strike burst detection.

    The index totals in a tape row dilute a single strike exploding (16M at one
    strike is a rounding error across 100+ strikes), so the alert could never
    say WHICH strike. Empty list when nothing is usable.
    """
    rows = []
    for r in strikes or []:
        try:
            strike = _safe_float(r.get("strike"))
        except Exception:
            continue
        if not strike:
            continue
        rows.append({
            "strike": strike,
            "ce_oi": _safe_int((r.get("ce") or {}).get("oi")),
            "pe_oi": _safe_int((r.get("pe") or {}).get("oi")),
        })
    if not rows or not spot:
        return []
    rows.sort(key=lambda x: abs(x["strike"] - spot))
    kept = rows[: max(1, 2 * n + 1)]
    kept.sort(key=lambda x: x["strike"])
    return kept


#: Max chain-vs-index disagreement tolerated before the index quote wins (0.25%).
SPOT_CHAIN_DEV_MAX = 0.0025
#: Max minute-over-minute spot move accepted without an independent confirmation.
#: 0.75% (~170 pts) is calibrated against the recorded tapes: on 2026-10-14 it
#: isolates exactly the three corrupt rows (12:53, 12:54, 13:19) and drops no
#: legitimate ones, while 0.50% cascades and discards 16 good rows behind them.
SPOT_JUMP_MAX = 0.0075
#: How many following rows may confirm that a spike was retracted. The
#: 2026-10-14 corruption came as a PAIR (12:53 and 12:54 both wrong), so a
#: single-row check would have missed it.
SPOT_LOOKAHEAD = 3


def reconcile_spot(chain_spot: float, index_spot: Optional[float],
                   last_spot: Optional[float],
                   *, chain_dev_max: float = SPOT_CHAIN_DEV_MAX,
                   jump_max: float = SPOT_JUMP_MAX) -> Optional[float]:
    """The most trustworthy spot for a tape row, or ``None`` to drop the row.

    Upstox's ``/option/chain`` ``underlying_spot_price`` went badly wrong on
    2026-10-14: two rows recorded 22,363 while the real market was ~22,690
    (~1.5% off, and inconsistent with the row's own ATM strike). A bad spot
    poisons the EMA20 trend gate every burst signal is filtered through, so it
    is cross-checked against the index quote and the previous row first.

    ``index_spot`` failing (e.g. an expired token) is fine — the jump check then
    stands alone and the row is dropped rather than persisted wrong.
    """
    spot = _safe_float(chain_spot) or None
    index = _safe_float(index_spot) or None
    last = _safe_float(last_spot) or None

    # 1. Prefer the index quote when the chain value disagrees materially.
    if index and (spot is None or abs(spot - index) / index > chain_dev_max):
        spot = index
    if spot is None:
        return None

    # 2. Drop a jump too large to be real — unless an independent quote agrees
    #    (a genuine gap move is allowed through when the index quote confirms).
    if last and abs(spot - last) / last > jump_max:
        confirmed = index is not None and abs(index - last) / last > jump_max
        if not confirmed:
            return None
    return spot


def _peek_last_tape_row(path: Path, minute: str) -> tuple[Optional[float], bool]:
    """``(last row's spot, last row shares this minute)`` — never raises."""
    last_spot: Optional[float] = None
    try:
        if not path.exists():
            return None, False
        with open(path) as f:
            lines = [ln.strip() for ln in f if ln.strip()]
        if not lines:
            return None, False
        last = json.loads(lines[-1])
        last_spot = _safe_float(last.get("spot")) or None
        return last_spot, str(last.get("t", ""))[:16] == minute
    except Exception:
        return last_spot, False


async def record_nifty_tape_tick(now: Optional[datetime] = None) -> Optional[dict]:
    """Record ONE per-minute tape row from the live chain; never raises.
    Reuses ``_compute_live(None)`` (nearest expiry, no candle walkback) and
    persists the light aggregates ``{t, spot, ce_oi, pe_oi, ce_vol, pe_vol,
    pcr_oi, pcr_vol, max_pain, flip, walls, expiry, atm_strike, atm_ce_ltp,
    atm_pe_ltp}`` to the day's JSONL.
    Rows sharing the same IST minute bucket as the file's last row are
    skipped (returns None). ALL exceptions are swallowed — returns the row
    on success, None otherwise.
    """
    global _tape_last_skip
    try:
        report = await _compute_live(None, walkback_days=0, with_verdicts=False,
                                     with_candles=False)
    except Exception:
        _tape_last_skip = "chain-failed"
        return None
    try:
        ts = now or datetime.now(config.IST)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=config.IST)
        t_iso = ts.isoformat()
        date_str = ts.strftime("%Y-%m-%d")
        path = tape_path(date_str)
        minute = t_iso[:16]
        last_spot, same_minute = _peek_last_tape_row(path, minute)
        if same_minute:
            _tape_last_skip = "same-minute"
            return None
        # Cross-check before anything derives from the spot (ATM, strikes_top).
        # The independent quote is bought LAZILY: only when the chain value is
        # worth confirming. A normal tick (or the day's first row) costs no
        # extra network call, so the 1-minute recorder stays cheap.
        spot_chain = _safe_float(report.get("spot"))
        index_spot = None
        if last_spot and (spot_chain <= 0
                          or abs(spot_chain - last_spot) / last_spot > SPOT_CHAIN_DEV_MAX):
            try:
                from api.options import get_spot_price
                index_spot = (await get_spot_price("NIFTY")).get("spot")
            except Exception:
                index_spot = None
        spot = reconcile_spot(spot_chain, index_spot, last_spot)
        if spot is None:
            global _tape_spot_rejections
            _tape_spot_rejections += 1
            _tape_last_skip = "spot-rejected"
            return None
        strikes = report.get("strikes", []) or []
        ce_oi = sum(_safe_int((r.get("ce") or {}).get("oi")) for r in strikes)
        pe_oi = sum(_safe_int((r.get("pe") or {}).get("oi")) for r in strikes)
        # An empty chain is a failed fetch, not a market state: writing it makes
        # the NEXT row difference into a fake +100M "burst".
        if not strikes or ce_oi + pe_oi == 0:
            _tape_last_skip = "empty-chain"
            return None
        ce_vol = sum(_safe_int((r.get("ce") or {}).get("volume")) for r in strikes)
        pe_vol = sum(_safe_int((r.get("pe") or {}).get("volume")) for r in strikes)
        gex = report.get("gex", {}) or {}
        # ATM premiums: anchored to the strike nearest spot with a tradeable
        # premium, so a future burst can be scored in real rupees instead of
        # index points. Only LTP is stored — the chain is not persisted.
        atm_strike, atm_ce_ltp, atm_pe_ltp = _atm_premium_snapshot(strikes, spot)
        # Per-minute GEX + ATM IV so the UI can chart cumulative net gamma and
        # the ATM IV / straddle series without re-fetching history.
        try:
            from api.reports_api.nifty_verdicts import atm_ivs
            atm_ce_iv, atm_pe_iv = atm_ivs(strikes, spot)
        except Exception:
            atm_ce_iv, atm_pe_iv = None, None
        row = {
            "t": t_iso,
            "spot": spot,
            "ce_oi": ce_oi,
            "pe_oi": pe_oi,
            "ce_vol": ce_vol,
            "pe_vol": pe_vol,
            "pcr_oi": _safe_float(report.get("pcr_oi")),
            "pcr_vol": _safe_float(report.get("pcr_vol")),
            "max_pain": _safe_float(report.get("max_pain")),
            "flip": gex.get("zero_cross"),
            "net_gex": gex.get("net_total"),
            "walls": report.get("walls", {"calls": [], "puts": []}),
            "expiry": report.get("expiry", ""),
            "atm_strike": atm_strike,
            "atm_ce_ltp": atm_ce_ltp,
            "atm_pe_ltp": atm_pe_ltp,
            "atm_ce_iv": atm_ce_iv,
            "atm_pe_iv": atm_pe_iv,
            # ATM +/-3 strikes with both legs' OI — lets a future alert name the
            # exact strike instead of only the index total.
            "strikes_top": _strike_oi_snapshot(strikes, spot),
        }
        TAPE_DIR.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as f:
            f.write(json.dumps(row) + "\n")
        # Keep the day's snapshot fresh so the EOD tab has data. Previously the
        # snapshot was written ONLY by POST /nifty/snapshot (the SNAPSHOT button),
        # so GET /nifty raised its 404 envelope on every day nobody clicked it —
        # the EOD tab has effectively never worked. The recorder already fetches
        # the chain every minute, so persisting it here costs one small JSON write
        # (overwritten in place, never deleted).
        try:
            write_snapshot(date_str, {
                **report,
                "mode": "snapshot",
                "date": date_str,
                "snapshot_at": t_iso,
                "source": "upstox-option-chain",
                "timeline": build_timeline_skeleton(report),
            })
        except Exception:
            pass
        # Full per-minute replay snapshot: append the exact report envelope the
        # UI renders (verdicts + candles ON) plus the Sensex context block, so
        # the whole report screen can be replayed after the day ends. Strictly
        # after the light row (its fresh spot anchors compute_reference) and
        # infallible — a snapshot failure must not stop the light tape row.
        try:
            await _append_minute_snapshot(date_str, t_iso)
        except Exception:
            pass
        _tape_last_skip = None
        return row
    except Exception:
        _tape_last_skip = "chain-failed"
        return None


_tape_last_tick: Optional[str] = None
#: Rows dropped because the spot could not be trusted (see reconcile_spot).
_tape_spot_rejections: int = 0
#: Why the last tick produced no row: "same-minute" (normal), "spot-rejected"
#: (data quality) or "chain-failed" (a real error). Lets the status endpoint
#: tell a deliberate skip apart from a failure.
_tape_last_skip: Optional[str] = None
_tape_last_error: Optional[str] = None
_tape_iterations: int = 0
_tape_task = None


def _ensure_tape_task() -> None:
    """Start the recorder loop if it isn't running (request-driven backup
    for the lifespan hook — survives reloaders that skip lifespan)."""
    global _tape_task
    try:
        import asyncio
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    try:
        if _tape_task is None or _tape_task.done():
            _tape_task = loop.create_task(start_nifty_tape_task())
    except Exception:
        pass


async def start_nifty_tape_task(poll_sec: int = TAPE_INTERVAL_SEC) -> None:
    """Background loop: one tape tick every ``poll_sec``s while the market is open.

    Market gate delegates to ``trading.utils.is_market_open`` (hour-window
    fallback on import failure, mirroring the server's ``_is_market_hours``).
    Never raises — per-tick errors are swallowed so the loop survives.
    Heartbeat (for /nifty/tape/status): ``_tape_last_tick/_tape_last_error``.
    """
    global _tape_last_tick, _tape_last_error, _tape_iterations
    import asyncio
    loop = asyncio.get_running_loop()
    next_tick = loop.time()
    while True:
        try:
            try:
                from trading.utils import is_market_open
                market_open = is_market_open()
            except Exception:
                market_open = 8 <= datetime.now(config.IST).hour <= 16
            if market_open:
                try:
                    timeout_sec = max(1.0, min(float(poll_sec), TAPE_TICK_TIMEOUT_SEC))
                    row = await asyncio.wait_for(
                        record_nifty_tape_tick(), timeout=timeout_sec
                    )
                    _tape_iterations += 1
                    if row is not None:
                        _tape_last_tick = row.get("t")
                        _tape_last_error = None
                    elif _tape_last_skip == "chain-failed":
                        _tape_last_error = "tick returned None (chain fetch failed?)"
                    else:
                        # A deliberate skip (same minute, or a rejected spot) is
                        # not a failure — don't leave a stale error behind.
                        _tape_last_error = None
                except asyncio.TimeoutError:
                    _tape_iterations += 1
                    _tape_last_error = (
                        f"tick timed out after {timeout_sec:.0f}s"
                    )
                except Exception as e:
                    _tape_iterations += 1
                    _tape_last_error = f"{type(e).__name__}: {str(e)[:200]}"
            next_tick += poll_sec
            await asyncio.sleep(max(0.0, next_tick - loop.time()))
        except asyncio.CancelledError:
            break
        except Exception:
            next_tick = loop.time() + poll_sec
            try:
                await asyncio.sleep(poll_sec)
            except asyncio.CancelledError:
                break


@router.get("/nifty/bursts/stream", dependencies=[Depends(get_current_user)])
async def stream_nifty_bursts():
    """Server-Sent Events: push newly detected alerts instead of polling.

    Sends a small snapshot of recent events first, then live ones, with a
    heartbeat so intermediaries don't drop an idle connection. The client is
    expected to fall back to `/nifty/bursts` polling if this errors.
    """
    from fastapi.responses import StreamingResponse

    from api.reports_api import nifty_stream as stream

    queue = stream.subscribe()

    async def _gen():
        try:
            # Immediate preamble so a client (and any proxy) sees the stream is
            # live even when there is nothing to send yet.
            yield ": connected\n\n"
            for event in stream.recent_events(limit=20):
                yield stream.sse_payload(event)
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield stream.sse_payload(event)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            stream.unsubscribe(queue)

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/nifty/tape/status")
def get_nifty_tape_status():
    """Heartbeat for the background recorder: last tick time / last error."""
    _ensure_tape_task()
    return {"last_tick": _tape_last_tick, "last_error": _tape_last_error,
            "iterations": _tape_iterations, "interval_sec": TAPE_INTERVAL_SEC,
            "spot_rejections": _tape_spot_rejections,
            "last_skip": _tape_last_skip}


@router.get("/nifty/tape")
def get_nifty_tape(date: Optional[str] = Query(default=None, description="Tape date YYYY-MM-DD (default: today)")):
    """Serve the day's per-minute OI tape with derived deltas.

    NOTE: past minutes are NEVER backfilled — rows exist only for minutes
    the recorder was alive during market hours, so gaps stay gaps. A
    missing/empty tape yields a 404 ``{is_trading_day: False}`` envelope.
    See :func:`derive_tape_rows` for the per-row formulas.
    """
    date_str = _validate_date(date or _today_str())
    raw = read_tape(date_str)
    if not raw:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "message": f"no Nifty tape for {date_str}",
        })
    rows = derive_tape_rows(raw)
    # Honest baseline: deltas are measured vs the day's FIRST recorded row,
    # which may be well after the open when the recorder booted late.
    baseline_t = rows[0].get("t") if rows else None
    return {"date": date_str, "interval_sec": TAPE_INTERVAL_SEC,
            "baseline_t": baseline_t, "rows": rows}


@router.get("/nifty/replay", dependencies=[Depends(get_current_user)])
def get_nifty_replay(
    date: str = Query(..., description="Replay date YYYY-MM-DD"),
    t: Optional[str] = Query(default=None, description=(
        "ISO minute; when given, returns the snapshot recorded at the last "
        "minute at or before ``t`` instead of the whole day")),
):
    """Serve the day's per-minute FULL report snapshots (replay source).

    Without ``t``: ``{"date", "count", "interval_sec", "snapshots"}`` — every
    recorded snapshot line in ascending-order as appended. A missing/empty log
    yields the same 404 ``{is_trading_day: False}`` envelope as ``/nifty/tape``.
    With ``t``: ``{"date", "snapshot"}`` — the single snapshot whose minute is
    the closest at or before ``t`` (``snapshot: null`` when none qualify —
    e.g. before the day's first recording).
    """
    date_str = _validate_date(date)
    snaps = read_snapshots(date_str)
    if not snaps:
        raise HTTPException(status_code=404, detail={
            "is_trading_day": False,
            "date": date_str,
            "message": f"no Nifty snapshots for {date_str}",
        })
    if t and isinstance(t, str):
        # Same-tz ISO strings: the minute bucket (YYYY-MM-DDTHH:MM) compares
        # correctly as text, so a sub-minute stamp picks its own minute. The
        # isinstance guard also keeps the direct (non-HTTP) call sentinel
        # Query object out of the path.
        target = t.strip()
        chosen: Optional[dict] = None
        for snap in snaps:
            snap_t = str(snap.get("t") or "")
            if snap_t and snap_t[:16] <= target[:16]:
                chosen = snap
        return {"date": date_str, "snapshot": chosen}
    return {"date": date_str, "count": len(snaps),
            "interval_sec": TAPE_INTERVAL_SEC, "snapshots": snaps}


# ---------------------------------------------------------------------------
# OI bursts: recomputable from the stored tape
# ---------------------------------------------------------------------------

def _recent_news_for(date_str: str) -> list[dict]:
    """Stored headlines around ``date_str`` (±12h) for burst tagging.

    Reads `news_articles` only — no network. Returns `[]` when the news tables
    or rows are unavailable, so burst tagging can never break the endpoint.
    """
    try:
        from datetime import datetime, timedelta

        from db.database import SessionLocal
        from db.models.news import NewsArticle

        day = datetime.strptime(date_str, "%Y-%m-%d")
        lo = day - timedelta(hours=12)
        hi = day + timedelta(hours=12)
        db = SessionLocal()
        try:
            rows = (
                db.query(NewsArticle.headline, NewsArticle.published_at,
                         NewsArticle.url, NewsArticle.source)
                .filter(NewsArticle.published_at.isnot(None))
                .filter(NewsArticle.published_at >= lo)
                .filter(NewsArticle.published_at <= hi)
                .order_by(NewsArticle.published_at)
                .limit(2000)
                .all()
            )
        finally:
            db.close()
        return [
            {"heading": h, "published_at": p, "url": u, "source": s}
            for (h, p, u, s) in rows
        ]
    except Exception:
        return []


def _snapshot_oi_context(date_str: str) -> tuple[Optional[list], float]:
    """``(strikes, spot)`` from the day's saved snapshot.

    Returns ``(None, 0.0)`` when the snapshot is missing, unreadable,
    malformed, or lacks ``strikes``/``spot``. Never raises, never touches
    the network — a burst without a snapshot simply carries ``signal: null``.
    """
    try:
        snap = read_snapshot(date_str)
        if not isinstance(snap, dict):
            return None, 0.0
        strikes = snap.get("strikes")
        spot = _safe_float(snap.get("spot"))
        if not strikes or not spot:
            return None, 0.0
        return strikes, spot
    except Exception:
        return None, 0.0


@router.get("/nifty/bursts")
@router.get("/nifty/bursts", dependencies=[Depends(get_current_user)])
def get_nifty_bursts(
    date: Optional[str] = Query(default=None, description="Burst date YYYY-MM-DD (default: today)"),
    window: int = Query(default=OI_BURST_WINDOW, ge=3, le=60, description="Trailing minutes for the baseline"),
    min_abs: float = Query(default=OI_BURST_MIN_ABS, ge=0, description="Absolute ΔOI floor (contracts)"),
):
    """Per-minute OI bursts recomputed from the stored tape — never errors.

    The tape's ``call_doi``/``put_doi`` are cumulative from the day's first
    row, so a burst is the first difference between consecutive minutes.
    History is recomputable for any recorded day (independent of the browser),
    so a missing/empty tape is a normal ``count: 0`` response (HTTP 200), not a
    404. ``signal`` is attached from the day's saved snapshot when available;
    otherwise it is ``null``. No network/Upstox calls are made here.
    """
    date_str = _validate_date(date or _today_str())
    raw = read_tape(date_str)
    if not raw:
        return {"date": date_str, "count": 0, "interval_sec": TAPE_INTERVAL_SEC,
                "bursts": [], "reason": "no tape"}

    rows = derive_tape_rows(raw)
    # Fades (OI bursts) + momentum (wall-break squeezes) in one feed.
    bursts = detect_oi_bursts(rows, window=window, min_abs=min_abs)
    try:
        bursts += detect_squeezes(rows)
    except Exception:
        pass
    try:
        bursts += detect_strike_bursts(rows)
    except Exception:
        pass
    try:
        bursts += detect_premium_moves(rows)
    except Exception:
        pass
    try:
        bursts += detect_coiling(rows)
    except Exception:
        pass
    bursts.sort(key=lambda b: str(b.get("t") or ""))
    # One alert per (minute, side): a single directional minute trips several
    # strikes/detectors and they describe the same event.
    bursts = coalesce_bursts(bursts)
    strikes, spot = _snapshot_oi_context(date_str)
    try:
        trend = session_trend(rows)
    except Exception:
        trend = None
    for b in bursts:
        try:
            # Trend at the burst's own minute, not at the close.
            b_trend = session_trend(rows, at_time=b.get("t")) or trend
            b["signal"] = derive_oi_signal(b, strikes, spot, trend=b_trend)
        except Exception:
            b["signal"] = None
    if trend:
        for b in bursts:
            b["trend"] = trend

    # Attach nearby headlines so a burst can be read with its likely catalyst.
    # Reads only what is already stored — no network call in this endpoint.
    try:
        attach_news(bursts, _recent_news_for(date_str), window_min=NEWS_WINDOW_MIN)
    except Exception:
        for b in bursts:
            b.setdefault("news", [])

    return {"date": date_str, "count": len(bursts),
            "interval_sec": TAPE_INTERVAL_SEC, "bursts": bursts}
