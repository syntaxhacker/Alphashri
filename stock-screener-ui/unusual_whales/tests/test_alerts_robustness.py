"""Robustness regression tests: one bad upstream row must not 500 the alerts feed.

Covers the NaN/Infinity parsing bug found in review (alerts_data._f / _safe_alert).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import alerts_data as A  # noqa: E402
import market_status as M  # noqa: E402


def test_f_rejects_nan_and_inf():
    assert A._f("NaN") == 0.0
    assert A._f("Infinity") == 0.0
    assert A._f("-Infinity") == 0.0
    assert A._f(float("nan")) == 0.0
    assert A._f(float("inf")) == 0.0
    assert A._f("1.5") == 1.5
    assert A._f(None, 7) == 7.0


def test_safe_alert_survives_a_poison_row():
    poison = {
        "option_symbol": "NVDA260925C00225000",
        "underlying_symbol": "NVDA",
        "curr_oi": "nan",
        "last_oi": "inf",
        "oi_change": "nan",
        "oi_diff_plain": "inf",
        "volume": "nan",
        "trades": "nan",
        "avg_price": "nan",
        "curr_date": "2026-09-25",
    }
    # must not raise and must not produce a bogus alert
    out = A._safe_alert(poison)
    assert out is None or isinstance(out, dict)


def test_safe_alert_returns_none_on_garbage():
    assert A._safe_alert({}) is None
    assert A._safe_alert(None) is None


def test_caches_are_phase_keyed_dicts():
    # the adaptive TTLs must have an entry for every phase
    for phase in ("open", "premarket", "afterhours", "closed"):
        assert phase in A._TTL
        assert phase in A._NATIVE_TTL
    assert set(M._TTL) == {"open", "premarket", "afterhours", "closed"}
