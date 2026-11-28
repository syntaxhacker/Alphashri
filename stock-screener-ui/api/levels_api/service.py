"""LevelBook build + JSON projection for the additive /api/levels endpoint.

Read-only and additive by contract: this module only wraps the existing
``market_levels.build_level_book`` service. It never re-implements S/R or
trendline math and never reads or rewrites the 52W screener columns, the
original chart S/R (``chart_patterns.levels``), or any other consumer output.

Candles come through ``chart_patterns.candles.fetch_for_timeframe`` so the
endpoint shares the same cache/session semantics as the chart instead of
recomputing anything.
"""

from __future__ import annotations

from typing import Any, Optional

from market_levels import Level, LevelBook, build_level_book

OHLC_COLUMNS = ("open", "high", "low", "close")


def _ist_date(value: Any) -> Optional[str]:
    """Format a timestamp's IST calendar date (the URL never leaks UTC dates)."""
    import config

    ts = value
    if hasattr(ts, "to_pydatetime"):
        ts = ts.to_pydatetime()
    if getattr(ts, "tzinfo", None) is not None:
        ts = ts.astimezone(config.IST)
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%d")
    return str(ts)[:10] if ts is not None else None


def serialize_level(level: Level) -> dict[str, Any]:
    """Project one frozen ``Level`` onto a flat, JSON-safe dict.

    Every geometry field is emitted (``None`` when not applicable) so the
    consumer can render horizontal / zone / segment levels uniformly.
    ``evidence`` is copied (never mutated) to keep provenance immutable.
    """
    return {
        "id": level.id,
        "symbol": level.symbol,
        "timeframe": level.timeframe,
        "as_of": level.as_of,
        "kind": level.kind,
        "source": level.source,
        "geometry": level.geometry,
        "side": level.side,
        "strength": level.strength,
        "touches": level.touches,
        "price": level.price,
        "bottom": level.bottom,
        "top": level.top,
        "start_price": level.start_price,
        "end_price": level.end_price,
        "start_as_of": level.start_as_of,
        "end_as_of": level.end_as_of,
        "evidence": dict(level.evidence),
        "detector_version": level.detector_version,
        "schema_version": level.schema_version,
    }


def project_book(book: LevelBook, *, candle_count: int) -> dict[str, Any]:
    """Project a fused ``LevelBook`` onto the public response shape."""
    sources: list[str] = []
    for level in book.levels:
        if level.source not in sources:
            sources.append(level.source)
    return {
        "schema_version": book.schema_version,
        "symbol": book.symbol,
        "timeframe": book.timeframe,
        "as_of": book.as_of,
        "spot": book.spot,
        "candle_count": candle_count,
        "sources": sources,
        "levels": [serialize_level(level) for level in book.levels],
    }


def build_levels_payload(
    symbol: str,
    timeframe: str = "1D",
    *,
    lookback_bars: Optional[int] = None,
    api_client=None,
) -> Optional[dict[str, Any]]:
    """Build and project a LevelBook for ``symbol``, or ``None`` on no data.

    ``lookback_bars`` limits the candle window passed to the detectors (the
    S/R and trendline lanes default to their own 400-bar lookback when unset).
    Returns a JSON-safe dict; ``None`` means candles could not be fetched or
    the frame lacked OHLC columns.
    """
    from chart_patterns.candles import fetch_for_timeframe

    df = fetch_for_timeframe(
        symbol=symbol,
        tf_id=timeframe,
        lookback_bars=lookback_bars,
        api_client=api_client,
        include_partial_today=False,
    )
    if df is None or df.empty:
        return None
    frame = df.tail(lookback_bars) if lookback_bars else df
    if not set(OHLC_COLUMNS).issubset(set(frame.columns)):
        return None

    spot = float(frame["close"].iloc[-1])
    as_of = _ist_date(frame.index[-1]) or str(frame.index[-1])[:10]

    book = build_level_book(
        symbol=symbol,
        timeframe=timeframe,
        as_of=as_of,
        candles=frame,
        spot=spot,
    )
    return project_book(book, candle_count=len(frame))