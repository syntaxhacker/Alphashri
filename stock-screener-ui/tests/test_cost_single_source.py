"""Single-source guards for trading-cost rate defaults and cost callers.

``backtest/costs.py`` owns the Indian intraday fee schedule. These tests pin
that the rate defaults restated in the strategy config layers are the very
same objects, and that every consumer that should use the canonical round-trip
math does so instead of a flat ``trade_value * 0.0006`` approximation.

PaperTrader's single-order ``calculate_costs`` is deliberately excluded from
the "must call canonical" rule: it accepts per-strategy rate overrides. The
parity tests below record exactly where it agrees with canonical and where it
intentionally diverges.
"""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backtest import costs

PROJECT = Path(__file__).resolve().parent.parent


def _reset_config_row(monkeypatch):
    """Run the paper reset-config handler against a mock DB row."""
    from api.paper import endpoints

    row = MagicMock()
    session = MagicMock()
    session.query.return_value.filter.return_value.first.return_value = row
    ctx = MagicMock()
    ctx.__enter__ = MagicMock(return_value=session)
    ctx.__exit__ = MagicMock(return_value=False)
    monkeypatch.setattr(endpoints, "SessionLocal", lambda: ctx)
    endpoints.reset_strategy_config_endpoint(name="orb_default", user=MagicMock())
    return row


class TestPaperResetConfigDefaults:
    def test_rate_defaults_are_canonical_objects(self, monkeypatch):
        """Reset must read the fee schedule, not restate its literals."""
        names = (
            "BROKERAGE_PCT", "MIN_BROKERAGE", "STT_PCT", "EXCHANGE_CHARGES_PCT",
            "SEBI_FEE_PCT", "STAMP_DUTY_PCT", "GST_PCT",
        )
        sentinels = {name: object() for name in names}
        for name, value in sentinels.items():
            monkeypatch.setattr(costs, name, value)

        row = _reset_config_row(monkeypatch)

        assert row.brokerage_pct is sentinels["BROKERAGE_PCT"]
        assert row.min_brokerage is sentinels["MIN_BROKERAGE"]
        assert row.stt_pct is sentinels["STT_PCT"]
        assert row.exchange_pct is sentinels["EXCHANGE_CHARGES_PCT"]
        assert row.sebi_pct is sentinels["SEBI_FEE_PCT"]
        assert row.stamp_pct is sentinels["STAMP_DUTY_PCT"]
        assert row.gst_pct is sentinels["GST_PCT"]

    def test_rate_defaults_match_canonical_values(self, monkeypatch):
        row = _reset_config_row(monkeypatch)

        assert row.brokerage_pct == costs.BROKERAGE_PCT
        assert row.min_brokerage == costs.MIN_BROKERAGE
        assert row.stt_pct == costs.STT_PCT
        assert row.exchange_pct == costs.EXCHANGE_CHARGES_PCT
        assert row.sebi_pct == costs.SEBI_FEE_PCT
        assert row.stamp_pct == costs.STAMP_DUTY_PCT
        assert row.gst_pct == costs.GST_PCT


class TestCanonicalRateDefaults:
    def test_min_brokerage_is_exported(self):
        assert costs.MIN_BROKERAGE == 20

    def test_calculate_trading_costs_uses_exported_cap(self, monkeypatch):
        monkeypatch.setattr(costs, "MIN_BROKERAGE", 5)
        out = costs.calculate_trading_costs(1000.0, 1000.0, 100)
        assert out["breakdown"]["buy_brokerage"] == 5.0
        assert out["breakdown"]["sell_brokerage"] == 5.0

    def test_config_loader_defaults_are_canonical_objects(self):
        from trading.config_loader import StrategyConfigData

        cfg = StrategyConfigData()
        assert cfg.brokerage_pct is costs.BROKERAGE_PCT
        assert cfg.min_brokerage is costs.MIN_BROKERAGE
        assert cfg.stt_pct is costs.STT_PCT
        assert cfg.exchange_pct is costs.EXCHANGE_CHARGES_PCT
        assert cfg.sebi_pct is costs.SEBI_FEE_PCT
        assert cfg.stamp_pct is costs.STAMP_DUTY_PCT
        assert cfg.gst_pct is costs.GST_PCT

    def test_db_model_defaults_are_canonical_objects(self):
        from db.models.bot import StrategyConfig

        columns = StrategyConfig.__table__.columns
        assert columns["brokerage_pct"].default.arg(None) is costs.BROKERAGE_PCT
        assert columns["min_brokerage"].default.arg(None) is costs.MIN_BROKERAGE
        assert columns["stt_pct"].default.arg(None) is costs.STT_PCT
        assert columns["exchange_pct"].default.arg(None) is costs.EXCHANGE_CHARGES_PCT
        assert columns["sebi_pct"].default.arg(None) is costs.SEBI_FEE_PCT
        assert columns["stamp_pct"].default.arg(None) is costs.STAMP_DUTY_PCT
        assert columns["gst_pct"].default.arg(None) is costs.GST_PCT


class TestPaperPortfolioRates:
    def test_fallback_rates_are_canonical_objects(self, monkeypatch):
        from trading.paper import paper_portfolio as pp

        monkeypatch.setattr(pp, "_config_available", False)
        trader = pp.PaperTrader()
        assert trader.brokerage_pct is costs.BROKERAGE_PCT
        assert trader.min_brokerage is costs.MIN_BROKERAGE
        assert trader.stt_pct is costs.STT_PCT
        assert trader.exchange_pct is costs.EXCHANGE_CHARGES_PCT
        assert trader.sebi_pct is costs.SEBI_FEE_PCT
        assert trader.stamp_pct is costs.STAMP_DUTY_PCT
        assert trader.gst_pct is costs.GST_PCT

    def test_default_rates_round_trip_matches_canonical(self, monkeypatch):
        """With canonical rates the two single-leg totals equal canonical."""
        from trading.paper import paper_portfolio as pp
        from trading.paper.paper_models import OrderSide

        monkeypatch.setattr(pp, "_config_available", False)
        trader = pp.PaperTrader()
        round_trip = round(
            trader.calculate_costs(100.0, 100, OrderSide.BUY)["total"]
            + trader.calculate_costs(105.0, 100, OrderSide.SELL)["total"],
            2,
        )
        assert round_trip == costs.calculate_trading_costs(100.0, 105.0, 100)["total_costs"]

    def test_custom_rates_intentionally_diverge(self):
        """A user-supplied fee schedule cannot be replaced by fixed constants."""
        from trading.paper import paper_portfolio as pp
        from trading.paper.paper_models import OrderSide

        trader = pp.PaperTrader(brokerage_pct=0.0006, min_brokerage=50, gst_pct=0.2)
        round_trip = round(
            trader.calculate_costs(100.0, 100, OrderSide.BUY)["total"]
            + trader.calculate_costs(105.0, 100, OrderSide.SELL)["total"],
            2,
        )
        assert round_trip != costs.calculate_trading_costs(100.0, 105.0, 100)["total_costs"]


class TestCanonicalCostConsumers:
    def test_profitability_has_no_flat_fallback(self):
        source = (PROJECT / "api" / "reports_api" / "profitability.py").read_text()
        assert "0.0006" not in source
        assert "flat-percentage fallback" not in source

    def test_profitability_cost_equals_canonical(self):
        from api.reports_api.profitability import _trade_cost

        assert _trade_cost(100.0, 105.0, 100) == costs.calculate_trading_costs(
            100.0, 105.0, 100
        )["total_costs"]

    def test_seed_data_has_no_flat_cost(self):
        source = (PROJECT / "scripts" / "seed_qa_data.py").read_text()
        assert "0.0006" not in source
        assert "calculate_trading_costs" in source


@pytest.mark.parametrize("relative_path", [
    "api/reports_api/profitability.py",
    "scripts/seed_qa_data.py",
])
def test_no_flat_cost_rate_in_owned_consumers(relative_path):
    assert "0.0006" not in (PROJECT / relative_path).read_text()
