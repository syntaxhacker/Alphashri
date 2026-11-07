#!/usr/bin/env python3
"""Session shape + after-hours move, with the session-pinning bug fixed.

Why this exists: yfinance's 5-minute series with prepost=True contains BOTH
yesterday's post-close bars and today's pre-market bars. Filtering only by
`index.hour >= 16` silently mixes in the PREVIOUS session's after-hours - which
is how the "IBM +5%" / "TSLA +1.5%" after-hours reads went wrong in earlier
notes. This script pins the session date first, then splits regular vs
after-hours.

Usage:
    python scripts/market/session_shape.py --tickers TSLA,IBM,META,LRCX
    python scripts/market/session_shape.py --tickers NQ=F,MES=F --interval 15m
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

import pandas as pd
import yfinance as yf


def analyse(ticker: str, interval: str) -> dict | None:
    h = yf.Ticker(ticker).history(period="3d", interval=interval, auto_adjust=False,
                                  prepost=True).dropna(subset=["Close"])
    if h.empty:
        return None
    # A session is "regular" when it has a bar at/after 15:45 (US cash close 16:00).
    sessions = sorted({d for d in h.index.date
                       if any((h.index.date == d) & (h.index.hour == 15) & (h.index.minute >= 45))})
    if not sessions:
        return None
    session = sessions[-1]
    day = h[h.index.date == session]
    regular = day[day.index.hour < 16]
    after = day[day.index.hour >= 16]
    if regular.empty:
        return None
    close = float(regular["Close"].iloc[-1])
    prev_close = None
    if len(sessions) > 1:
        prev_day = h[h.index.date == sessions[-2]]
        prev_regular = prev_day[prev_day.index.hour < 16]
        if not prev_regular.empty:
            prev_close = float(prev_regular["Close"].iloc[-1])
    out = {
        "ticker": ticker,
        "session": str(session),
        "open": float(regular["Open"].iloc[0]),
        "high": float(regular["High"].max()),
        "low": float(regular["Low"].min()),
        "close": close,
        "day%": (100 * (close / prev_close - 1)) if prev_close else None,
        "off_high%": 100 * (close / float(regular["High"].max()) - 1),
        "bars": len(regular),
        "ah_bars": 0,
        "ah_last": None,
        "ah%": None,
        "ah_low": None,
        "ah_high": None,
    }
    if not after.empty:
        ah_last = float(after["Close"].iloc[-1])
        out.update({
            "ah_bars": len(after),
            "ah_last": ah_last,
            "ah%": 100 * (ah_last / close - 1),
            "ah_low": float(after["Low"].min()),
            "ah_high": float(after["High"].max()),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tickers", required=True, help="comma-separated (futures like NQ=F work too)")
    ap.add_argument("--interval", default="5m", help="5m | 15m (default 5m)")
    args = ap.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    rows = [r for r in (analyse(t, args.interval) for t in tickers) if r]
    if not rows:
        print("no session data", file=sys.stderr)
        return 1
    df = pd.DataFrame(rows)
    pd.set_option("display.width", 240)
    for col in ("day%", "off_high%", "ah%", "ah_low", "ah_high", "ah_last"):
        df[col] = pd.to_numeric(df[col], errors="coerce").round(2)
    print(f"\n=== SESSION SHAPE ({args.interval} bars, session pinned) ===")
    print(df[["ticker", "session", "open", "high", "low", "close", "day%", "off_high%",
              "ah_bars", "ah_last", "ah%", "ah_low", "ah_high"]].to_string(index=False))
    print("\nafter-hours ranges are where whipsaws live: a stock can print +8% and close the")
    print("session -5%. Judge after-hours reaction only after it has settled (1h+).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
