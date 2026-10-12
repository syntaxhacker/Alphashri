"""Tests for the asset-class classifier."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import asset_class as AC  # noqa: E402


def test_index():
    assert AC.classify("SPX") == "index"
    assert AC.classify("spxw") == "index"
    assert AC.classify("NDX") == "index"
    assert AC.classify("RUT") == "index"


def test_etf():
    assert AC.classify("SPY") == "etf"
    assert AC.classify("QQQ") == "etf"
    assert AC.classify("TQQQ") == "etf"
    assert AC.classify("IWM") == "etf"


def test_stock():
    assert AC.classify("NVDA") == "stock"
    assert AC.classify("AAPL") == "stock"
    assert AC.classify("PLTR", "Common Stock") == "stock"


def test_issue_type_overrides_ticker_guess():
    assert AC.classify("XYZ", "Index") == "index"
    assert AC.classify("XYZ", "ETF") == "etf"
    assert AC.classify("SPY", "Common Stock") == "stock"


def test_unknown_ticker_defaults_to_stock():
    assert AC.classify("ZZZZZZ") == "stock"
    assert AC.classify("") == "stock"
