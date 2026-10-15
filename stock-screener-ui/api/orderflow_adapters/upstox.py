"""Upstox order-flow adapter (wraps the existing full-mode streamer helpers)."""

from typing import Optional

from api.orderflow_adapters.base import OrderFlowAdapter, register_adapter
from api.orderflow_stream import _normalize_tick


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
