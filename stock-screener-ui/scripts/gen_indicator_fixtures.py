"""Regenerate golden indicator fixtures from TA-Lib (the oracle).

Run once in a dev env with TA-Lib installed, then commit the outputs:

    source .venv/bin/activate && python scripts/gen_indicator_fixtures.py

CI never needs TA-Lib: tests compare our adapter against the committed fixtures.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import talib

FIX = Path(__file__).resolve().parents[1] / "tests" / "indicators" / "fixtures"
N = 400


def build_ohlcv() -> pd.DataFrame:
    """Deterministic pseudo-market OHLCV (reproducible across machines)."""
    rng = np.random.default_rng(20260101)
    ret = rng.normal(0, 0.004, N)
    close = 1000.0 * np.cumprod(1 + ret)
    high = close * (1 + np.abs(rng.normal(0, 0.002, N)))
    low = close * (1 - np.abs(rng.normal(0, 0.002, N)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    volume = rng.integers(1_000, 50_000, N).astype(float)
    idx = pd.date_range("2025-01-01 09:15", periods=N, freq="15min")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


def main() -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    df = build_ohlcv()
    h, l, c = df["high"].values, df["low"].values, df["close"].values

    def tail(series, k=120):
        return [None if np.isnan(v) else round(float(v), 6) for v in series[-k:]]

    expected = {
        "n": N,
        "tail": 120,
        "ema_21": tail(talib.EMA(c, 21)),
        "rsi_14": tail(talib.RSI(c, 14)),
        "adx_14": tail(talib.ADX(h, l, c, 14)),
        "atr_14": tail(talib.ATR(h, l, c, 14)),
        "adx_di_latest": {
            "adx": round(float(talib.ADX(h, l, c, 14)[-1]), 4),
            "di_plus": round(float(talib.PLUS_DI(h, l, c, 14)[-1]), 4),
            "di_minus": round(float(talib.MINUS_DI(h, l, c, 14)[-1]), 4),
        },
    }

    df.to_csv(FIX / "ohlcv.csv")
    (FIX / "expected.json").write_text(json.dumps(expected, indent=2))
    print(f"wrote {FIX/'ohlcv.csv'} and {FIX/'expected.json'} ({N} bars)")


if __name__ == "__main__":
    main()
