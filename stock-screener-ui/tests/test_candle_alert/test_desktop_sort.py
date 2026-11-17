from datetime import datetime
from types import SimpleNamespace

import candle_alert_desktop as desktop
from candle_alert.config import UTC


ROWS = [
    {"label": "GOLD", "time_near": 14.3, "price_near": 75.0,
     "price": "3,873.00", "prev": "3,865.80", "change_str": "+7.20 (+0.19%)"},
    {"label": "NQ", "time_near": 3.6, "price_near": 50.9,
     "price": "27,396.00", "prev": "27,319.75", "change_str": "+76.25 (+0.28%)"},
    {"label": "OIL", "time_near": 14.3, "price_near": 0.0,
     "price": "84.97", "prev": "85.27", "change_str": "-0.30 (-0.35%)"},
]


def _app(sort_key, sort_reverse=False):
    return SimpleNamespace(sort_key=sort_key, sort_reverse=sort_reverse)


def test_sort_value_parses_formatted_cells():
    assert desktop._sort_value(ROWS[0], "change_str") == 7.2
    assert desktop._sort_value(ROWS[2], "change_str") == -0.3
    assert desktop._sort_value(ROWS[1], "price") == 27396.0
    assert desktop._sort_value(ROWS[0], "prev") == 3865.8
    assert desktop._sort_value(ROWS[0], "label") == "GOLD"


def test_sorted_rows_numeric_ascending_and_descending():
    ascending = desktop.CandleAlertApp._sorted_rows(_app("time_near"), ROWS)
    assert [r["label"] for r in ascending] == ["NQ", "GOLD", "OIL"]

    descending = desktop.CandleAlertApp._sorted_rows(_app("time_near", True), ROWS)
    assert [r["label"] for r in descending] == ["GOLD", "OIL", "NQ"]


def test_sorted_rows_string_and_formatted_cells():
    by_label = desktop.CandleAlertApp._sorted_rows(_app("label"), ROWS)
    assert [r["label"] for r in by_label] == ["GOLD", "NQ", "OIL"]

    by_change = desktop.CandleAlertApp._sorted_rows(_app("change_str"), ROWS)
    assert [r["label"] for r in by_change] == ["OIL", "GOLD", "NQ"]

    by_price = desktop.CandleAlertApp._sorted_rows(_app("price"), ROWS)
    assert [r["label"] for r in by_price] == ["OIL", "GOLD", "NQ"]


def test_sorted_rows_no_key_keeps_original_order():
    assert desktop.CandleAlertApp._sorted_rows(_app(None), ROWS) == ROWS


def test_next_alert_text():
    assert desktop._next_alert_text(
        datetime(2026, 11, 17, 3, 0, 0, tzinfo=UTC)
    ) == "NEXT ALERT 03:59 (in 59m)"
    assert desktop._next_alert_text(
        datetime(2026, 11, 17, 3, 59, 30, tzinfo=UTC)
    ) == "NEXT ALERT NOW"
    assert desktop._next_alert_text(
        datetime(2026, 11, 17, 4, 0, 0, tzinfo=UTC)
    ) == "NEXT ALERT 04:59 (in 59m)"
