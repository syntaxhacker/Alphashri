"""Indicator divergence report — correctness evidence for the shared adapter.

Compares every canonical indicator exposed by ``trading.indicators`` against the
TA-Lib oracle on a real OHLCV dataset (or the committed fixture), and reports for
each: max/mean absolute delta and the threshold signal-flip rate.

Usage:
    source .venv/bin/activate
    python scripts/indicator_divergence_report.py [path/to/ohlcv.pkl|csv]

TA-Lib is a dev/test-only dependency; this script is not imported at runtime.
"""
from __future__ import annotations

import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import talib

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from trading.indicators import adx, atr, ema, rsi  # noqa: E402

DEFAULT = REPO / "experiments" / "data" / "b15m_2025_ADANIPORTS.pkl"


def load(path: Path) -> pd.DataFrame:
    if path.suffix == ".pkl":
        df = pickle.load(open(path, "rb"))
    else:
        df = pd.read_csv(path, index_col=0, parse_dates=True)
    return df.dropna()[["high", "low", "close"]]


def delta(ours, ref, skip=30):
    a = np.asarray(ours, dtype=float)[skip:]
    b = np.asarray(ref, dtype=float)[skip:]
    m = ~(np.isnan(a) | np.isnan(b))
    d = np.abs(a[m] - b[m])
    return float(d.max()), float(d.mean())


def flip_rate(ours, ref, threshold, skip=30):
    a = (np.asarray(ours, float) > threshold)[skip:]
    b = (np.asarray(ref, float) > threshold)[skip:]
    m = ~(np.isnan(np.asarray(ours, float)[skip:]) | np.isnan(np.asarray(ref, float)[skip:]))
    return float(np.mean(a[m] != b[m]) * 100)


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    df = load(path)
    h, l, c = df["high"], df["low"], df["close"]
    c_np, h_np, l_np = c.values, h.values, l.values
    print(f"dataset: {path.name}  bars={len(df)}\n")
    print(f"{'indicator':10} {'maxΔ':>10} {'meanΔ':>10}  {'flip%':>7}")
    print("-" * 42)

    mx, mean = delta(ema(c, 21, full=True), talib.EMA(c_np, 21))
    print(f"{'EMA(21)':10} {mx:10.5f} {mean:10.6f} {'-':>7}")

    mx, mean = delta(rsi(c, 14, full=True), talib.RSI(c_np, 14))
    print(f"{'RSI(14)':10} {mx:10.5f} {mean:10.6f} {flip_rate(rsi(c, 14, full=True), talib.RSI(c_np, 14), 70):6.1f}%")

    mx, mean = delta(adx(h, l, c, 14, full=True), talib.ADX(h_np, l_np, c_np, 14))
    print(f"{'ADX(14)':10} {mx:10.5f} {mean:10.6f} {flip_rate(adx(h, l, c, 14, full=True), talib.ADX(h_np, l_np, c_np, 14), 25):6.1f}%")

    mx, mean = delta(atr(h, l, c, 14, full=True), talib.ATR(h_np, l_np, c_np, 14))
    print(f"{'ATR(14)':10} {mx:10.5f} {mean:10.6f} {'-':>7}")


if __name__ == "__main__":
    main()
