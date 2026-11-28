"""Parity guards for the final LOW/MEDIUM constant consolidations.

The ATR period and USA exchange allowlist must resolve to the same canonical
objects used by ``trading.indicators`` and ``api.tv.columns``; a fork that
restates either literal silently drifts on the next default change.
"""
from __future__ import annotations

import inspect

import api.tv.columns as tv_columns
from chart_patterns import levels
from market_levels.detectors import trendline
from scripts.market import screens
from trading import indicators


class TestAtrPeriodSingleSource:
    def test_canonical_default_is_unchanged(self):
        assert indicators.DEFAULT_ATR_PERIOD == 14

    def test_atr_default_uses_canonical(self):
        default = inspect.signature(indicators.atr).parameters["period"].default
        assert default is indicators.DEFAULT_ATR_PERIOD

    def test_levels_aliases_canonical(self):
        assert levels.ATR_PERIOD is indicators.DEFAULT_ATR_PERIOD

    def test_trendline_aliases_canonical(self):
        assert trendline.ATR_PERIOD is indicators.DEFAULT_ATR_PERIOD


class TestUsaExchangesSingleSource:
    def test_canonical_set_is_unchanged(self):
        assert tv_columns.USA_EXCHANGES == {"NASDAQ", "NYSE", "AMEX"}

    def test_screens_aliases_canonical(self):
        assert screens.USA_EXCHANGES is tv_columns.USA_EXCHANGES
