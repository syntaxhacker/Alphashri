"""Tests for api.value_scan.filters — pure gates, no network, deterministic."""

from api.value_scan.filters import PRESETS, apply_filters, describe_filters


def make_row(**overrides):
    """A healthy mid-cap row (fcf_yield 10%, mcap 20bn, above 200dma).

    ``_pct`` holds the market-relative percentile ranks that
    ``api.value_scan.scoring.score_row`` attaches (0 = cheapest / weakest,
    1 = richest / strongest inside the row's own sector bucket). The default
    values describe a cheap-but-strong row so the market-relative presets have
    something to pass.
    """
    row = {
        "name": "NSE:TEST",
        "sector": "Technology",
        "close": 100.0,
        "SMA200": 90.0,
        "price_52_week_high": 120.0,
        "volume": 1_000_000.0,
        "market_cap_basic": 20e9,
        "price_earnings_ttm": 10.0,
        "price_sales_ratio": 1.0,
        "price_book_fq": 2.0,
        "return_on_equity_fq": 20.0,
        "debt_to_equity_fq": 0.3,
        "free_cash_flow_ttm": 2e9,
        "total_revenue_yoy_growth_ttm": 12.0,
        "earnings_per_share_diluted_yoy_growth_ttm": 10.0,
        "earnings_per_share_diluted_ttm": 5.0,
        "dividends_yield_current": 2.5,
        "RSI": 55.0,
        "_pct": {
            "pe": 0.05,
            "ps": 0.05,
            "pb": 0.10,
            "roe": 0.90,
            "fcf_yield": 0.90,
            "rev_yoy": 0.70,
            "eps_yoy": 0.70,
            "de": 0.10,
            "off_52w_high": 0.60,
        },
    }
    row.update(overrides)
    return row


def pct(**overrides):
    """Return a percentile map with the given metrics overridden."""
    base = dict(make_row()["_pct"])
    base.update(overrides)
    return base


def serious_ok():
    return make_row()


def deep_ok():
    return make_row(price_earnings_ttm=7.0, price_book_fq=0.8, return_on_equity_fq=18.0)


def garp_ok():
    return make_row()


def yield_ok():
    return make_row(dividends_yield_current=5.0)


def turnaround_ok():
    return make_row(total_revenue_yoy_growth_ttm=1.0)


def test_preset_keys_match_spec():
    # the "cheap" presets are market-relative (percentile gates): absolute
    # multiples do not travel between markets.
    assert PRESETS["SERIOUS"] == {
        "pe_pct_max": 0.35, "roe_pct_min": 0.55, "fcf_yield_pct_min": 0.65,
        "eps_yoy_pct_min": 0.50, "off_52w_high_pct_min": 0.25,
        "min_eps_yoy": -50, "max_de": 1.0, "min_mcap_bn": 0.5,
    }
    assert PRESETS["DEEP"] == {
        "pe_pct_max": 0.15, "pb_pct_max": 0.30, "roe_pct_min": 0.70,
        "fcf_yield_pct_min": 0.80, "eps_yoy_pct_min": 0.50,
        "off_52w_high_pct_min": 0.15, "min_eps_yoy": -50, "max_de": 0.8,
        "min_mcap_bn": 0.5,
    }
    assert PRESETS["GARP_VALUE"] == {
        "pe_pct_max": 0.60, "roe_pct_min": 0.70, "rev_yoy_pct_min": 0.55,
        "eps_yoy_pct_min": 0.55, "min_rev_yoy": 5, "min_eps_yoy": 5, "min_fcf_yield": 1,
    }
    assert PRESETS["YIELD"] == {
        "min_div_yield": 4, "pe_pct_max": 0.50, "fcf_yield_pct_min": 0.60, "min_eps_yoy": 0,
    }
    assert PRESETS["TURNAROUND"] == {
        "max_pe": 15, "min_eps_yoy": 0, "max_rev_yoy": 5, "above_200dma": True,
    }
    assert PRESETS["NO_GATE"] == {}


def test_serious_preset():
    assert apply_filters([serious_ok()], PRESETS["SERIOUS"]) != []
    # expensive relative to its own bucket -> fails the percentile gate
    assert apply_filters([make_row(_pct=pct(pe=0.95))], PRESETS["SERIOUS"]) == []
    # weak ROE / weak FCF relative to the bucket -> fails
    assert apply_filters([make_row(_pct=pct(roe=0.10, fcf_yield=0.10))], PRESETS["SERIOUS"]) == []
    # deeply broken (worst quartile of drawdown from the 52w high) -> fails
    assert apply_filters([make_row(_pct=pct(off_52w_high=0.02))], PRESETS["SERIOUS"]) == []
    assert apply_filters([make_row(close=80.0)], PRESETS["SERIOUS"]) != []  # 200dma is a user filter, not a preset gate
    assert apply_filters([make_row(close=80.0)], {**PRESETS["SERIOUS"], "above_200dma": True}) == []
    assert apply_filters([make_row(debt_to_equity_fq=2.0)], PRESETS["SERIOUS"]) == []
    # a row without percentile information cannot pass a percentile gate
    no_pct = make_row()
    no_pct.pop("_pct")
    assert apply_filters([no_pct], PRESETS["SERIOUS"]) == []
    # a metric that is not populated for the whole bucket skips its gate
    # (TradingView has no free-cash-flow data for most Indian names)
    no_fcf = make_row()
    no_fcf["_avail"] = {"fcf_yield": False}
    assert apply_filters([no_fcf], PRESETS["SERIOUS"]) != []


def test_deep_preset():
    assert apply_filters([deep_ok()], PRESETS["DEEP"]) != []
    assert apply_filters([make_row(_pct=pct(pe=0.80))], PRESETS["DEEP"]) == []
    assert apply_filters([make_row(_pct=pct(pb=0.90))], PRESETS["DEEP"]) == []


def test_garp_value_preset():
    assert apply_filters([garp_ok()], PRESETS["GARP_VALUE"]) != []
    assert apply_filters([make_row(total_revenue_yoy_growth_ttm=2.0)], PRESETS["GARP_VALUE"]) == []
    assert apply_filters([make_row(_pct=pct(roe=0.10))], PRESETS["GARP_VALUE"]) == []


def test_yield_preset():
    assert apply_filters([yield_ok()], PRESETS["YIELD"]) != []
    assert apply_filters([make_row(dividends_yield_current=0.5)], PRESETS["YIELD"]) == []
    assert apply_filters([make_row(free_cash_flow_ttm=100.0)], PRESETS["YIELD"]) == []


def test_turnaround_preset():
    assert apply_filters([turnaround_ok()], PRESETS["TURNAROUND"]) != []
    # Stagnant growers pass; fast growers (>3%) are not turnarounds.
    assert apply_filters([make_row(total_revenue_yoy_growth_ttm=20.0)], PRESETS["TURNAROUND"]) == []
    assert apply_filters([make_row(earnings_per_share_diluted_yoy_growth_ttm=-20.0)], PRESETS["TURNAROUND"]) == []


def test_no_gate_preset_passes_everything():
    rows = [make_row(), {}, {"sector": "Banks"}]
    assert apply_filters(rows, PRESETS["NO_GATE"]) == rows


def test_no_filters_returns_all_rows_unchanged():
    rows = [make_row(), make_row(price_earnings_ttm=None)]
    assert apply_filters(rows, None) == rows
    assert apply_filters(rows, {}) == rows
    assert apply_filters(rows, {"bogus_key": 1}) == rows  # unknown-only ~= no-op


def test_unknown_keys_ignored():
    rows = [make_row()]
    assert apply_filters(rows, {"max_pe": 12, "nonsense": 999}) == rows


def test_none_values_fail_bounds():
    assert apply_filters([make_row(price_earnings_ttm=None)], {"max_pe": 12}) == []
    assert apply_filters([make_row(SMA200=None)], {"above_200dma": True}) == []
    assert apply_filters([make_row(market_cap_basic=None)], {"min_mcap_bn": 0.5}) == []
    assert apply_filters([make_row(debt_to_equity_fq=None)], {"max_de": 0.8}) == []
    assert apply_filters([make_row(**{"RSI": None})], {"max_rsi": 70}) == []


def test_sectors_filter_case_insensitive():
    bank = make_row(sector="Banks")
    assert apply_filters([bank], {"sectors": ["banks"]}) == [bank]
    assert apply_filters([bank], {"sectors": ["BANKS"]}) == [bank]
    assert apply_filters([bank], {"sectors": ["Technology"]}) == []
    assert apply_filters([make_row()], {"sectors": ["technology", "banks"]}) != []


def test_bounds_are_inclusive():
    assert apply_filters([make_row(price_earnings_ttm=12.0)], {"max_pe": 12}) != []
    assert apply_filters([make_row(price_earnings_ttm=12.01)], {"max_pe": 12}) == []
    assert apply_filters([make_row(market_cap_basic=0.5e9)], {"min_mcap_bn": 0.5}) != []


def test_boolean_and_range_gates():
    assert apply_filters([make_row()], {"require_low_de": True}) != []
    assert apply_filters([make_row(debt_to_equity_fq=5.0)], {"require_low_de": True}) == []
    assert apply_filters([make_row()], {"exclude_negative_fcf": True}) != []
    assert apply_filters([make_row(free_cash_flow_ttm=-1.0)], {"exclude_negative_fcf": True}) == []
    assert apply_filters([make_row()], {"exclude_negative_eps": True}) != []
    assert apply_filters([make_row(earnings_per_share_diluted_ttm=-1.0)], {"exclude_negative_eps": True}) == []
    assert apply_filters([make_row(earnings_per_share_diluted_ttm=-1.0)], {"exclude_loss_making": True}) == []
    assert apply_filters([make_row()], {"min_price": 100.0, "min_volume": 1_000_000.0, "max_rsi": 55.0}) != []
    assert apply_filters([make_row()], {"max_mcap_bn": 50.0, "min_mcap_bn": 1.0}) != []
    assert apply_filters([make_row()], {"min_pe": 8.0, "max_ps": 1.0, "max_pb": 2.0}) != []


def test_describe_filters_normalises_and_drops_empties():
    assert describe_filters(None) == {}
    assert describe_filters({}) == {}
    out = describe_filters(
        {"max_pe": 12, "bogus": 1, "min_roe": None, "sectors": [], "above_200dma": False, "min_mcap_bn": 0.5}
    )
    assert out == {"max_pe": 12, "min_mcap_bn": 0.5}
    assert describe_filters({"sectors": ["Banks", "  "]}) == {"sectors": ["Banks"]}
    assert describe_filters({"above_200dma": True}) == {"above_200dma": True}
