"""``exclude_loss_making`` must be the NET LOSS gate.

It used to test ``earnings_per_share_diluted_ttm`` — byte-for-byte the same
as ``exclude_negative_eps`` — so the UI's "Exclude loss-making" switch (a
separate switch from "Positive EPS") changed nothing. The router's degraded
fallback already used ``net_income``, which is the loss-making metric.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.value_scan.filters import apply_filters  # noqa: E402


def _row(**overrides):
    row = {
        "name": "NSE:TEST",
        "sector": "Technology",
        "close": 100.0,
        "market_cap_basic": 20e9,
        "price_earnings_ttm": 10.0,
        "earnings_per_share_diluted_ttm": 5.0,
        "net_income": 1e8,
    }
    row.update(overrides)
    return row


def test_profitable_company_passes_the_loss_making_gate():
    assert apply_filters([_row()], {"exclude_loss_making": True}) != []


def test_company_with_a_net_loss_is_excluded():
    assert apply_filters([_row(net_income=-1e8)], {"exclude_loss_making": True}) == []


def test_zero_net_income_is_excluded():
    assert apply_filters([_row(net_income=0.0)], {"exclude_loss_making": True}) == []


def test_positive_eps_with_a_net_loss_is_still_excluded():
    """EPS can be positive while the company is loss-making (one-off charges)."""
    row = _row(earnings_per_share_diluted_ttm=5.0, net_income=-1e8)
    assert apply_filters([row], {"exclude_loss_making": True}) == []


def test_unknown_net_income_does_not_pass_the_gate():
    """unknown != pass (the module contract)."""
    row = _row()
    row.pop("net_income")
    assert apply_filters([row], {"exclude_loss_making": True}) == []


def test_the_two_gates_are_no_longer_identical():
    """``exclude_negative_eps`` still measures EPS; the other gate measures profit."""
    row = _row(earnings_per_share_diluted_ttm=-1.0, net_income=1e8)
    assert apply_filters([row], {"exclude_negative_eps": True}) == []
    assert apply_filters([row], {"exclude_loss_making": True}) != []
