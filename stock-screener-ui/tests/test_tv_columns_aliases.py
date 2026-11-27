"""Canonical field aliases for known TradingView scanner field drift."""

import pytest

from api.tv.columns import (
    FIELD_ALIASES,
    canonical_field,
    canonicalize_fields,
)


def test_alias_map_matches_verified_canonical_fields():
    assert FIELD_ALIASES == {
        "price_book_ratio": "price_book_fq",
        "return_on_equity": "return_on_equity_fq",
        "relative_volume": "relative_volume_10d_calc",
        "dividends_yield_current": "dividend_yield_recent",
    }


@pytest.mark.parametrize("raw,expected", [
    ("price_book_ratio", "price_book_fq"),
    ("return_on_equity", "return_on_equity_fq"),
    ("relative_volume", "relative_volume_10d_calc"),
    ("dividends_yield_current", "dividend_yield_recent"),
])
def test_canonical_field_resolves_known_drift(raw, expected):
    assert canonical_field(raw) == expected


@pytest.mark.parametrize("name", [
    "price_book_fq",
    "return_on_equity_fq",
    "relative_volume_10d_calc",
    "dividend_yield_recent",
    "close",
    "RSI",
    "Recommend.All",
    "unseen_future_field",
])
def test_canonical_and_unknown_fields_pass_through(name):
    assert canonical_field(name) == name


def test_resolver_strips_whitespace_without_lowercasing():
    assert canonical_field("  price_book_ratio\n") == "price_book_fq"
    assert canonical_field("ATR") == "ATR"


def test_canonicalize_fields_preserves_order_and_duplicates():
    fields = ["close", "price_book_ratio", "close", "relative_volume"]

    assert canonicalize_fields(fields) == [
        "close", "price_book_fq", "close", "relative_volume_10d_calc",
    ]
    assert fields == ["close", "price_book_ratio", "close", "relative_volume"]
