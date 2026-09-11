"""Shared replay data sources.

Two families of replay data live behind this module so every engine stops
re-implementing the same loader logic:

* ``load_daily_bars`` — NSE daily OHLCV bars for swing engines (originally
  inlined in ``trading/replay/engines/week52.py``).
* ``load_nq_session`` — NQ tick stream, 1m bars and optional overnight history
  (originally inlined in ``api/poc_nq._load_replay_data``).

The NQ loader imports ``scripts.*`` at call time on purpose so tests can patch
``scripts.nq_ticks.fetch_nq_ticks`` / ``scripts.smc_tick_eval.build_1m_bars``
exactly like the legacy endpoints did.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from config import IST
from market_data.market_data import fetch_candles

# Process-level memo for NSE 1m sessions, keyed ``(SYMBOL, date)``.
_NSE_1M_CACHE: dict[tuple[str, str], list[dict]] = {}


def load_daily_bars(symbol: str, date: str, lookback_days: int = 400, fetch=None) -> list[dict]:
    """Fetch NSE daily bars ending at ``date`` as canonical bar dicts.

    ``fetch`` defaults to :func:`market_data.market_data.fetch_candles` but can
    be injected so existing engines keep their patchable module-level symbol.
    """
    fetch = fetch or fetch_candles
    to_date = date
    from_date = (datetime.fromisoformat(date) - timedelta(days=lookback_days + 260)).strftime("%Y-%m-%d")

    df = fetch(symbol, tf=1440, from_date=from_date, to_date=to_date)
    daily_bars: list[dict] = []
    if df is not None and not df.empty:
        for ts, row in df.iterrows():
            try:
                volume = row["volume"] if "volume" in row else 0
                daily_bars.append({
                    "time": int(ts.timestamp()),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(volume) if volume == volume else 0.0,
                })
            except Exception:
                continue
    return daily_bars


def load_nse_1m(symbol: str, date: str, fetch=None) -> list[dict]:
    """Fetch one NSE session's 1m bars as canonical bar dicts.

    ``fetch`` defaults to :func:`market_data.market_data.fetch_candles` but can
    be injected (or the module-level symbol patched) so replay tests stay
    offline. Results are memoized per ``(SYMBOL, date)`` for the process.
    Returns ``[]`` on None / empty / exception.
    """
    fetch = fetch or fetch_candles
    key = (symbol.upper(), date)
    cached = _NSE_1M_CACHE.get(key)
    if cached is not None:
        return cached

    try:
        df = fetch(symbol.upper(), tf=1, from_date=date, to_date=date, api_client=None)
    except Exception:
        return []

    bars: list[dict] = []
    if df is not None and not df.empty:
        for ts, row in df.iterrows():
            try:
                volume = row["volume"] if "volume" in row else 0
                bars.append({
                    "time": int(ts.timestamp()),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": float(volume) if volume == volume else 0.0,
                })
            except Exception:
                continue

    _NSE_1M_CACHE[key] = bars
    return bars


def load_prev_daily_bar(symbol: str, date: str, fetch=None) -> list[dict]:
    """Return the single daily bar immediately before ``date`` (or ``[]``).

    Reuses :func:`load_daily_bars` with a short lookback so prior-session pivot
    levels can be derived without fetching the full history.
    """
    bars = load_daily_bars(symbol, date, lookback_days=30, fetch=fetch)
    cutoff = datetime.fromisoformat(date).replace(tzinfo=IST).timestamp()
    prior = [b for b in bars if b["time"] < cutoff]
    return prior[-1:] if prior else []


def load_nq_session(date: str, hist_hours: int = 0):
    """Return ``(ticks, bars, hist_bars, basis)`` for an NQ session.

    Ticks are sorted by timestamp; ``bars`` are 1m bars built from them and
    ``hist_bars`` is the optional overnight 1m history window ending at the
    session open.
    """
    from scripts.nq_ticks import fetch_nq_ticks
    from scripts.smc_tick_eval import build_1m_bars

    ticks, basis = fetch_nq_ticks(date)
    ticks = sorted(ticks, key=lambda t: t["timestamp"])  # single order for fills, subs, VWAP
    bars = build_1m_bars(ticks)
    hist_bars = []
    if hist_hours and hist_hours > 0 and bars:
        from scripts.smc_tick_eval import fetch_ticks

        prev = (datetime.fromisoformat(date) - timedelta(days=1)).date().isoformat()
        try:
            pticks = fetch_ticks(prev)
            cut = bars[0]["time"] - hist_hours * 3600
            hist_bars = [b for b in build_1m_bars(pticks) if b["time"] >= cut and b["time"] < bars[0]["time"]]
        except Exception:
            hist_bars = []
    return ticks, bars, hist_bars, basis
