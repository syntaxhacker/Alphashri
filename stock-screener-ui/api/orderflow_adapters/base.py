"""
Broker-agnostic order-flow feed adapters.

Each adapter turns a broker's raw WebSocket messages into the SAME normalized
tick shape the rest of the pipeline already consumes (journal, signal engine,
recorder, UI). Adding a broker means adding one subclass and registering it.

Normalized tick ``data`` shape:
    {
      "ltp": float, "volume": float, "vwap": float, "ltt": int(ms),
      "ltq": float, "cp": float, "tbq": float, "tsq": float,
      "oi": float, "iv": float, "greeks": dict | None,
      "day": {"open","high","low","close","volume"} | None,
      "depth": {"buy": [{"price","quantity","orders"}], "sell": [...]},
    }
"""

import re
from abc import ABC, abstractmethod
from typing import Callable, Optional

TickCallback = Callable[[str, dict], None]

_REGISTRY: dict[str, type] = {}

#: Substrings that mean the broker rejected our session — retrying will not
#: help, the user has to re-authenticate.
AUTH_ERROR_HINTS = (
    "401",
    "403",
    "forbidden",
    "unauthorized",
    "invalid token",
    "token expired",
    "token is expired",
    "authentication failed",
    "auth failed",
    "session expired",
    "no access token",
)

#: Broker SDKs append the raw HTTP response between these markers, including
#: ``set-cookie`` values and ``cf-ray`` ids. That is credential-adjacent and
#: must never reach logs or the browser.
_ERROR_BLOB_MARKERS = ("-+-+-", "b'", 'b"')


class OrderFlowAuthError(RuntimeError):
    """The broker rejected our session and the user must re-authenticate."""

    def __init__(self, broker: str, detail: str = ""):
        self.broker = broker
        self.detail = detail
        super().__init__(f"{broker} session rejected: {detail}".strip(": "))


def strip_error_noise(message: object, limit: int = 200) -> str:
    """Collapse a broker SDK error into one short, safe line.

    Drops the raw HTTP response dump (headers, Set-Cookie, cf-ray, bytes repr)
    and any opaque tail, so neither the log nor the UI can leak it.
    """
    text = str(message or "").replace("\n", " ").replace("\r", " ")
    for marker in _ERROR_BLOB_MARKERS:
        if marker in text:
            text = text.split(marker)[0]
    return re.sub(r"\s+", " ", text).strip()[:limit]


def is_auth_error(message: object) -> bool:
    lowered = str(message or "").lower()
    return any(hint in lowered for hint in AUTH_ERROR_HINTS)


#: A delimited blob or a bare header/cookie assignment.
_BLOB_RE = re.compile(re.escape("-+-+-") + r".*" + re.escape("-+-+-"), re.S)
_HEADER_RE = re.compile(
    r"(?i)(set-cookie|__cf_bm|_cfuvid|cf-ray|cf-cache-status|authorization|access_token|bearer)"
    r"(['\"]?\s*[:=]\s*['\"]?)[^\s,;}'\"]+"
)


def redact_sensitive(text: object) -> str:
    """Remove credential-adjacent values, keeping the rest of the line.

    Used as a logging filter because broker/transport libraries (``websockets``,
    the Fyers SDK) log the raw HTTP handshake themselves — those lines never
    pass through our error handling, so only a filter can catch them.
    """
    out = str(text or "")
    out = _BLOB_RE.sub(" [redacted] ", out)
    out = _HEADER_RE.sub(r"\1\2[redacted]", out)
    return re.sub(r"\s+", " ", out).strip()


#: How each broker is written in user-facing text.
_BROKER_DISPLAY_NAMES = {
    "upstox": "Upstox",
    "fyers": "Fyers",
    "fyers_tbt": "Fyers TBT",
}


def broker_display_name(broker: object) -> str:
    key = str(broker or "").strip().lower()
    if key in _BROKER_DISPLAY_NAMES:
        return _BROKER_DISPLAY_NAMES[key]
    return key.replace("_", " ").title() or "Broker"


#: Output shape of :func:`sanitize_adapter_error`, used to stay idempotent.
_ACTIONABLE_RE = re.compile(r"session expired or rejected.*?Reconnect .*? in Settings", re.S)


def sanitize_adapter_error(broker: str, error: object, limit: int = 200) -> str:
    """One safe, actionable line for any adapter error.

    Auth failures get an instruction instead of a status code, because the
    status code alone left the UI showing a dead feed with no way forward.

    Idempotent: adapters sanitize before the hub/bridge sees the text, and
    re-wrapping that output produced a nested "session expired (...) Reconnect
    ..." inside another copy of itself.
    """
    if _ACTIONABLE_RE.search(str(error or "")):
        return strip_error_noise(error, limit=400)

    detail = strip_error_noise(error, limit)
    if is_auth_error(f"{error} {detail}"):
        name = broker_display_name(broker)
        return (
            f"{name} session expired or rejected"
            f"{f' ({detail})' if detail else ''}. "
            f"Reconnect {name} in Settings → Brokers, then restart the feed."
        )
    return detail or f"{broker} feed error"


def register_adapter(cls: type) -> type:
    """Class decorator adding an adapter to the registry by its ``name``."""
    _REGISTRY[cls.name] = cls
    return cls


def get_adapter(name: str) -> Optional[type]:
    return _REGISTRY.get(name)


def available_adapters() -> list[str]:
    return sorted(_REGISTRY)


def make_depth(levels: list[dict]) -> list[dict]:
    """Normalize one side's levels to ``[{price, quantity, orders}]``."""
    out: list[dict] = []
    for level in levels or []:
        price = float(level.get("price") or 0.0)
        qty = float(level.get("quantity") or 0.0)
        if price > 0 and qty > 0:
            out.append(
                {
                    "price": price,
                    "quantity": qty,
                    "orders": int(level.get("orders") or 0),
                }
            )
    return out


class OrderFlowAdapter(ABC):
    """Base class for a broker's live order-flow feed.

    Subclasses declare the connection/depth capabilities and implement
    :meth:`normalize`. Connection lifecycle (``connect``/``disconnect``) is
    broker-specific and may be overridden; the default raises so subclasses are
    explicit about it.
    """

    name: str = "base"
    depth_levels: int = 5
    max_symbols_per_connection: int = 2000
    max_connections: int = 5
    #: whether per-level resting order counts are available
    has_order_counts: bool = False

    @abstractmethod
    def normalize(self, raw: dict) -> list[tuple[str, dict]]:
        """Map one raw broker message to ``[(broker_symbol, tick_data), ...]``.

        Unknown / non-market messages return an empty list.
        """
        raise NotImplementedError

    def connect(self, symbols, on_tick: TickCallback, on_error=None) -> None:
        """Open the feed and stream normalized ticks (broker-specific)."""
        raise NotImplementedError(f"{self.name} adapter does not implement connect()")

    def disconnect(self) -> None:
        """Tear down the feed (broker-specific)."""
        raise NotImplementedError(f"{self.name} adapter does not implement disconnect()")

    def broker_symbol(self, symbol: str) -> str:
        """Map an app symbol to this broker's symbol format (default: identity)."""
        return symbol

    def subscribe_symbol(self, symbol: str) -> bool:
        """Add one symbol to an already-connected feed.

        Returns ``True`` when the symbol now streams on the existing connection.
        The default refuses, which tells callers to open a new connection; feeds
        that share process-global socket state (Fyers) must override this rather
        than let a second connection exist.
        """
        raise NotImplementedError(f"{self.name} adapter cannot add symbols in place")

    def capabilities(self) -> dict:
        return {
            "name": self.name,
            "depth_levels": self.depth_levels,
            "max_symbols_per_connection": self.max_symbols_per_connection,
            "max_connections": self.max_connections,
            "has_order_counts": self.has_order_counts,
        }
