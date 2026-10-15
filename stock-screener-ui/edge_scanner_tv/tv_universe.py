"""Universe + snapshot queries via the tradingview_screener lib.

Same call shapes this repo already uses:
- liquid-universe scan: scanners/trending_upside.py::_build_query
- targeted enrichment: api/screener_api/screener_52w.py::_enrich_with_tv_scanner_data
  (batched set_tickers, BATCH_SIZE=80, iloc-first row parsing for the
  duplicate-'ticker'-column quirk).
"""
from __future__ import annotations

import logging

from .markets import MarketSpec, normalize_symbol, strip_tv_prefix

log = logging.getLogger(__name__)

TICKER_BATCH_SIZE = 80  # TV returns empty responses for oversized set_tickers lists

UNIVERSE_COLUMNS = [
    "name", "close", "open", "high", "low", "change", "volume",
    "RSI", "ADX", "ATR", "EMA20", "EMA50", "SMA50", "SMA200",
    "relative_volume_10d_calc", "market_cap_basic", "sector",
    "price_52_week_high", "price_52_week_low", "Perf.W", "gap",
]

SNAPSHOT_COLUMNS = [
    "name", "ticker", "close", "open", "high", "low", "change", "volume",
    "RSI", "ADX", "ATR", "relative_volume_10d_calc", "market_cap_basic",
    "sector", "price_52_week_high", "price_52_week_low", "Perf.W", "gap",
    "premarket_change",
]


def fetch_universe(
    market: MarketSpec,
    limit: int = 100,
    min_price: float = 20.0,
    min_volume: int = 100_000,
    min_mcap: float = 10_000_000_000,
) -> list[dict]:
    """Top-N liquid symbols for a market, ordered by volume desc.

    India is NSE-only: without an exchange filter the same company arrives
    twice (NSE + BSE rows), duplicating every ranking and alert list.
    """
    from tradingview_screener import Query, col

    filters = [
        col("close") > min_price,
        col("volume") > min_volume,
        col("market_cap_basic") > min_mcap,
    ]
    if market.key == "india":
        filters.append(col("exchange") == "NSE")
    q = (
        Query()
        .select(*UNIVERSE_COLUMNS)
        .set_markets(market.tv_market)
        .where(*filters)
        .order_by("volume", ascending=False)
        .limit(limit)
    )
    _, df = q.get_scanner_data()
    if df is None or df.empty:
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for _, row in df.iterrows():
        rec = row.to_dict() if hasattr(row, "to_dict") else dict(row)
        name = str(rec.get("name", "")).strip()
        if not name:
            continue
        rec["symbol"] = normalize_symbol(strip_tv_prefix(name, market))
        if rec["symbol"] in seen:
            continue  # belt-and-braces: same company via two listings
        seen.add(rec["symbol"])
        # Exact exchange-qualified ticker for later set_tickers() calls.
        # US snapshots REQUIRE this form (bare 'AAPL' returns empty); for
        # India it avoids NSE:/BSE: ambiguity.
        rec["tv_ticker"] = str(rec.get("ticker", "") or name).strip()
        out.append(rec)
    return out


def fetch_snapshots(
    symbols: list[str],
    market: MarketSpec,
    tv_tickers: dict[str, str] | None = None,
) -> dict[str, dict]:
    """Targeted snapshot for exact symbols via batched set_tickers.

    Returns {bare_symbol: scanner_row_dict}. Symbols missing from the TV
    response are simply absent (caller treats them as no-data, never as zero).

    tv_tickers optionally maps bare symbol -> exact TV ticker
+    ('NASDAQ:AAPL'). Preferred when known: US set_tickers() requires the
+    exchange-qualified form. Falls back to f'{tv_prefix}{symbol}'.
    """
    from tradingview_screener import Query

    from .markets import normalize_symbol as _norm

    pending = [_norm(s) for s in symbols if s]
    result: dict[str, dict] = {}
    for i in range(0, len(pending), TICKER_BATCH_SIZE):
        batch = pending[i:i + TICKER_BATCH_SIZE]
        tickers = [(tv_tickers or {}).get(s)
                   or (f"{market.tv_prefix}{s}" if market.tv_prefix else s)
                   for s in batch]
        try:
            q = Query().set_tickers(*tickers).select(*SNAPSHOT_COLUMNS)
            _, df = q.get_scanner_data()
        except Exception as exc:
            log.warning("TV snapshot batch failed (%s): %s", market.key, exc)
            continue
        if df is None or df.empty:
            continue
        for _, row in df.iterrows():
            try:
                raw = str(row.iloc[0]).strip() if len(row) > 0 else ""
                if not raw or raw.lower() == "nan":
                    raw = str(row.iloc[1]).strip() if len(row) > 1 else ""
            except Exception:
                raw = str(row.get("ticker", "") or row.get("name", ""))
            bare = _norm(strip_tv_prefix(raw, market))
            if bare:
                result[bare] = row.to_dict() if hasattr(row, "to_dict") else dict(row)
    return result
