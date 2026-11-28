"""Pinned parity numbers for the indicator single-source consolidation.

These values were measured from the forked implementations BEFORE consolidation.
They must stay identical after the forks delegate to ``trading.indicators``.
"""
from __future__ import annotations

import pandas as pd
import pytest

from api.reports_api import nifty_verdicts as nv
from api.reports_api import profitability as pb
from chart_patterns import features as F


RAMP = [100.0 + i for i in range(60)]


class TestReportEmaParity:
    def test_ema_scalar_values(self):
        assert nv.ema(RAMP, 9) == 155.00000000000003
        assert nv.ema(RAMP, 20) == 149.5
        assert nv.ema(RAMP, 50) == 134.50000000000003
        assert nv.ema([1, 2, 3, 4], 3) == 3.0
        assert nv.ema([1.0, 2.0], 3) is None

    def test_ema_series_clean_values(self):
        out = nv.ema_series([float(i) for i in range(1, 31)], 9)
        assert out[:8] == [None] * 8
        assert out[8:12] == [
            5.0, 6.0, 7.000000000000001, 8.000000000000002,
        ]
        assert out[-1] == 26.000000000000007

    def test_ema_series_gap_stays_aligned(self):
        values = [1.0, 2.0, None, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
        assert nv.ema_series(values, 3) == [
            None, None, None,
            2.3333333333333335, 3.666666666666667, 4.833333333333334,
            5.916666666666667, 6.958333333333334, 7.979166666666667,
            8.989583333333334,
        ]


class TestReportRsiParity:
    def test_rsi_pinned_values(self):
        assert nv.rsi_wilder([float(i) for i in range(1, 16)], 14) == 100.0
        assert nv.rsi_wilder([float(i) for i in range(15, 0, -1)], 14) == 0.0
        series = [100.0 + i * 0.37 + (i % 7) for i in range(60)]
        assert nv.rsi_wilder(series, 14) == 59.89616218121838

    def test_rsi_needs_period_plus_one(self):
        assert nv.rsi_wilder([1.0] * 14, 14) is None


class TestProfitabilityEmaParity:
    def test_ema_cross_series_pinned(self):
        closes = [100.0 + i * 0.37 + (i % 7) for i in range(60)]
        e12, e26 = pb._ema_cross_series(closes)
        assert e12[:4] == [
            100.0, 100.21076923076923, 100.59988165680474, 101.13989986345017,
        ]
        assert e12[-3:] == [
            121.82434907922692, 122.07598768242278, 122.49968188512696,
        ]
        assert e26[-3:] == [
            119.39317559194639, 119.69442184439481, 120.07483504110631,
        ]
        assert pb._ema_cross_series([]) == ([], [])


def _atr_frame() -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=5, freq="D", tz="UTC")
    return pd.DataFrame(
        {
            "open": [9.9, 10.0, 10.0, 10.0, 10.0],
            "high": [10.0, 10.2, 10.1, 10.1, 10.1],
            "low": [9.8, 9.9, 9.9, 9.9, 9.9],
            "close": [9.9, 10.0, 10.0, 10.0, 10.0],
            "volume": [100.0] * 5,
        },
        index=idx,
    )


class TestFeatureAtrParity:
    def test_atr_series_pinned(self):
        df = _atr_frame()
        assert F.atr(df, 2).tolist() == pytest.approx([
            0.1999999999999993, 0.2499999999999991, 0.2249999999999992,
            0.21249999999999925, 0.20624999999999927,
        ])
        assert F.atr(df, 14).iloc[-1] == 0.20571897126197347

    def test_atr_value_pinned(self):
        assert F.atr_value(_atr_frame(), 2) == 0.20624999999999927


class TestCanonicalVariantsReproduceForks:
    """The variants own the numbers; the forks above are thin delegators."""

    def test_ema_sma_seed_scalar_and_series(self):
        from trading.indicators import ema_sma_seed

        assert ema_sma_seed(RAMP, 9) == 155.00000000000003
        clean = [float(i) for i in range(1, 31)]
        assert ema_sma_seed(clean, 9, full=True) == nv.ema_series(clean, 9)
        gap = [1.0, 2.0, None, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
        assert ema_sma_seed(gap, 3, full=True) == [
            None, None, None,
            2.3333333333333335, 3.666666666666667, 4.833333333333334,
            5.916666666666667, 6.958333333333334, 7.979166666666667,
            8.989583333333334,
        ]

    def test_ema_first_close(self):
        from trading.indicators import ema_first_close

        closes = [100.0 + i * 0.37 + (i % 7) for i in range(60)]
        assert ema_first_close(closes, 12, full=True) == pb._ema_cross_series(closes)[0]
        assert ema_first_close(closes, 26, full=True)[-1] == 120.07483504110631

    def test_rsi_wilder(self):
        from trading.indicators import rsi_wilder

        series = [100.0 + i * 0.37 + (i % 7) for i in range(60)]
        assert rsi_wilder(series, 14) == 59.89616218121838
        assert rsi_wilder([1.0] * 14, 14) is None

    def test_atr_first_bar(self):
        from trading.indicators import atr_first_bar

        df = _atr_frame()
        out = atr_first_bar(df["high"], df["low"], df["close"], 14, full=True)
        assert out.index.equals(df.index)
        assert out.iloc[-1] == 0.20571897126197347
        assert atr_first_bar([], [], [], 14, full=True) == []
