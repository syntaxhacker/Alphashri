#!/usr/bin/env python3
"""Simple screen: stocks that broke out of a multi-week consolidation THIS WEEK.

No backtest. For each stock:
  - consolidation: the prior 20 sessions' high-low range <= 12%
  - breakout: a close in the last 5 sessions above that 20-day high
  - confirmation: volume > 1.5x the 20-day average, close above the 50-DMA
Output: symbol, breakout date, consolidation range, volume ratio, % above level.

Run:
    .venv/bin/python scripts/breakout_screen.py
"""

from __future__ import annotations

import glob
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
LOOKBACK = 20          # consolidation window (sessions)
MAX_RANGE = 0.12       # consolidation range <= 12%
VOL_MULT = 1.5
LAST_N = 5             # "this week"


def universe() -> list[str]:
    return sorted(Path(p).stem.replace("b15m_2025_", "")
                  for p in glob.glob(str(ROOT / "experiments" / "data" / "b15m_2025_*.pkl")))


def main():
    syms = universe()
    tickers = [s + ".NS" for s in syms]
    raw = yf.download(tickers, period="1y", interval="1d", group_by="ticker",
                      auto_adjust=False, progress=False, threads=True)
    rows = []
    for s, t in zip(syms, tickers):
        try:
            df = raw[t].dropna()
        except Exception:
            continue
        if len(df) < 60:
            continue
        high, low, close, vol = df["High"], df["Low"], df["Close"], df["Volume"]
        ph = high.rolling(LOOKBACK).max().shift(1)
        pl = low.rolling(LOOKBACK).min().shift(1)
        rng = (ph - pl) / pl
        v20 = vol.rolling(LOOKBACK).mean().shift(1)
        sma50 = close.rolling(50).mean()
        recent = df.iloc[-LAST_N:]
        for dt, r in recent.iterrows():
            i = df.index.get_loc(dt)
            if i < LOOKBACK + 2:
                continue
            if (r["Close"] > ph.iloc[i] and r["Volume"] > VOL_MULT * v20.iloc[i]
                    and rng.iloc[i] <= MAX_RANGE and r["Close"] > sma50.iloc[i]):
                rows.append({
                    "symbol": s, "date": dt.strftime("%Y-%m-%d"),
                    "close": round(float(r["Close"]), 1),
                    "breakout_lvl": round(float(ph.iloc[i]), 1),
                    "above_%": round((r["Close"] / ph.iloc[i] - 1) * 100, 1),
                    "cons_range_%": round(float(rng.iloc[i]) * 100, 1),
                    "cons_low": round(float(pl.iloc[i]), 1),
                    "stop_%": round((r["Close"] / pl.iloc[i] - 1) * 100, 1),
                    "vol_x": round(float(r["Volume"] / v20.iloc[i]), 1),
                    "1w_%": round((r["Close"] / df["Close"].iloc[i - 5] - 1) * 100, 1),
                    "1m_%": round((r["Close"] / df["Close"].iloc[i - 21] - 1) * 100, 1),
                })
                break  # first breakout day only
    out = pd.DataFrame(rows)
    if out.empty:
        print("No breakouts in the last 5 sessions.")
        return
    out = out.sort_values(["vol_x", "above_%"], ascending=False)
    print(out.to_string(index=False))


if __name__ == "__main__":
    main()
