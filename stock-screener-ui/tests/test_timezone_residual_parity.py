"""Bit-exact parity for the audit-B1 IST residual consolidation.

Pins the pre-consolidation outputs of the four residual call sites: the
``backtest_routes`` chart-index conversion, the breakout-watch 1m session mask,
the chart-indicator session registry and the ``trading.timezone`` shim. The
sources now take ``config.IST`` (conversions) or ``trading.timezone.TZ_IST``
(zone-name registries); these assertions prove the observable outputs did not
move. Literal values here are the pinned baseline, not new app-layer sources.
"""

from __future__ import annotations

import ast
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

import config
from chart_patterns import candles as candles_mod
from chart_patterns import indicators, watch
from trading import timezone as tz_shim

REPO = Path(__file__).resolve().parents[1]

#: Pinned pre-consolidation registry values (chart_patterns/indicators.py).
PINNED_INDIA_SESSION = "Asia/Kolkata"
PINNED_USA_SESSION = "America/New_York"
PINNED_SESSION_OPENS = {
    "Asia/Kolkata": (9, 15),
    "America/New_York": (9, 30),
}
PINNED_VWAP_DEFAULTS = ("Asia/Kolkata", None)


def test_registry_values_are_bit_identical_and_derive_from_canonical_name():
    assert indicators.MARKET_SESSIONS == {
        "india": PINNED_INDIA_SESSION,
        "usa": PINNED_USA_SESSION,
    }
    assert indicators.SESSION_OPENS == PINNED_SESSION_OPENS
    assert indicators.session_for_market(None) == PINNED_INDIA_SESSION
    assert indicators.session_for_market("india") == PINNED_INDIA_SESSION
    assert indicators.session_for_market("USA") == PINNED_USA_SESSION
    assert indicators.session_for_market("bogus") == PINNED_INDIA_SESSION
    assert indicators.compute_vwap.__defaults__ == PINNED_VWAP_DEFAULTS

    # Identity proves the values are the canonical constant, not restated clones.
    assert tz_shim.TZ_IST == PINNED_INDIA_SESSION
    assert indicators.MARKET_SESSIONS["india"] is tz_shim.TZ_IST
    assert indicators.session_for_market(None) is tz_shim.TZ_IST
    assert PINNED_INDIA_SESSION in indicators.SESSION_OPENS


def test_backtest_conversion_output_is_bit_identical_to_literal_baseline():
    # Pinned: tz_convert('Asia/Kolkata').tz_localize(None) on this UTC frame.
    pinned = [
        pd.Timestamp("2026-11-27 18:30:00"),
        pd.Timestamp("2026-11-29 00:00:00"),
        pd.Timestamp("2026-11-28 14:45:00"),
    ]
    aware = pd.DatetimeIndex(
        ["2026-11-27 13:00:00", "2026-11-28 18:30:00", "2026-11-28 09:15:00"]
    ).tz_localize("UTC")
    converted = aware.tz_convert(config.IST).tz_localize(None)
    assert list(converted) == pinned
    # The old literal produced the same wall clock for every bar.
    assert list(aware.tz_convert(PINNED_INDIA_SESSION).tz_localize(None)) == pinned


def test_backtest_route_conversion_takes_app_config_ist():
    tree = ast.parse((REPO / "api/backtest_routes.py").read_text(encoding="utf-8"))
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "tz_convert"
    ]
    assert len(calls) == 1
    arg = calls[0].args[0]
    assert isinstance(arg, ast.Attribute) and arg.attr == "IST"
    assert isinstance(arg.value, ast.Name) and arg.value.id == "app_config"


def test_watch_conversion_dates_and_volume_mask_are_bit_identical():
    naive = pd.DatetimeIndex(
        ["2026-11-27 13:00:00", "2026-11-28 18:30:00", "2026-11-28 09:15:00"]
    )
    pin_dates = ["2026-11-27", "2026-11-29", "2026-11-28"]
    canonical_dates = [str(d) for d in naive.tz_localize("UTC").tz_convert(config.IST).date]
    assert canonical_dates == pin_dates
    assert [
        str(d) for d in naive.tz_localize("UTC").tz_convert(PINNED_INDIA_SESSION).date
    ] == pin_dates

    aware = naive.tz_localize("UTC")
    assert [str(t) for t in aware.tz_convert(config.IST).tz_localize(None)] == [
        "2026-11-27 18:30:00",
        "2026-11-29 00:00:00",
        "2026-11-28 14:45:00",
    ]
    assert [str(t) for t in aware.tz_convert(PINNED_INDIA_SESSION).tz_localize(None)] == [
        "2026-11-27 18:30:00",
        "2026-11-29 00:00:00",
        "2026-11-28 14:45:00",
    ]


def test_watch_vol_adj_one_matches_literal_baseline(monkeypatch):
    idx = pd.DatetimeIndex(
        [
            "2026-11-27 03:45:00",
            "2026-11-27 03:46:00",
            "2026-11-27 03:47:00",
            "2026-11-27 03:48:00",
            "2026-11-27 03:49:00",
        ]
    )
    df_1m = pd.DataFrame({"volume": [10.0, 20.0, 30.0, 40.0, 50.0]}, index=idx)
    df_1d = pd.DataFrame(
        {"volume": [100.0] * 10},
        index=pd.date_range("2026-11-18", periods=10, freq="D"),
    )

    def fake_fetch(symbol, timeframe):
        return df_1m if timeframe == "1m" else df_1d

    monkeypatch.setattr(candles_mod, "fetch_for_timeframe", fake_fetch)
    now = pd.Timestamp("2026-11-27 10:00", tz=config.IST)

    legacy_idx = idx.tz_localize("UTC").tz_convert(PINNED_INDIA_SESSION)
    legacy_mask = [d == now.date() for d in legacy_idx.date]
    legacy_vol = float(df_1m["volume"][legacy_mask].fillna(0.0).sum())
    legacy_denom = float(df_1d["volume"].tail(10).fillna(0.0).mean()) * watch._vol_adj_session_fraction(now)
    pinned = legacy_vol / legacy_denom

    assert pinned == 12.5
    assert watch._vol_adj_one("TEST", now) == pinned


def test_trading_timezone_shim_matches_config_and_canonical_name():
    assert tz_shim.IST is config.IST
    assert tz_shim.IST.utcoffset(None) == timedelta(hours=5, minutes=30)
    assert ZoneInfo(tz_shim.TZ_IST).utcoffset(datetime(2026, 11, 27)) == config.IST.utcoffset(None)
