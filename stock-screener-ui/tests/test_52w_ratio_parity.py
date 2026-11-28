"""Characterization pins for the 52W-ratio consolidation.

Every site restates a different sign / denominator / rounding contract. The
canonical ``gap_pct_to_52w_high`` is only one of them, so this file freezes each
site's *current* numbers before any delegation is introduced and asserts that
each canonical variant reproduces them bit-for-bit afterwards.

The numeric pins are deliberately literal float reprs: a reordered operand or
an added round() changes the last ULP and must fail this file.
"""
import importlib
import os

os.environ.setdefault("CI_MODE", "1")

import pytest

from trading.week52.math import (
    gap_pct_from_price_to_52w_high,
    gap_pct_to_52w_high_unrounded,
    pct_from_52w_low,
    position_pct_in_52w_range,
    ratio_gap_pct_from_52w_high,
    rounded_gap_pct_to_52w_high,
    signed_gap_pct_to_52w_high,
)

SAMPLES = [
    (100.0, 95.0),
    (100.0, 110.0),
    (100.0, 100.1),
    (3.0, 1.0),
    (1234.56, 1199.99),
]


class TestVariantBitParity:
    """Each variant must reproduce the verbatim pre-refactor site expression."""

    def test_signed_subtract_form(self):
        for high, price in SAMPLES:
            assert signed_gap_pct_to_52w_high(high, price) == (price - high) / high * 100.0

    def test_signed_ratio_form_is_distinct(self):
        for high, price in SAMPLES:
            assert ratio_gap_pct_from_52w_high(high, price) == (price / high - 1.0) * 100.0
        # The two signed forms are NOT interchangeable: 100/95 is the witness.
        assert signed_gap_pct_to_52w_high(100.0, 95.0) != ratio_gap_pct_from_52w_high(100.0, 95.0)

    def test_from_low(self):
        for _high, price in SAMPLES:
            assert pct_from_52w_low(80.0, price) == (price - 80.0) / 80.0 * 100.0

    def test_position_in_range(self):
        for high, price in SAMPLES:
            assert position_pct_in_52w_range(80.0, high, price) == (
                (price - 80.0) / (high - 80.0) * 100.0
            )

    def test_unrounded_canonical_sign(self):
        for high, price in SAMPLES:
            assert gap_pct_to_52w_high_unrounded(high, price) == ((high - price) / high) * 100.0

    def test_price_denominator(self):
        for high, price in SAMPLES:
            assert gap_pct_from_price_to_52w_high(high, price) == (high - price) / price * 100.0

    def test_rounded_without_input_guard(self):
        for high, price in SAMPLES:
            assert rounded_gap_pct_to_52w_high(high, price) == round(((high - price) / high) * 100, 2)

    def test_rounded_matches_canonical_for_positive_inputs(self):
        from trading.week52.math import gap_pct_to_52w_high

        for high, price in SAMPLES:
            assert rounded_gap_pct_to_52w_high(high, price) == gap_pct_to_52w_high(high, price)
        # Guard differs on purpose: store.py only guards the high, not the close.
        assert rounded_gap_pct_to_52w_high(100.0, 0.0) == 100.0
        assert gap_pct_to_52w_high(100.0, 0.0) is None


class TestDelegation:
    """Fails until every site imports its canonical variant (the consolidation)."""

    @pytest.mark.parametrize(
        "module_name,variant",
        [
            ("api.screener_api.dashboard", "signed_gap_pct_to_52w_high"),
            ("api.screener_api.dashboard", "pct_from_52w_low"),
            ("api.market_screen.snapshot", "signed_gap_pct_to_52w_high"),
            ("api.market_screen.snapshot", "pct_from_52w_low"),
            ("api.market_screen.snapshot", "position_pct_in_52w_range"),
            ("api.value_scan.scoring", "ratio_gap_pct_from_52w_high"),
            ("api.value_scan.router", "signed_gap_pct_to_52w_high"),
            ("chart_patterns.store", "rounded_gap_pct_to_52w_high"),
            ("trading.week52_chaser_signals", "signed_gap_pct_to_52w_high"),
            ("trading.blind_52w_signals", "gap_pct_to_52w_high_unrounded"),
            ("trading.runner_signals", "gap_pct_from_price_to_52w_high"),
            ("api.screener_api.screener_scan", "gap_pct_from_price_to_52w_high"),
            ("api.debug_api", "gap_pct_from_price_to_52w_high"),
        ],
    )
    def test_site_imports_canonical_variant(self, module_name, variant):
        assert hasattr(importlib.import_module(module_name), variant)


class TestFrozenSiteNumbers:
    """Literal outputs captured from each site before any source was touched."""

    @pytest.mark.parametrize(
        "high,price,expected",
        [
            (100.0, 95.0, -5.0),
            (100.0, 110.0, 10.0),
            (100.0, 100.1, 0.09999999999999432),
            (3.0, 1.0, -66.66666666666666),
        ],
    )
    def test_dashboard_to_52w_pct(self, high, price, expected):
        from api.screener_api import dashboard

        assert dashboard._to_52w_pct(price, high) == expected

    @pytest.mark.parametrize(
        "price,expected",
        [(95.0, 18.75), (110.0, 37.5), (100.1, 25.124999999999993), (1.0, -98.75)],
    )
    def test_dashboard_from_52w_low_pct(self, price, expected):
        from api.screener_api import dashboard

        assert dashboard._from_52w_low_pct(price, 80.0) == expected

    @pytest.mark.parametrize(
        "high,price,expected",
        [
            (100.0, 95.0, -5.000000000000004),
            (100.0, 110.0, 10.000000000000009),
            (100.0, 100.1, 0.09999999999998899),
            (3.0, 1.0, -66.66666666666667),
        ],
    )
    def test_value_scoring_off_52w_high(self, high, price, expected):
        from api.value_scan.scoring import _off_52w_high_from

        assert _off_52w_high_from(price, high) == expected

    @pytest.mark.parametrize(
        "high,price,expected",
        [
            (100.0, 95.0, -5.0),
            (100.0, 110.0, 10.0),
            (100.0, 100.1, 0.09999999999999432),
            (3.0, 1.0, -66.66666666666666),
        ],
    )
    def test_value_router_off_52w_high(self, high, price, expected):
        router = importlib.import_module("api.value_scan.router")

        assert router._off_52w_high({"close": price, "price_52_week_high": high}) == expected

    @pytest.mark.parametrize(
        "high,price,expected",
        [
            (100.0, 95.0, (75.0, -5.0, 18.75)),
            (100.0, 110.0, (150.0, 10.0, 37.5)),
            (100.0, 100.1, (100.49999999999997, 0.09999999999999432, 25.124999999999993)),
            (3.0, 1.0, (102.59740259740259, -66.66666666666666, -98.75)),
        ],
    )
    def test_snapshot_ratios(self, high, price, expected):
        from api.market_screen.snapshot import _shape_rows

        raw = {
            "name": "TEST",
            "description": "Test",
            "sector": "Tech",
            "exchange": "NSE",
            "close": price,
            "price_52_week_low": 80.0,
            "price_52_week_high": high,
        }
        row = _shape_rows([raw])[0]
        assert (row["pos_52w"], row["to_52w_high_pct"], row["from_52w_low_pct"]) == expected

    @pytest.mark.parametrize(
        "high,price,expected",
        [
            (100.0, 95.0, (4, "MED")),
            (100.0, 110.0, (0, "HIGH")),
            (100.0, 100.1, (0, "HIGH")),
            (3.0, 1.0, (None, None)),
        ],
    )
    def test_estimate_days_to_52w(self, high, price, expected):
        from api.screener_api.screener_scan import estimate_days_to_52w

        assert estimate_days_to_52w(price, high, 30.0, 1.0, 2.0, 1.0) == expected

    @pytest.mark.parametrize("price,expected", [(101.0, 1.0), (102.5, 2.5), (100.5, 0.5)])
    def test_chaser_pct_above(self, price, expected):
        from trading.week52_chaser_signals import Week52ChaserSignalGenerator

        md = {
            "current_price": price,
            "high_52w": 100.0,
            "avg_volume_20d": 100000.0,
            "volume": 200000.0,
            "days_since_52w_high": 30,
        }
        signal = Week52ChaserSignalGenerator(config={}).check_entry("T", md)
        assert signal is not None
        assert signal.or_range_pct == expected

    @pytest.mark.parametrize(
        "price,expected",
        [
            (98.0, "Blind 52W: 2.0% below 52W high ₹100.00, 30d drought | threshold=3.0% min_days=20"),
            (99.0, "Blind 52W: 1.0% below 52W high ₹100.00, 30d drought | threshold=3.0% min_days=20"),
            (97.0, "Blind 52W: 3.0% below 52W high ₹100.00, 30d drought | threshold=3.0% min_days=20"),
        ],
    )
    def test_blind_pct_from_high(self, price, expected):
        from trading.blind_52w_signals import Blind52WSignalGenerator

        md = {
            "current_price": price,
            "high_52w": 100.0,
            "days_since_52w_high": 30,
            "avg_volume_20d": 100000.0,
        }
        signal = Blind52WSignalGenerator(config={}).check_entry("T", md)
        assert signal is not None
        assert signal.notes == expected

    def test_chart_patterns_store_gap(self):
        from chart_patterns.store import _attach_52w_gaps

        class _Query:
            def __init__(self, rows):
                self.rows = rows

            def filter(self, *_args, **_kwargs):
                return self

            def all(self):
                return self.rows

        class _Session:
            def query(self, *_cols):
                return _Query([("NEAR", 100.0, 98.0), ("FAR", 100.0, 50.0), ("ZERO", 0.0, 50.0)])

        items = [{"symbol": sym} for sym in ("NEAR", "FAR", "ZERO", "NOROW")]
        _attach_52w_gaps(_Session(), items)
        assert {i["symbol"]: i["to_52w_high"] for i in items} == {
            "NEAR": 2.0,
            "FAR": 50.0,
            "ZERO": None,
            "NOROW": None,
        }


class TestGuardsUnchanged:
    """Delegation must not swallow the callers' original guard behaviour."""

    def test_dashboard_guards(self):
        from api.screener_api import dashboard

        assert dashboard._to_52w_pct(None, 100.0) is None
        assert dashboard._to_52w_pct(95.0, None) is None
        assert dashboard._to_52w_pct(95.0, 0.0) is None
        assert dashboard._to_52w_pct(95.0, -1.0) is None
        assert dashboard._from_52w_low_pct(95.0, 0.0) is None
        assert dashboard._from_52w_low_pct(None, 80.0) is None

    def test_scoring_and_router_guards(self):
        from api.value_scan.scoring import _off_52w_high_from

        router = importlib.import_module("api.value_scan.router")
        assert _off_52w_high_from(None, 100.0) is None
        assert _off_52w_high_from(95.0, 0.0) is None
        assert router._off_52w_high({"close": 95.0, "price_52_week_high": 0}) is None

    def test_snapshot_guards(self):
        from api.market_screen.snapshot import _shape_rows

        row = _shape_rows([{"name": "T", "close": 95.0}])[0]
        assert row["pos_52w"] is None
        assert row["to_52w_high_pct"] is None
        assert row["from_52w_low_pct"] is None
