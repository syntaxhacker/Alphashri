from __future__ import annotations

import json
import re

import pytest

from scripts.market.report_viz import InstrumentSpec
from scripts.market.report_viz.charts import gex as gex_charts


def _spec(**overrides):
    base = dict(
        symbol="SENSEX",
        name="SENSEX",
        currency_symbol="₹",
        price_decimals=2,
        strike_step=100.0,
        lot_size=20,
        is_index=True,
        value_unit="₹ Cr/pt",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _stock_spec(**overrides):
    base = dict(
        symbol="ACME",
        name="Acme Ltd",
        currency_symbol="$",
        price_decimals=2,
        strike_step=20.0,
        lot_size=1,
        is_index=False,
        value_unit="pts",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _payload(html: str) -> dict:
    match = re.search(
        r'<script type="application/json" class="rv-data">(.*?)</script>',
        html,
        re.S,
    )
    assert match, "panel payload missing"
    return json.loads(match.group(1))


def _gamma_data():
    return {
        "t": ["09:15", "09:20", "09:25"],
        "spot": [82000.0, 82050.0, 82020.0],
        "flip": [81900.0, None, 81950.0],
        "net_gex": [-120.0, 15.0, 260.0],
        "regime_gex": [-340.0, -300.0, -120.0],
    }


def test_gamma_flip_keeps_both_gex_definitions_separately():
    html = gex_charts.gamma_flip_gex(_gamma_data(), spec=_spec())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="gamma_flip_gex"' in html
    assert data["net_gex"] == [-120.0, 15.0, 260.0]
    assert data["regime_gex"] == [-340.0, -300.0, -120.0]
    assert data["definitions"]["net_gex"]["label"] == "net GEX, all strikes"
    assert data["definitions"]["net_gex"]["scope"] == "all strikes"
    assert data["definitions"]["regime_gex"]["label"] == "cumulative GEX, strikes ≤ spot"
    assert data["definitions"]["regime_gex"]["scope"] == "strikes ≤ spot"

    # Both labels must survive into the rendered chrome, not only the payload.
    assert "net GEX, all strikes" in html
    assert "cumulative GEX, strikes ≤ spot" in html


def test_null_flip_stays_a_gap_and_is_never_zero():
    data = _gamma_data()
    data["flip"] = [None, None, None]
    payload = _payload(gex_charts.gamma_flip_gex(data, spec=_spec()))
    assert payload["data"]["flip"] == [None, None, None]
    assert payload["data"]["flip_null"] == [0, 1, 2]
    assert payload["data"]["flip_null_note"] == "no cross"
    assert "no cross" in payload["data"]["flip_null_note"]
    assert not any(value == 0 for value in payload["data"]["flip"])


def test_partial_null_flip_remains_null_not_zero():
    payload = _payload(gex_charts.gamma_flip_gex(_gamma_data(), spec=_spec()))
    assert payload["data"]["flip"][1] is None
    assert payload["data"]["flip_null"] == [1]


def test_spot_and_flip_share_one_price_scale():
    data = _gamma_data()
    payload = _payload(gex_charts.gamma_flip_gex(data, spec=_spec()))
    domain = payload["data"]["domain"]["price"]
    visible = [value for value in data["spot"] + data["flip"] if value is not None]

    assert domain[0] <= min(visible)
    assert domain[1] >= max(visible)
    assert set(payload["data"]["domain"]) == {"price", "gex", "gex_scale"}


def test_missing_definition_is_rejected_instead_of_substituted():
    data = _gamma_data()
    del data["regime_gex"]
    with pytest.raises(ValueError, match="refusing to substitute"):
        gex_charts.gamma_flip_gex(data, spec=_spec())


def test_mismatched_series_lengths_are_rejected():
    data = _gamma_data()
    data["spot"] = data["spot"][:2]
    with pytest.raises(ValueError, match="series lengths must match"):
        gex_charts.gamma_flip_gex(data, spec=_spec())


def test_non_finite_values_are_rejected():
    data = _gamma_data()
    data["net_gex"] = [-120.0, float("nan"), 260.0]
    with pytest.raises(ValueError, match="finite"):
        gex_charts.gamma_flip_gex(data, spec=_spec())


def test_gex_profiles_share_scale_and_keep_null_flip():
    data = {
        "profiles": [
            {
                "label": "11:30",
                "t": "11:30",
                "strikes": [82000.0, 82100.0, 82200.0],
                "net_gex": [-5.0, 10.0, -2.0],
                "spot": 82110.0,
                "max_pain": 82100.0,
                "flip": 82040.0,
                "net_total": 3.0,
            },
            {
                "label": "14:00",
                "t": "14:00",
                "strikes": [82000.0, 82100.0, 82200.0],
                "net_gex": [20.0, -40.0, 15.0],
                "spot": 82080.0,
                "max_pain": 82000.0,
                "flip": None,
                "net_total": -5.0,
            },
        ]
    }

    html = gex_charts.gex_profiles(data, spec=_spec())
    payload = _payload(html)
    profiles = payload["data"]["profiles"]

    assert 'data-rv-chart="gex_profiles"' in html
    assert [profile["label"] for profile in profiles] == ["11:30", "14:00"]
    assert profiles[0]["cum_gex"] == [-5.0, 5.0, 3.0]
    assert profiles[1]["flip"] is None
    assert payload["data"]["domain"]["strike"] == [82000.0, 82200.0]
    assert payload["data"]["domain"]["gex"][0] <= -40.0
    assert payload["data"]["domain"]["gex"][1] >= 20.0
    assert payload["data"]["unit"] == "₹ Cr/pt"


def test_gex_profiles_explicit_cum_gex_is_respected():
    data = {
        "profiles": [
            {
                "label": "open",
                "strikes": [82000.0, 82100.0],
                "net_gex": [1.0, 2.0],
                "cum_gex": [7.0, 9.0],
            }
        ]
    }
    payload = _payload(gex_charts.gex_profiles(data, spec=_spec()))
    assert payload["data"]["profiles"][0]["cum_gex"] == [7.0, 9.0]


def test_gex_surface_preserves_null_cells():
    data = {
        "times": ["09:15", "09:20", "09:25"],
        "minutes": [555, 560, 565],
        "strikes": [82000.0, 82100.0],
        "z": [[1.0, None, 3.0], [None, -2.5, 4.0]],
    }

    html = gex_charts.gex_surface(data, spec=_spec())
    payload = _payload(html)
    surface = payload["data"]

    assert 'data-rv-chart="gex_surface"' in html
    assert surface["z"][0][1] is None
    assert surface["z"][1][0] is None
    assert surface["z"][0][0] == 1.0
    assert surface["null_count"] == 2
    assert surface["shape"] == {"strikes": 2, "times": 3}
    assert surface["domain"]["gex"] == [-4.0, 4.0]
    assert surface["unit"] == "₹ Cr/pt"


def test_gex_surface_dimension_mismatch_is_rejected():
    data = {
        "times": ["09:15", "09:20"],
        "strikes": [82000.0, 82100.0],
        "z": [[1.0, 2.0]],
    }
    with pytest.raises(ValueError, match="one row per strike"):
        gex_charts.gex_surface(data, spec=_spec())

    data = {
        "times": ["09:15", "09:20"],
        "strikes": [82000.0, 82100.0],
        "z": [[1.0], [2.0]],
    }
    with pytest.raises(ValueError, match="one cell per time"):
        gex_charts.gex_surface(data, spec=_spec())


def test_gex_by_strike_single_snapshot():
    data = {
        "label": "14:07",
        "t": "14:07",
        "strikes": [82000.0, 82100.0, 82200.0],
        "net_gex": [-8.0, 25.0, -3.0],
        "spot": 82110.0,
        "max_pain": 82100.0,
        "flip": None,
    }
    html = gex_charts.gex_by_strike(data, spec=_spec())
    payload = _payload(html)
    snapshot = payload["data"]["snapshots"][0]

    assert 'data-rv-chart="gex_by_strike"' in html
    assert len(payload["data"]["snapshots"]) == 1
    assert snapshot["net_gex"] == [-8.0, 25.0, -3.0]
    assert snapshot["spot"] == 82110.0
    assert snapshot["max_pain"] == 82100.0
    assert snapshot["flip"] is None
    assert payload["data"]["flip"] is None
    assert payload["data"]["unit"] == "₹ Cr/pt"


def test_gex_by_strike_aligns_different_ladders_with_nulls():
    data = {
        "snapshots": [
            {"label": "open", "strikes": [82000.0, 82200.0], "net_gex": [1.0, 3.0]},
            {"label": "close", "strikes": [82100.0, 82200.0], "net_gex": [2.0, -1.0]},
        ]
    }
    html = gex_charts.gex_by_strike(data, spec=_spec())
    payload = _payload(html)
    snapshots = payload["data"]["snapshots"]

    assert snapshots[0]["strikes"] == [82000.0, 82100.0, 82200.0]
    assert snapshots[0]["net_gex"] == [1.0, None, 3.0]
    assert snapshots[1]["net_gex"] == [None, 2.0, -1.0]
    assert payload["data"]["domain"]["strike"] == [82000.0, 82200.0]
    assert "rv-legend" in html
    assert ">open<" in html and ">close<" in html


def test_sensex_and_stock_change_axis_labels_and_units_only():
    data = {
        "label": "close",
        "strikes": [82000.0, 82100.0],
        "net_gex": [-1.0, 2.0],
        "spot": 82050.0,
        "max_pain": 82100.0,
    }
    sensex_html = gex_charts.gex_by_strike(data, spec=_spec())
    sensex = _payload(sensex_html)["data"]
    assert sensex["strike_step"] == 100.0
    assert sensex["unit"] == "₹ Cr/pt"
    assert "₹100 ladder" in sensex_html

    stock_data = dict(data, strikes=[410.0, 430.0], spot=420.0, max_pain=410.0)
    stock_html = gex_charts.gex_by_strike(stock_data, spec=_stock_spec())
    stock = _payload(stock_html)["data"]
    assert stock["strike_step"] == 20.0
    assert stock["unit"] == "pts"
    assert "$20 ladder" in stock_html
    assert "NIFTY" not in stock_html
    assert "₹" not in stock_html


def test_builders_do_not_hardcode_index_constants():
    data = _gamma_data()
    html = gex_charts.gamma_flip_gex(data, spec=_stock_spec())
    assert "NIFTY" not in html
    assert "25,000" not in html
    assert "₹" not in html


def test_asset_registers_four_renderers_and_uses_core_helpers():
    from pathlib import Path

    asset = Path(__file__).resolve().parents[1] / "assets" / "gex.js"
    js = asset.read_text()
    for name in ("gamma_flip_gex", "gex_profiles", "gex_surface", "gex_by_strike"):
        assert f'RV.register("{name}"' in js
    assert "RV.plotly(" in js
    assert "RV.plotlyLayout(" in js
    assert "NIFTY" not in js
    assert "25,000" not in js
    assert re.search(r"#[0-9A-Fa-f]{6}", js) is None
