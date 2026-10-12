"""Nifty options report backend.

Endpoints (all under the shared ``/api/reports`` prefix):
  - ``GET  /api/reports/nifty/live?expiry=YYYY-MM-DD`` — on-demand report built
    from the live Upstox option chain (60s in-memory TTL).
  - ``GET  /api/reports/nifty?date=YYYY-MM-DD`` — serve a saved snapshot from
    ``experiments/data/nifty_reports/{date}.json`` (404 envelope when missing).
  - ``POST /api/reports/nifty/snapshot`` — build a snapshot (same computation
    as live, plus timeline skeleton / snapshot_at / source) and persist it.

Upstox access goes through :mod:`api.options` helpers, imported lazily inside
the handlers so this module stays import-light (and cycle-free).
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import config

router = APIRouter(prefix="/api/reports", tags=["reports-nifty"])

# stock-screener-ui/api/reports_api/nifty.py -> parents[2] == stock-screener-ui
SNAPSHOT_DIR = Path(__file__).resolve().parent.parent.parent / "experiments" / "data" / "nifty_reports"

_LIVE_TTL = 60
_live_cache: dict[str, dict] = {}

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


def build_leg(market_data: dict) -> dict:
    """Flatten one side's Upstox ``market_data`` into the report leg shape."""
    md = market_data or {}
    ltp = _safe_float(md.get("ltp"))
    close_price = _safe_float(md.get("close_price", ltp))
    oi = _safe_int(md.get("oi"))
    prev_oi = _safe_int(md.get("prev_oi"))
    volume = _safe_int(md.get("volume"))
    oi_change = oi - prev_oi
    price_change = round(ltp - close_price, 2)
    return {
        "ltp": ltp,
        "close_price": close_price,
        "oi": oi,
        "prev_oi": prev_oi,
        "oi_change": oi_change,
        "volume": volume,
        "price_change": price_change,
        "sentiment": get_sentiment(price_change, oi_change),
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
        call_md = (item.get("call_options") or {}).get("market_data", {})
        put_md = (item.get("put_options") or {}).get("market_data", {})
        rows.append({"strike": strike, "ce": build_leg(call_md), "pe": build_leg(put_md)})
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

async def _compute_live(expiry: Optional[str], for_date: Optional[str] = None,
                      walkback_days: int = 5) -> dict:
    """Fetch the Upstox chain + spot and build a live report (no caching)."""
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
    candles = _fetch_nifty_candles(for_date or _today_str(),
                                    walkback_days=walkback_days)
    return build_report(chain_expiry or expiry, spot, rows, mode="live",
                        candles=candles)


@router.get("/nifty/expiries")
async def get_nifty_expiries():
    """Available NIFTY expiry dates for the report expiry picker."""
    from api.options import get_expiries as _get_expiries
    try:
        listing = await _get_expiries("NIFTY")
        return {"expiries": listing.get("expiries", [])}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"expiries fetch failed: {e}")


@router.get("/nifty/live")
async def get_nifty_live(expiry: Optional[str] = Query(default=None, description="Expiry YYYY-MM-DD (default: nearest)")):
    """On-demand Nifty report from the live Upstox option chain (60s TTL)."""
    if expiry:
        _validate_date(expiry)
    key = expiry or "default"
    now = time.time()
    hit = _live_cache.get(key)
    if hit and now - hit["ts"] < _LIVE_TTL:
        return hit["data"]
    report = await _compute_live(expiry)
    _live_cache[key] = {"ts": now, "data": report}
    return report


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
