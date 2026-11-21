from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from scripts.market.report_viz import InstrumentSpec, palette
from scripts.market.report_viz.charts.positioning import (
    ce_pe_divergence,
    ce_pe_net_positioning,
    participant_class_heatmap,
    participant_class_stream,
    participant_focus,
    pe_oi_heatmap,
    positioning_window_bars,
    strike_terrain,
    volume_vs_net_oi,
    wall_ladder,
)

ASSET_DIR = Path(__file__).resolve().parents[1] / "assets"
CHART_DIR = Path(__file__).resolve().parents[1] / "charts"
_PAYLOAD = re.compile(
    r'<script type="application/json" class="rv-data">(.*?)</script>', re.S
)

CHARTS = (
    "ce_pe_net_positioning",
    "ce_pe_divergence",
    "pe_oi_heatmap",
    "positioning_window_bars",
    "volume_vs_net_oi",
    "participant_class_stream",
    "participant_class_heatmap",
    "participant_focus",
    "strike_terrain",
    "wall_ladder",
)


def sensex(**overrides):
    base = dict(
        symbol="SENSEX",
        name="SENSEX",
        underlying="SENSEX",
        venue="BSE",
        currency="INR",
        currency_symbol="₹",
        price_decimals=2,
        strike_step=100.0,
        lot_size=20,
        is_index=True,
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def stock(**overrides):
    base = dict(
        symbol="RELIANCE",
        name="Reliance",
        venue="NSE",
        currency="INR",
        currency_symbol="₹",
        price_decimals=2,
        strike_step=20.0,
        lot_size=250,
        is_index=False,
        oi_unit="lots",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def payload(html: str) -> dict:
    match = _PAYLOAD.search(html)
    assert match, "panel must embed an rv-data payload"
    return json.loads(match.group(1).replace("<\\/", "</"))


def asset(name: str) -> str:
    return (ASSET_DIR / name).read_text()


# ---------------------------------------------------------------------------
# ce_pe_net_positioning
# ---------------------------------------------------------------------------


def test_ce_pe_net_positioning_keeps_signed_values_and_gaps():
    html = ce_pe_net_positioning(
        [
            {"t": "09:15", "ce": 1_200_000, "pe": -800_000, "spot": 82000.0},
            {"t": "09:20", "ce": -300_000, "pe": 1_500_000, "spot": 81960.0},
            {"t": "09:25", "ce": 0, "pe": 0, "spot": None},
            {"t": "09:30", "ce": 900_000, "pe": -100_000, "spot": 82010.0, "gap": True},
        ],
        spec=sensex(),
        unit="M contracts",
        scale=1e6,
    )
    data = payload(html)["data"]

    assert data["t"] == ["09:15", "09:20", "09:25", "09:30"]
    assert data["ce"] == [1.2, -0.3, 0.0, None]
    assert data["pe"] == [-0.8, 1.5, 0.0, None]
    assert data["ce"][1] == -0.3 and data["pe"][1] == 1.5
    assert data["gaps"] == [False, False, False, True]
    assert data["spot"] == [82000.0, 81960.0, None, 82010.0]
    assert data["unit"] == "M contracts"
    assert data["oi_unit"] == "contracts"
    assert data["scale"] == 1e6
    assert data["session"] == {
        "open": "09:15",
        "close": "15:30",
        "timezone": "Asia/Kolkata",
    }

    assert 'data-rv-chart="ce_pe_net_positioning"' in html
    assert "rv-span-2" in html
    assert "--rv-chart-height:300px" in html
    assert "net ΔOI per bucket" in html
    assert "NIFTY" not in html


def test_ce_pe_net_positioning_defaults_to_spec_oi_unit_and_validates():
    html = ce_pe_net_positioning(
        [{"t": "09:15", "ce": 10, "pe": -20}], spec=sensex()
    )
    data = payload(html)["data"]
    assert data["unit"] == "contracts"
    assert "spot" not in data

    with pytest.raises(ValueError):
        ce_pe_net_positioning([], spec=stock())
    with pytest.raises(ValueError):
        ce_pe_net_positioning([{"t": "09:15", "ce": None, "pe": None}], spec=stock())
    with pytest.raises(ValueError):
        ce_pe_net_positioning([{"t": "09:15", "ce": 1, "pe": 1}], spec=stock(), scale=0)


# ---------------------------------------------------------------------------
# ce_pe_divergence
# ---------------------------------------------------------------------------


def test_ce_pe_divergence_ranks_signed_bars_and_keeps_one_sided_nulls():
    html = ce_pe_divergence(
        [
            {"strike": 82000, "ce": -1_000_000, "pe": 2_000_000},
            {"strike": 82100, "ce": 3_000_000},
            {"strike": 82200, "pe": -500_000},
            {"strike": 82300, "ce": 1_000_000, "pe": -2_500_000},
        ],
        spec=sensex(),
        label="11:45–12:00",
        scale=1e6,
        spot_start=82000.0,
        spot_end=82080.0,
    )
    data = payload(html)["data"]

    assert data["strikes"] == [82300.0, 82000.0, 82100.0, 82200.0]
    assert data["ce"] == [1.0, -1.0, 3.0, None]
    assert data["pe"] == [-2.5, 2.0, None, -0.5]
    assert data["ce"][3] is None and data["pe"][2] is None
    assert data["axis_abs"] == 3.0
    assert data["label"] == "11:45–12:00"
    assert data["unit"] == "contracts"
    assert data["spot_start"] == 82000.0
    assert data["spot_end"] == 82080.0
    assert "ranked by |ΔPE − ΔCE|" in html


def test_ce_pe_divergence_rejects_empty_and_zero_limit():
    with pytest.raises(ValueError):
        ce_pe_divergence([], spec=stock())
    with pytest.raises(ValueError):
        ce_pe_divergence([{"strike": 100, "ce": None, "pe": None}], spec=stock())
    with pytest.raises(ValueError):
        ce_pe_divergence(
            [{"strike": 100, "ce": 1, "pe": 2}], spec=stock(), limit=0
        )


# ---------------------------------------------------------------------------
# pe_oi_heatmap
# ---------------------------------------------------------------------------


def test_pe_oi_heatmap_preserves_nulls_and_signed_cells():
    html = pe_oi_heatmap(
        ["09:15", "09:20"],
        [82000, 81900],
        [[1_000_000, None], [None, -2_000_000]],
        spec=sensex(),
        scale=1e6,
        emphasis=81900,
    )
    data = payload(html)["data"]

    assert data["labels"] == ["09:15", "09:20"]
    assert data["strikes"] == [82000.0, 81900.0]
    assert data["matrix"] == [[1.0, None], [None, -2.0]]
    assert data["matrix"][0][1] is None
    assert data["matrix"][1][0] is None
    assert data["row_totals"] == [1.0, -2.0]
    assert data["axis_abs"] == 2.0
    assert data["emphasis"] == 81900.0
    assert data["unit"] == "contracts"

    assert "blank = no print" in html
    assert "₹100 ladder" in html
    assert 'data-rv-chart="pe_oi_heatmap"' in html


def test_pe_oi_heatmap_validates_shape_and_all_blank_grid():
    with pytest.raises(ValueError):
        pe_oi_heatmap(["09:15"], [82000, 81900], [[1.0]], spec=sensex())
    with pytest.raises(ValueError):
        pe_oi_heatmap(["09:15", "09:20"], [82000], [[1.0]], spec=sensex())
    with pytest.raises(ValueError):
        pe_oi_heatmap(["09:15"], [82000], [[1.0]], spec=sensex(), emphasis=81900)
    with pytest.raises(ValueError):
        pe_oi_heatmap(["09:15"], [82000, 82000], [[1.0], [2.0]], spec=sensex())
    with pytest.raises(ValueError):
        pe_oi_heatmap(["09:15"], [82000], [[None]], spec=sensex())


# ---------------------------------------------------------------------------
# positioning_window_bars
# ---------------------------------------------------------------------------


def test_positioning_window_bars_sorts_descending_and_keeps_one_side_null():
    html = positioning_window_bars(
        [
            {
                "strike": 82000,
                "d_pe_oi": 5_000_000,
                "d_ce_oi": -1_000_000,
                "pe_oi": 30_000_000,
                "ce_oi": 10_000_000,
            },
            {
                "strike": 82100,
                "d_pe_oi": -2_000_000,
                "pe_oi": 20_000_000,
            },
        ],
        spec=sensex(),
        label="11:45–12:00",
        scale=1e6,
    )
    data = payload(html)["data"]

    assert [row["strike"] for row in data["rows"]] == [82100.0, 82000.0]
    assert data["rows"][0]["d_pe_oi"] == -2.0
    assert data["rows"][0]["d_ce_oi"] is None
    assert data["rows"][1]["d_pe_oi"] == 5.0
    assert data["rows"][1]["d_ce_oi"] == -1.0
    assert data["axis_abs"] == 5.0
    assert data["label"] == "11:45–12:00"
    assert data["unit"] == "contracts"
    assert 'data-rv-chart="positioning_window_bars"' in html


def test_positioning_window_bars_rejects_empty():
    with pytest.raises(ValueError):
        positioning_window_bars([], spec=stock())
    with pytest.raises(ValueError):
        positioning_window_bars(
            [{"strike": 100, "d_pe_oi": None, "d_ce_oi": None}], spec=stock()
        )


# ---------------------------------------------------------------------------
# volume_vs_net_oi
# ---------------------------------------------------------------------------


def test_volume_vs_net_oi_keeps_rows_and_bubble_oi():
    html = volume_vs_net_oi(
        [
            {"strike": 82000, "volume": 2_000_000, "d_oi": 5_000_000, "oi": 30_000_000},
            {"strike": 82100, "volume": 1_000_000, "d_oi": None, "oi": 20_000_000},
        ],
        spec=sensex(),
        scale=1e6,
    )
    data = payload(html)["data"]

    assert data["rows"][0] == {
        "strike": 82000.0,
        "volume": 2.0,
        "d_oi": 5.0,
        "oi": 30.0,
    }
    assert data["rows"][1]["d_oi"] is None
    assert data["rows"][1]["oi"] == 20.0
    assert data["unit"] == "contracts"
    assert data["volume_unit"] == "contracts"
    assert "bubble = PE OI" in html


def test_volume_vs_net_oi_rejects_empty_and_unplottable():
    with pytest.raises(ValueError):
        volume_vs_net_oi([], spec=stock())
    with pytest.raises(ValueError):
        volume_vs_net_oi(
            [{"strike": 100, "volume": 1, "d_oi": None}], spec=stock()
        )


# ---------------------------------------------------------------------------
# participant_class_stream
# ---------------------------------------------------------------------------


def test_participant_class_stream_uses_abs_magnitudes_and_gaps():
    html = participant_class_stream(
        [
            {
                "t": "09:15",
                "values": {"long_buildup": 2_000_000, "short_buildup": -1_000_000},
            },
            {
                "t": "09:20",
                "gap": True,
                "values": {"long_buildup": 999_000, "short_buildup": 999_000},
            },
            {"t": "09:25", "values": [3_000_000, None]},
        ],
        spec=sensex(),
        classes=[
            {"id": "long_buildup", "label": "Long buildup", "short": "LB"},
            {"id": "short_buildup", "label": "Short buildup", "short": "SB"},
        ],
        scale=1e6,
    )
    data = payload(html)["data"]

    series = {row["id"]: row["values"] for row in data["series"]}
    assert series["long_buildup"] == [2.0, None, 3.0]
    assert series["short_buildup"] == [1.0, None, None]
    assert data["gaps"] == [False, True, False]
    assert data["unit"] == "contracts"

    p = palette()
    assert data["classes"][0]["color"] == p["green"]
    assert data["classes"][1]["color"] == p["red"]
    assert data["classes"][0]["short"] == "LB"
    assert "Σ|ΔOI|" in html


def test_participant_class_stream_validates_shape_and_empty():
    with pytest.raises(ValueError):
        participant_class_stream([], spec=stock())
    with pytest.raises(ValueError):
        participant_class_stream(
            [{"t": "09:15", "values": {}}], spec=stock()
        )
    with pytest.raises(ValueError):
        participant_class_stream(
            [{"t": "09:15", "values": [1.0]}],
            spec=stock(),
            classes=[{"id": "a"}, {"id": "b"}],
        )


# ---------------------------------------------------------------------------
# participant_class_heatmap
# ---------------------------------------------------------------------------


def test_participant_class_heatmap_states_and_gap_columns():
    html = participant_class_heatmap(
        [
            {"t": "09:15", "state": "long_buildup"},
            {"t": "09:20", "gap": True},
            {"t": "09:25", "state": "short_cover"},
        ],
        spec=sensex(),
        classes=[
            {"id": "long_buildup", "label": "Long buildup", "short": "LB"},
            {"id": "short_cover", "label": "Short covering", "short": "SC"},
        ],
    )
    data = payload(html)["data"]

    assert data["t"] == ["09:15", "09:20", "09:25"]
    assert data["states"] == ["long_buildup", None, "short_cover"]
    assert data["gaps"] == [False, True, False]
    assert [row["id"] for row in data["classes"]] == ["long_buildup", "short_cover"]
    assert 'data-rv-chart="participant_class_heatmap"' in html


def test_participant_class_heatmap_rejects_unknown_and_empty():
    with pytest.raises(ValueError):
        participant_class_heatmap([], spec=stock())
    with pytest.raises(ValueError):
        participant_class_heatmap(
            [{"t": "09:15", "state": "mystery"}],
            spec=stock(),
            classes=[{"id": "long_buildup"}],
        )


# ---------------------------------------------------------------------------
# participant_focus
# ---------------------------------------------------------------------------


def test_participant_focus_defaults_to_nearest_present_strike_and_keeps_nulls():
    rows = [
        {"t": "11:00", "strike": 25450, "premium": 90.0, "oi": 10_000_000, "spot": 25406.0},
        {"t": "11:00", "strike": 25500, "premium": 107.3, "oi": 30_000_000, "spot": 25406.0},
        {"t": "12:00", "strike": 25500, "premium": 48.15, "oi": 25_000_000, "spot": 25483.7},
        {"t": "12:15", "strike": 25500, "premium": None, "oi": None, "spot": 25497.8},
    ]
    html = participant_focus(rows, spec=sensex(strike_step=50.0), side="PE", spot=25480.0)
    data = payload(html)["data"]

    assert data["strike"] == 25500.0
    assert data["side"] == "PE"
    assert data["t"] == ["11:00", "12:00", "12:15"]
    assert data["premium"] == [107.3, 48.15, None]
    assert data["oi"] == [30_000_000.0, 25_000_000.0, None]
    assert data["moneyness"] == [round(25500 - 25406.0, 1), round(25500 - 25483.7, 1), round(25500 - 25497.8, 1)]
    assert data["moneyness"][0] == 94.0
    assert data["spot"] == [25406.0, 25483.7, 25497.8]
    assert data["unit"] == "contracts"
    assert "₹25,500.00 PE focus" in html
    assert "line = premium" in html


def test_participant_focus_explicit_strike_and_moneyness_side():
    rows = [
        {"t": "09:15", "strike": 2520, "premium": 20.0, "oi": 1000, "spot": 2512.0},
        {"t": "09:20", "strike": 2520, "premium": 18.0, "oi": 900, "spot": 2515.0},
    ]
    data = payload(participant_focus(rows, spec=stock(), strike=2520, side="CE"))["data"]
    assert data["moneyness"] == [-8.0, -5.0]
    assert data["strike"] == 2520.0
    assert data["label"] == "₹2,520.00 CE"


def test_participant_focus_single_present_strike_needs_no_spot():
    rows = [{"t": "09:15", "strike": 25500, "premium": 100.0, "oi": 1_000}]
    data = payload(
        participant_focus(rows, spec=sensex(strike_step=50.0), side="PE")
    )["data"]
    assert data["strike"] == 25500.0
    assert data["moneyness"] == [None]
    assert "spot" not in data


def test_participant_focus_rejects_missing_strike_or_spot():
    rows = [{"t": "09:15", "premium": 10.0, "oi": 100}]
    with pytest.raises(ValueError):
        participant_focus(rows, spec=stock())
    with pytest.raises(ValueError):
        participant_focus([], spec=stock(), spot=100)
    with pytest.raises(ValueError):
        participant_focus(
            [{"t": "09:15", "strike": 100, "premium": 1.0}],
            spec=stock(),
            strike=120,
        )
    with pytest.raises(ValueError):
        participant_focus(
            [{"t": "09:15", "premium": 1.0, "oi": 1}], spec=stock(), side="XX", spot=100
        )


# ---------------------------------------------------------------------------
# strike_terrain
# ---------------------------------------------------------------------------


def test_strike_terrain_keeps_put_minus_call_signed():
    html = strike_terrain(
        [
            {"strike": 82200, "ce_oi": 25_000_000, "pe_oi": 5_000_000},
            {"strike": 82000, "ce_oi": 10_000_000, "pe_oi": 30_000_000},
            {"strike": 82100, "ce_oi": None, "pe_oi": 5_000_000},
        ],
        spec=sensex(),
        scale=1e6,
        spot=82050.0,
    )
    data = payload(html)["data"]

    assert data["strikes"] == [82000.0, 82100.0, 82200.0]
    assert data["net"] == [20.0, None, -20.0]
    assert data["net"][0] == 20.0 and data["net"][2] == -20.0
    assert data["pe_oi"] == [30.0, 5.0, 5.0]
    assert data["ce_oi"] == [10.0, None, 25.0]
    assert data["spot"] == 82050.0
    assert data["atm"] == 82000.0
    assert data["strike_step"] == 100.0
    assert "put-heavy (PE &gt; CE)" in html


def test_strike_terrain_rejects_empty_and_missing_side():
    with pytest.raises(ValueError):
        strike_terrain([], spec=stock())
    with pytest.raises(ValueError):
        strike_terrain(
            [{"strike": 100, "ce_oi": 10, "pe_oi": None}], spec=stock()
        )


# ---------------------------------------------------------------------------
# wall_ladder
# ---------------------------------------------------------------------------


def test_wall_ladder_distances_are_signed_points_from_spot():
    html = wall_ladder(
        [
            {
                "t": "09:15",
                "spot": 82000.0,
                "call_wall": 82100.0,
                "put_wall": 81900.0,
                "max_pain": 82050.0,
            },
            {
                "t": "09:20",
                "spot": 82050.0,
                "call_wall": None,
                "put_wall": 81950.0,
                "max_pain": 82000.0,
            },
        ],
        spec=sensex(),
    )
    data = payload(html)["data"]

    assert data["call"] == [100.0, None]
    assert data["put"] == [-100.0, -100.0]
    assert data["max_pain"] == [50.0, -50.0]
    assert data["spot"] == [82000.0, 82050.0]
    assert data["unit"] == "pts"
    assert data["spot_label"] == "SENSEX"
    assert "points from live spot" in html
    assert 'data-rv-chart="wall_ladder"' in html


def test_wall_ladder_rejects_empty_and_no_levels():
    with pytest.raises(ValueError):
        wall_ladder([], spec=stock())
    with pytest.raises(ValueError):
        wall_ladder([{"t": "09:15", "spot": 100}], spec=stock())


# ---------------------------------------------------------------------------
# units travel with the spec
# ---------------------------------------------------------------------------


def test_sensex_and_stock_units_change_only_through_the_spec():
    sensex_html = ce_pe_net_positioning(
        [{"t": "09:15", "ce": 10, "pe": -10}], spec=sensex()
    )
    stock_html = ce_pe_net_positioning(
        [{"t": "09:15", "ce": 10, "pe": -10}], spec=stock()
    )
    sensex_payload = payload(sensex_html)
    stock_payload = payload(stock_html)

    assert sensex_payload["spec"]["strike_step"] == 100.0
    assert sensex_payload["spec"]["name"] == "SENSEX"
    assert stock_payload["spec"]["strike_step"] == 20.0
    assert stock_payload["spec"]["is_index"] is False
    assert sensex_payload["data"]["unit"] == "contracts"
    assert stock_payload["data"]["unit"] == "lots"
    assert stock_payload["data"]["oi_unit"] == "lots"
    assert "SENSEX" not in json.dumps(stock_payload["data"])


def test_builder_outputs_all_panel_names():
    panels = {
        "ce_pe_net_positioning": ce_pe_net_positioning(
            [{"t": "09:15", "ce": 1, "pe": -1}], spec=stock()
        ),
        "ce_pe_divergence": ce_pe_divergence(
            [{"strike": 100, "ce": 1, "pe": -1}], spec=stock()
        ),
        "pe_oi_heatmap": pe_oi_heatmap(
            ["09:15"], [100], [[1]], spec=stock()
        ),
        "positioning_window_bars": positioning_window_bars(
            [{"strike": 100, "d_pe_oi": 1, "d_ce_oi": -1}], spec=stock()
        ),
        "volume_vs_net_oi": volume_vs_net_oi(
            [{"strike": 100, "volume": 1, "d_oi": 1, "oi": 10}], spec=stock()
        ),
        "participant_class_stream": participant_class_stream(
            [{"t": "09:15", "values": {"long_buildup": 1}}],
            spec=stock(),
            classes=[{"id": "long_buildup", "label": "Long buildup"}],
        ),
        "participant_class_heatmap": participant_class_heatmap(
            [{"t": "09:15", "state": "long_buildup"}],
            spec=stock(),
            classes=[{"id": "long_buildup", "label": "Long buildup"}],
        ),
        "participant_focus": participant_focus(
            [{"t": "09:15", "premium": 1, "oi": 10}], spec=stock(), spot=100
        ),
        "strike_terrain": strike_terrain(
            [{"strike": 100, "ce_oi": 1, "pe_oi": 2}], spec=stock()
        ),
        "wall_ladder": wall_ladder(
            [{"t": "09:15", "spot": 100, "call_wall": 110, "put_wall": 90}],
            spec=stock(),
        ),
    }
    for name, html in panels.items():
        assert f'data-rv-chart="{name}"' in html
        assert payload(html)["data"] is not None


# ---------------------------------------------------------------------------
# browser asset
# ---------------------------------------------------------------------------


def test_positioning_asset_registers_all_ten_names():
    text = asset("positioning.js")
    for name in CHARTS:
        assert f'RV.register("{name}"' in text

    assert "RV.onResize" in text
    assert "RV.tip" in text
    assert "RV.svg" in text
    assert "RV.money(spec" in text
    assert "RV.timeTicks" in text
    assert "Math.max(320" in text
    assert "width >= 620" in text
    assert "width >= 520" in text
    assert "pointDecimals(spec)" in text
    assert "missing(" in text
    assert "isBlank" in text
    assert "Plotly" not in text
    assert "NIFTY" not in text
    assert "₹" not in text
    assert "25500" not in text
    assert "25,500" not in text


def test_positioning_builder_has_no_instrument_literals():
    text = (CHART_DIR / "positioning.py").read_text()
    assert "NIFTY" not in text
    assert "25500" not in text
    assert "25,500" not in text
    assert "₹" not in text


def test_positioning_asset_handles_every_chart_empty_state():
    text = asset("positioning.js")
    assert text.count("blank(host") >= len(CHARTS)
