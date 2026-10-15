"""Golden parity tests: our adapter must match the TA-Lib oracle fixtures.

TA-Lib is NOT required to run these — expected values are committed under
``fixtures/expected.json`` (regenerate with ``scripts/gen_indicator_fixtures.py``).

Tolerances reflect known pandas-ta <-> TA-Lib implementation deltas: both use
Wilder smoothing, but RSI can spike near the 0/100 bounds and ADX differs in the
DI warm-up handling.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from trading.indicators import adx, adx_di, atr, ema, rsi

FIX = Path(__file__).parent / "fixtures"


def _load():
    df = pd.read_csv(FIX / "ohlcv.csv", index_col=0, parse_dates=True)
    exp = json.loads((FIX / "expected.json").read_text())
    return df, exp


def _tail(series, k):
    return np.asarray(series[-k:], dtype=float)


def _delta(ours, ref):
    a, b = _tail(ours, len(ref)), np.asarray(ref, dtype=float)
    m = ~(np.isnan(a) | np.isnan(b))
    d = np.abs(a[m] - b[m])
    return d.max(), d.mean(), int(m.sum())


DF, EXP = _load()
TAIL = EXP["tail"]


# ---- exact-ish (EMA / ATR) -------------------------------------------------
def test_ema_matches_oracle():
    mx, mean, _ = _delta(ema(DF["close"], 21, full=True), EXP["ema_21"])
    assert mx < 1e-3, f"EMA maxΔ {mx}"


def test_atr_matches_oracle():
    mx, mean, _ = _delta(atr(DF["high"], DF["low"], DF["close"], 14, full=True), EXP["atr_14"])
    assert mx < 0.05, f"ATR maxΔ {mx}"


# ---- bounded-oscillator parity (RSI / ADX) ---------------------------------
def test_rsi_matches_oracle():
    _, mean, n = _delta(rsi(DF["close"], 14, full=True), EXP["rsi_14"])
    assert n > TAIL - 20
    assert mean < 0.1, f"RSI meanΔ {mean}"


def test_adx_matches_oracle():
    _, mean, n = _delta(adx(DF["high"], DF["low"], DF["close"], 14, full=True), EXP["adx_14"])
    assert n > TAIL - 20
    assert mean < 0.1, f"ADX meanΔ {mean}"


def test_adx_di_latest_matches_oracle():
    got = adx_di(DF["high"], DF["low"], DF["close"], 14)
    exp = EXP["adx_di_latest"]
    assert abs(got["adx"] - exp["adx"]) < 0.2
    assert abs(got["di_plus"] - exp["di_plus"]) < 0.2
    assert abs(got["di_minus"] - exp["di_minus"]) < 0.2
