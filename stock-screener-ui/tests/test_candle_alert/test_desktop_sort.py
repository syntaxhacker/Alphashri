from datetime import datetime
from types import SimpleNamespace

import candle_alert_desktop as desktop
from candle_alert.config import UTC


ROWS = [
    {"label": "GOLD", "market": "USA", "time_near": 14.3, "price_near": 75.0,
     "price": "3,873.00", "prev": "3,865.80", "change_str": "+7.20 (+0.19%)"},
    {"label": "NQ", "market": "USA", "time_near": 3.6, "price_near": 50.9,
     "price": "27,396.00", "prev": "27,319.75", "change_str": "+76.25 (+0.28%)"},
    {"label": "OIL", "market": "USA", "time_near": 14.3, "price_near": 0.0,
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


def test_sorted_rows_keep_market_sections():
    india = {**ROWS[0], "label": "NIFTY", "market": "INDIA", "time_near": 1.0}
    rows = ROWS + [india]

    sorted_rows = desktop.CandleAlertApp._sorted_rows(_app("time_near"), rows)

    assert [row["market"] for row in sorted_rows] == ["USA", "USA", "USA", "INDIA"]
    assert [row["label"] for row in sorted_rows] == ["NQ", "GOLD", "OIL", "NIFTY"]


def test_sorted_rows_no_key_keeps_original_order():
    assert desktop.CandleAlertApp._sorted_rows(_app(None), ROWS) == ROWS


def _epoch(hour, minute):
    return int(datetime(2026, 11, 17, hour, minute, tzinfo=UTC).timestamp())


def _alert_row(hour, minute, label=None, zone="UTC"):
    return {
        "alert_epoch": _epoch(hour, minute),
        "alert_str": label or f"{hour:02d}:{minute:02d}",
        "tz_label": zone,
    }


def test_time_text_is_ist():
    now = datetime(2026, 11, 17, 4, 30, 15, tzinfo=UTC)
    assert desktop._time_text(now) == "10:00:15 IST"


def test_header_and_row_columns_align():
    starts = {}
    position = 0
    for key, title, width in desktop._COLUMNS:
        assert len(title) <= width, f"{title!r} overflows its {width}-char column"
        starts[key] = position
        position += width

    widths = desktop._WIDTHS
    row = {
        "label": "BANKNIFTY", "tf_label": "1H", "close_str": "12:15",
        "hms": "00:50:00",
    }
    text = (
        f"{row['label']:<{widths['label']}}{row['tf_label']:<{widths['tf_label']}}"
        f"{row['close_str']:<{widths['close_str']}}{row['hms']:<{widths['hms']}}"
    )
    assert text[starts["close_str"]:].startswith("12:15")
    assert text[starts["hms"]:].startswith("00:50:00")


def test_column_widths_fit_longest_symbol():
    from candle_alert.config import SYMBOLS

    widths = {key: width for key, _, width in desktop._COLUMNS}
    assert widths["label"] >= max(len(label) for label, _ in SYMBOLS)


def test_change_tag_scale():
    assert desktop._change_tag(1.5) == "chg_extreme_up"
    assert desktop._change_tag(0.5) == "chg_up"
    assert desktop._change_tag(0.1) == "chg_slight_up"
    assert desktop._change_tag(0.0) == "chg_flat"
    assert desktop._change_tag(-0.1) == "chg_slight_down"
    assert desktop._change_tag(-0.5) == "chg_down"
    assert desktop._change_tag(-1.5) == "chg_extreme_down"


def test_price_and_time_tags():
    assert desktop._price_tag("HIGH", 100.0) == "price_extreme_high"
    assert desktop._price_tag("LOW", 0.0) == "price_extreme_low"
    assert desktop._price_tag("HIGH", 80.0) == "price_high"
    assert desktop._price_tag("MID", 50.0) == "price_mid"
    assert desktop._time_tag(99.5) == "time_extreme"
    assert desktop._time_tag(96.0) == "time_hot"
    assert desktop._time_tag(85.0) == "time_warm"
    assert desktop._time_tag(20.0) == "time_cool"


def test_next_alert_text():
    rows = [_alert_row(3, 59), _alert_row(7, 59)]
    assert desktop._next_alert_text(
        rows, datetime(2026, 11, 17, 3, 0, 0, tzinfo=UTC)
    ) == "NEXT ALERT 03:59 UTC (in 59m)"
    assert desktop._next_alert_text(
        [_alert_row(3, 59)], datetime(2026, 11, 17, 3, 59, 30, tzinfo=UTC)
    ) == "NEXT ALERT NOW"
    assert desktop._next_alert_text(
        [], datetime(2026, 11, 17, 4, 0, 0, tzinfo=UTC)
    ) == "NEXT ALERT --:--"
    ist_rows = [_alert_row(4, 44, label="10:14", zone="IST")]
    assert desktop._next_alert_text(
        ist_rows, datetime(2026, 11, 17, 4, 0, 0, tzinfo=UTC)
    ) == "NEXT ALERT 10:14 IST (in 44m)"
