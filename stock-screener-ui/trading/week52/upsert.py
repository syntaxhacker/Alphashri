"""Change-only upsert of 52W ranges into the local SQLite table.

Both ingest paths (the Upstox batch script and the release-asset sync) call
this helper so a row is only touched when one of its values actually changed.
"""
from __future__ import annotations

from datetime import datetime

import config
from db.models.stock_52w_touch import Stock52WeekRange


def upsert_52w_ranges(
    session_factory,
    symbols: dict,
    *,
    chunk_size: int = 400,
) -> tuple[int, int]:
    """Change-only upsert of {symbol: {high, low, close[, days_ago]}} into stock_52w_range."""
    if not symbols:
        return 0, 0
    if chunk_size < 1:
        raise ValueError("chunk_size must be positive")

    symbol_list = list(symbols)
    added = 0
    updated = 0
    session = session_factory()
    try:
        for offset in range(0, len(symbol_list), chunk_size):
            chunk = symbol_list[offset : offset + chunk_size]
            existing = {
                row.symbol: row
                for row in session.query(Stock52WeekRange)
                .filter(Stock52WeekRange.symbol.in_(chunk))
                .all()
            }
            now = datetime.now(config.IST).replace(tzinfo=None)
            for symbol in chunk:
                info = symbols[symbol]
                current = existing.get(symbol)
                if current is None:
                    session.add(
                        Stock52WeekRange(
                            symbol=symbol,
                            high_52w=info["high"],
                            low_52w=info["low"],
                            close=info["close"],
                            days_ago=info.get("days_ago"),
                            updated_at=now,
                        )
                    )
                    added += 1
                elif (
                    current.high_52w != info["high"]
                    or current.low_52w != info["low"]
                    or current.close != info["close"]
                    or current.days_ago != info.get("days_ago")
                ):
                    current.high_52w = info["high"]
                    current.low_52w = info["low"]
                    current.close = info["close"]
                    current.days_ago = info.get("days_ago")
                    current.updated_at = now
                    updated += 1
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return added, updated
