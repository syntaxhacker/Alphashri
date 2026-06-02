"""Debug API — 52-week high analysis endpoint."""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from trading.week52_utils import calculate_52w_high

router = APIRouter(tags=["debug"])


def _fetch_daily_data_for_debug(symbol: str, date_str: Optional[str] = None) -> dict:
    from upstox_trader.config_and_utils.free_indian_apis import UpstoxAPI
    import config as app_config

    api_key = app_config.UPSTOX_API_KEY
    api_secret = app_config.UPSTOX_API_SECRET
    if not api_key or not api_secret:
        raise HTTPException(status_code=503, detail="UPSTOX_API_KEY not configured")

    api = UpstoxAPI(api_key=api_key, api_secret=api_secret, quiet=True)

    if date_str:
        from_date = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=400)).strftime("%Y-%m-%d")
        to_date = date_str
    else:
        to_date = datetime.now().strftime("%Y-%m-%d")
        from_date = (datetime.now() - timedelta(days=400)).strftime("%Y-%m-%d")

    df = api.fetch_historical_data_v3(
        symbol=symbol,
        unit="days",
        interval=1,
        to_date=to_date,
        from_date=from_date,
    )

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No daily data for {symbol}")

    closes = df["close"].tolist()
    highs = df["high"].tolist()
    lows = df["low"].tolist()
    volumes = df["volume"].tolist() if "volume" in df.columns else []

    high_52w = calculate_52w_high(highs, period=252, exclude_current=True) or 0.0

    days_since_52w_high = 0
    if high_52w > 0 and len(highs) >= 2:
        past_highs = highs[:-1]
        window = past_highs[-252:] if len(past_highs) >= 252 else past_highs
        if len(window) >= 2:
            reversed_window = list(reversed(window))
            try:
                days_since_52w_high = reversed_window.index(high_52w)
            except ValueError:
                pass

    avg_volume_20d = 0.0
    if len(volumes) >= 20:
        avg_volume_20d = sum(volumes[-20:]) / 20

    ma50 = 0.0
    ma200 = 0.0
    if len(closes) >= 50:
        ma50 = sum(closes[-50:]) / 50
    if len(closes) >= 200:
        ma200 = sum(closes[-200:]) / 200

    current_price = closes[-1]
    try:
        intraday = api.fetch_intraday_data_v3(symbol=symbol, interval="1")
    except Exception:
        intraday = None

    if intraday is not None and not intraday.empty:
        current_price = float(intraday["close"].iloc[-1])

    return {
        "current_price": current_price,
        "high_52w": high_52w,
        "days_since_52w_high": days_since_52w_high,
        "daily_highs": highs,
        "daily_closes": closes,
        "volume": volumes[-1] if volumes else 0.0,
        "avg_volume_20d": avg_volume_20d,
        "ma50": ma50,
        "ma200": ma200,
        "prev_high": highs[-2] if len(highs) >= 2 else highs[-1],
        "prev_low": lows[-2] if len(lows) >= 2 else lows[-1],
        "prev_close": closes[-2] if len(closes) >= 2 else closes[-1],
    }


@router.get("/api/debug/52w/{symbol}")
async def debug_52w(
    symbol: str,
    date: Optional[str] = None,
    user=Depends(get_current_user),
):
    md = _fetch_daily_data_for_debug(symbol, date)
    current_price = md["current_price"]
    high_52w = md["high_52w"]
    days_since = md["days_since_52w_high"]
    daily_highs = md["daily_highs"]

    pct_from_52w_high = ((high_52w - current_price) / current_price) * 100 if current_price > 0 else 0.0

    recent_touches = []
    threshold_52w = 0.99 * high_52w
    if high_52w > 0:
        for i in range(len(daily_highs) - 1, -1, -1):
            if len(recent_touches) >= 10:
                break
            h = daily_highs[i]
            if h >= threshold_52w:
                dist_pct = ((h - high_52w) / high_52w) * 100
                recent_touches.append({
                    "date": None,
                    "price": round(h, 2),
                    "distance_pct": round(dist_pct, 2),
                })

    strategy_52w_chaser = _check_52w_chaser(md)
    strategy_52w_target = _check_52w_target(md)
    strategy_blind_52w = _check_blind_52w(md)

    return {
        "symbol": symbol.upper(),
        "current_price": round(current_price, 2),
        "high_52w": round(high_52w, 2),
        "days_since_52w_high": days_since,
        "pct_from_52w_high": round(pct_from_52w_high, 2),
        "total_daily_bars": len(daily_highs),
        "recent_touches": recent_touches,
        "strategy_checks": {
            "52W_CHASER": strategy_52w_chaser,
            "52W_TARGET": strategy_52w_target,
            "BLIND_52W": strategy_blind_52w,
        },
        "market_data": {k: v for k, v in md.items() if k not in ("daily_highs", "daily_closes")},
    }


def _check_52w_chaser(md: dict) -> dict:
    from trading.week52_chaser_signals import Week52ChaserSignalGenerator
    gen = Week52ChaserSignalGenerator({})
    conditions = []
    current_price = md.get("current_price")
    high_52w = md.get("high_52w")

    if not current_price or not high_52w or current_price <= 0 or high_52w <= 0:
        return {"would_enter": False, "conditions": [{"condition": "No market data", "passed": False, "value": None}]}

    pct_above = ((current_price - high_52w) / high_52w) * 100

    conditions.append({
        "condition": f"Price {pct_above:+.2f}% above 52W high (need {gen.min_breakout_pct}% to {gen.entry_threshold_pct}%)",
        "passed": gen.min_breakout_pct <= pct_above <= gen.entry_threshold_pct,
        "value": round(pct_above, 2),
    })

    sl = high_52w
    tp = current_price * (1 + gen.tp_pct / 100)
    conditions.append({
        "condition": f"SL @ 52W high ₹{sl:.2f}, TP {gen.tp_pct}% = ₹{tp:.2f}",
        "passed": True,
        "value": {"sl": round(sl, 2), "tp": round(tp, 2)},
    })

    would_enter = all(c["passed"] for c in conditions)
    return {"would_enter": would_enter, "conditions": conditions}


def _check_52w_target(md: dict) -> dict:
    from trading.week52_target_signals import Week52TargetSignalGenerator
    gen = Week52TargetSignalGenerator({})
    conditions = []
    current_price = md.get("current_price")
    high_52w = md.get("high_52w")
    days_since = md.get("days_since_52w_high", 99)

    if not current_price or current_price <= 0:
        return {"would_enter": False, "conditions": [{"condition": "No price data", "passed": False, "value": None}]}

    below_high = current_price < high_52w if high_52w else False
    conditions.append({
        "condition": f"Price ₹{current_price:.2f} {'<' if below_high else '>='} 52W high ₹{(high_52w or 0):.2f}",
        "passed": current_price < (high_52w or float("inf")),
        "value": round(current_price, 2),
    })

    entry_threshold_amount = (high_52w or 0) * (1 - gen.entry_threshold_pct / 100)
    within_threshold = current_price >= entry_threshold_amount if high_52w else False
    conditions.append({
        "condition": f"Price ₹{current_price:.2f} within {gen.entry_threshold_pct}% of high (threshold ₹{entry_threshold_amount:.2f})",
        "passed": within_threshold,
        "value": round(current_price, 2),
    })

    conditions.append({
        "condition": f"Days since 52W high: {days_since} >= {gen.recent_touch_days}",
        "passed": days_since >= gen.recent_touch_days,
        "value": days_since,
    })

    would_enter = all(c["passed"] for c in conditions)
    return {"would_enter": would_enter, "conditions": conditions}


def _check_blind_52w(md: dict) -> dict:
    from trading.blind_52w_signals import Blind52WSignalGenerator
    gen = Blind52WSignalGenerator({})
    conditions = []
    current_price = md.get("current_price")
    high_52w = md.get("high_52w")
    days_since = md.get("days_since_52w_high")

    if not current_price or not high_52w or days_since is None:
        return {"would_enter": False, "conditions": [{"condition": "Insufficient data", "passed": False, "value": None}]}

    below_high = current_price < high_52w
    conditions.append({
        "condition": f"Price ₹{current_price:.2f} {'<' if below_high else '>='} 52W high ₹{high_52w:.2f}",
        "passed": below_high,
        "value": round(current_price, 2),
    })

    pct_from_high = (high_52w - current_price) / high_52w * 100
    conditions.append({
        "condition": f"{pct_from_high:.2f}% from 52W high (need ≤{gen.near_high_threshold_pct}%)",
        "passed": pct_from_high <= gen.near_high_threshold_pct,
        "value": round(pct_from_high, 2),
    })

    conditions.append({
        "condition": f"Days since 52W high: {days_since} >= {gen.min_days_since_52w_high}",
        "passed": days_since >= gen.min_days_since_52w_high,
        "value": days_since,
    })

    would_enter = all(c["passed"] for c in conditions)
    return {"would_enter": would_enter, "conditions": conditions}
