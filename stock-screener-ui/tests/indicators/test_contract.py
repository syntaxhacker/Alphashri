"""Adapter input/output contract tests (Series in -> Series out, list in -> float/list)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from trading.indicators import adx, adx_di, atr, atr_pct, ema, rsi, sma

CLOSES = [float(x) for x in (100 + np.sin(np.arange(80) / 5) * 5 + np.arange(80) / 10)]
HIGH = [c + 1 for c in CLOSES]
LOW = [c - 1 for c in CLOSES]


def test_list_input_returns_latest_float():
    v = rsi(CLOSES, 14)
    assert isinstance(v, float)
    assert 0.0 <= v <= 100.0


def test_full_list_input_returns_aligned_list_with_none_warmup():
    out = rsi(CLOSES, 14, full=True)
    assert isinstance(out, list)
    assert len(out) == len(CLOSES)
    assert out[0] is None  # warm-up
    assert any(x is not None for x in out[len(CLOSES) // 2:])


def test_series_input_returns_series_same_index():
    s = pd.Series(CLOSES, index=pd.date_range("2025-01-01", periods=len(CLOSES), freq="D"))
    out = ema(s, 21)
    assert isinstance(out, pd.Series)
    assert out.index.equals(s.index)


def test_sma_and_ema_list_contract():
    assert isinstance(sma(CLOSES, 10), float)
    assert isinstance(ema(CLOSES, 10), float)


def test_atr_and_atr_pct():
    assert isinstance(atr(HIGH, LOW, CLOSES, 14), float)
    assert atr_pct(HIGH, LOW, CLOSES, 14) >= 0.0


def test_adx_list_contract_and_dict():
    assert isinstance(adx(HIGH, LOW, CLOSES, 14), float)
    d = adx_di(HIGH, LOW, CLOSES, 14)
    assert set(d) == {"adx", "di_plus", "di_minus"}
    assert all(isinstance(v, float) for v in d.values())


def test_short_input_is_safe():
    assert rsi([100.0, 101.0], 14) == 0.0
    assert adx_di([1.0, 2.0], [1.0, 2.0], [1.0, 2.0], 14) == {"adx": 0.0, "di_plus": 0.0, "di_minus": 0.0}
    assert atr_pct([], [], [], 14) == 0.0
