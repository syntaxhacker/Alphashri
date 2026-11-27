from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from scripts.market.report_viz import InstrumentSpec
from scripts.market.report_viz.charts import replay3d

ASSET = Path(__file__).resolve().parents[1] / "assets" / "replay3d.js"
PAYLOAD_RE = re.compile(r'<script[^>]*class="rv-data"[^>]*>(.*?)</script>', re.S)

CHART_NAMES = (
    "positioning_terrain_3d",
    "iv_surface_3d",
    "futures_path_3d",
    "replay_heatmap",
    "replay_pe_focus",
    "top_volume_strikes",
    "event_annotations",
)


def _spec(**overrides) -> InstrumentSpec:
    base = dict(
        symbol="SENSEX",
        name="SENSEX",
        currency_symbol="₹",
        price_decimals=2,
        strike_step=100.0,
        lot_size=20,
        is_index=True,
        oi_unit="contracts",
        value_unit="₹ Cr/pt",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _stock_spec(**overrides) -> InstrumentSpec:
    base = dict(
        symbol="ACME",
        name="Acme Ltd",
        currency="USD",
        currency_symbol="$",
        price_decimals=2,
        strike_step=20.0,
        lot_size=1,
        is_index=False,
        oi_unit="shares",
        value_unit="pts",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _payload(html: str) -> dict:
    match = PAYLOAD_RE.search(html)
    assert match, "panel emitted no rv-data payload"
    return json.loads(match.group(1))


TERRAIN = {
    "times": ["10:00", "10:05", "10:10"],
    "minutes": [600, 605, 610],
    "strikes": [400.0, 420.0, 440.0],
    "metric": "pe_vol",
    "interval_label": "5 min",
    "metrics": {
        "pe_vol": [[1.5, None, 2.0], [0.0, 2.5, None], [3.0, 3.5, 4.0]],
        "pe_oi": [[-1.0, 0.5, 1.0], [None, 1.5, 2.0], [0.5, None, -2.0]],
        "ce_vol": [[1.0, 1.0, 1.0], [2.0, 2.0, 2.0], [3.0, 3.0, 3.0]],
        "ce_oi": [[-0.5, 0.5, 0.0], [0.0, -0.5, 0.5], [1.0, 1.0, None]],
    },
    "focus_strike": 420.0,
    "spot": [419.0, 421.0, None],
}

IV = {
    "times": ["10:00", "10:05", "10:10", "10:15", "10:20"],
    "minutes": [600, 605, 610, 615, 620],
    "strikes": [400.0, 420.0, 440.0],
    "z": [
        [12.0, 13.0, None, 14.0, 15.0],
        [11.0, None, 12.5, 13.5, 14.5],
        [13.0, 14.0, 15.0, None, 16.0],
    ],
    "spot": [420.0, 421.0, None, 419.0, 420.0],
}

FUTURES = {
    "points": [
        {"t": "10:00", "min": 600, "price": 42050.0, "oi": 1_200_000.0, "regime": "long_buildup"},
        {"t": "10:03", "min": 603, "price": 42080.0, "oi": None},
        {"t": "10:06", "min": 606, "price": None, "oi": 1_250_000.0, "regime": "flat"},
        {"t": "10:09", "min": 609, "price": 42110.0, "oi": 1_300_000.0, "regime": "short_cover"},
    ]
}

HEAT = {
    "times": ["10:00", "10:05", "10:10"],
    "minutes": [600, 605, 610],
    "strikes": [400.0, 420.0, 440.0],
    "metric": "oi",
    "interval_label": "5 min",
    "metrics": {
        "oi": [[1.0, None, 2.0], [None, 3.0, 4.0], [5.0, 6.0, None]],
        "vol": [[0.0, 1.0, 2.0], [3.0, 4.0, 5.0], [6.0, 7.0, 8.0]],
        "prem": [[10.0, 20.0, 30.0], [40.0, None, 50.0], [60.0, 70.0, 80.0]],
    },
    "focus_strike": 420.0,
    "spot": {"t": ["10:00", "10:05"], "price": [419.0, 421.0]},
}

FOCUS = {
    "strike": 420.0,
    "side": "PE",
    "t": [0, 60, 120],
    "premium": [12.5, 11.0, None],
    "oi": [1_000_000.0, 1_200_000.0, 1_300_000.0],
    "volume": [10.0, 20.0, None],
}

TOP_VOLUME = {
    "strikes": [
        {"strike": 440.0, "volume": 120.0},
        {"strike": 400.0, "volume": None},
        {"strike": 420.0, "volume": 300.0},
        {"strike": 460.0, "volume": 80.0},
    ]
}

EVENTS = {
    "events": [
        {"id": "open", "time": "09:20", "label": "Opening drive", "detail": "First push", "tone": "pos"},
        {"time": "11:45", "end": "12:00", "label": "Build window", "tone": "warn"},
    ]
}

CASES = [
    ("positioning_terrain_3d", replay3d.positioning_terrain_3d, TERRAIN),
    ("iv_surface_3d", replay3d.iv_surface_3d, IV),
    ("futures_path_3d", replay3d.futures_path_3d, FUTURES),
    ("replay_heatmap", replay3d.replay_heatmap, HEAT),
    ("replay_pe_focus", replay3d.replay_pe_focus, FOCUS),
    ("top_volume_strikes", replay3d.top_volume_strikes, TOP_VOLUME),
    ("event_annotations", replay3d.event_annotations, EVENTS),
]


def test_positioning_terrain_carries_metric_label_and_unit():
    html = replay3d.positioning_terrain_3d(TERRAIN, spec=_stock_spec())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="positioning_terrain_3d"' in html
    assert data["metric"] == "pe_vol"
    assert data["label"] == "PE volume"
    assert data["unit"] == "shares / 5 min"
    assert data["shape"] == {"strikes": 3, "times": 3}
    assert [option["id"] for option in data["metric_options"]] == [
        "pe_vol",
        "pe_oi",
        "ce_vol",
        "ce_oi",
    ]
    assert data["metric_options"][1]["label"] == "PE OI change"
    assert data["metric_options"][1]["unit"] == "shares change"
    assert data["metric_options"][2]["side"] == "ce"
    assert data["metrics"]["pe_vol"] == TERRAIN["metrics"]["pe_vol"]
    assert data["times"] == TERRAIN["times"]
    assert data["x"] == [600, 605, 610]
    assert data["strikes"] == [400.0, 420.0, 440.0]


def test_positioning_terrain_metric_switch_keeps_every_grid():
    switched = dict(TERRAIN, metric="ce_oi")
    payload = _payload(replay3d.positioning_terrain_3d(switched, spec=_stock_spec()))
    data = payload["data"]

    assert data["metric"] == "ce_oi"
    assert data["label"] == "CE OI change"
    assert data["unit"] == "shares change"
    assert set(data["metrics"]) == {"pe_vol", "pe_oi", "ce_vol", "ce_oi"}
    assert data["metrics"]["ce_oi"] == TERRAIN["metrics"]["ce_oi"]
    assert data["ranges"]["ce_oi"] == [-0.5, 1.0]


def test_positioning_terrain_accepts_payload_label_overrides():
    overridden = dict(
        TERRAIN,
        metric_options=[
            {"id": "pe_vol", "label": "Put volume added", "unit": "lots", "side": "put"}
        ],
    )
    payload = _payload(replay3d.positioning_terrain_3d(overridden, spec=_stock_spec()))
    data = payload["data"]

    assert data["label"] == "Put volume added"
    assert data["unit"] == "lots"
    assert data["metric_options"][0]["side"] == "pe"
    html = replay3d.positioning_terrain_3d(overridden, spec=_stock_spec())
    assert "Put volume added" in html


def test_positioning_terrain_keeps_null_cells_null():
    payload = _payload(replay3d.positioning_terrain_3d(TERRAIN, spec=_stock_spec()))
    data = payload["data"]

    assert data["metrics"]["pe_vol"][0][1] is None
    assert data["metrics"]["pe_vol"][1][2] is None
    assert data["null_counts"]["pe_vol"] == 2
    assert data["null_counts"]["ce_oi"] == 1
    # A missing cell must not become zero anywhere in the payload.
    assert data["metrics"]["pe_vol"][0][1] != 0
    assert data["spot"] == [419.0, 421.0, None]


def test_positioning_terrain_rejects_unknown_metric_and_bad_shape():
    with pytest.raises(ValueError, match="is not in this payload"):
        replay3d.positioning_terrain_3d(dict(TERRAIN, metric="missing"), spec=_stock_spec())

    short_rows = dict(TERRAIN, metrics={"pe_vol": [[1.0, 2.0, 3.0]]})
    with pytest.raises(ValueError, match="one row per strike"):
        replay3d.positioning_terrain_3d(short_rows, spec=_stock_spec())

    short_cells = dict(TERRAIN, metrics={"pe_vol": [[1.0], [2.0], [3.0]]})
    with pytest.raises(ValueError, match="one cell per time"):
        replay3d.positioning_terrain_3d(short_cells, spec=_stock_spec())

    with pytest.raises(ValueError, match="unsupported side"):
        replay3d.positioning_terrain_3d(
            dict(TERRAIN, metric_options=[{"id": "pe_vol", "side": "both"}]),
            spec=_stock_spec(),
        )


def test_terrain_and_iv_reject_duplicate_strikes_and_unsorted_clocks():
    with pytest.raises(ValueError, match="duplicate strike"):
        replay3d.positioning_terrain_3d(
            dict(TERRAIN, strikes=[400.0, 400.0, 440.0]), spec=_stock_spec()
        )
    with pytest.raises(ValueError, match="strictly increasing"):
        replay3d.positioning_terrain_3d(
            dict(TERRAIN, minutes=[605, 600, 610]), spec=_stock_spec()
        )
    with pytest.raises(ValueError, match="must be non-empty"):
        replay3d.iv_surface_3d(dict(IV, times=["10:00", "", "10:10", "10:15", "10:20"]), spec=_stock_spec())


def test_iv_surface_preserves_null_cells_and_reports_coverage():
    html = replay3d.iv_surface_3d(IV, spec=_stock_spec())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="iv_surface_3d"' in html
    assert data["z"][0][2] is None
    assert data["z"][1][1] is None
    assert data["z"][2][3] is None
    assert data["null_count"] == 3
    assert data["coverage"] == {
        "frames": 5,
        "cells": 15,
        "filled": 12,
        "pct": 80.0,
        "min_per_frame": 2,
        "median_per_frame": 2,
        "strike_band": [400.0, 440.0],
    }
    assert data["sufficient"] is True
    assert data["unit"] == "%"
    assert data["label"] == "OTM IV"
    assert data["spot"] == [420.0, 421.0, None, 419.0, 420.0]


def test_iv_surface_is_suppressed_when_coverage_is_thin():
    thin = dict(
        IV,
        times=["10:00", "10:05"],
        minutes=[600, 605],
        z=[[12.0, None], [None, None], [13.0, None]],
        spot=[420.0, None],
    )
    html = replay3d.iv_surface_3d(thin, spec=_stock_spec())
    payload = _payload(html)
    data = payload["data"]

    assert data["coverage"]["frames"] == 2
    assert data["coverage"]["filled"] == 2
    assert data["sufficient"] is False
    assert data["insufficient_note"] in html

    blank = dict(
        IV,
        z=[[None] * 5, [None] * 5, [None] * 5],
        spot=[],
    )
    blank_payload = _payload(replay3d.iv_surface_3d(blank, spec=_stock_spec()))
    assert blank_payload["data"]["coverage"]["filled"] == 0
    assert blank_payload["data"]["sufficient"] is False


def test_iv_surface_rejects_negative_values_and_bad_dimensions():
    negative = dict(IV, z=[[-1.0, 13.0, None, 14.0, 15.0]] + IV["z"][1:])
    with pytest.raises(ValueError, match="IV cannot be negative"):
        replay3d.iv_surface_3d(negative, spec=_stock_spec())

    with pytest.raises(ValueError, match="one row per strike"):
        replay3d.iv_surface_3d(dict(IV, z=IV["z"][:2]), spec=_stock_spec())

    with pytest.raises(ValueError, match="one cell per time"):
        replay3d.iv_surface_3d(dict(IV, z=[[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]), spec=_stock_spec())


def test_futures_path_keeps_gaps_and_regime_labels():
    html = replay3d.futures_path_3d(FUTURES, spec=_stock_spec())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="futures_path_3d"' in html
    assert data["price"] == [42050.0, 42080.0, None, 42110.0]
    assert data["oi"] == [1_200_000.0, None, 1_250_000.0, 1_300_000.0]
    assert data["regimes"] == ["long_buildup", None, "flat", "short_cover"]
    assert data["points"][0]["regime_label"] == "long buildup"
    assert data["points"][3]["regime_label"] == "short covering"
    assert data["range"]["price"] == [42050.0, 42110.0]
    assert data["oi_unit"] == "shares"
    labels = [item["label"] for item in _legend_items(html)]
    assert "long buildup" in labels
    assert "short covering" in labels
    assert _legend_items(html)[0]["color"] == "var(--rv-green)"
    assert _legend_items(html)[2]["color"] == "var(--rv-blue)"


def test_futures_path_accepts_parallel_arrays_and_close_alias():
    data = {
        "t": ["10:00", "10:01"],
        "min": [600, 601],
        "close": [100.0, 101.0],
        "oi": [10.0, 11.0],
    }
    payload = _payload(replay3d.futures_path_3d(data, spec=_stock_spec()))
    assert payload["data"]["price"] == [100.0, 101.0]
    assert payload["data"]["oi"] == [10.0, 11.0]
    assert payload["data"]["points"][1]["t"] == "10:01"


def test_futures_path_rejects_untimed_points_and_empty_axes():
    untimed = {"points": [{"price": 100.0, "oi": 10.0}]}
    with pytest.raises(ValueError, match="needs a time label or a minute"):
        replay3d.futures_path_3d(untimed, spec=_stock_spec())

    no_price = {"points": [{"t": "10:00", "price": None, "oi": 10.0}]}
    with pytest.raises(ValueError, match="no recorded price"):
        replay3d.futures_path_3d(no_price, spec=_stock_spec())

    no_oi = {"points": [{"t": "10:00", "price": 100.0, "oi": None}]}
    with pytest.raises(ValueError, match="no recorded open interest"):
        replay3d.futures_path_3d(no_oi, spec=_stock_spec())

    mismatched = {"t": ["10:00"], "price": [100.0, 101.0], "oi": [10.0, 11.0]}
    with pytest.raises(ValueError, match="series lengths must match"):
        replay3d.futures_path_3d(mismatched, spec=_stock_spec())

    backwards = {
        "points": [
            {"t": "10:03", "min": 603, "price": 100.0, "oi": 10.0},
            {"t": "10:00", "min": 600, "price": 101.0, "oi": 11.0},
        ]
    }
    with pytest.raises(ValueError, match="strictly increasing"):
        replay3d.futures_path_3d(backwards, spec=_stock_spec())


def test_replay_heatmap_preserves_nulls_and_units():
    html = replay3d.replay_heatmap(HEAT, spec=_stock_spec())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="replay_heatmap"' in html
    assert data["metric"] == "oi"
    assert data["label"] == "OI"
    assert data["unit"] == "shares"
    assert data["metrics"]["oi"][0][1] is None
    assert data["metrics"]["oi"][1][0] is None
    assert data["metrics"]["oi"][2][2] is None
    assert data["null_counts"]["oi"] == 3
    assert data["metric_options"][1]["label"] == "Volume"
    assert data["metric_options"][1]["unit"] == "shares / 5 min"
    assert data["metric_options"][2]["label"] == "Premium"
    assert data["metric_options"][2]["unit"] == "pts"
    assert data["spot"] == {"x": [0, 1], "price": [419.0, 421.0]}
    assert data["shape"] == {"strikes": 3, "times": 3}


def test_replay_heatmap_metric_switch_and_spot_pairs():
    switched = dict(HEAT, metric="vol", spot=[[0, 419.0], ["10:05", 421.0]])
    payload = _payload(replay3d.replay_heatmap(switched, spec=_stock_spec()))
    data = payload["data"]

    assert data["metric"] == "vol"
    assert data["label"] == "Volume"
    assert data["unit"] == "shares / 5 min"
    assert data["spot"] == {"x": [0, 1], "price": [419.0, 421.0]}
    assert set(data["metrics"]) == {"oi", "vol", "prem"}


def test_replay_heatmap_rejects_bad_shape_and_unknown_time():
    with pytest.raises(ValueError, match="one row per strike"):
        replay3d.replay_heatmap(
            dict(HEAT, metrics={"oi": HEAT["metrics"]["oi"][:2]}), spec=_stock_spec()
        )
    with pytest.raises(ValueError, match="one cell per time"):
        replay3d.replay_heatmap(
            dict(HEAT, metrics={"oi": [[1.0], [2.0], [3.0]]}), spec=_stock_spec()
        )
    with pytest.raises(ValueError, match="is not a recorded time label"):
        replay3d.replay_heatmap(
            dict(HEAT, spot={"t": ["10:01"], "price": [419.0]}), spec=_stock_spec()
        )


def test_focus_strike_keeps_nulls_and_uses_spec_money():
    html = replay3d.replay_pe_focus(FOCUS, spec=_stock_spec())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="replay_pe_focus"' in html
    assert data["strike"] == 420.0
    assert data["side"] == "PE"
    assert data["label"] == "PE focus"
    assert data["premium"] == [12.5, 11.0, None]
    assert data["oi"] == [1_000_000.0, 1_200_000.0, 1_300_000.0]
    assert data["volume"] == [10.0, 20.0, None]
    assert data["oi_unit"] == "shares"
    assert "$420" in html
    assert "₹" not in html


def test_focus_strike_accepts_source_aliases():
    legacy = {
        "strike": 420.0,
        "t": [0, 60, 120],
        "pe": [12.5, 11.0, None],
        "oi": [1_000_000.0, 1_200_000.0, 1_300_000.0],
        "vol": [[0, 10.0], [60, 20.0]],
    }
    payload = _payload(replay3d.replay_pe_focus(legacy, spec=_stock_spec()))
    data = payload["data"]
    assert data["side"] == "PE"
    assert data["label"] == "PE focus"
    assert data["premium"] == [12.5, 11.0, None]
    assert data["volume"] == [10.0, 20.0, None]


def test_focus_strike_rejects_non_monotonic_time():
    with pytest.raises(ValueError, match="strictly increasing"):
        replay3d.replay_pe_focus(dict(FOCUS, t=[0, 120, 60]), spec=_stock_spec())

    with pytest.raises(ValueError, match="premium and oi"):
        replay3d.replay_pe_focus(
            dict(FOCUS, premium=[None, None, None], oi=[None, None, None]),
            spec=_stock_spec(),
        )


def test_payload_unit_overrides_travel_into_axis_labels():
    futures = _payload(
        replay3d.futures_path_3d(
            dict(FUTURES, oi_unit="M contracts", price_unit="index points"),
            spec=_stock_spec(),
        )
    )["data"]
    assert futures["oi_unit"] == "M contracts"
    assert futures["price_unit"] == "index points"

    focus = _payload(
        replay3d.replay_pe_focus(
            dict(FOCUS, oi_unit="M units", volume_unit="M units / bucket"),
            spec=_stock_spec(),
        )
    )["data"]
    assert focus["oi_unit"] == "M units"
    assert focus["volume_unit"] == "M units / bucket"


def test_top_volume_strikes_sorts_nulls_last_and_honours_limit():
    payload = _payload(replay3d.top_volume_strikes(TOP_VOLUME, spec=_stock_spec()))
    data = payload["data"]

    assert [row["strike"] for row in data["rows"]] == [420.0, 440.0, 460.0, 400.0]
    assert data["rows"][0]["volume"] == 300.0
    assert data["rows"][-1]["volume"] is None
    assert data["null_count"] == 1
    assert data["unit"] == "shares"
    assert data["rows"][0]["label"] == "$420"
    assert data["total"] == 4

    limited = _payload(replay3d.top_volume_strikes(TOP_VOLUME, spec=_stock_spec(), limit=2))
    assert [row["strike"] for row in limited["data"]["rows"]] == [420.0, 440.0]
    assert limited["data"]["limit"] == 2


def test_top_volume_strikes_accepts_parallel_arrays():
    payload = _payload(
        replay3d.top_volume_strikes(
            {"strike": [400.0, 420.0], "volume": [5.0, 9.0], "unit": "lots"},
            spec=_stock_spec(),
        )
    )
    assert [row["strike"] for row in payload["data"]["rows"]] == [420.0, 400.0]
    assert payload["data"]["unit"] == "lots"


def test_top_volume_strikes_accepts_source_cum_alias():
    payload = _payload(
        replay3d.top_volume_strikes(
            {"strikes": [{"strike": 400.0, "cum": 5.0}, {"strike": 420.0, "cum": 9.0}]},
            spec=_stock_spec(),
        )
    )
    assert [row["strike"] for row in payload["data"]["rows"]] == [420.0, 400.0]
    assert payload["data"]["rows"][0]["volume"] == 9.0


def test_top_volume_strikes_rejects_negative_volume():
    with pytest.raises(ValueError, match="cannot be negative"):
        replay3d.top_volume_strikes(
            {"strikes": [{"strike": 400.0, "volume": -1.0}]}, spec=_stock_spec()
        )


def test_event_annotations_carry_times_and_labels_only():
    html = replay3d.event_annotations(EVENTS, spec=_stock_spec())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="event_annotations"' in html
    assert data["count"] == 2
    assert data["window"]["open"] == "09:15"
    assert data["window"]["close"] == "15:30"
    assert data["window"]["span_minutes"] == 375
    first, second = data["events"]
    assert first["id"] == "open"
    assert first["start_min"] == 560
    assert first["end"] is None
    assert second["start_min"] == 705
    assert second["end_min"] == 720
    assert second["label"] == "Build window"
    assert second["detail"] == ""
    assert second["tone"] == "warn"
    # The ribbon must not invent measurements of its own.
    for event in data["events"]:
        assert set(event) == {
            "id",
            "time",
            "start_min",
            "end",
            "end_min",
            "label",
            "detail",
            "tone",
        }


def test_event_annotations_rejects_bad_clocks_and_windows():
    with pytest.raises(ValueError, match="HH:MM"):
        replay3d.event_annotations(
            {"events": [{"time": "25:00", "label": "late"}]}, spec=_stock_spec()
        )
    with pytest.raises(ValueError, match="outside"):
        replay3d.event_annotations(
            {"events": [{"time": "08:00", "label": "early"}]}, spec=_stock_spec()
        )
    with pytest.raises(ValueError, match="not precede"):
        replay3d.event_annotations(
            {"events": [{"time": "12:00", "end": "11:00", "label": "backwards"}]},
            spec=_stock_spec(),
        )
    with pytest.raises(ValueError, match="tone"):
        replay3d.event_annotations(
            {"events": [{"time": "12:00", "label": "loud", "tone": "loud"}]},
            spec=_stock_spec(),
        )
    with pytest.raises(ValueError, match="close must be later"):
        replay3d.event_annotations(
            {
                "window": {"open": "10:00", "close": "09:00"},
                "events": [{"time": "10:00", "label": "x"}],
            },
            spec=_stock_spec(),
        )


def test_asset_registers_all_seven_renderers_and_uses_core_helpers():
    js = ASSET.read_text()
    for name in CHART_NAMES:
        assert f'RV.register("{name}"' in js
    assert "RV.plotly(" in js
    assert "RV.plotlyLayout(" in js
    assert "RV.onResize(" in js
    assert "RV.tip(" in js
    assert "metric_options" in js
    assert "aria-pressed" in js
    assert re.search(r"#[0-9A-Fa-f]{6}", js) is None
    for literal in ("NIFTY", "25,500", "₹"):
        assert literal not in js


def _legend_items(html: str) -> list[dict[str, str]]:
    return [
        {"color": color, "label": label}
        for color, label in re.findall(
            r'<span><i style="background:([^"]+)"></i>([^<]*)</span>', html
        )
    ]


def test_every_builder_is_instrument_agnostic_in_html_and_payload():
    for name, builder, data in CASES:
        html = builder(data, spec=_stock_spec())
        assert "NIFTY" not in html, name
        assert "25,500" not in html, name
        assert "₹" not in html, name
        assert _payload(html)["spec"]["symbol"] == "ACME"


@pytest.mark.parametrize("name,builder,data", CASES, ids=[case[0] for case in CASES])
def test_each_builder_emits_the_panel_name_the_asset_registers(name, builder, data):
    html = builder(data, spec=_stock_spec())
    assert f'data-rv-chart="{name}"' in html
    assert _payload(html)["spec"]["symbol"] == "ACME"


def test_sensex_and_stock_change_units_only():
    sensex = _payload(replay3d.positioning_terrain_3d(TERRAIN, spec=_spec()))["data"]
    assert sensex["metric_options"][0]["unit"] == "contracts / 5 min"
    assert sensex["metric_options"][1]["unit"] == "contracts change"

    stock = _payload(
        replay3d.positioning_terrain_3d(
            TERRAIN, spec=_stock_spec(strike_step=20.0, oi_unit="shares")
        )
    )["data"]
    assert stock["metric_options"][0]["unit"] == "shares / 5 min"
    assert stock["metric_options"][1]["unit"] == "shares change"

    heat = _payload(replay3d.replay_heatmap(HEAT, spec=_spec()))["data"]
    assert heat["metric_options"][0]["unit"] == "contracts"
    assert heat["metric_options"][2]["unit"] == "₹ Cr/pt"
