from typing import Optional

from api.broker_hub.adapters.base import OrderFlowAdapter, register_adapter

# Upstox full mode emits 5 depth levels per quote list.
_DEPTH_LEVELS = 5


def _num(value, default: float = 0.0) -> float:
    """Coerce protobuf JSON values (int64 arrives as string) to float."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _day_ohlc(mff: dict) -> Optional[dict]:
    """Extract the daily OHLC entry from the full feed's ``marketOHLC``."""
    for ohlc in (mff.get("marketOHLC") or {}).get("ohlc") or []:
        if not isinstance(ohlc, dict):
            continue
        if ohlc.get("interval") == "1d":
            return {
                "open": _num(ohlc.get("open")),
                "high": _num(ohlc.get("high")),
                "low": _num(ohlc.get("low")),
                "close": _num(ohlc.get("close")),
                "volume": _num(ohlc.get("vol")),
            }
    return None


def _normalize_tick(feed_map: dict) -> Optional[dict]:
    """Map an Upstox ``fullFeed.marketFF`` payload to the OrderFlowMap shape."""
    if not isinstance(feed_map, dict):
        return None

    for feed in feed_map.values():
        if not isinstance(feed, dict):
            continue
        full_feed = feed.get("fullFeed") or {}
        mff = full_feed.get("marketFF")
        if not mff:
            # Indices carry no order book (indexFF): emit price + OHLC only.
            index_ff = full_feed.get("indexFF")
            if not index_ff:
                continue
            ltpc = index_ff.get("ltpc") or {}
            ltp = ltpc.get("ltp")
            if ltp is None:
                continue
            return {
                "type": "market_data",
                "data": {
                    "ltp": _num(ltp),
                    "volume": 0.0,
                    "vwap": 0.0,
                    "ltt": int(_num(ltpc.get("ltt"))),
                    "ltq": _num(ltpc.get("ltq")),
                    "cp": _num(ltpc.get("cp")),
                    "tbq": 0.0,
                    "tsq": 0.0,
                    "oi": 0.0,
                    "iv": 0.0,
                    "greeks": None,
                    "day": _day_ohlc(index_ff),
                    "depth": {"buy": [], "sell": []},
                },
            }

        ltpc = mff.get("ltpc") or {}
        ltp = ltpc.get("ltp")
        if ltp is None:
            continue

        bids: list[dict] = []
        asks: list[dict] = []
        quotes = (mff.get("marketLevel") or {}).get("bidAskQuote") or []
        for level in quotes[:_DEPTH_LEVELS]:
            if not isinstance(level, dict):
                continue
            bp, bq = _num(level.get("bidP")), _num(level.get("bidQ"))
            ap, aq = _num(level.get("askP")), _num(level.get("askQ"))
            if bp > 0 and bq > 0:
                bids.append({"price": bp, "quantity": bq, "orders": 0})
            if ap > 0 and aq > 0:
                asks.append({"price": ap, "quantity": aq, "orders": 0})

        if not bids and not asks:
            continue

        return {
            "type": "market_data",
            "data": {
                "ltp": _num(ltp),
                "volume": _num(mff.get("vtt")),
                # Upstox `atp` = average traded price for the day → true session VWAP.
                "vwap": _num(mff.get("atp")),
                "ltt": int(_num(ltpc.get("ltt"))),
                # Extra full-feed fields (free — no extra API calls).
                "cp": _num(ltpc.get("cp")),          # previous close
                "ltq": _num(ltpc.get("ltq")),        # last traded quantity
                "tbq": _num(mff.get("tbq")),         # total buy quantity (all levels)
                "tsq": _num(mff.get("tsq")),         # total sell quantity (all levels)
                "oi": _num(mff.get("oi")),           # open interest (F&O)
                "iv": _num(mff.get("iv")),           # implied volatility (F&O)
                "greeks": _normalize_greeks(mff),    # F&O only (None for equity)
                "day": _day_ohlc(mff),
                "depth": {"buy": bids, "sell": asks},
            },
        }
    return None


def _normalize_greeks(mff: dict) -> Optional[dict]:
    """Extract option greeks when present (F&O instruments only)."""
    og = mff.get("optionGreeks")
    if not isinstance(og, dict) or not og:
        return None
    if not any(k in og for k in ("delta", "gamma", "theta", "vega")):
        return None
    return {name: _num(og.get(name)) for name in ("delta", "gamma", "theta", "vega", "rho")}


@register_adapter
class UpstoxAdapter(OrderFlowAdapter):
    """Upstox Market Data Feed V3, ``full`` mode (5-level depth)."""

    name = "upstox"
    depth_levels = 5
    max_symbols_per_connection = 2000
    max_connections = 5
    has_order_counts = False  # V3 quotes carry quantity only

    def normalize(self, raw: dict) -> list[tuple[str, dict]]:
        feeds = raw.get("feeds") if isinstance(raw, dict) else None
        if not isinstance(feeds, dict):
            return []
        out: list[tuple[str, dict]] = []
        for instrument_key, feed in feeds.items():
            tick = _normalize_tick({instrument_key: feed})
            if tick and isinstance(tick.get("data"), dict):
                out.append((instrument_key, tick["data"]))
        return out
