"""Shared clients for the market-research scripts (TradingView scanner + options).

Used by:
  - us_earnings.py      earnings prints, surprise %, market reaction, implied moves
  - us_fundamentals.py  valuation / quality / trend panel for US large caps
  - ai_value.py         value screen over the AI complex
  - india_session.py    next-session setup for the Indian market
  - futures_cue.py      global cue snapshot (futures, crude, GIFT Nifty, VIX)

All data comes from TradingView's public scanner endpoints plus Yahoo Finance
options chains. No API keys, no auth, no cookies.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import pandas as pd
import requests

SCANNER_URL = "https://scanner.tradingview.com/{market}/scan"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
}
TIMEOUT = 30

MARKETS = {
    "america": "https://scanner.tradingview.com/america/scan",
    "india": "https://scanner.tradingview.com/india/scan",
    "futures": "https://scanner.tradingview.com/futures/scan",
}

# Columns that are strings (never coerced to float)
TEXT_COLUMNS = {"name", "description", "sector", "industry", "exchange", "type", "update_mode"}


def _coerce(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce every non-text column to numeric, leaving NaN where TV returns null."""
    for col in df.columns:
        if col not in TEXT_COLUMNS:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def scan(
    market: str,
    filters: Sequence[dict] | None = None,
    columns: Sequence[str] | None = None,
    sort: str | None = None,
    order: str = "desc",
    limit: int = 500,
    tickers: Iterable[str] | None = None,
) -> pd.DataFrame:
    """Run a TradingView scanner query and return a tidy DataFrame.

    ``filters`` uses the raw TV filter dialect, e.g.
    ``[{"left": "change", "operation": "less", "right": -2}]``.
    Multiple filters are ANDed by the endpoint.
    """
    url = MARKETS.get(market, SCANNER_URL.format(market=market))
    body: dict[str, Any] = {
        "markets": [market],
        "symbols": {"tickers": list(tickers or []), "query": {"types": []}},
        "columns": list(columns or ["name", "description", "close", "change", "volume"]),
        "range": [0, limit],
        "ignore_unknown_fields": True,
    }
    if filters:
        body["filter"] = list(filters)
    if sort:
        body["sort"] = {"sortBy": sort, "sortOrder": order}

    resp = requests.post(url, json=body, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    payload = resp.json()
    rows = [dict(zip(body["columns"], row["d"])) for row in payload.get("data", [])]
    df = pd.DataFrame(rows, columns=list(body["columns"]))
    return _coerce(df)


def add_symbol(df: pd.DataFrame) -> pd.DataFrame:
    """Attach a ``sym`` column (ticker without exchange prefix) to a scanner frame."""
    if "name" in df.columns:
        df = df.assign(sym=df["name"].astype(str).str.split(":").str[-1])
    return df


def scanner_frame(market: str, **kwargs: Any) -> pd.DataFrame:
    """Convenience wrapper: scan() + numeric coercion + ``sym`` column."""
    return add_symbol(scan(market, **kwargs))


@dataclass(frozen=True)
class ImpliedMove:
    """Options-implied move for one earnings event."""

    symbol: str
    price: float
    event_date: dt.date
    expiry: str
    dte: int
    implied_pct: float
    iv_pct: float
    put_call_ratio: float
    strike: float = 0.0
    notes: str = field(default="", compare=False)

    def as_row(self) -> dict[str, Any]:
        return {
            "sym": self.symbol,
            "px": self.price,
            "event": str(self.event_date),
            "expiry": self.expiry,
            "dte": self.dte,
            "implied%": self.implied_pct,
            "IV%": self.iv_pct,
            "PCR": self.put_call_ratio,
        }


def implied_move(symbol: str, event_date: str | dt.date, max_window_days: int = 20) -> ImpliedMove | None:
    """Straddle-implied move for the option expiry that contains ``event_date``.

    Returns ``None`` when the chain is unavailable (bad symbol, no listed options).
    """
    import yfinance as yf  # imported lazily: only the earnings scripts need it

    ev = event_date if isinstance(event_date, dt.date) else dt.date.fromisoformat(str(event_date))
    t = yf.Ticker(symbol)
    px = float(t.fast_info["last_price"])
    candidates: list[tuple[dt.date, str]] = []
    for raw in t.options:
        try:
            exp = dt.datetime.strptime(raw, "%Y-%m-%d").date()
        except ValueError:
            continue
        if ev + dt.timedelta(days=1) <= exp <= ev + dt.timedelta(days=max_window_days):
            candidates.append((exp, raw))
    if not candidates:
        return None
    exp_date, exp_raw = min(candidates)
    chain = t.option_chain(exp_raw)
    calls = chain.calls[(chain.calls["strike"] > px * 0.75) & (chain.calls["strike"] < px * 1.3)]
    puts = chain.puts[(chain.puts["strike"] > px * 0.75) & (chain.puts["strike"] < px * 1.3)]
    if calls.empty or puts.empty:
        return None
    call_row = calls.iloc[(calls["strike"] - px).abs().argsort()[:1]]
    put_row = puts.iloc[(puts["strike"] - px).abs().argsort()[:1]]
    call_px = float(call_row["lastPrice"].iloc[0])
    put_px = float(put_row["lastPrice"].iloc[0])
    if not call_px and not put_px:
        return None
    return ImpliedMove(
        symbol=symbol,
        price=round(px, 2),
        event_date=ev,
        expiry=exp_raw,
        dte=(exp_date - dt.date.today()).days,
        implied_pct=round((call_px + put_px) / px * 100, 2),
        iv_pct=round(float(call_row["impliedVolatility"].iloc[0]) * 100),
        put_call_ratio=round(put_px / call_px, 2) if call_px else float("nan"),
        strike=float(call_row["strike"].iloc[0]),
    )


def earnings_table(symbols: Sequence[str], lookback_days: int = 10) -> pd.DataFrame:
    """Latest earnings event per symbol: date, estimate, reported EPS, surprise %."""
    import yfinance as yf

    cutoff = dt.date.today() - dt.timedelta(days=lookback_days)
    rows: list[dict[str, Any]] = []
    for sym in symbols:
        try:
            ed = yf.Ticker(sym).get_earnings_dates(limit=4)
        except Exception:
            continue
        if ed is None or ed.empty:
            continue
        ed = ed.reset_index()
        ed["_d"] = pd.to_datetime(ed["Earnings Date"], errors="coerce", utc=True).dt.tz_localize(None)
        past = ed[ed["_d"].dt.date <= dt.date.today()].sort_values("_d", ascending=False)
        if past.empty:
            continue
        r = past.iloc[0]
        rows.append(
            {
                "sym": sym,
                "date": str(r["_d"].date()),
                "est": r.get("EPS Estimate"),
                "rep": r.get("Reported EPS"),
                "surp%": r.get("Surprise(%)"),
                "recent": bool(r["_d"].date() >= cutoff),
            }
        )
    return pd.DataFrame(rows)
