from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from api.agri import aggregate


def _row(
    day: str,
    market: str,
    modal: float | None,
    low: float | None = None,
    high: float | None = None,
    arrivals: float | None = 10.0,
    *,
    key: str = "onion",
    variety: str = "",
) -> dict[str, Any]:
    return {
        "date": day, "state": "MH", "district": "Pune", "market": market,
        "commodity": "Onion", "commodity_key": key, "variety": variety, "grade": "FAQ",
        "min_price": low if low is not None else (modal - 100 if modal else None),
        "max_price": high if high is not None else (modal + 100 if modal else None),
        "modal_price": modal, "arrivals_qtl": arrivals,
        "price_unit": "Rs./Quintal", "source": "test",
    }


def test_metric_tonnes_are_multiplied_by_ten_and_raw_unit_kept():
    assert aggregate.normalise_arrivals(12.5, "Metric Tonnes") == (125.0, "Metric Tonnes")
    assert aggregate.normalise_arrivals(3, "Quintal") == (3.0, "Quintal")
    assert aggregate.normalise_arrivals(None, "Metric Tonnes") == (None, "Metric Tonnes")


def test_normalize_source_row_maps_ckan_columns_and_skips_untracked():
    row = aggregate.normalize_source_row({
        "date": "2026-05-31", "state_name": "Maharashtra", "district_name": "Pune",
        "market_center_name": "Pune APMC", "commodity_name": "Onion",
        "min_price": "100", "max_price": "200", "modal_price": "150",
        "arrival_quantity": "4", "arrival_units": "Metric Tonnes",
        "price_unit": "Rs./Quintal",
    }, source="test")
    assert row is not None
    assert row["commodity_key"] == "onion"
    assert row["arrivals_qtl"] == 40.0
    assert row["arrival_units"] == "Metric Tonnes"
    assert row["date"] == "2026-05-31"
    assert aggregate.normalize_source_row({"date": "2026-05-31", "commodity_name": "Absinthe"}, source="test") is None


def test_normalize_source_row_maps_data_gov_historical_uppercase_fields():
    row = aggregate.normalize_source_row({
        "Arrival_Date": "21/11/2026", "State": "Maharashtra", "District": "Pune",
        "Market": "Pune APMC", "Commodity": "Onion", "Variety": "Other",
        "Grade": "FAQ", "Min_Price": "100", "Max_Price": "200",
        "Modal_Price": "150", "Unit": "Rs./Quintal",
    }, source="agmarknet_daily")
    assert row is not None
    assert row["date"] == "2026-11-21"
    assert row["commodity_key"] == "onion"
    assert row["min_price"] == 100.0
    assert row["max_price"] == 200.0
    assert row["modal_price"] == 150.0
    assert row["price_unit"] == "Rs./Quintal"


def test_daily_modal_is_median_not_mean_and_arrivals_are_summed():
    rows = [
        _row("2026-05-31", "A", 100, 90, 110, 10),
        _row("2026-05-31", "B", 200, 190, 210, 20),
        _row("2026-05-31", "C", 1000, 990, 1010, 30),
    ]
    assert aggregate.aggregate_daily(rows) == [{
        "date": "2026-05-31", "modal": 200.0, "min": 90.0,
        "max": 1010.0, "arrivals_qtl": 60.0, "market_count": 3,
    }]


def test_daily_robust_min_max_clip_a_single_impossible_print():
    rows = [_row("2026-05-31", f"M{i:03d}", 1000.0, 900.0, 1100.0) for i in range(99)]
    outlier = _row("2026-05-31", "M999", 1000.0, 900.0, 1100.0)
    outlier["min_price"] = -500.0
    outlier["max_price"] = 1_350_000.0
    assert aggregate.aggregate_daily(rows + [outlier]) == [{
        "date": "2026-05-31", "modal": 1000.0, "min": 900.0,
        "max": 1100.0, "arrivals_qtl": 1000.0, "market_count": 100,
    }]


def test_daily_single_market_keeps_its_exact_range():
    out = aggregate.aggregate_daily([_row("2026-05-31", "A", 100.0, 90.0, 110.0)])
    assert out[0]["min"] == 90.0
    assert out[0]["max"] == 110.0


def test_changes_use_nearest_date_at_or_before_each_target():
    daily = [
        {"date": "2025-11-20", "modal": 60.0},
        {"date": "2026-04-29", "modal": 80.0},
        {"date": "2026-05-23", "modal": 100.0},
        {"date": "2026-05-31", "modal": 120.0},
    ]
    changes = aggregate.changes_from_daily(daily, "2026-05-31")
    assert changes == {"chg_1w_pct": 20.0, "chg_1m_pct": 50.0, "chg_6m_pct": 100.0}


def test_changes_are_null_without_an_earlier_anchor():
    daily = [{"date": "2026-05-31", "modal": 100.0}]
    assert aggregate.changes_from_daily(daily, "2026-05-31") == {
        "chg_1w_pct": None, "chg_1m_pct": None, "chg_6m_pct": None,
    }


def test_changes_do_not_cross_a_collection_gap():
    daily = [
        {"date": "2026-05-31", "modal": 100.0},
        {"date": "2026-11-21", "modal": 248.0},
    ]
    assert aggregate.changes_from_daily(daily, "2026-11-21") == {
        "chg_1w_pct": None, "chg_1m_pct": None, "chg_6m_pct": None,
    }


def test_gap_is_reported_as_a_warning():
    rows = [
        {"date": "2026-05-31", "modal": 100.0, "arrivals_qtl": 1.0, "price_unit": "Rs./Quintal"},
        {"date": "2026-11-21", "modal": 248.0, "arrivals_qtl": 1.0, "price_unit": "Rs./Quintal"},
    ]
    warnings = aggregate.collect_warnings(rows, "2026-11-21", today=date(2026, 11, 21))
    assert any("174-day gap" in warning for warning in warnings)


def test_range_is_anchored_to_as_of_not_today():
    daily = [
        {"date": "2026-01-01", "modal": 1.0},
        {"date": "2026-04-30", "modal": 2.0},
        {"date": "2026-05-01", "modal": 3.0},
        {"date": "2026-05-31", "modal": 4.0},
    ]
    as_of = "2026-05-31"
    assert aggregate.range_cutoff(as_of, "1m") == "2026-05-01"
    assert [p["date"] for p in aggregate.filter_by_range(daily, as_of, "1m")] == ["2026-05-01", "2026-05-31"]
    assert len(aggregate.filter_by_range(daily, as_of, "max")) == 4
    assert [p["date"] for p in aggregate.filter_by_range(daily, as_of, "6m", from_date="2026-04-30")] == [
        "2026-04-30", "2026-05-01", "2026-05-31",
    ]


def test_snapshot_covers_all_tracked_keys_and_marks_missing(sample_rows):
    snapshot = aggregate.latest_snapshot(sample_rows)
    assert len(snapshot) == 22
    onion = next(row for row in snapshot if row["key"] == "onion")
    assert onion["date"] == "2026-05-31"
    assert onion["modal"] == 2155.0
    jeera = next(row for row in snapshot if row["key"] == "jeera")
    assert jeera["date"] is None
    assert jeera["modal"] is None


def test_selected_quotes_keep_only_latest_date_per_mandi(sample_rows):
    onion_rows = [row for row in sample_rows if row["commodity_key"] == "onion"]
    quotes = aggregate.selected_quotes(onion_rows)
    assert len(quotes) == 2
    assert {q["date"] for q in quotes} == {"2026-05-31"}
    assert {q["market"] for q in quotes} == {"Pune APMC", "Bengaluru APMC"}
    assert quotes[0]["modal"] in (2130.0, 2180.0)
    assert len(aggregate.selected_quotes(onion_rows, limit=1)) == 1


def test_kpis_use_registered_units_and_null_msp(sample_rows):
    onion_rows = [row for row in sample_rows if row["commodity_key"] == "onion"]
    kpis = aggregate.kpis_for(aggregate.aggregate_daily(onion_rows), "2026-05-31", "onion")
    assert kpis["modal"] == 2155.0
    assert kpis["min"] == 2030.0
    assert kpis["max"] == 2330.0
    assert kpis["market_count"] == 2
    assert kpis["arrivals_qtl"] == 200.0
    assert kpis["unit"] == "INR/quintal"
    assert kpis["arrivals_unit"] == "qtl"
    assert kpis["msp"] is None
    assert kpis["distance_to_msp_pct"] is None
    assert kpis["chg_1w_pct"] == pytest.approx(3.36, abs=0.01)


def test_comparison_series_follows_the_range_window(sample_rows):
    by_key = {
        key: [row for row in sample_rows if row["commodity_key"] == key]
        for key in ("onion", "potato")
    }
    series = aggregate.comparison_series(by_key, "2026-05-31", "1m", from_date="2026-05-25")
    assert [s["key"] for s in series] == ["onion", "potato"]
    assert len(series[0]["points"]) == 7
    assert series[0]["points"][0]["date"] == "2026-05-25"


def test_freshness_and_warnings(sample_rows):
    assert aggregate.freshness_days("2026-05-31", today=date(2026, 5, 31)) == 0
    assert aggregate.freshness_days(None) is None
    fresh = aggregate.collect_warnings(sample_rows, "2026-05-31", selected_key="onion", today=date(2026, 5, 31))
    assert not any("stale" in warning for warning in fresh)
    assert any("MSP not verified" in warning for warning in fresh)
    stale = aggregate.collect_warnings(sample_rows, "2026-05-31", today=date(2026, 6, 30))
    assert any("30 days old" in warning for warning in stale)
