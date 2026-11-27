"""Alpaca candles for US stocks.

Public bars REST API through httpx; alpaca-py is deliberately not a dependency.
Credentials come from the environment only and are never stored in source.

Free Alpaca gives IEX real-time bars and SIP bars delayed by 15 minutes, so the
feed is IEX unless ``ALPACA_FEED=sip`` is set explicitly.
"""

from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping

import httpx
import pandas as pd

from .base import MarketDataProvider, OHLCV, ProviderNoData, normalize_ohlcv
from .symbol_map import normalize_us_symbol

BARS_URL = "https://data.alpaca.markets/v2/stocks/bars"
US_SESSION_TZ = "America/New_York"
MAX_PAGES = 100
PAGE_LIMIT = 10000
ALPACA_EPOCH_1M = "2016-01-01T00:00:00Z"

_KEY_ENV = ("ALPACA_API_KEY", "APCA_API_KEY_ID")
_SECRET_ENV = ("ALPACA_API_SECRET", "APCA_API_SECRET_KEY")

_ALPACA_TIMEFRAMES = {
    "1m": "1Min", "1min": "1Min", "1minute": "1Min", "minute": "1Min",
    "5m": "5Min", "5min": "5Min", "5minute": "5Min",
    "15m": "15Min", "15min": "15Min", "15minute": "15Min",
    "1h": "1Hour", "1hour": "1Hour", "hour": "1Hour", "60m": "1Hour",
    "1d": "1Day", "1day": "1Day", "day": "1Day", "d": "1Day",
}

_DEFAULT_RANGES = {
    "1Min": "5d", "5Min": "5d", "15Min": "1mo", "1Hour": "3mo", "1Day": "1y",
}

_RANGE = re.compile(r"^(\d+)\s*(d|w|mo|m|y)$", re.IGNORECASE)
_RANGE_MULTIPLIER = {"d": 1, "w": 7, "m": 30, "mo": 30, "y": 365}


class AlpacaProviderError(Exception):
    """An Alpaca request failed for a reason other than 'no data'."""

    # ``kind`` lets the chart route map failures without importing concrete
    # provider classes (it only knows the neutral ProviderNoData base).
    kind = "error"


class AlpacaAuthError(AlpacaProviderError, ProviderNoData):
    """Missing credentials or a 401/403 from Alpaca."""

    kind = "auth"


class AlpacaRateLimitError(AlpacaProviderError, ProviderNoData):
    """Alpaca returned HTTP 429; callers should back off or fail over."""

    kind = "rate_limit"

    def __init__(self, message: str, *, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


# Neutral aliases keep callers independent of the concrete class names.
ProviderAuthError = AlpacaAuthError
ProviderRateLimitError = AlpacaRateLimitError


def _safe_retry_after(response: Any, *, default: int = 60, cap: int = 300) -> int:
    """Return a bounded, numeric-only Retry-After hint from an upstream reply.

    The value is echoed to clients, so anything that is not a small positive
    integer is replaced by ``default`` — upstream text must never reach a 429.
    """
    headers = getattr(response, "headers", None)
    raw = None
    if headers is not None:
        try:
            raw = headers.get("retry-after") or headers.get("Retry-After")
        except Exception:  # noqa: BLE001 - a non-mapping header object is unusable
            raw = None
    try:
        seconds = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    if seconds <= 0:
        return default
    return min(seconds, cap)


def _first_env(names: tuple[str, ...]) -> str:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return ""


def normalize_timeframe(timeframe: str) -> str:
    """Map UI/Yahoo timeframe keys to Alpaca's ``timeframe`` values."""
    mapped = _ALPACA_TIMEFRAMES.get(str(timeframe or "").strip().lower())
    if mapped is None:
        raise ProviderNoData(f"unsupported Alpaca timeframe: {timeframe}")
    return mapped


def _iso(value: Any) -> str:
    """RFC 3339 UTC string; bare ``YYYY-MM-DD`` strings become midnight UTC."""
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            return f"{text}T00:00:00Z"
        return text
    if isinstance(value, date) and not isinstance(value, datetime):
        value = datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return (
        value.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def range_bounds(
    range_spec: Any = None,
    start: Any = None,
    end: Any = None,
    *,
    now: datetime | None = None,
) -> tuple[str, str]:
    """Turn a ``5d``/``1mo``/``max`` range into a UTC ``(start, end)`` pair."""
    now = now or datetime.now(timezone.utc)
    if start is not None:
        start_value = start
    elif isinstance(range_spec, (datetime, date)):
        start_value = range_spec
    else:
        text = str(range_spec or "").strip().lower()
        if text in ("max", "all", "full"):
            start_value = ALPACA_EPOCH_1M
        else:
            match = _RANGE.match(text)
            if match:
                days = int(match.group(1)) * _RANGE_MULTIPLIER[match.group(2).lower()]
                start_value = now - timedelta(days=days)
            else:
                try:
                    start_value = datetime.fromisoformat(text.replace("Z", "+00:00"))
                except ValueError:
                    start_value = now - timedelta(days=5)
    end_value = end if end is not None else now
    return _iso(start_value), _iso(end_value)


def _extract_bars(payload: Mapping[str, Any], symbol: str) -> list[Mapping[str, Any]]:
    bars = payload.get("bars", {})
    if isinstance(bars, Mapping):
        rows = bars.get(symbol)
        if rows is None and len(bars) == 1:
            rows = next(iter(bars.values()))
    elif isinstance(bars, list):
        rows = bars
    else:
        rows = None
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, Mapping)]


def _bars_to_frame(bars: list[Mapping[str, Any]]) -> pd.DataFrame:
    times: list[Any] = []
    rows: list[dict[str, Any]] = []
    for bar in bars:
        if bar.get("t") is None:
            continue
        times.append(bar["t"])
        rows.append(
            {
                "open": bar.get("o"),
                "high": bar.get("h"),
                "low": bar.get("l"),
                "close": bar.get("c"),
                "volume": bar.get("v") if bar.get("v") is not None else 0,
            }
        )
    frame = pd.DataFrame(rows, columns=list(OHLCV))
    frame.index = pd.to_datetime(times, utc=True)
    frame.index.name = "timestamp"
    return frame


class AlpacaProvider:
    """US candles from Alpaca's public bars endpoint.

    ``candles(symbol, timeframe)`` follows :class:`MarketDataProvider`; the
    optional keyword arguments exist for callers that want an explicit window.
    """

    market = "usa"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        api_secret: str | None = None,
        feed: str | None = None,
        client: httpx.Client | Any | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.api_key = api_key if api_key is not None else _first_env(_KEY_ENV)
        self.api_secret = api_secret if api_secret is not None else _first_env(_SECRET_ENV)
        configured = str(feed if feed is not None else os.getenv("ALPACA_FEED", "iex"))
        # Free SIP is 15-min delayed; only opt in when explicitly requested.
        self.feed = "sip" if configured.strip().lower() == "sip" else "iex"
        self.delay_label = "live (IEX)" if self.feed == "iex" else "15 min delayed (SIP)"
        self.feed_label = f"alpaca-{self.feed}"
        self._timeout = timeout
        self._client = client
        if self._client is None and self.is_available():
            self._client = httpx.Client(timeout=self._timeout)

    @property
    def headers(self) -> dict[str, str]:
        return {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.api_secret,
        }

    @property
    def client(self) -> Any:
        if self._client is None:
            self._client = httpx.Client(timeout=self._timeout)
        return self._client

    def close(self) -> None:
        if self._client is not None and hasattr(self._client, "close"):
            self._client.close()
        self._client = None

    @classmethod
    def configured(cls) -> bool:
        """True when both credentials are present in the environment."""
        return bool(_first_env(_KEY_ENV) and _first_env(_SECRET_ENV))

    def is_available(self) -> bool:
        return bool(self.api_key and self.api_secret)

    @property
    def available(self) -> bool:
        return self.is_available()

    def _get(self, params: dict[str, Any]) -> Mapping[str, Any]:
        try:
            response = self.client.get(
                BARS_URL,
                params=params,
                headers=self.headers,
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise AlpacaProviderError(
                f"Alpaca request failed: {type(exc).__name__}"
            ) from exc

        status = int(getattr(response, "status_code", 0))
        if status in (401, 403):
            raise AlpacaAuthError(f"Alpaca authentication failed (HTTP {status})")
        if status == 429:
            raise AlpacaRateLimitError(
                f"Alpaca rate limit exceeded (HTTP {status})",
                retry_after=_safe_retry_after(response),
            )
        if status >= 400:
            raise AlpacaProviderError(f"Alpaca request failed (HTTP {status})")

        try:
            payload = response.json()
        except Exception as exc:
            raise AlpacaProviderError("Alpaca returned a non-JSON response") from exc
        if not isinstance(payload, Mapping):
            raise AlpacaProviderError("Alpaca returned an unexpected payload")
        return payload

    def candles(
        self,
        symbol: str,
        timeframe: str,
        *,
        range: Any = None,
        start: Any = None,
        end: Any = None,
        limit: int = PAGE_LIMIT,
    ) -> pd.DataFrame:
        """Return a clean UTC OHLCV frame or raise :class:`ProviderNoData`."""
        if not self.is_available():
            raise AlpacaAuthError("Alpaca credentials are not configured")

        alpaca_tf = normalize_timeframe(timeframe)
        vendor_symbol = str(normalize_us_symbol(symbol))
        start_iso, end_iso = range_bounds(
            range if range is not None else _DEFAULT_RANGES.get(alpaca_tf, "5d"),
            start,
            end,
        )
        params: dict[str, Any] = {
            "symbols": vendor_symbol,
            "timeframe": alpaca_tf,
            "start": start_iso,
            "end": end_iso,
            "feed": self.feed,
            "limit": int(limit),
        }

        bars: list[Mapping[str, Any]] = []
        page_token: str | None = None
        pages = 0
        while True:
            if pages >= MAX_PAGES:
                raise AlpacaProviderError("Alpaca pagination exceeded page limit")
            pages += 1
            page_params = dict(params)
            if page_token:
                page_params["page_token"] = page_token
            payload = self._get(page_params)
            bars.extend(_extract_bars(payload, vendor_symbol))
            token = payload.get("next_page_token")
            page_token = str(token) if token else None
            if not page_token:
                break

        return normalize_ohlcv(_bars_to_frame(bars), session_tz=US_SESSION_TZ)

    def quote(self, symbol: str) -> dict | None:
        # v1 charts only consume candles; no quote endpoint is needed yet.
        return None
