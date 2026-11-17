import re
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from candle_alert import render
from candle_alert.config import SYMBOLS, TIMEFRAMES

NOW = datetime(2026, 11, 17, 14, 23, 7, tzinfo=render.UTC)

CLOSES = {
    60: datetime(2026, 11, 17, 15, 0, tzinfo=render.UTC),
    240: datetime(2026, 11, 17, 16, 0, tzinfo=render.UTC),
}
SECONDS = {60: 2213, 240: 3600}

QUOTES = {
    "GOLD": SimpleNamespace(price=3325.80, prev_1h=3321.40, prev_4h=3300.00,
                            low_1h=3300.0, high_1h=3326.0, low_4h=3280.0, high_4h=3340.0),
    "NQ": SimpleNamespace(price=19842.50, prev_1h=19800.00, prev_4h=19750.25,
                          low_1h=19800.0, high_1h=20000.0, low_4h=19700.0, high_4h=19900.0),
    "OIL": SimpleNamespace(price=71.30, prev_1h=70.90, prev_4h=70.10,
                           low_1h=71.10, high_1h=71.50, low_4h=70.00, high_4h=71.50),
}

EXPECTED_KEYS = {
    "label", "tf_label", "close_str", "hms", "alert_str",
    "time_near", "price_near", "price_side",
    "price", "prev", "change_str",
}

LIST_ROWS = [
    {"label": "GOLD", "tf_label": "1H", "close_str": "15:00", "hms": "00:36:53",
     "alert_str": "14:59", "time_near": 38.5, "price_near": 99.2, "price_side": "HIGH",
     "price": "3,325.80", "prev": "3,321.40", "change_str": "+4.40 (+0.13%)"},
    {"label": "NQ", "tf_label": "1H", "close_str": "15:00", "hms": "00:36:53",
     "alert_str": "14:59", "time_near": 38.5, "price_near": 21.2, "price_side": "LOW",
     "price": "19,842.50", "prev": "19,800.00", "change_str": "+42.50 (+0.21%)"},
    {"label": "OIL", "tf_label": "1H", "close_str": "15:00", "hms": "00:36:53",
     "alert_str": "14:59", "time_near": 38.5, "price_near": 50.0, "price_side": "MID",
     "price": "71.30", "prev": "70.90", "change_str": "+0.40 (+0.56%)"},
]


def _next_close(tf, now):
    return CLOSES[tf]


def _seconds_until(tf, now):
    return SECONDS[tf]


def _change_pair(current, previous):
    change = current - previous
    return change, change / previous * 100


def test_build_rows():
    with patch.object(render, "next_close", side_effect=_next_close), \
         patch.object(render, "seconds_until", side_effect=_seconds_until), \
         patch.object(render, "change_pair", side_effect=_change_pair) as cp:
        rows = render.build_rows(QUOTES, NOW)

    assert len(rows) == len(SYMBOLS) * len(TIMEFRAMES)
    assert [r["label"] for r in rows] == [
        label for label, _ in SYMBOLS for _ in TIMEFRAMES
    ]
    assert [r["tf_label"] for r in rows] == ["1H", "4H"] * len(SYMBOLS)
    assert all(set(r) == EXPECTED_KEYS for r in rows)

    gold_1h, gold_4h = rows[0], rows[1]
    assert gold_1h["close_str"] == "15:00"
    assert gold_1h["hms"] == "00:36:53"
    assert gold_1h["alert_str"] == "14:59"
    assert gold_1h["price"] == "3,325.80"
    assert gold_1h["prev"] == "3,321.40"
    assert gold_1h["change_str"] == "+4.40 (+0.13%)"
    assert gold_1h["time_near"] == pytest.approx(38.5, abs=0.1)
    assert gold_1h["price_near"] == pytest.approx(99.2, abs=0.1)
    assert gold_1h["price_side"] == "HIGH"

    assert gold_4h["close_str"] == "16:00"
    assert gold_4h["alert_str"] == "15:59"
    assert gold_4h["prev"] == "3,300.00"
    assert gold_4h["time_near"] == pytest.approx(75.0)
    assert gold_4h["price_near"] == pytest.approx(76.3, abs=0.1)
    assert gold_4h["price_side"] == "HIGH"

    assert rows[2]["price_side"] == "LOW"
    assert rows[4]["price_side"] == "MID"

    assert cp.call_args_list[0].args == (3325.80, 3321.40)
    assert cp.call_args_list[1].args == (3325.80, 3300.00)


def test_price_near_edges():
    assert render.price_near(100.0, 100.0, 200.0) == (0.0, "LOW")
    assert render.price_near(200.0, 100.0, 200.0) == (100.0, "HIGH")
    assert render.price_near(150.0, 100.0, 200.0) == (50.0, "MID")
    assert render.price_near(100.0, 100.0, 100.0) == (50.0, "MID")


def test_range_text():
    assert render._range_text({"price_near": 100.0, "price_side": "HIGH"}) == "AT HIGH (100%)"
    assert render._range_text({"price_near": 0.0, "price_side": "LOW"}) == "AT LOW (0%)"
    assert render._range_text({"price_near": 50.0, "price_side": "MID"}) == "MID (50%)"
    assert render._range_text({"price_near": 12.0, "price_side": "LOW"}) == "NEAR LOW (12%)"


def test_render_list():
    out = render.render_list(LIST_ROWS, NOW)

    assert out.startswith("CANDLE CLOSE BOARD  now 14:23:07 UTC  (alert 1 min before close)\n")
    assert out.splitlines()[1] == render.COLUMN_HEADER
    row = out.splitlines()[2]
    for fragment in ("GOLD   1H", "closes 15:00", "left 00:36:53", "alert 14:59",
                     "38.5%", "HIGH  99.2%", "last 3,325.80", "prior 3,321.40",
                     "+4.40 (+0.13%)"):
        assert fragment in row
    assert "CLOSES AT" in render.COLUMN_HEADER
    assert "VS PRIOR RANGE" in render.COLUMN_HEADER
    assert "CHANGE abs/%" in render.COLUMN_HEADER
    assert out.endswith("\n")
    assert not re.search(r"[\u2500-\u257f]", out)


def test_render_notification_body():
    out = render.render_notification_body(LIST_ROWS)

    lines = out.splitlines()
    assert lines[0] == "1H closes at 15:00 UTC"
    assert lines[1] == ""
    assert len(lines) == 5
    for index, (label, near) in enumerate(
        (("GOLD", "range NEAR HIGH (99%)"), ("NQ", "range NEAR LOW (21%)"),
         ("OIL", "range MID (50%)")), start=2
    ):
        assert lines[index].startswith(label)
        assert "last " in lines[index]
        assert "prior close " in lines[index]
        assert near in lines[index]
    assert out.endswith("\n")
    assert not re.search(r"[\u2500-\u257f]", out)
