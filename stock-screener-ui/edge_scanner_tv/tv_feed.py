"""TradingViewFeed — edge-scanner DataFeed interface over TV scanner + yfinance.

edge-scanner's contract (scanner/data/interface.py), ported 1:1 so any
evaluator written against it keeps working:

    get_historical_daily(symbol, start, end) -> UTC-indexed OHLCV DataFrame
    get_historical_bars(symbol, timeframe, start, end) -> UTC-indexed OHLCV DataFrame
    subscribe_minute_bars(symbols, callback) -> polls snapshots, folds into 1-min bars
    get_snapshot(symbols) -> {symbol: quote_dict}

Data sources:
- universe/snapshot: tradingview_screener (set_markets india/america).
  The lib exposes scanner fields only — no OHLC history endpoint.
- history: yfinance (India mapped to SYMBOL.NS). Normalized to the
  edge-scanner schema: UTC tz-aware index + open/high/low/close/volume/
  vwap/trade_count columns.
- live: snapshot polling. Successive snapshots for one symbol fold into a
  synthetic 1-min bar (close = latest TV close, volume = delta). True
  intra-minute high/low is unknowable here — lower fidelity than a real bar
  websocket, documented in the README.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timezone
from typing import Callable

import pandas as pd

from .markets import MarketSpec, normalize_symbol, to_yf_symbol
from .tv_universe import fetch_snapshots

log = logging.getLogger(__name__)

BAR_COLS = ["open", "high", "low", "close", "volume", "vwap", "trade_count"]

_YF_INTERVALS = {
    "1Min": "1m", "5Min": "5m", "15Min": "15m",
    "30Min": "30m", "1Hour": "60m", "4Hour": "60m",
    "1Week": "1wk", "Day": "1d",
}


def normalize_yf_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize a yfinance OHLC frame to the edge-scanner bar schema."""
    if df is None or df.empty:
        return pd.DataFrame(columns=BAR_COLS)
    # yfinance may return MultiIndex columns for single-ticker downloads.
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    cols = {c.lower(): c for c in df.columns}
    out = pd.DataFrame(index=df.index)
    for key in ("open", "high", "low", "close", "volume"):
        out[key] = df[cols[key]] if key in cols else float("nan")
    out["vwap"] = float("nan")  # yfinance has no VWAP; computed downstream
    out["trade_count"] = float("nan")
    idx = pd.DatetimeIndex(pd.to_datetime(out.index, utc=True))
    try:
        idx = idx.tz_convert("UTC")
    except Exception:
        pass
    out.index = idx
    return out[BAR_COLS]


class TradingViewFeed:
    """DataFeed for one market (india or america)."""

    def __init__(self, market: MarketSpec, history_days: int = 365) -> None:
        self.market = market
        self.history_days = history_days
        self._stop = threading.Event()

    # ── history (yfinance) ──────────────────────────────────────────────

    def _download(self, symbol: str, interval: str, period: str) -> pd.DataFrame:
        import yfinance as yf

        ticker = to_yf_symbol(symbol, self.market)
        df = yf.download(
            ticker, period=period, interval=interval,
            progress=False, auto_adjust=True, prepost=False,
        )
        df = normalize_yf_frame(df)
        if df.empty and ticker != symbol.strip().upper():
            # Cross-market fallback: e.g. SPY on the india server was mapped
            # to SPY.NS (nonexistent). Retry the bare symbol before giving up.
            df = normalize_yf_frame(yf.download(
                symbol.strip().upper(), period=period, interval=interval,
                progress=False, auto_adjust=True, prepost=False,
            ))
        return df

    def get_historical_daily(self, symbol: str, start: date, end: date) -> pd.DataFrame:
        df = self._download(symbol, "1d", f"{max(self.history_days, 30)}d")
        if df.empty:
            return df
        lo = pd.Timestamp(start, tz="UTC")
        hi = pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)
        return df[(df.index >= lo) & (df.index < hi)]

    def get_historical_bars(
        self, symbol: str, timeframe: str, start: date, end: date,
    ) -> pd.DataFrame:
        interval = _YF_INTERVALS.get(timeframe, "5m")
        # yfinance lookback caps: 1m → 7d, 5m/15m/30m → 60d, coarser → 2y.
        if interval == "1m":
            period = "7d"
        elif interval in ("5m", "15m", "30m"):
            period = "60d"
        else:
            period = "2y"
        df = self._download(symbol, interval, period)
        if df.empty:
            return df
        lo = pd.Timestamp(start, tz="UTC")
        hi = pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)
        return df[(df.index >= lo) & (df.index < hi)]

    # ── live 1-min bars (yfinance) ──────────────────────────────────────

    def get_intraday_minute_frames(
        self, symbols: list[str], period: str = "1d",
    ) -> dict[str, pd.DataFrame]:
        """Batch 1-minute yfinance frames keyed by bare symbol (UTC index).

        One `yf.download` call for every symbol keeps the per-poll cost to a
        single round-trip; frames are normalized to the bar schema. yfinance
        1m history is limited to the last ~7 days, which is all a session needs.
        """
        import yfinance as yf

        syms = [normalize_symbol(s) for s in symbols if s]
        if not syms:
            return {}
        ymap = {to_yf_symbol(s, self.market): s for s in syms}
        tickers = list(ymap)
        try:
            data = yf.download(
                tickers, period=period, interval="1m", progress=False,
                auto_adjust=True, prepost=False, group_by="ticker",
                threads=True,
            )
        except Exception as exc:
            log.warning("1m download failed: %s", exc)
            return {}
        out: dict[str, pd.DataFrame] = {}
        if data is None or data.empty:
            return out
        if isinstance(data.columns, pd.MultiIndex):
            lvl0 = list(data.columns.get_level_values(0))
            if any(tk in lvl0 for tk in tickers):
                # (ticker, field) layout from group_by="ticker".
                for tk in tickers:
                    if tk not in lvl0:
                        continue
                    df = normalize_yf_frame(data[tk])
                    if not df.empty:
                        out[ymap[tk]] = df
            elif len(tickers) == 1:
                # (field, ticker) layout for a single ticker.
                df = normalize_yf_frame(data)
                if not df.empty:
                    out[ymap[tickers[0]]] = df
        else:
            df = normalize_yf_frame(data)
            if not df.empty:
                out[ymap[tickers[0]]] = df
        return out

    # ── snapshot (tradingview_screener) ─────────────────────────────────

    def get_snapshot(
        self, symbols: list[str], tv_tickers: dict[str, str] | None = None,
    ) -> dict[str, dict]:
        """Latest TV scanner row keyed by bare symbol."""
        syms = [normalize_symbol(s) for s in symbols if s]
        if not syms:
            return {}
        rows = fetch_snapshots(syms, self.market, tv_tickers=tv_tickers)
        out: dict[str, dict] = {}
        for sym in syms:
            row = rows.get(sym)
            if not row:
                continue
            out[sym] = {
                "symbol": sym,
                "close": _f(row.get("close")),
                "open": _f(row.get("open")),
                "high": _f(row.get("high")),
                "low": _f(row.get("low")),
                "volume": _f(row.get("volume")),
                "change": _f(row.get("change")),
                "rsi": _f(row.get("RSI")),
                "adx": _f(row.get("ADX")),
                "atr": _f(row.get("ATR")),
                "rvol": _f(row.get("relative_volume_10d_calc")),
                "mcap": _f(row.get("market_cap_basic")),
                "sector": row.get("sector") or "-",
                "high_52w": _f(row.get("price_52_week_high")),
                "low_52w": _f(row.get("price_52_week_low")),
                "perf_w": _f(row.get("Perf.W")),
                "gap": _f(row.get("gap")),
                "raw": row,
            }
        return out

    # ── live (snapshot polling → synthetic 1-min bars) ──────────────────

    def subscribe_minute_bars(
        self, symbols: list[str], callback: Callable[[dict], None],
        poll_sec: int = 60,
    ) -> None:
        """Poll snapshots; fold them into synthetic 1-min bars.

        Blocks until stop_stream() is called. Each callback bar carries
        dict(symbol, timestamp, open, high, low, close, volume, vwap)
        matching edge-scanner's bar dict.
        """
        syms = [normalize_symbol(s) for s in symbols if s]
        last_close: dict[str, float] = {}
        last_vol: dict[str, float] = {}
        self._stop.clear()
        while not self._stop.is_set():
            ts = datetime.now(timezone.utc)
            try:
                snaps = self.get_snapshot(syms)
            except Exception as exc:
                log.warning("snapshot poll failed: %s", exc)
                self._stop.wait(poll_sec)
                continue
            for sym, snap in snaps.items():
                close = snap["close"]
                if close <= 0:
                    continue
                prev_close = last_close.get(sym, close)
                vol = snap["volume"]
                dvol = max(0.0, vol - last_vol.get(sym, 0.0)) if vol > 0 else 0.0
                bar = {
                    "symbol": sym,
                    "timestamp": ts,
                    "open": prev_close,
                    "high": max(prev_close, close),
                    "low": min(prev_close, close),
                    "close": close,
                    "volume": dvol,
                    "vwap": close,  # unknown intra-minute; best available proxy
                }
                last_close[sym] = close
                if vol > 0:
                    last_vol[sym] = vol
                try:
                    callback(bar)
                except Exception as exc:
                    log.warning("bar callback failed for %s: %s", sym, exc)
            self._stop.wait(poll_sec)

    def stop_stream(self) -> None:
        self._stop.set()


def subscribe_minute_bars_once(
    feed: TradingViewFeed, symbols: list[str],
    prev: dict[str, float] | None = None,
) -> list[dict]:
    """Single polling round → synthetic bars (used by --watch and tests).

    `prev` maps symbol -> last seen cumulative day volume; when given,
    bars carry delta (period) volume and `prev` is updated in place.
    When None, volume is 0 (NOT cumulative — cumulative day volume would
    break downstream RVOL math).
    """
    bars: list[dict] = []
    ts = datetime.now(timezone.utc)
    for sym, snap in feed.get_snapshot(symbols).items():
        close = snap["close"]
        if close <= 0:
            continue
        if prev is None:
            # No baseline for a delta: emit 0 rather than cumulative volume.
            vol = 0.0
        else:
            cum = snap["volume"]
            dvol = max(0.0, cum - prev.get(sym, 0.0)) if cum > 0 else 0.0
            vol = dvol
            if cum > 0:
                prev[sym] = cum
        bars.append({
            "symbol": sym, "timestamp": ts, "open": close, "high": close,
            "low": close, "close": close, "volume": vol, "vwap": close,
        })
    # Keep network I/O out of tight loops: one round = one snapshot call.
    time.sleep(0)
    return bars


def _f(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        import math
        num = float(value)
        return default if math.isnan(num) else num
    except (TypeError, ValueError):
        return default
