from __future__ import annotations

import json
import math
import re
from pathlib import Path

import pytest

from scripts.market.report_viz import InstrumentSpec
from scripts.market.report_viz.charts.futures import (
    futures_basis,
    futures_price_oi,
    futures_regimes,
    futures_volume,
)

ASSET = Path(__file__).resolve().parents[1] / "assets" / "futures.js"
_PAYLOAD_RE = re.compile(
    r'<script type="application/json" class="rv-data">(.*?)</script>', re.S
)


def _payload(html: str) -> dict:
    match = _PAYLOAD_RE.search(html)
    assert match, html[:300]
    return json.loads(match.group(1))


def _sensex(**overrides) -> InstrumentSpec:
    base = dict(
        symbol="SENSEX",
        name="SENSEX",
        underlying="SENSEX",
        currency_symbol="₹",
        price_decimals=2,
        strike_step=100.0,
        lot_size=20,
        is_index=True,
        oi_unit="contracts",
        session_open="09:15",
        session_close="15:30",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _stock(**overrides) -> InstrumentSpec:
    base = dict(
        symbol="RELIANCE",
        name="Reliance Industries",
        underlying="RELIANCE",
        currency_symbol="$",
        price_decimals=1,
        strike_step=20.0,
        lot_size=250,
        is_index=False,
        oi_unit="contracts",
        value_unit="$ /pt",
        session_open="09:30",
        session_close="16:00",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


ROWS = [
    {
        "t": "2026-11-17T09:15:00+05:30",
        "close": 25345.0,
        "oi": 11_400_740,
        "volume": 69_550,
        "spot": None,
        "basis": None,
    },
    {
        "t": "2026-11-17T09:16:00+05:30",
        "close": 25370.0,
        "oi": 11_404_250,
        "volume": 27_300,
        "spot": 25366.35,
        "basis": 3.65,
    },
    {
        "t": "2026-11-17T09:17:00+05:30",
        "close": 25348.5,
        "oi": 11_410_360,
        "volume": 35_685,
        "spot": 25382.95,
        "basis": -34.45,
    },
    {
        "t": "2026-11-17T09:18:00+05:30",
        "close": None,
        "oi": None,
        "volume": None,
        "spot": 25352.5,
        "basis": None,
    },
]


def test_price_oi_payload_carries_series_and_stats() -> None:
    html = futures_price_oi(ROWS, spec=_sensex())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="futures_price_oi"' in html
    assert "rv-span-2" in html
    assert data["t"] == ["09:15", "09:16", "09:17", "09:18"]
    assert data["close"] == [25345.0, 25370.0, 25348.5, None]
    assert data["oi"] == [11_400_740, 11_404_250, 11_410_360, None]
    assert data["volume"][-1] is None

    stats = data["stats"]
    assert stats["bars"] == 4
    assert stats["first"] == 25345.0
    assert stats["last"] == 25348.5
    assert stats["change"] == 3.5
    assert stats["high"] == 25370.0
    assert stats["high_t"] == "09:16"
    assert stats["low"] == 25345.0
    assert stats["oi_change"] == 9_620
    assert stats["price_nulls"] == 1
    assert stats["oi_nulls"] == 1


def test_price_oi_uses_spec_for_units_and_session() -> None:
    html = futures_price_oi(ROWS, spec=_sensex())
    payload = _payload(html)
    spec = payload["spec"]
    assert spec["symbol"] == "SENSEX"
    assert spec["strike_step"] == 100.0
    assert spec["lot_size"] == 20
    assert "SENSEX" in html
    assert "₹" in html
    assert "09:15–15:30" in html
    assert "NIFTY" not in html


def test_basis_null_is_a_gap_never_zero() -> None:
    html = futures_basis(ROWS, spec=_sensex())
    payload = _payload(html)
    data = payload["data"]

    assert data["basis"] == [None, 3.65, -34.45, None]
    assert data["spot"] == [None, 25366.35, 25382.95, 25352.5]
    assert data["close"] == [25345.0, 25370.0, 25348.5, None]
    assert data["unit"] == "pts"

    stats = data["stats"]
    assert stats["points"] == 2
    assert stats["nulls"] == 2
    assert stats["mean"] == -15.4
    assert stats["min"] == -34.45
    assert stats["max"] == 3.65
    assert stats["positive_share"] == 0.5
    assert stats["last"] == -34.45
    assert stats["last_t"] == "09:17"

    assert "not percent" in html
    assert "blank, not a zero basis" in html
    assert 'data-rv-chart="futures_basis"' in html


def test_basis_is_derived_only_when_the_column_is_absent() -> None:
    rows = [
        {"t": "09:15", "close": 100.5, "spot": 100.0},
        {"t": "09:16", "close": 101.0, "spot": None},
    ]
    payload = _payload(futures_basis(rows, spec=_sensex()))
    assert payload["data"]["basis"] == [0.5, None]

    explicit_nulls = [
        {"t": "09:15", "close": 100.5, "spot": 100.0, "basis": None},
    ]
    payload = _payload(futures_basis(explicit_nulls, spec=_sensex()))
    assert payload["data"]["basis"] == [None]


def test_basis_legend_carries_the_mean_in_price_points() -> None:
    html = futures_basis(ROWS, spec=_sensex())
    assert "Session mean -15.4" in html
    assert "var(--rv-green)" in html


def _regime_rows() -> list[dict]:
    return [
        {"t": "09:15", "close": 100.0, "oi": 1_000, "volume": 10, "regime": "long_buildup"},
        {"t": "09:30", "close": 110.0, "oi": 2_000, "volume": 20, "regime": "long_buildup"},
        {"t": "09:45", "close": 112.0, "oi": 2_500, "volume": 30, "regime": "neutral"},
        {"t": "10:00", "close": 108.0, "oi": 2_100, "volume": 40, "regime": "short_covering"},
        {"t": "10:15", "close": 109.0, "oi": 2_150, "volume": 50, "regime": None},
        {"t": "10:30", "close": 104.0, "oi": 2_400, "volume": 60, "regime": "long_unwinding"},
        {"t": "10:45", "close": 102.0, "oi": 2_300, "volume": 70, "regime": "long_unwinding"},
    ]


def test_regimes_merge_rows_into_categorical_bands() -> None:
    payload = _payload(futures_regimes(_regime_rows(), spec=_sensex()))
    data = payload["data"]
    bands = data["bands"]

    assert [band["regime"] for band in bands] == [
        "long_buildup",
        "neutral",
        "short_covering",
        "long_unwinding",
    ]
    assert [(band["start"], band["end"]) for band in bands] == [
        ("09:15", "09:45"),
        ("09:45", "10:00"),
        ("10:00", "10:15"),
        ("10:30", "11:00"),
    ]
    assert bands[0]["dp"] == 10.0
    assert bands[0]["doi"] == 1_000
    assert bands[0]["volume"] == 30
    assert bands[1]["dp"] == 2.0
    assert bands[2]["dp"] == -4.0
    assert bands[3]["dp"] == -7.0

    for band in bands:
        assert isinstance(band["start_m"], int)
        assert band["end_m"] > band["start_m"]
        assert isinstance(band["regime"], str)
        assert "y" not in band

    categories = {category["id"]: category for category in data["categories"]}
    assert categories["long_buildup"] == {
        "id": "long_buildup",
        "label": "Long buildup",
        "tone": "green",
    }
    assert categories["short_buildup"]["tone"] == "red"
    assert categories["long_unwinding"]["tone"] == "amber"
    assert categories["short_covering"]["tone"] == "blue"
    assert categories["neutral"]["tone"] == "muted"

    assert data["stats"]["bands"] == 4
    assert data["stats"]["dominant"] == "long_buildup"
    assert data["stats"]["counts"]["long_buildup"] == 1
    assert data["stats"]["first"] == "09:15"
    assert data["stats"]["last"] == "11:00"


def test_regimes_accept_prebuilt_bands_and_custom_labels() -> None:
    data = {
        "bands": [
            {
                "start": "09:15",
                "end": "09:30",
                "regime": "long_buildup",
                "dp": 50.5,
                "doi": 96_915,
                "volume": 350_220,
                "from_price": 25_318.0,
                "to_price": 25_368.5,
            },
            {
                "start": "09:30",
                "end": "09:45",
                "regime": "mystery_flow",
                "dp": -4.0,
                "doi": -1_000,
                "volume": 10,
            },
            {
                "start": "09:45",
                "end": "10:00",
                "regime": "neutral",
                "from_price": 25_368.5,
                "to_price": 25_360.0,
            },
        ],
        "regime_labels": {"long_buildup": "Build-up"},
    }
    html = futures_regimes(data, spec=_sensex())
    payload = _payload(html)
    bands = payload["data"]["bands"]
    categories = {category["id"]: category for category in payload["data"]["categories"]}

    assert bands[0]["duration"] == 15
    assert bands[0]["dp"] == 50.5
    assert bands[0]["volume"] == 350_220
    assert bands[1]["end_m"] - bands[1]["start_m"] == 15
    assert bands[2]["dp"] == -8.5
    assert categories["long_buildup"]["label"] == "Build-up"
    assert categories["mystery_flow"]["label"] == "Mystery Flow"
    assert categories["mystery_flow"]["tone"] == "muted"
    assert "15-minute OI/price regime timeline" in html
    assert "Build-up" in html


def test_regimes_require_a_classification() -> None:
    with pytest.raises(ValueError, match="needs a 'regime' per row"):
        futures_regimes([{"t": "09:15", "close": 100.0}], spec=_sensex())


def test_volume_payload_keeps_gaps_and_finds_the_peak() -> None:
    html = futures_volume(ROWS, spec=_sensex())
    payload = _payload(html)
    data = payload["data"]

    assert data["t"] == ["09:15", "09:16", "09:17", "09:18"]
    assert data["volume"] == [69_550, 27_300, 35_685, None]
    stats = data["stats"]
    assert stats["total"] == 132_535
    assert stats["peak"] == 69_550
    assert stats["peak_t"] == "09:15"
    assert stats["bars"] == 3
    assert stats["nulls"] == 1
    assert stats["mean"] == pytest.approx(44_178.3, abs=0.1)
    assert "peak bar highlighted" in html


def test_sensex_and_stock_render_from_the_same_builders_with_their_own_units() -> None:
    def panels(spec: InstrumentSpec) -> list[str]:
        return [
            futures_price_oi(ROWS, spec=spec),
            futures_basis(ROWS, spec=spec),
            futures_regimes(_regime_rows(), spec=spec),
            futures_volume(ROWS, spec=spec),
        ]

    sensex_html = "".join(panels(_sensex()))
    stock_html = "".join(panels(_stock()))

    sensex_spec = _payload(futures_price_oi(ROWS, spec=_sensex()))["spec"]
    stock_spec = _payload(futures_price_oi(ROWS, spec=_stock()))["spec"]
    assert sensex_spec["strike_step"] == 100.0
    assert stock_spec["strike_step"] == 20.0
    assert sensex_spec["is_index"] is True
    assert stock_spec["is_index"] is False
    assert stock_spec["lot_size"] == 250
    assert stock_spec["price_decimals"] == 1

    assert "₹" in sensex_html
    assert "₹" not in stock_html
    assert "$" in stock_html
    assert "09:30–16:00" in stock_html
    assert "NIFTY" not in sensex_html + stock_html

    stock_basis = _payload(futures_basis(ROWS, spec=_stock()))
    assert stock_basis["data"]["stats"]["mean"] == -15.4
    assert stock_basis["spec"]["price_decimals"] == 1


def test_builder_output_has_no_hardcoded_palette_hex_or_nifty_level() -> None:
    for builder in (futures_price_oi, futures_basis, futures_volume):
        html = builder(ROWS, spec=_sensex())
        assert re.search(r"#[0-9A-Fa-f]{6}", html) is None
        chrome = html.split('class="rv-data"', 1)[0]
        assert "25,000" not in chrome
        assert "25000" not in chrome
        assert "Cr" not in chrome
        assert "NIFTY" not in chrome


def test_column_mapping_input_matches_row_input() -> None:
    columns = {
        "t": [row["t"] for row in ROWS],
        "close": [row["close"] for row in ROWS],
        "oi": [row["oi"] for row in ROWS],
        "volume": [row["volume"] for row in ROWS],
    }
    from_rows = _payload(futures_price_oi(ROWS, spec=_sensex()))["data"]
    from_columns = _payload(futures_price_oi(columns, spec=_sensex()))["data"]
    assert from_columns == from_rows


def test_nan_is_missing_and_never_becomes_zero() -> None:
    rows = [
        {"t": "09:15", "close": math.nan, "oi": 1_000, "volume": math.nan},
        {"t": "09:16", "close": 100.0, "oi": 1_100, "volume": 500},
    ]
    payload = _payload(futures_price_oi(rows, spec=_sensex()))
    assert payload["data"]["close"][0] is None
    assert payload["data"]["volume"][0] is None
    assert payload["data"]["stats"]["price_nulls"] == 1
    assert payload["data"]["stats"]["last"] == 100.0


def test_unordered_timestamps_fail_loudly() -> None:
    rows = [
        {"t": "09:16", "close": 100.0},
        {"t": "09:15", "close": 101.0},
    ]
    with pytest.raises(ValueError, match="strictly increase"):
        futures_price_oi(rows, spec=_sensex())


def test_non_numeric_close_fails_loudly() -> None:
    with pytest.raises(ValueError, match="expected a number"):
        futures_price_oi([{"t": "09:15", "close": "n/a"}], spec=_sensex())


def test_empty_payload_renders_empty_series() -> None:
    payload = _payload(futures_price_oi([], spec=_sensex()))
    assert payload["data"]["t"] == []
    assert payload["data"]["stats"]["bars"] == 0

    basis_payload = _payload(futures_basis([], spec=_sensex()))
    assert basis_payload["data"]["stats"]["points"] == 0
    assert basis_payload["data"]["stats"]["mean"] is None

    regimes_payload = _payload(futures_regimes([], spec=_sensex()))
    assert regimes_payload["data"]["bands"] == []
    assert len(regimes_payload["data"]["categories"]) == 5

    volume_payload = _payload(futures_volume([], spec=_sensex()))
    assert volume_payload["data"]["stats"]["total"] is None


# browser asset contract
def test_asset_registers_four_renderers_without_extra_libraries() -> None:
    text = ASSET.read_text()
    for name in (
        "futures_price_oi",
        "futures_basis",
        "futures_regimes",
        "futures_volume",
    ):
        assert f'RV.register("{name}"' in text

    for helper in ("RV.onResize", "RV.tip", "RV.svg", "RV.timeTicks", "RV.money"):
        assert helper in text
    assert ".defined(" in text
    assert "Plotly" not in text
    assert "d3.line" in text
    assert "NIFTY" not in text
    assert "09:15" not in text and "15:30" not in text
    assert "25,000" not in text and "25000" not in text


def test_asset_basis_tooltip_includes_futures_and_spot() -> None:
    text = ASSET.read_text()
    assert '["Futures", RV.money(spec, row.close)]' in text
    assert '["Spot", RV.money(spec, row.spot)]' in text
    assert '["Basis", pointText(row.basis, spec)]' in text


def test_render_page_inlines_the_futures_asset_once() -> None:
    from scripts.market.report_viz import render_page

    html = render_page(
        title="Futures fixture",
        spec=_sensex(),
        panels=[
            futures_price_oi(ROWS, spec=_sensex()),
            futures_basis(ROWS, spec=_sensex()),
            futures_regimes(_regime_rows(), spec=_sensex()),
            futures_volume(ROWS, spec=_sensex()),
        ],
    )
    assert "/* futures.js */" in html
    assert html.count("/* core.js */") == 1
    assert html.count("d3@7.9.0") == 1
    for name in (
        "futures_price_oi",
        "futures_basis",
        "futures_regimes",
        "futures_volume",
    ):
        assert f'RV.register("{name}"' in html
