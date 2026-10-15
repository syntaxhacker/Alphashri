"""Premium Tracker API — cheap vs expensive option premium snapshot.

Powers the "Premium" tab on the Options page. For NIFTY and BANKNIFTY it
combines the live Fyers option chain (ATM straddle price, back-out IV) with
20-day realized volatility from yfinance, producing the cookbook's checks
#1 (straddle vs average range) and #2 (IV vs HV) in one call.

Weekends: the Fyers chain reflects Friday's snapshot (see
``india_board.scripts.fyers_data``); the payload carries ``as_of`` so the
UI can label stale data.
"""

from __future__ import annotations

import math
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/options", tags=["options"])

_UNDERLYINGS = ("NIFTY", "BANKNIFTY")
_YF_SYMBOL = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK"}

_TTL_SEC = 120.0
_CACHE: Dict[str, Any] = {"at": 0.0, "payload": None}


class PremiumLeg(BaseModel):
    underlying: str
    spot: Optional[float] = None
    atm_strike: Optional[float] = None
    ce_ltp: Optional[float] = None
    pe_ltp: Optional[float] = None
    straddle_price: Optional[float] = None
    straddle_pct: Optional[float] = None
    ce_iv_pct: Optional[float] = None
    pe_iv_pct: Optional[float] = None
    dte_days: Optional[int] = None
    hv20_ann_pct: Optional[float] = None
    hv20_daily_pct: Optional[float] = None
    avg_range20_pct: Optional[float] = None
    iv_hv_ratio: Optional[float] = None
    verdict: str = "UNKNOWN"
    error: Optional[str] = None


class PremiumTrackerResponse(BaseModel):
    legs: List[PremiumLeg]
    as_of: Optional[str] = None
    cached: bool = False


def _verdict(iv_hv_ratio: Optional[float]) -> str:
    if iv_hv_ratio is None:
        return "UNKNOWN"
    if iv_hv_ratio >= 1.1:
        return "EXPENSIVE"
    if iv_hv_ratio <= 0.9:
        return "CHEAP"
    return "FAIR"


def _realized(symbol: str) -> Dict[str, Optional[float]]:
    """20-day HV (annualized + daily) and average daily range via yfinance."""
    import pandas as pd  # noqa: F401  (ensures pandas-backed frames)
    import yfinance as yf

    df = yf.download(symbol, period="2mo", auto_adjust=False, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df.dropna()
    if len(df) < 21:
        return {"hv20_ann_pct": None, "hv20_daily_pct": None, "avg_range20_pct": None}
    cc = df["Close"].pct_change().dropna().tail(20)
    hv_daily = float(cc.std())
    rng = ((df["High"] - df["Low"]) / df["Close"] * 100.0).tail(20)
    return {
        "hv20_ann_pct": round(hv_daily * math.sqrt(252) * 100.0, 2),
        "hv20_daily_pct": round(hv_daily * 100.0, 3),
        "avg_range20_pct": round(float(rng.mean()), 3),
    }


def _leg(underlying: str) -> PremiumLeg:
    from india_board.scripts.fyers_data import (
        _chain_dte_days,
        _implied_vol,
        get_chain,
    )

    try:
        chain = get_chain(underlying)
    except Exception as exc:  # noqa: BLE001 — per-leg failure must not 500 the tab
        return PremiumLeg(underlying=underlying, error=str(exc)[:200])

    spot = chain.get("spot")
    strikes = chain.get("strikes") or []
    if spot is None or not strikes:
        return PremiumLeg(underlying=underlying, error="empty chain")
    atm = min(strikes, key=lambda r: abs(float(r.get("strike", 0)) - float(spot)))
    strike = float(atm.get("strike"))
    ce, pe = float(atm.get("ce_ltp") or 0), float(atm.get("pe_ltp") or 0)
    dte = _chain_dte_days(chain)
    T = max(dte, 1) / 365.0
    ce_iv = _implied_vol(ce, float(spot), strike, T, "call")
    pe_iv = _implied_vol(pe, float(spot), strike, T, "put")
    straddle = ce + pe

    try:
        real = _realized(_YF_SYMBOL[underlying])
    except Exception:  # noqa: BLE001 — chain data alone is still useful
        real = {"hv20_ann_pct": None, "hv20_daily_pct": None, "avg_range20_pct": None}

    mean_iv = None
    ivs = [v for v in (ce_iv, pe_iv) if v is not None]
    if ivs:
        mean_iv = sum(ivs) / len(ivs)
    ratio = None
    hv_ann = real["hv20_ann_pct"]
    if mean_iv is not None and hv_ann:
        ratio = round((mean_iv * 100.0) / hv_ann, 2)

    return PremiumLeg(
        underlying=underlying,
        spot=round(float(spot), 2),
        atm_strike=strike,
        ce_ltp=round(ce, 2),
        pe_ltp=round(pe, 2),
        straddle_price=round(straddle, 2),
        straddle_pct=round(straddle / float(spot) * 100.0, 3),
        ce_iv_pct=round(ce_iv * 100.0, 2) if ce_iv is not None else None,
        pe_iv_pct=round(pe_iv * 100.0, 2) if pe_iv is not None else None,
        dte_days=dte,
        hv20_ann_pct=hv_ann,
        hv20_daily_pct=real["hv20_daily_pct"],
        avg_range20_pct=real["avg_range20_pct"],
        iv_hv_ratio=ratio,
        verdict=_verdict(ratio),
    )


@router.get("/premium-tracker", response_model=PremiumTrackerResponse)
def premium_tracker() -> PremiumTrackerResponse:
    """Live cheap-vs-expensive snapshot for NIFTY and BANKNIFTY."""
    now = time.time()
    if _CACHE["payload"] is not None and now - _CACHE["at"] < _TTL_SEC:
        payload = dict(_CACHE["payload"])
        payload["cached"] = True
        return PremiumTrackerResponse(**payload)

    legs = [_leg(u) for u in _UNDERLYINGS]
    from datetime import datetime, timezone

    as_of = datetime.now(timezone.utc).isoformat()
    payload = {"legs": [leg.model_dump() for leg in legs], "as_of": as_of, "cached": False}
    _CACHE["at"] = now
    _CACHE["payload"] = payload
    return PremiumTrackerResponse(**payload)


def clear_premium_tracker_cache() -> None:
    """Drop the cached snapshot (tests / manual refresh)."""
    _CACHE["at"] = 0.0
    _CACHE["payload"] = None
