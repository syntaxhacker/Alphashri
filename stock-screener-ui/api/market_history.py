"""Daily history fetching for sector indices/ETFs.

One place owns the client construction, window bounds, IST normalisation,
per-symbol isolation, bounded concurrency and provenance for both the sector
correlation and sector history consumers.  ``api/sector.py`` keeps its legacy
fetch path for the 15s-style correlation endpoint; ``api/sector_history.py``
uses :func:`fetch_market_history` from here.
"""

import asyncio
import logging
import time
from datetime import date, datetime, timedelta
from typing import Dict, Optional, Tuple

import pandas as pd
import requests

from config import IST
from api import sector as _sector_module
from api.sector_universe import DESCRIPTORS_BY_MARKET, SectorDescriptor

logger = logging.getLogger(__name__)

MIN_DAILY_ROWS = 5
MAX_FETCH_CONCURRENCY = 4
MAX_WINDOW_DAYS = 3650
HISTORY_MEMO_TTL_SECONDS = 30.0

#: The Upstox daily-candle endpoint is limited to one decade.
UPSTOX_DAY_UNIT = "day"
# Upstox V3 path order is unit/interval/to_date/from_date.
UPSTOX_CANDLE_URL = (
    "https://api.upstox.com/v3/historical-candle/"
    "{instrument_key}/day/1/{to_date}/{from_date}"
)


class HistoryData(dict):
    """``{display_name: daily close DataFrame}`` plus per-series provenance."""

    sources: Dict[str, str]

    def __init__(
        self,
        closes: Optional[Dict[str, pd.DataFrame]] = None,
        sources: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__(closes or {})
        self.sources = dict(sources or {})


# ===== Client / window =====

def build_upstox_client():
    """Build the single Upstox client used by every India history fetch."""
    from upstox_trader.config_and_utils.upstox_api import UpstoxAPI
    from config import UPSTOX_API_KEY, UPSTOX_API_SECRET

    if not UPSTOX_API_KEY or not UPSTOX_API_SECRET:
        return None
    api = UpstoxAPI(
        api_key=UPSTOX_API_KEY,
        api_secret=UPSTOX_API_SECRET,
        quiet=True,
    )
    if not api.instruments:
        api._download_and_cache_instruments()
    return api


def _get_instrument_key_map() -> Dict[str, str]:
    """Read the legacy NSE instrument map through the sector module.

    Kept as a thin indirection so tests/consumers can patch either this module
    or ``api.sector._get_instrument_key_map``.
    """
    return _sector_module._get_instrument_key_map()


def window_bounds(years: int) -> Tuple[date, date]:
    """Compute the inclusive daily window once; cap 10Y at 3650 days."""
    end = datetime.now(IST).date()
    days = max(1, min(int(years) * 365, MAX_WINDOW_DAYS))
    return end - timedelta(days=days), end


# ===== Normalisation =====

def normalize_daily_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise a daily frame to an IST, date-only, unique ``close`` index."""
    if df is None or df.empty or "close" not in df.columns:
        return pd.DataFrame(columns=["close"], dtype=float)
    index = pd.DatetimeIndex(df.index)
    if index.tz is not None:
        index = index.tz_convert(IST)
    index = index.normalize()
    close = pd.to_numeric(df["close"], errors="coerce")
    frame = pd.DataFrame({"close": close.to_numpy()}, index=index)
    if frame.index.tz is not None:
        frame.index = frame.index.tz_localize(None)
    frame = frame[~frame.index.duplicated(keep="last")]
    return frame.sort_index().dropna()


# ===== Upstox =====

async def _fetch_upstox_index_data(
    api, instrument_key: str, start: date, end: date
) -> Optional[pd.DataFrame]:
    """Fetch daily index candles from Upstox V3, returning a normalised frame."""
    if not instrument_key or start > end:
        return None
    try:
        url = UPSTOX_CANDLE_URL.format(
            instrument_key=instrument_key,
            to_date=end.isoformat(),
            from_date=start.isoformat(),
        )
        headers = api._get_headers()

        response = await asyncio.to_thread(
            lambda: requests.get(url, headers=headers, timeout=30)
        )
        response.raise_for_status()
        data = response.json()

        if data.get("status") != "success":
            return None

        candles = data.get("data", {}).get("candles", [])
        if not candles:
            return None

        frame = pd.DataFrame(candles)
        if frame.empty or frame.shape[1] < 5:
            return None
        # V3 may include open interest as a seventh column; keep OHLCV only.
        frame = frame.iloc[:, :6]
        names = ["timestamp", "open", "high", "low", "close", "volume"]
        frame.columns = names[: frame.shape[1]]
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="coerce")
        frame = frame.dropna(subset=["timestamp"]).set_index("timestamp").sort_index()
        return normalize_daily_frame(frame)
    except Exception:
        logger.warning(
            "Upstox daily history failed for %s", instrument_key, exc_info=True
        )
        return None


# ===== yfinance =====

async def _fetch_yfinance_history(
    symbol: str, start: date, end: date
) -> Optional[pd.DataFrame]:
    """Fetch daily closes from yfinance with explicit adjustment semantics."""

    def _load() -> Optional[pd.DataFrame]:
        import yfinance as yf

        frame = yf.Ticker(symbol).history(
            start=start.isoformat(),
            end=end.isoformat(),
            interval="1d",
            auto_adjust=True,
        )
        if frame is None or frame.empty or "Close" not in frame.columns:
            return None
        return frame.rename(columns={"Close": "close"})[["close"]]

    try:
        frame = await asyncio.to_thread(_load)
    except Exception:
        logger.warning("yfinance history failed for %s", symbol, exc_info=True)
        return None
    if frame is None or frame.empty:
        return None
    normalized = normalize_daily_frame(frame)
    return normalized if not normalized.empty else None


# ===== Per-symbol fetch =====

def _resolve_upstox_key(
    descriptor: SectorDescriptor, upper_keys: Dict[str, str]
) -> Optional[str]:
    """Prefer the descriptor's canonical key; instrument map is only fallback."""
    if descriptor.upstox_key:
        return descriptor.upstox_key
    aliases = {
        "NIFTY FIN_SERVICE": (
            "NIFTY FIN SERVICE",
            "NIFTY FINANCIAL SERVICES",
        ),
        "NIFTY CONSUMPTION": (
            "NIFTY INDIA CONSUMPTION",
            "NIFTY CONSUMER",
        ),
    }
    for name in (descriptor.display,) + aliases.get(descriptor.display, ()):
        key = upper_keys.get(name.upper())
        if key:
            return key
    return None


async def _fetch_india_descriptor(
    descriptor: SectorDescriptor,
    api,
    upper_keys: Dict[str, str],
    start: date,
    end: date,
    semaphore: asyncio.Semaphore,
) -> Optional[Tuple[str, pd.DataFrame, str]]:
    async with semaphore:
        try:
            if api is not None:
                key = _resolve_upstox_key(descriptor, upper_keys)
                frame = await _fetch_upstox_index_data(api, key, start, end)
                if frame is not None and len(frame) >= MIN_DAILY_ROWS:
                    return descriptor.display, frame, "upstox"

            if descriptor.yf_symbol:
                frame = await _fetch_yfinance_history(
                    descriptor.yf_symbol, start, end
                )
                if frame is not None and len(frame) >= MIN_DAILY_ROWS:
                    return descriptor.display, frame, "yfinance"
        except Exception:
            logger.warning(
                "History fetch failed for %s", descriptor.display, exc_info=True
            )
        return None


async def _fetch_us_descriptor(
    descriptor: SectorDescriptor,
    start: date,
    end: date,
    semaphore: asyncio.Semaphore,
) -> Optional[Tuple[str, pd.DataFrame, str]]:
    async with semaphore:
        try:
            if descriptor.yf_symbol:
                frame = await _fetch_yfinance_history(
                    descriptor.yf_symbol, start, end
                )
                if frame is not None and len(frame) >= MIN_DAILY_ROWS:
                    return descriptor.display, frame, "yfinance"
        except Exception:
            logger.warning(
                "History fetch failed for %s", descriptor.display, exc_info=True
            )
        return None


async def _fetch_india_history(years: int) -> HistoryData:
    start, end = window_bounds(years)

    # Client first, instrument map second: the descriptor keys are canonical,
    # the map only helps when an optional key is absent.
    try:
        api = await asyncio.to_thread(build_upstox_client)
    except Exception:
        logger.warning("Upstox client unavailable", exc_info=True)
        api = None

    try:
        key_map = await asyncio.to_thread(_get_instrument_key_map)
    except Exception:
        logger.warning("Upstox instrument map unavailable", exc_info=True)
        key_map = {}
    upper_keys = {str(name).upper(): key for name, key in key_map.items()}

    semaphore = asyncio.Semaphore(MAX_FETCH_CONCURRENCY)
    results = await asyncio.gather(
        *(
            _fetch_india_descriptor(
                descriptor, api, upper_keys, start, end, semaphore
            )
            for descriptor in DESCRIPTORS_BY_MARKET["india"]
        )
    )
    data = HistoryData()
    for result in results:
        if result is not None:
            display, frame, source = result
            data[display] = frame
            data.sources[display] = source
    return data


async def _fetch_us_history(years: int) -> HistoryData:
    start, end = window_bounds(years)
    semaphore = asyncio.Semaphore(MAX_FETCH_CONCURRENCY)
    results = await asyncio.gather(
        *(
            _fetch_us_descriptor(descriptor, start, end, semaphore)
            for descriptor in DESCRIPTORS_BY_MARKET["america"]
        )
    )
    data = HistoryData()
    for result in results:
        if result is not None:
            display, frame, source = result
            data[display] = frame
            data.sources[display] = source
    return data


# ===== Single-flight + short process memo =====

_fetch_locks: Dict[Tuple[str, int], Tuple[object, asyncio.Lock]] = {}
_fetch_memo: Dict[Tuple[str, int], Tuple[float, HistoryData]] = {}


def _lock_for(key: Tuple[str, int]) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    entry = _fetch_locks.get(key)
    if entry is None or entry[0] is not loop:
        entry = (loop, asyncio.Lock())
        _fetch_locks[key] = entry
    return entry[1]


def clear_market_history_memo() -> None:
    """Test/refresh hook: drop the 30s process memo and per-key locks."""
    _fetch_memo.clear()
    _fetch_locks.clear()


async def fetch_market_history(
    market: str, years: int, force: bool = False
) -> HistoryData:
    """Fetch one market's sector proxies with bounded, single-flight work.

    Eleven symbols are fetched concurrently but never more than
    ``MAX_FETCH_CONCURRENCY`` at once. Concurrent callers for the same
    ``(market, years)`` share one fetch via a process lock + short memo;
    ``force`` bypasses the memo and is used by the endpoint's explicit
    refresh.
    """
    if market not in DESCRIPTORS_BY_MARKET:
        raise ValueError(f"Unknown market: {market}")

    key = (market, years)
    if not force:
        memo = _fetch_memo.get(key)
        if memo is not None and time.monotonic() - memo[0] <= HISTORY_MEMO_TTL_SECONDS:
            return memo[1]

    async with _lock_for(key):
        if not force:
            memo = _fetch_memo.get(key)
            if (
                memo is not None
                and time.monotonic() - memo[0] <= HISTORY_MEMO_TTL_SECONDS
            ):
                return memo[1]

        data = (
            await _fetch_india_history(years)
            if market == "india"
            else await _fetch_us_history(years)
        )
        _fetch_memo[key] = (time.monotonic(), data)
        return data


def source_summary(market: str, sources: Dict[str, str]) -> str:
    """Human-readable provenance summary for the history payload."""
    descriptors = DESCRIPTORS_BY_MARKET.get(market, ())
    total = len(descriptors)
    present = len(sources)
    values = [str(value).strip().lower() for value in sources.values()]
    upstox = values.count("upstox")
    yfinance = values.count("yfinance")

    if market == "india":
        parts = []
        if upstox:
            parts.append(f"Upstox NIFTY sector indices ({upstox})")
        if yfinance:
            parts.append(f"yfinance fallback ({yfinance})")
        text = " + ".join(parts) or "NIFTY sector indices"
    else:
        text = f"yfinance US sector ETFs ({yfinance or present})"

    missing = total - present
    if missing > 0:
        text += f"; {missing} unavailable"
    return text
