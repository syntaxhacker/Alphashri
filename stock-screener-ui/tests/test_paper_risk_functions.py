"""Unit tests for trading/paper/paper_risk.py standalone functions.

Tests cover:
- simulate_fill: partial fill simulation, probability failure, edge cases
- calculate_fill_price: slippage on buy/sell, zero/negative params
- calculate_margin_required: margin math, edge cases
- has_sufficient_cash: boundary comparisons
- has_duplicate_position: dict key existence
"""

import sys
from pathlib import Path
from unittest.mock import patch
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from trading.paper.paper_risk import (
    simulate_fill,
    calculate_fill_price,
    calculate_margin_required,
    has_sufficient_cash,
    has_duplicate_position,
)
from trading.paper.paper_models import OrderSide


class TestSimulateFill:
    """Tests for simulate_fill() — randomness mocked for determinism."""

    def test_full_fill_default(self):
        """max_fill_pct=1.0 should always return full quantity."""
        with patch('trading.paper.paper_risk.random.uniform', return_value=1.0):
            qty, partial = simulate_fill(100, 1.0, 1.0)
        assert qty == 100
        assert partial is False

    def test_full_fill_even_with_low_random(self):
        """Even with low random, max_fill_pct=1.0 gives fill_pct=1.0."""
        with patch('trading.paper.paper_risk.random.uniform', return_value=0.3):
            qty, partial = simulate_fill(100, 1.0, 1.0)
        assert qty == 100
        assert partial is False

    def test_partial_fill_with_max_fill_pct(self):
        """When max_fill_pct<1.0, fill quantity should be capped."""
        with patch('trading.paper.paper_risk.random.uniform', return_value=0.8):
            qty, partial = simulate_fill(100, 1.0, 0.5)
        assert qty == 50
        assert partial is False

    def test_partial_fill_random_below_max(self):
        """When uniform returns less than max_fill_pct, the random is used."""
        with patch('trading.paper.paper_risk.random.uniform', return_value=0.3):
            qty, partial = simulate_fill(100, 1.0, 0.7)
        assert qty == 30
        assert partial is False

    def test_zero_fill_probability(self):
        """fill_probability=0 should always return 0 quantity with partial=True."""
        with patch('trading.paper.paper_risk.random.random', return_value=0.5):
            qty, partial = simulate_fill(100, 0.0, 1.0)
        assert qty == 0
        assert partial is True

    def test_fill_probability_rejection(self):
        """random > fill_probability should return 0 with partial=True."""
        with patch('trading.paper.paper_risk.random.random', return_value=0.8):
            qty, partial = simulate_fill(100, 0.5, 1.0)
        assert qty == 0
        assert partial is True

    def test_zero_quantity(self):
        """Zero quantity should return 0 with partial=True."""
        with patch('trading.paper.paper_risk.random.uniform', return_value=1.0):
            qty, partial = simulate_fill(0, 1.0, 1.0)
        assert qty == 0
        assert partial is True

    def test_very_small_max_fill_pct(self):
        """Very small max_fill_pct floors fill quantity to 0."""
        with patch('trading.paper.paper_risk.random.uniform', return_value=0.6):
            qty, partial = simulate_fill(10, 1.0, 0.01)
        assert qty == 0
        assert partial is True

    def test_large_quantity(self):
        """Large quantity should work without overflow."""
        with patch('trading.paper.paper_risk.random.uniform', return_value=1.0):
            qty, partial = simulate_fill(1_000_000, 1.0, 0.75)
        assert qty == 750_000
        assert partial is False


class TestCalculateFillPrice:
    """Tests for calculate_fill_price() — slippage application."""

    def test_buy_slippage_adds_to_price(self):
        """Buy side: price * (1 + slippage_pct)."""
        result = calculate_fill_price(1000.0, OrderSide.BUY, 0.01)
        assert result == 1010.0

    def test_sell_slippage_subtracts_from_price(self):
        """Sell side: price * (1 - slippage_pct)."""
        result = calculate_fill_price(1000.0, OrderSide.SELL, 0.01)
        assert result == 990.0

    def test_zero_slippage(self):
        """Zero slippage: fill price equals input price."""
        for side in (OrderSide.BUY, OrderSide.SELL):
            assert calculate_fill_price(1000.0, side, 0.0) == 1000.0

    def test_negative_slippage_buy(self):
        """Negative slippage on buy should reduce price (unusual but possible)."""
        result = calculate_fill_price(1000.0, OrderSide.BUY, -0.01)
        assert result == 990.0

    def test_negative_slippage_sell(self):
        """Negative slippage on sell should increase price."""
        result = calculate_fill_price(1000.0, OrderSide.SELL, -0.01)
        assert result == 1010.0

    def test_zero_price(self):
        """Zero price should stay zero."""
        assert calculate_fill_price(0.0, OrderSide.BUY, 0.01) == 0.0

    def test_small_price_with_slippage(self):
        """Small price should still apply slippage ratio."""
        result = calculate_fill_price(1.0, OrderSide.BUY, 0.5)
        assert result == 1.5

    def test_one_hundred_percent_slippage(self):
        """100% slippage should double/halve the price."""
        assert calculate_fill_price(100.0, OrderSide.BUY, 1.0) == 200.0
        assert calculate_fill_price(100.0, OrderSide.SELL, 1.0) == 0.0


class TestCalculateMarginRequired:
    """Tests for calculate_margin_required()."""

    def test_basic_margin_calculation(self):
        """Margin = fill_price * quantity, where fill_price includes slippage."""
        result = calculate_margin_required(1000.0, 100, OrderSide.BUY, 0.01)
        # fill_price = 1010, margin = 1010 * 100 = 101000
        assert result == 101000.0

    def test_sell_margin_calculation(self):
        """Sell side uses price * (1 - slippage) for margin."""
        result = calculate_margin_required(1000.0, 100, OrderSide.SELL, 0.01)
        # fill_price = 990, margin = 990 * 100 = 99000
        assert result == 99000.0

    def test_zero_slippage_margin(self):
        """Zero slippage: margin = price * quantity."""
        result = calculate_margin_required(500.0, 50, OrderSide.BUY, 0.0)
        assert result == 25000.0

    def test_zero_quantity(self):
        """Zero quantity should yield zero margin."""
        result = calculate_margin_required(1000.0, 0, OrderSide.BUY, 0.01)
        assert result == 0.0

    def test_large_values(self):
        """Large price * quantity should not overflow."""
        result = calculate_margin_required(50000.0, 1000, OrderSide.BUY, 0.005)
        # fill_price = 50250, margin = 50250 * 1000 = 50,250,000
        assert result == pytest.approx(50250000.0, rel=1e-9)

    def test_negative_slippage_margin(self):
        """Negative slippage should still calculate correctly."""
        result = calculate_margin_required(1000.0, 10, OrderSide.BUY, -0.1)
        # fill_price = 900, margin = 9000
        assert result == 9000.0


class TestHasSufficientCash:
    """Tests for has_sufficient_cash()."""

    def test_equal_cash_and_margin(self):
        """Cash exactly equal to margin required is sufficient."""
        assert has_sufficient_cash(1000.0, 1000.0) is True

    def test_more_cash_than_margin(self):
        """More cash than required is sufficient."""
        assert has_sufficient_cash(5000.0, 1000.0) is True

    def test_less_cash_than_margin(self):
        """Less cash than required is insufficient."""
        assert has_sufficient_cash(500.0, 1000.0) is False

    def test_zero_cash(self):
        """Zero cash with any margin is insufficient."""
        assert has_sufficient_cash(0.0, 100.0) is False

    def test_zero_margin(self):
        """Zero margin required is always sufficient."""
        assert has_sufficient_cash(0.0, 0.0) is True
        assert has_sufficient_cash(100.0, 0.0) is True

    def test_negative_cash(self):
        """Negative cash is insufficient."""
        assert has_sufficient_cash(-100.0, 50.0) is False

    def test_negative_margin(self):
        """Negative margin should be treated as sufficient (unusual case)."""
        assert has_sufficient_cash(0.0, -100.0) is True

    def test_very_large_values(self):
        """Very large cash/margin values should not overflow."""
        assert has_sufficient_cash(1e12, 1e9) is True
        assert has_sufficient_cash(1e9, 1e12) is False


class TestHasDuplicatePosition:
    """Tests for has_duplicate_position()."""

    def test_symbol_exists(self):
        """Symbol present in positions dict -> True."""
        positions = {"RELIANCE": "pos1", "TCS": "pos2"}
        assert has_duplicate_position(positions, "RELIANCE") is True

    def test_symbol_does_not_exist(self):
        """Symbol not present -> False."""
        positions = {"TCS": "pos1"}
        assert has_duplicate_position(positions, "RELIANCE") is False

    def test_empty_dict(self):
        """Empty positions dict -> False."""
        assert has_duplicate_position({}, "RELIANCE") is False

    def test_case_sensitivity(self):
        """Symbol lookup is case-sensitive."""
        positions = {"RELIANCE": "pos1"}
        assert has_duplicate_position(positions, "reliance") is False

    def test_none_positions(self):
        """None as positions should raise TypeError."""
        with pytest.raises(TypeError):
            has_duplicate_position(None, "RELIANCE")
