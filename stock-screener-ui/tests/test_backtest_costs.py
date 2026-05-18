"""
Unit tests for backtest/costs.py.

Tests cover:
- Trading cost calculations (brokerage, STT, GST, etc.)
- Buy vs sell side cost differences
- Brokerage cap at ₹20 per order
- STT (sell side only) and stamp duty (buy side only)
- Exchange charges and SEBI fees
- Total cost breakdown accuracy
- Edge cases (small/large trades)
- Cost breakdown display function
- Average cost estimation
"""

import pytest
from backtest import costs


class TestCostConstants:
    """Tests for trading cost constants."""

    def test_brokerage_percentage(self):
        """Test: Brokerage rate is 0.03%."""
        assert costs.BROKERAGE_PCT == 0.0003

    def test_stt_percentage(self):
        """Test: STT rate is 0.025%."""
        assert costs.STT_PCT == 0.00025

    def test_exchange_charges_percentage(self):
        """Test: Exchange charges rate is 0.00297%."""
        assert costs.EXCHANGE_CHARGES_PCT == 0.0000297

    def test_sebi_fee_percentage(self):
        """Test: SEBI fee rate is 0.0001%."""
        assert costs.SEBI_FEE_PCT == 0.000001

    def test_stamp_duty_percentage(self):
        """Test: Stamp duty rate is 0.003%."""
        assert costs.STAMP_DUTY_PCT == 0.00003

    def test_gst_percentage(self):
        """Test: GST rate is 18%."""
        assert costs.GST_PCT == 0.18

    def test_dp_charges_zero_for_intraday(self):
        """Test: DP charges are zero for intraday."""
        assert costs.DP_CHARGES == 0


class TestCalculateTradingCosts:
    """Tests for calculate_trading_costs function."""

    def test_returns_dict_with_required_keys(self):
        """Test: Returns dict with all required keys."""
        result = costs.calculate_trading_costs(100.0, 105.0, 100)
        assert 'buy_costs' in result
        assert 'sell_costs' in result
        assert 'total_costs' in result
        assert 'breakdown' in result

    def test_breakdown_has_all_cost_components(self):
        """Test: Breakdown contains all cost components."""
        result = costs.calculate_trading_costs(100.0, 105.0, 100)
        breakdown = result['breakdown']
        assert 'buy_brokerage' in breakdown
        assert 'buy_stamp_duty' in breakdown
        assert 'buy_exchange' in breakdown
        assert 'buy_sebi' in breakdown
        assert 'buy_gst' in breakdown
        assert 'sell_brokerage' in breakdown
        assert 'sell_stt' in breakdown
        assert 'sell_exchange' in breakdown
        assert 'sell_sebi' in breakdown
        assert 'sell_gst' in breakdown

    def test_total_costs_equals_buy_plus_sell(self):
        """Test: Total costs equals buy + sell costs."""
        result = costs.calculate_trading_costs(100.0, 105.0, 100)
        assert result['total_costs'] == result['buy_costs'] + result['sell_costs']

    def test_buy_costs_are_positive(self):
        """Test: Buy costs are always positive."""
        result = costs.calculate_trading_costs(100.0, 105.0, 100)
        assert result['buy_costs'] > 0

    def test_sell_costs_are_positive(self):
        """Test: Sell costs are always positive."""
        result = costs.calculate_trading_costs(100.0, 105.0, 100)
        assert result['sell_costs'] > 0

    def test_values_are_rounded_to_two_decimals(self):
        """Test: All returned values are rounded to 2 decimals."""
        result = costs.calculate_trading_costs(123.456, 128.901, 99)
        assert result['buy_costs'] == round(result['buy_costs'], 2)
        assert result['sell_costs'] == round(result['sell_costs'], 2)
        assert result['total_costs'] == round(result['total_costs'], 2)
        for value in result['breakdown'].values():
            assert value == round(value, 2)


class TestBrokerageCalculation:
    """Tests for brokerage calculation with ₹20 cap."""

    def test_brokerage_percentage_applied_below_cap(self):
        """Test: Brokerage uses 0.03% for trades below ₹20 cap (hardcoded rate)."""
        entry_price = 100.0
        quantity = 50
        buy_value = entry_price * quantity
        result = costs.calculate_trading_costs(entry_price, 105.0, quantity)
        expected = min(20, buy_value * 0.0003)
        assert result['breakdown']['buy_brokerage'] == round(expected, 2)

    def test_brokerage_capped_at_20_small_trade(self):
        """Test: Brokerage capped at ₹20 for small trades."""
        entry_price = 100.0
        quantity = 50
        buy_value = entry_price * quantity
        expected_pct_brokerage = buy_value * costs.BROKERAGE_PCT
        
        result = costs.calculate_trading_costs(entry_price, 105.0, quantity)
        
        expected_brokerage = min(20, expected_pct_brokerage)
        assert result['breakdown']['buy_brokerage'] == round(expected_brokerage, 2)

    def test_brokerage_uses_percentage_for_large_trade(self):
        """Test: Brokerage uses percentage for large trades."""
        entry_price = 1000.0
        quantity = 1000
        buy_value = entry_price * quantity
        expected_pct_brokerage = buy_value * costs.BROKERAGE_PCT
        
        result = costs.calculate_trading_costs(entry_price, 1050.0, quantity)
        
        expected_brokerage = min(20, expected_pct_brokerage)
        assert result['breakdown']['buy_brokerage'] == round(expected_brokerage, 2)

    def test_brokerage_exactly_at_cap_boundary(self):
        """Test: Brokerage at exactly ₹20 cap boundary."""
        entry_price = 100.0
        quantity = 667
        buy_value = entry_price * quantity
        expected_pct_brokerage = buy_value * costs.BROKERAGE_PCT
        
        result = costs.calculate_trading_costs(entry_price, 105.0, quantity)
        
        expected_brokerage = min(20, expected_pct_brokerage)
        assert result['breakdown']['buy_brokerage'] == round(expected_brokerage, 2)

    def test_buy_and_sell_brokerage_calculated_separately(self):
        """Test: Buy and sell brokerage calculated separately."""
        entry_price = 100.0
        exit_price = 110.0
        quantity = 500
        
        result = costs.calculate_trading_costs(entry_price, exit_price, quantity)
        
        buy_value = entry_price * quantity
        sell_value = exit_price * quantity
        expected_buy_brokerage = min(20, buy_value * costs.BROKERAGE_PCT)
        expected_sell_brokerage = min(20, sell_value * costs.BROKERAGE_PCT)
        
        assert result['breakdown']['buy_brokerage'] == round(expected_buy_brokerage, 2)
        assert result['breakdown']['sell_brokerage'] == round(expected_sell_brokerage, 2)


class TestSTTAndStampDuty:
    """Tests for STT (sell side) and stamp duty (buy side)."""

    def test_stt_only_on_sell_side(self):
        """Test: STT is charged only on sell side."""
        result = costs.calculate_trading_costs(100.0, 105.0, 100)
        
        sell_value = 105.0 * 100
        expected_stt = sell_value * costs.STT_PCT
        
        assert result['breakdown']['sell_stt'] == round(expected_stt, 2)
        assert 'buy_stt' not in result['breakdown']

    def test_stamp_duty_only_on_buy_side(self):
        """Test: Stamp duty is charged only on buy side."""
        result = costs.calculate_trading_costs(100.0, 105.0, 100)
        
        buy_value = 100.0 * 100
        expected_stamp_duty = buy_value * costs.STAMP_DUTY_PCT
        
        assert result['breakdown']['buy_stamp_duty'] == round(expected_stamp_duty, 2)
        assert 'sell_stamp_duty' not in result['breakdown']

    def test_stt_calculation_accuracy(self):
        """Test: STT calculation accuracy."""
        exit_price = 500.0
        quantity = 200
        result = costs.calculate_trading_costs(480.0, exit_price, quantity)
        
        sell_value = exit_price * quantity
        expected_stt = sell_value * costs.STT_PCT
        
        assert result['breakdown']['sell_stt'] == round(expected_stt, 2)

    def test_stamp_duty_calculation_accuracy(self):
        """Test: Stamp duty calculation accuracy."""
        entry_price = 250.0
        quantity = 400
        result = costs.calculate_trading_costs(entry_price, 260.0, quantity)
        
        buy_value = entry_price * quantity
        expected_stamp_duty = buy_value * costs.STAMP_DUTY_PCT
        
        assert result['breakdown']['buy_stamp_duty'] == round(expected_stamp_duty, 2)


class TestGSTCalculation:
    """Tests for GST calculation."""

    def test_gst_on_buy_side_components(self):
        """Test: GST on buy side includes brokerage, exchange, SEBI."""
        entry_price = 100.0
        quantity = 100
        result = costs.calculate_trading_costs(entry_price, 105.0, quantity)
        
        buy_value = entry_price * quantity
        buy_brokerage = min(20, buy_value * costs.BROKERAGE_PCT)
        buy_exchange = buy_value * costs.EXCHANGE_CHARGES_PCT
        buy_sebi = buy_value * costs.SEBI_FEE_PCT
        expected_gst = costs.GST_PCT * (buy_brokerage + buy_exchange + buy_sebi)
        
        assert result['breakdown']['buy_gst'] == round(expected_gst, 2)

    def test_gst_on_sell_side_components(self):
        """Test: GST on sell side includes brokerage, exchange, SEBI (not STT)."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100
        result = costs.calculate_trading_costs(entry_price, exit_price, quantity)
        
        sell_value = exit_price * quantity
        sell_brokerage = min(20, sell_value * costs.BROKERAGE_PCT)
        sell_exchange = sell_value * costs.EXCHANGE_CHARGES_PCT
        sell_sebi = sell_value * costs.SEBI_FEE_PCT
        expected_gst = costs.GST_PCT * (sell_brokerage + sell_exchange + sell_sebi)
        
        assert result['breakdown']['sell_gst'] == round(expected_gst, 2)

    def test_gst_excludes_stt_and_stamp_duty(self):
        """Test: GST does not include STT or stamp duty."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100
        result = costs.calculate_trading_costs(entry_price, exit_price, quantity)
        
        stt = result['breakdown']['sell_stt']
        stamp_duty = result['breakdown']['buy_stamp_duty']
        
        buy_value = entry_price * quantity
        sell_value = exit_price * quantity
        buy_brokerage = min(20, buy_value * costs.BROKERAGE_PCT)
        sell_brokerage = min(20, sell_value * costs.BROKERAGE_PCT)
        
        gst_base_buy = buy_brokerage + buy_value * costs.EXCHANGE_CHARGES_PCT + buy_value * costs.SEBI_FEE_PCT
        gst_base_sell = sell_brokerage + sell_value * costs.EXCHANGE_CHARGES_PCT + sell_value * costs.SEBI_FEE_PCT
        
        expected_buy_gst = costs.GST_PCT * gst_base_buy
        expected_sell_gst = costs.GST_PCT * gst_base_sell
        
        assert result['breakdown']['buy_gst'] == round(expected_buy_gst, 2)
        assert result['breakdown']['sell_gst'] == round(expected_sell_gst, 2)


class TestExchangeAndSEBIFees:
    """Tests for exchange charges and SEBI fees."""

    def test_exchange_charges_on_both_sides(self):
        """Test: Exchange charges applied to both buy and sell."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100
        result = costs.calculate_trading_costs(entry_price, exit_price, quantity)
        
        buy_value = entry_price * quantity
        sell_value = exit_price * quantity
        expected_buy_exchange = buy_value * costs.EXCHANGE_CHARGES_PCT
        expected_sell_exchange = sell_value * costs.EXCHANGE_CHARGES_PCT
        
        assert result['breakdown']['buy_exchange'] == round(expected_buy_exchange, 2)
        assert result['breakdown']['sell_exchange'] == round(expected_sell_exchange, 2)

    def test_sebi_fees_on_both_sides(self):
        """Test: SEBI fees applied to both buy and sell."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100
        result = costs.calculate_trading_costs(entry_price, exit_price, quantity)
        
        buy_value = entry_price * quantity
        sell_value = exit_price * quantity
        expected_buy_sebi = buy_value * costs.SEBI_FEE_PCT
        expected_sell_sebi = sell_value * costs.SEBI_FEE_PCT
        
        assert result['breakdown']['buy_sebi'] == round(expected_buy_sebi, 2)
        assert result['breakdown']['sell_sebi'] == round(expected_sell_sebi, 2)


class TestTotalCostCalculation:
    """Tests for total cost calculation."""

    def test_buy_total_is_sum_of_components(self):
        """Test: Buy total is approximately sum of all buy components."""
        entry_price = 100.0
        quantity = 100
        result = costs.calculate_trading_costs(entry_price, 105.0, quantity)
        b = result['breakdown']
        
        expected_buy_total = (
            b['buy_brokerage'] +
            b['buy_stamp_duty'] +
            b['buy_exchange'] +
            b['buy_sebi'] +
            b['buy_gst']
        )
        
        assert abs(result['buy_costs'] - expected_buy_total) < 0.02

    def test_sell_total_is_sum_of_components(self):
        """Test: Sell total is sum of all sell components."""
        exit_price = 105.0
        quantity = 100
        result = costs.calculate_trading_costs(100.0, exit_price, quantity)
        b = result['breakdown']
        
        expected_sell_total = (
            b['sell_brokerage'] +
            b['sell_stt'] +
            b['sell_exchange'] +
            b['sell_sebi'] +
            b['sell_gst']
        )
        
        assert result['sell_costs'] == round(expected_sell_total, 2)

    def test_total_costs_reasonable_percentage(self):
        """Test: Total costs are within reasonable range."""
        entry_price = 100.0
        exit_price = 105.0
        quantity = 100
        result = costs.calculate_trading_costs(entry_price, exit_price, quantity)
        
        total_value = (entry_price + exit_price) * quantity
        cost_pct = (result['total_costs'] / total_value) * 100
        
        assert 0.01 < cost_pct < 0.2


class TestDifferentPriceScenarios:
    """Tests for different price and quantity scenarios."""

    def test_same_entry_and_exit_price(self):
        """Test: Same entry and exit price still has costs."""
        result = costs.calculate_trading_costs(100.0, 100.0, 100)
        assert result['total_costs'] > 0

    def test_exit_higher_than_entry(self):
        """Test: Profitable trade still incurs costs."""
        result = costs.calculate_trading_costs(100.0, 120.0, 100)
        assert result['total_costs'] > 0

    def test_exit_lower_than_entry(self):
        """Test: Loss trade still incurs costs."""
        result = costs.calculate_trading_costs(100.0, 80.0, 100)
        assert result['total_costs'] > 0

    def test_high_value_stock(self):
        """Test: High value stock trade."""
        result = costs.calculate_trading_costs(2500.0, 2550.0, 50)
        assert result['total_costs'] > 0
        assert result['breakdown']['sell_stt'] > result['breakdown']['buy_stamp_duty']

    def test_low_value_stock(self):
        """Test: Low value stock trade."""
        result = costs.calculate_trading_costs(25.0, 26.0, 1000)
        assert result['total_costs'] > 0


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_minimum_quantity_one(self):
        """Test: Minimum quantity of 1 share."""
        result = costs.calculate_trading_costs(100.0, 105.0, 1)
        assert result['total_costs'] > 0
        assert result['buy_costs'] > 0
        assert result['sell_costs'] > 0

    def test_large_quantity(self):
        """Test: Large quantity trade."""
        result = costs.calculate_trading_costs(100.0, 105.0, 10000)
        assert result['total_costs'] > 0

    def test_very_small_prices(self):
        """Test: Very small stock prices."""
        result = costs.calculate_trading_costs(0.5, 0.55, 10000)
        assert result['total_costs'] >= 0

    def test_very_large_prices(self):
        """Test: Very large stock prices."""
        result = costs.calculate_trading_costs(50000.0, 51000.0, 10)
        assert result['total_costs'] > 0

    def test_fractional_prices(self):
        """Test: Fractional prices."""
        result = costs.calculate_trading_costs(123.45, 128.90, 100)
        assert result['total_costs'] > 0

    def test_zero_quantity_returns_zero_costs(self):
        """Test: Zero quantity returns minimal/zero costs."""
        result = costs.calculate_trading_costs(100.0, 105.0, 0)
        assert result['buy_costs'] == 0
        assert result['sell_costs'] == 0
        assert result['total_costs'] == 0

    def test_large_trade_value_brokerage_capped(self):
        """Test: Large trade value has brokerage capped at ₹20."""
        large_value = 100000.0
        quantity = 100
        entry_price = large_value / quantity
        
        result = costs.calculate_trading_costs(entry_price, entry_price * 1.05, quantity)
        
        assert result['breakdown']['buy_brokerage'] <= 20
        assert result['breakdown']['sell_brokerage'] <= 20


class TestGetCostBreakdown:
    """Tests for get_cost_breakdown function."""

    def test_returns_dict(self):
        """Test: Returns a dictionary."""
        result = costs.get_cost_breakdown()
        assert isinstance(result, dict)

    def test_has_all_cost_types(self):
        """Test: Has all expected cost types."""
        result = costs.get_cost_breakdown()
        expected_keys = [
            'brokerage', 'stt', 'exchange_charges',
            'sebi_fee', 'stamp_duty', 'gst', 'dp_charges'
        ]
        for key in expected_keys:
            assert key in result

    def test_each_cost_has_required_fields(self):
        """Test: Each cost has rate, description, and applies_to."""
        result = costs.get_cost_breakdown()
        for cost_type, info in result.items():
            assert 'rate' in info
            assert 'description' in info
            assert 'applies_to' in info

    def test_brokerage_description(self):
        """Test: Brokerage has correct description."""
        result = costs.get_cost_breakdown()
        assert result['brokerage']['rate'] == '0.03%'
        assert '₹20' in result['brokerage']['description']

    def test_stt_description(self):
        """Test: STT has correct description."""
        result = costs.get_cost_breakdown()
        assert result['stt']['rate'] == '0.025%'
        assert 'sell' in result['stt']['applies_to'].lower()

    def test_stamp_duty_description(self):
        """Test: Stamp duty has correct description."""
        result = costs.get_cost_breakdown()
        assert result['stamp_duty']['rate'] == '0.003%'
        assert 'buy' in result['stamp_duty']['applies_to'].lower()

    def test_gst_description(self):
        """Test: GST has correct description."""
        result = costs.get_cost_breakdown()
        assert result['gst']['rate'] == '18%'

    def test_dp_charges_zero_for_intraday(self):
        """Test: DP charges show zero for intraday."""
        result = costs.get_cost_breakdown()
        assert result['dp_charges']['rate'] == '₹0'
        assert 'intraday' in result['dp_charges']['description'].lower()


class TestEstimateAvgCostPerTrade:
    """Tests for estimate_avg_cost_per_trade function."""

    def test_returns_float(self):
        """Test: Returns a float."""
        result = costs.estimate_avg_cost_per_trade()
        assert isinstance(result, float)

    def test_default_trade_value(self):
        """Test: Default trade value produces reasonable cost."""
        result = costs.estimate_avg_cost_per_trade()
        assert result > 0

    def test_custom_trade_value(self):
        """Test: Custom trade value produces different cost."""
        small_trade = costs.estimate_avg_cost_per_trade(10000)
        large_trade = costs.estimate_avg_cost_per_trade(100000)
        
        assert small_trade > 0
        assert large_trade > 0
        assert large_trade != small_trade

    def test_cost_scales_with_trade_value(self):
        """Test: Cost generally scales with trade value."""
        small_trade = costs.estimate_avg_cost_per_trade(10000)
        medium_trade = costs.estimate_avg_cost_per_trade(50000)
        large_trade = costs.estimate_avg_cost_per_trade(100000)
        
        assert small_trade <= medium_trade <= large_trade

    def test_very_small_trade_value(self):
        """Test: Very small trade value."""
        result = costs.estimate_avg_cost_per_trade(1000)
        assert result >= 0

    def test_very_large_trade_value(self):
        """Test: Very large trade value."""
        result = costs.estimate_avg_cost_per_trade(1000000)
        assert result > 0


class TestRealisticScenarios:
    """Tests for realistic trading scenarios."""

    def test_typical_intraday_trade(self):
        """Test: Typical intraday trade with 2% profit target."""
        result = costs.calculate_trading_costs(500.0, 510.0, 100)
        
        total_value = 500.0 * 100 + 510.0 * 100
        cost_pct = (result['total_costs'] / total_value) * 100
        
        assert cost_pct < 0.2
        assert result['total_costs'] > 0

    def test_reliance_trade(self):
        """Test: Realistic RELIANCE trade."""
        result = costs.calculate_trading_costs(2500.0, 2550.0, 40)
        
        assert result['breakdown']['sell_stt'] > 0
        assert result['breakdown']['buy_stamp_duty'] > 0

    def test_small_cap_stock_trade(self):
        """Test: Small cap stock with larger quantity."""
        result = costs.calculate_trading_costs(50.0, 52.0, 500)
        
        assert result['total_costs'] > 0

    def test_high_frequency_trade_costs(self):
        """Test: Multiple trades cost accumulation."""
        total_costs = 0
        for _ in range(10):
            result = costs.calculate_trading_costs(100.0, 101.0, 100)
            total_costs += result['total_costs']
        
        assert total_costs > 0

    def test_profitable_trade_after_costs(self):
        """Test: Trade that is profitable after costs."""
        entry = 100.0
        exit_price = 102.0
        quantity = 100
        
        result = costs.calculate_trading_costs(entry, exit_price, quantity)
        
        gross_profit = (exit_price - entry) * quantity
        net_profit = gross_profit - result['total_costs']
        
        assert net_profit > 0

    def test_marginal_trade_after_costs(self):
        """Test: Trade that is marginal after costs."""
        entry = 100.0
        exit_price = 100.10
        quantity = 100
        
        result = costs.calculate_trading_costs(entry, exit_price, quantity)
        
        gross_profit = (exit_price - entry) * quantity
        net_profit = gross_profit - result['total_costs']
        
        assert net_profit < 0


class TestCostProportions:
    """Tests for cost proportion relationships."""

    def test_stt_larger_than_stamp_duty(self):
        """Test: STT is larger than stamp duty for same value."""
        result = costs.calculate_trading_costs(100.0, 100.0, 100)
        
        assert result['breakdown']['sell_stt'] > result['breakdown']['buy_stamp_duty']

    def test_sell_costs_higher_than_buy(self):
        """Test: Sell costs higher due to STT."""
        result = costs.calculate_trading_costs(100.0, 100.0, 100)
        
        assert result['sell_costs'] > result['buy_costs']

    def test_brokerage_same_for_same_value(self):
        """Test: Brokerage same when buy and sell values equal."""
        result = costs.calculate_trading_costs(100.0, 100.0, 100)
        
        assert result['breakdown']['buy_brokerage'] == result['breakdown']['sell_brokerage']
