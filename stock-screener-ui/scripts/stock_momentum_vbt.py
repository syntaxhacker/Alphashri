#!/usr/bin/env python3
"""Indian cash equities — momentum / pattern study with vectorbt.

Universe: the 66 liquid NSE names already in experiments/data/b15m_2025_*.pkl.
Data: yfinance daily, 2 years. Costs: 0.25% round trip (delivery).

Strategies:
  A. cross-sectional momentum — long the top-N by 20-day return, weekly rebalance
  B. Donchian breakout — close > 20-day high and > 50-DMA; exit < 10-day low
  C. EMA 20/50 cross

Train = before 2025-10-01, test = after. Also prints this week's "booming" list.

Run:
    .venv/bin/python scripts/stock_momentum_vbt.py
"""

from __future__ import annotations

import glob
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import vectorbt as vbt
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
COST = 0.0025          # 0.25% round trip (delivery: STT + stamp + brokerage + GST)
SPLIT = "2025-10-01"


def universe() -> list[str]:
    syms = sorted(Path(p).stem.replace("b15m_2025_", "")
                  for p in glob.glob(str(ROOT / "experiments" / "data" / "b15m_2025_*.pkl")))
    return syms


def panel(symbols: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    tickers = [s + ".NS" for s in symbols]
    raw = yf.download(tickers, period="2y", interval="1d", group_by="ticker",
                      auto_adjust=False, progress=False, threads=True)
    close, vol = {}, {}
    for s, t in zip(symbols, tickers):
        try:
            df = raw[t]
        except Exception:
            continue
        if df.empty or "Close" not in df:
            continue
        close[s] = df["Close"]
        vol[s] = df["Volume"]
    c = pd.DataFrame(close).sort_index()
    v = pd.DataFrame(vol).sort_index()
    c = c.dropna(how="all").ffill()
    return c, v


def stats_from_trades(pf, label: str, start=None, end=None) -> dict:
    rec = pf.trades.records_readable
    if rec is None or rec.empty:
        return {"label": label, "n": 0, "win": 0, "net": 0.0, "pf": 0.0, "dd": 0.0}
    if start is not None:
        rec = rec[pd.to_datetime(rec["Entry Timestamp"]) >= pd.Timestamp(start)]
    if end is not None:
        rec = rec[pd.to_datetime(rec["Entry Timestamp"]) < pd.Timestamp(end)]
    pnl = rec["PnL"].astype(float)
    fees = (rec.get("Entry Fees", 0).astype(float) + rec.get("Exit Fees", 0).astype(float))
    gross = pnl + fees
    wins = pnl[pnl > 0]
    loss = -pnl[pnl < 0]
    eq = pnl.cumsum()
    dd = (eq - eq.cummax()).min() if len(eq) else 0.0
    return {"label": label, "n": len(pnl), "win": int((pnl > 0).sum()),
            "net": float(pnl.sum()), "gross": float(gross.sum()),
            "fees": float(fees.sum()),
            "pf": float(wins.sum() / loss.sum()) if loss.sum() else 0.0,
            "dd": float(dd)}


def run_csm(c: pd.DataFrame, top_n=10) -> vbt.Portfolio:
    ret = c.pct_change(20)
    # weekly rebalance: rank on the last session of each week
    weekly = ret.resample("W-FRI").last()
    ranks = weekly.rank(axis=1, ascending=False)
    w = (ranks <= top_n).astype(float)
    w = w.div(w.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    w = w.reindex(c.index, method="ffill").fillna(0.0)
    return vbt.Portfolio.from_orders(c, size=w, size_type="targetpercent",
                                     fees=COST, freq="1D", init_cash=100000,
                                     cash_sharing=True, group_by=True)


def run_donchian(c: pd.DataFrame) -> vbt.Portfolio:
    hi = c.rolling(20).max().shift(1)
    lo = c.rolling(10).min().shift(1)
    sma = c.rolling(50).mean()
    entries = (c > hi) & (c > sma)
    exits = c < lo
    return vbt.Portfolio.from_signals(c, entries, exits, fees=COST, freq="1D",
                                      init_cash=100000, size=0.2, size_type="percent",
                                      cash_sharing=True, group_by=True)


def run_ema(c: pd.DataFrame) -> vbt.Portfolio:
    e20 = c.ewm(span=20).mean()
    e50 = c.ewm(span=50).mean()
    entries = (e20 > e50) & (e20.shift(1) <= e50.shift(1))
    exits = (e20 < e50) & (e20.shift(1) >= e50.shift(1))
    return vbt.Portfolio.from_signals(c, entries, exits, fees=COST, freq="1D",
                                      init_cash=100000, size=0.2, size_type="percent",
                                      cash_sharing=True, group_by=True)


def screen(c: pd.DataFrame, v: pd.DataFrame, top_n=12) -> pd.DataFrame:
    last = c.index[-1]
    w1 = c.iloc[-1] / c.iloc[-6] - 1
    m1 = c.iloc[-1] / c.iloc[-21] - 1
    m3 = c.iloc[-1] / c.iloc[-63] - 1
    dma50 = c.rolling(50).mean().iloc[-1]
    vr = (v.iloc[-5:].mean() / v.iloc[-21:].mean())
    out = pd.DataFrame({"1w": w1, "1m": m1, "3m": m3,
                        "above50dma": c.iloc[-1] > dma50, "vol_ratio": vr})
    out = out.dropna()
    out = out[out["above50dma"] & (out["vol_ratio"] > 1.0)]
    out = out.sort_values("1w", ascending=False).head(top_n)
    return out


def main():
    syms = universe()
    print(f"universe {len(syms)} · downloading 2y daily …", flush=True)
    c, v = panel(syms)
    print(f"panel {c.shape[0]} days × {c.shape[1]} stocks · {c.index.min().date()} → {c.index.max().date()}", flush=True)

    books = {
        "CSM top10": run_csm(c, 10),
        "Donchian 20/10": run_donchian(c),
        "EMA 20/50": run_ema(c),
    }
    print(f"\n{'strategy':16s} {'split':6s} {'n':>4s} {'win%':>5s} {'gross':>9s} {'fees':>8s} {'net':>9s} {'PF':>5s} {'DD':>8s}")
    for name, pf in books.items():
        for label, a, b in (("train", None, SPLIT), ("test", SPLIT, None)):
            s = stats_from_trades(pf, name, a, b)
            print(f"{name:16s} {label:6s} {s['n']:4d} {s['win']/max(1,s['n'])*100:4.0f}% "
                  f"{s['gross']:+9.0f} {s['fees']:8.0f} {s['net']:+9.0f} {s['pf']:5.2f} {s['dd']:+8.0f}")

    print("\n=== this week's booming (1w return, above 50-DMA, volume > 1x) ===")
    sc = screen(c, v)
    print(sc.round(3).to_string())


if __name__ == "__main__":
    main()
