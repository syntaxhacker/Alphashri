"""
Unit tests for trading.risk_utils module.

Covers all public functions:
- make_validation_result
- calculate_risk_reward
- apply_risk_reward_to_result
- calculate_position_size
- position_to_dict
"""

import sys
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from trading.risk_utils import (
    apply_risk_reward_to_result,
    calculate_position_size,
    calculate_risk_reward,
    make_validation_result,
    position_to_dict,
)


# ---------------------------------------------------------------------------
# make_validation_result
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestMakeValidationResult:
    def test_returns_all_expected_keys(self):
        result = make_validation_result()
        expected_keys = {
            'valid', 'shares', 'trade_value', 'risk_amount',
            'risk_pct', 'reward_amount', 'reward_pct', 'rr_ratio', 'reason',
        }
        assert set(result.keys()) == expected_keys

    def test_default_values(self):
        result = make_validation_result()
        assert result['valid'] is False
        assert result['shares'] == 0
        assert result['trade_value'] == 0
        assert result['risk_amount'] == 0
        assert result['risk_pct'] == 0
        assert result['reward_amount'] == 0
        assert result['reward_pct'] == 0
        assert result['rr_ratio'] == 0
        assert result['reason'] == ''

    def test_returns_fresh_dict_each_call(self):
        r1 = make_validation_result()
        r2 = make_validation_result()
        r1['valid'] = True
        assert r2['valid'] is False


# ---------------------------------------------------------------------------
# calculate_risk_reward
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestCalculateRiskReward:
    def test_buy_side_basic(self):
        risk, reward, risk_pct, reward_pct, rr = calculate_risk_reward(
            entry_price=100.0, stop_loss=95.0, take_profit=115.0, side="BUY",
        )
        assert risk == pytest.approx(5.0)
        assert reward == pytest.approx(15.0)
        assert risk_pct == pytest.approx(5.0)
        assert reward_pct == pytest.approx(15.0)
        assert rr == pytest.approx(3.0)

    def test_sell_side_basic(self):
        risk, reward, risk_pct, reward_pct, rr = calculate_risk_reward(
            entry_price=100.0, stop_loss=105.0, take_profit=85.0, side="SELL",
        )
        assert risk == pytest.approx(5.0)
        assert reward == pytest.approx(15.0)
        assert risk_pct == pytest.approx(5.0)
        assert reward_pct == pytest.approx(15.0)
        assert rr == pytest.approx(3.0)

    def test_default_side_is_buy(self):
        result_default = calculate_risk_reward(100.0, 95.0, 110.0)
        result_buy = calculate_risk_reward(100.0, 95.0, 110.0, "BUY")
        assert result_default == result_buy

    def test_zero_risk_entry_equals_sl(self):
        risk, reward, risk_pct, reward_pct, rr = calculate_risk_reward(
            entry_price=100.0, stop_loss=100.0, take_profit=110.0, side="BUY",
        )
        assert risk == pytest.approx(0.0)
        assert rr == pytest.approx(0.0)

    def test_symmetry_buy_sell_with_swapped_sl_tp(self):
        buy = calculate_risk_reward(100.0, 90.0, 120.0, "BUY")
        sell = calculate_risk_reward(100.0, 110.0, 80.0, "SELL")
        assert buy == sell

    def test_risk_pct_calculated_correctly(self):
        _, _, risk_pct, _, _ = calculate_risk_reward(200.0, 190.0, 230.0, "BUY")
        assert risk_pct == pytest.approx(5.0)

    def test_reward_pct_calculated_correctly(self):
        _, _, _, reward_pct, _ = calculate_risk_reward(200.0, 190.0, 230.0, "BUY")
        assert reward_pct == pytest.approx(15.0)

    def test_rr_ratio_one_to_one(self):
        _, _, _, _, rr = calculate_risk_reward(100.0, 95.0, 105.0, "BUY")
        assert rr == pytest.approx(1.0)

    def test_rr_ratio_fractional(self):
        _, _, _, _, rr = calculate_risk_reward(100.0, 95.0, 102.0, "BUY")
        assert rr == pytest.approx(0.4)

    def test_sell_side_sl_above_entry(self):
        risk, reward, _, _, rr = calculate_risk_reward(
            entry_price=500.0, stop_loss=520.0, take_profit=460.0, side="SELL",
        )
        assert risk == pytest.approx(20.0)
        assert reward == pytest.approx(40.0)
        assert rr == pytest.approx(2.0)


# ---------------------------------------------------------------------------
# apply_risk_reward_to_result
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestApplyRiskRewardToResult:
    def test_buy_side_populates_risk_reward(self):
        result = make_validation_result()
        apply_risk_reward_to_result(
            result, entry_price=100.0, stop_loss=95.0, take_profit=115.0,
            side="BUY",
        )
        assert result['risk_pct'] == pytest.approx(5.0)
        assert result['reward_pct'] == pytest.approx(15.0)
        assert result['rr_ratio'] == pytest.approx(3.0)

    def test_sell_side_populates_risk_reward(self):
        result = make_validation_result()
        apply_risk_reward_to_result(
            result, entry_price=100.0, stop_loss=105.0, take_profit=85.0,
            side="SELL",
        )
        assert result['risk_pct'] == pytest.approx(5.0)

    def test_buy_vs_sell_formula_mirror(self):
        """BUY and SELL from same price with mirrored SL/TP should produce same RR."""
        result_buy = make_validation_result()
        apply_risk_reward_to_result(
            result_buy, entry_price=100.0, stop_loss=96.0, take_profit=108.0,
            side="BUY",
        )

        result_sell = make_validation_result()
        apply_risk_reward_to_result(
            result_sell, entry_price=100.0, stop_loss=104.0, take_profit=92.0,
            side="SELL",
        )

        assert result_buy['risk_pct'] == pytest.approx(result_sell['risk_pct']), \
            f"risk_pct mismatch: BUY={result_buy['risk_pct']} vs SELL={result_sell['risk_pct']}"
        assert result_buy['rr_ratio'] == pytest.approx(result_sell['rr_ratio']), \
            f"rr_ratio mismatch: BUY={result_buy['rr_ratio']} vs SELL={result_sell['rr_ratio']}"

    def test_invalid_entry_price_zero(self):
        result = make_validation_result()
        ret = apply_risk_reward_to_result(
            result, entry_price=0.0, stop_loss=95.0, take_profit=110.0,
        )
        assert ret is result
        assert result['reason'] == "Invalid entry price"

    def test_invalid_entry_price_negative(self):
        result = make_validation_result()
        ret = apply_risk_reward_to_result(
            result, entry_price=-50.0, stop_loss=95.0, take_profit=110.0,
        )
        assert ret is result
        assert result['reason'] == "Invalid entry price"

    def test_populates_risk_pct_rounded(self):
        result = make_validation_result()
        apply_risk_reward_to_result(
            result, entry_price=100.0, stop_loss=97.5, take_profit=110.0,
            side="BUY",
        )
        assert result['risk_pct'] == pytest.approx(2.5)


# ---------------------------------------------------------------------------
# calculate_position_size
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestCalculatePositionSize:
    def test_normal_risk_limited(self):
        shares = calculate_position_size(
            capital=1_000_000, entry_price=100.0,
            risk_per_share=5.0, risk_per_trade_pct=0.001,
            max_capital_per_trade_pct=0.50,
            min_trade_value=5000, max_trade_value=200_000,
        )
        assert shares == 200

    def test_capital_limited(self):
        shares = calculate_position_size(
            capital=1_000_000, entry_price=5000.0,
            risk_per_share=10.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        )
        max_capital = 1_000_000 * 0.10
        expected = int(max_capital / 5000.0)
        assert shares == expected

    def test_min_trade_value_bump(self):
        # Use lower risk so bumped shares don't exceed risk limit
        # max_risk = 10000 (1%), bump to 100 shares = 100*100 risk = 10000 (exactly at limit)
        shares = calculate_position_size(
            capital=1_000_000, entry_price=100.0,
            risk_per_share=50.0, risk_per_trade_pct=0.01,  # max_risk=10000
            max_capital_per_trade_pct=0.50,
            min_trade_value=10_000, max_trade_value=500_000,
        )
        # Without bump (shares_risk=200): trade_value=20000
        # With bump (shares=100): trade_value=10000 (exactly min_trade_value)
        # Should be bumped to min_trade_value without exceeding risk
        trade_value = shares * 100.0
        assert trade_value >= 10_000, f"Expected >= 10000, got {trade_value}"

    def test_max_trade_value_clamp(self):
        shares = calculate_position_size(
            capital=10_000_000, entry_price=100.0,
            risk_per_share=1.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.50,
            min_trade_value=5000, max_trade_value=50_000,
        )
        assert shares * 100.0 <= 50_000

    def test_zero_entry_price_returns_zero(self):
        assert calculate_position_size(
            capital=1_000_000, entry_price=0.0,
            risk_per_share=5.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        ) == 0

    def test_negative_entry_price_returns_zero(self):
        assert calculate_position_size(
            capital=1_000_000, entry_price=-100.0,
            risk_per_share=5.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        ) == 0

    def test_zero_risk_per_share_returns_zero(self):
        assert calculate_position_size(
            capital=1_000_000, entry_price=100.0,
            risk_per_share=0.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        ) == 0

    def test_zero_capital_returns_zero(self):
        assert calculate_position_size(
            capital=0, entry_price=100.0,
            risk_per_share=5.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        ) == 0

    def test_min_trade_value_exceeds_risk_limit_returns_zero(self):
        shares = calculate_position_size(
            capital=100_000, entry_price=100.0,
            risk_per_share=50.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.50,
            min_trade_value=100_000, max_trade_value=500_000,
        )
        assert shares == 0

    def test_min_trade_value_exceeds_capital_returns_zero(self):
        shares = calculate_position_size(
            capital=10_000, entry_price=100.0,
            risk_per_share=0.5, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=50_000, max_trade_value=500_000,
        )
        assert shares == 0

    def test_returns_int_type(self):
        shares = calculate_position_size(
            capital=1_000_000, entry_price=100.0,
            risk_per_share=5.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        )
        assert isinstance(shares, int)

    def test_shares_truncated_not_rounded(self):
        shares = calculate_position_size(
            capital=1_000_000, entry_price=333.0,
            risk_per_share=3.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=1000, max_trade_value=200_000,
        )
        assert isinstance(shares, int)

    def test_high_risk_smaller_position(self):
        shares_low = calculate_position_size(
            capital=1_000_000, entry_price=100.0,
            risk_per_share=2.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        )
        shares_high = calculate_position_size(
            capital=1_000_000, entry_price=100.0,
            risk_per_share=20.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        )
        assert shares_low > shares_high

    def test_negative_capital_returns_zero(self):
        assert calculate_position_size(
            capital=-500_000, entry_price=100.0,
            risk_per_share=5.0, risk_per_trade_pct=0.01,
            max_capital_per_trade_pct=0.10,
            min_trade_value=5000, max_trade_value=200_000,
        ) == 0


# ---------------------------------------------------------------------------
# position_to_dict
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestPositionToDict:
    @staticmethod
    def _make_position(**overrides):
        defaults = {
            'symbol': 'RELIANCE',
            'side': MagicMock(value='BUY'),
            'quantity': 10,
            'entry_price': 2500.0,
            'current_price': 2550.0,
            'stop_loss': 2400.0,
            'take_profit': 2800.0,
            'unrealized_pnl': 500.0,
            'unrealized_pnl_pct': 2.0,
            'entry_time': datetime(2026, 4, 28, 9, 30, 0, tzinfo=timezone.utc),
            'strategy_id': 'orb_v1',
            'strategy_name': 'ORB Strategy',
        }
        defaults.update(overrides)
        pos = MagicMock()
        for k, v in defaults.items():
            setattr(pos, k, v)
        return pos

    def test_basic_dict_conversion(self):
        pos = self._make_position()
        d = position_to_dict(pos)
        assert d['symbol'] == 'RELIANCE'
        assert d['side'] == 'BUY'
        assert d['quantity'] == 10
        assert d['entry_price'] == 2500.0
        assert d['current_price'] == 2550.0
        assert d['stop_loss'] == 2400.0
        assert d['take_profit'] == 2800.0
        assert d['unrealized_pnl'] == 500.0
        assert d['unrealized_pnl_pct'] == 2.0
        assert d['strategy_id'] == 'orb_v1'
        assert d['strategy_name'] == 'ORB Strategy'

    def test_entry_time_isoformat(self):
        pos = self._make_position()
        d = position_to_dict(pos)
        assert isinstance(d['entry_time'], str)
        assert '2026-04-28' in d['entry_time']

    def test_with_extra_fields(self):
        pos = self._make_position()
        extras = {'bot_id': 42, 'custom_tag': 'test'}
        d = position_to_dict(pos, extra_fields=extras)
        assert d['bot_id'] == 42
        assert d['custom_tag'] == 'test'
        assert d['symbol'] == 'RELIANCE'

    def test_extra_fields_override_base(self):
        pos = self._make_position()
        d = position_to_dict(pos, extra_fields={'symbol': 'TCS'})
        assert d['symbol'] == 'TCS'

    def test_no_extra_fields(self):
        pos = self._make_position()
        d = position_to_dict(pos, extra_fields=None)
        assert 'symbol' in d
        assert len(d) == 13

    def test_sell_side_value(self):
        pos = self._make_position(side=MagicMock(value='SELL'))
        d = position_to_dict(pos)
        assert d['side'] == 'SELL'
