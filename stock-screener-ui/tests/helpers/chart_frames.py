"""Synthetic OHLCV frames shared by chart-pattern detector tests."""
from __future__ import annotations

import numpy as np
import pandas as pd

INDEX = pd.date_range("2024-01-01", periods=400, freq="D", tz="UTC")


def frame(closes, spread: float = 0.5) -> pd.DataFrame:
    close = np.asarray(closes, dtype=float)
    n = len(close)
    return pd.DataFrame(
        {
            "open": np.concatenate([[close[0]], close[:-1]]),
            "high": close + spread,
            "low": close - spread,
            "close": close,
            "volume": np.full(n, 1000.0),
        },
        index=INDEX[:n],
    )
