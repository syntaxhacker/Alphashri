#!/usr/bin/env python3
"""Autoresearch on Indian cash equities — vectorbt, scored on TRAIN only.

Levers: lookback, top-N, rebalance frequency, NIFTY 200-DMA market filter,
vol-adjusted momentum, Donchian/EMA parameters. Test is read once for the best
train config.

Run:
    .venv/bin/python scripts/stock_autoresearch.py
"""

from __future__ import annotations

import glob
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import vectorbt as vbt
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "experiments" / "data" / "stock_daily_panel.pkl"
OUT = ROOT / "reports" / "STOCK_MOMENTUM"
OUT.mkdir(parents=True, exist_ok=True)
COST = 0.0025
SPLIT = "2025-10-01"


def load_panel():
    if CACHE.exists():
        d = pd.read_pickle(CACHE)
        return d["close"], d["vol"], d["nifty"]
    syms = sorted(Path(p).stem.replace("b15m_2025_", "")
                  for p in glob.glob(str(ROOT / "experiments" / "data" / "b15m_2025_*.pkl")))
    tickers = [s + ".NS" for s in syms]
    raw = yf.download(tickers, period="2y", interval="1d", group_by="ticker",
                      auto_adjust=False, progress=False, threads=True)
    close, vol = {}, {}
    for s, t in zip(syms, tickers):
        try:
            df = raw[t]
        except Exception:
            continue
        if df.empty or "Close" not in df:
            continue
        close[s] = df["Close"]; vol[s] = df["Volume"]
    c = pd.DataFrame(close).sort_index().dropna(how="all").ffill()
    v = pd.DataFrame(vol).sort_index()
    n = yf.download("^NSEI", period="5y", interval="1d", auto_adjust=False, progress=False)
    nifty = n["Close"].squeeze() if isinstance(n.columns, pd.MultiIndex) else n["Close"]
    nifty = nifty.dropna()
    pd.to_pickle({"close": c, "vol": v, "nifty": nifty}, CACHE)
    return c, v, nifty


def mkt(nifty, c, use):
    if not use:
        return pd.Series(True, index=c.index)
    return (nifty > nifty.rolling(200).mean()).reindex(c.index).ffill().fillna(False)


def score(pf, start, end):
    rec = pf.trades.records_readable
    if rec is None or rec.empty:
        return {"n": 0, "win": 0, "net": 0.0, "pf": 0.0, "dd": 0.0}
    ts = pd.to_datetime(rec["Entry Timestamp"])
    mask = pd.Series(True, index=rec.index)
    if start:
        mask &= ts >= pd.Timestamp(start)
    if end:
        mask &= ts < pd.Timestamp(end)
    rec = rec[mask]
    pnl = rec["PnL"].astype(float)
    w = pnl[pnl > 0]; l = -pnl[pnl < 0]
    eq = pnl.cumsum()
    return {"n": len(pnl), "win": int((pnl > 0).sum()), "net": float(pnl.sum()),
            "pf": float(w.sum() / l.sum()) if l.sum() else 0.0,
            "dd": float((eq - eq.cummax()).min()) if len(eq) else 0.0}


def csm(c, nifty, lookback, top_n, rebal, use_mkt, vol_adj, v):
    ret = c.pct_change(lookback)
    if vol_adj:
        ret = ret / c.pct_change().rolling(lookback).std()
    freq = "W-FRI" if rebal == "W" else "ME"
    r = ret.resample(freq).last()
    rank = r.rank(axis=1, ascending=False)
    w = (rank <= top_n).astype(float)
    m = mkt(nifty, c, use_mkt).resample(freq).last().reindex(r.index).fillna(False)
    w = w.mul(m, axis=0)
    w = w.div(w.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    w = w.reindex(c.index, method="ffill").fillna(0.0)
    return vbt.Portfolio.from_orders(c, size=w, size_type="targetpercent", fees=COST,
                                     freq="1D", init_cash=100000, cash_sharing=True, group_by=True)


def donchian(c, nifty, entry, exit_, trend, use_mkt):
    hi = c.rolling(entry).max().shift(1)
    lo = c.rolling(exit_).min().shift(1)
    sma = c.rolling(trend).mean()
    e = (c > hi) & (c > sma)
    m = mkt(nifty, c, use_mkt)
    e = e.mul(m, axis=0).astype(bool)
    x = c < lo
    return vbt.Portfolio.from_signals(c, e, x, fees=COST, freq="1D", init_cash=100000,
                                      size=0.2, size_type="percent", cash_sharing=True, group_by=True)


def ema(c, nifty, fast, slow, use_mkt):
    ef, es = c.ewm(span=fast).mean(), c.ewm(span=slow).mean()
    e = (ef > es) & (ef.shift(1) <= es.shift(1))
    e = e.mul(mkt(nifty, c, use_mkt), axis=0).astype(bool)
    x = (ef < es) & (ef.shift(1) >= es.shift(1))
    return vbt.Portfolio.from_signals(c, e, x, fees=COST, freq="1D", init_cash=100000,
                                      size=0.2, size_type="percent", cash_sharing=True, group_by=True)


def main():
    c, v, nifty = load_panel()
    print(f"panel {c.shape[0]}d × {c.shape[1]} stocks · {c.index.min().date()} → {c.index.max().date()}", flush=True)
    configs = []
    for lb in (20, 60, 120):
        for top in (5, 10):
            for rebal in ("W", "M"):
                for use_mkt in (False, True):
                    for vol_adj in (False, True):
                        configs.append(("CSM", dict(lookback=lb, top_n=top, rebal=rebal,
                                                    use_mkt=use_mkt, vol_adj=vol_adj)))
    for entry in (20, 50):
        for exit_ in (10, 20):
            for trend in (50, 200):
                for use_mkt in (False, True):
                    configs.append(("DON", dict(entry=entry, exit_=exit_, trend=trend, use_mkt=use_mkt)))
    for fast, slow in ((20, 50), (50, 200)):
        for use_mkt in (False, True):
            configs.append(("EMA", dict(fast=fast, slow=slow, use_mkt=use_mkt)))

    rows = []
    for i, (kind, kw) in enumerate(configs, 1):
        try:
            if kind == "CSM":
                pf = csm(c, nifty, kw["lookback"], kw["top_n"], kw["rebal"], kw["use_mkt"], kw["vol_adj"], v)
            elif kind == "DON":
                pf = donchian(c, nifty, kw["entry"], kw["exit_"], kw["trend"], kw["use_mkt"])
            else:
                pf = ema(c, nifty, kw["fast"], kw["slow"], kw["use_mkt"])
        except Exception as e:
            print(f"{i:2d} {kind} {kw} ERR {e}", flush=True)
            continue
        a = score(pf, None, SPLIT)
        b = score(pf, SPLIT, None)
        rows.append((kind, kw, a, b))
        print(f"{i:2d} {kind:3s} {str(kw):62s} TR n={a['n']:4d} PF={a['pf']:5.2f} | TE n={b['n']:4d} PF={b['pf']:5.2f} net={b['net']:+8.0f}", flush=True)

    ok = [r for r in rows if r[2]["pf"] >= 1.0 and r[2]["n"] >= 30]
    ok.sort(key=lambda r: r[2]["pf"], reverse=True)
    print("\n=== top by TRAIN PF (n>=30) ===")
    for kind, kw, a, b in ok[:8]:
        print(f"{kind:3s} {str(kw):62s} TR PF={a['pf']:5.2f} n={a['n']:4d} | TE PF={b['pf']:5.2f} n={b['n']:4d} net={b['net']:+8.0f}")

    with (OUT / "autoresearch.jsonl").open("w") as f:
        for kind, kw, a, b in rows:
            f.write(json.dumps({"kind": kind, "config": kw, "train": a, "test": b}) + "\n")


if __name__ == "__main__":
    main()
