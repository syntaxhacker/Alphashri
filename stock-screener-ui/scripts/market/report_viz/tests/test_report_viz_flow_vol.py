from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from scripts.market.report_viz import InstrumentSpec
from scripts.market.report_viz.charts.flow import (
    flow_heatmap,
    flow_share,
    flow_stream,
    flow_top_itm,
)
from scripts.market.report_viz.charts.volatility import iv_smile, levels_distance

ASSET_DIR = Path(__file__).resolve().parents[1] / "assets"
_PAYLOAD = re.compile(
    r'<script type="application/json" class="rv-data">(.*?)</script>', re.S
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
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def payload(html: str) -> dict:
    match = _PAYLOAD.search(html)
    assert match, "panel must embed an rv-data payload"
    return json.loads(match.group(1).replace("<\\/", "</"))


def asset(name: str) -> str:
    return (ASSET_DIR / name).read_text()




def test_flow_stream_scales_volume_keeps_spot_and_spec():
    rows = [
        {
            "t": "09:15",
            "ce": 3_589_000,
            "pe": 3_065_000,
            "ce_itm": 904_000,
            "pe_itm": 306_000,
            "spot": 82000.1,
        },
        {
            "t": "09:20",
            "ce": 2_171_000,
            "pe": 1_951_000,
            "ce_itm": 472_000,
            "pe_itm": 373_000,
            "spot": 81920.5,
        },
    ]
    html = flow_stream(
        rows,
        spec=sensex(),
        unit="M units",
        scale=1e6,
        marks=[{"t": "09:20", "label": "open"}],
    )
    data = payload(html)["data"]

    assert data["t"] == ["09:15", "09:20"]
    assert data["ce"] == [3.6, 2.2]
    assert data["pe"] == [3.1, 2.0]
    assert data["ce_itm"] == [0.9, 0.5]
    assert data["pe_itm"] == [0.3, 0.4]
    assert data["spot"] == [82000.1, 81920.5]
    assert data["unit"] == "M units"
    assert data["spot_label"] == "SENSEX"
    assert data["marks"] == [{"t": "09:20", "label": "open"}]

    assert 'data-rv-chart="flow_stream"' in html
    assert "rv-span-2" in html
    assert "--rv-chart-height:320px" in html
    assert "NIFTY" not in html


def test_flow_stream_omits_optional_axes_and_rejects_bad_scale():
    html = flow_stream(
        [{"t": "09:15", "ce": 10, "pe": 20}],
        spec=stock(),
    )
    data = payload(html)["data"]
    assert "spot" not in data
    assert "ce_itm" not in data
    assert "SENSEX" not in html

    with pytest.raises(ValueError):
        flow_stream([{"t": "09:15", "ce": 1, "pe": 1}], spec=stock(), scale=0)
    with pytest.raises(ValueError):
        flow_stream([], spec=stock())




def test_flow_share_label_is_pe_volume_axis_in_percent():
    html = flow_share(
        [
            {"t": "09:15", "share": 10.0, "spot": 82000.0},
            {"t": "09:20", "share": None, "spot": 81950.0},
            {"t": "09:25", "share": 40.0, "spot": 81900.0},
        ],
        spec=sensex(),
    )
    data = payload(html)["data"]

    assert data["label"] == "ITM PE share of PE volume"
    assert data["share"] == [10.0, None, 40.0]
    assert data["median"] == 25.0
    assert data["spot"] == [82000.0, 81950.0, 81900.0]
    assert "ITM PE share of PE volume" in html
    assert "not a share of total option volume" in html
    assert 'data-rv-chart="flow_share"' in html


def test_flow_share_rejects_out_of_range_and_empty():
    with pytest.raises(ValueError):
        flow_share([{"t": "09:15", "share": 101.0}], spec=stock())
    with pytest.raises(ValueError):
        flow_share([{"t": "09:15", "share": None}], spec=stock())
    with pytest.raises(ValueError):
        flow_share([], spec=stock())




def test_flow_heatmap_preserves_nulls_and_does_not_zero_fill():
    html = flow_heatmap(
        ["09:15", "09:20"],
        [1000, 950],
        [[1_000_000, None], [None, 2_000_000]],
        spec=sensex(),
        unit="M units",
        scale=1e6,
        emphasis=1000,
    )
    data = payload(html)["data"]

    assert data["labels"] == ["09:15", "09:20"]
    assert data["strikes"] == [1000.0, 950.0]
    assert data["matrix"] == [[1.0, None], [None, 2.0]]
    assert data["matrix"][0][1] is None
    assert data["matrix"][1][0] is None
    assert data["row_totals"] == [1.0, 2.0]
    assert data["emphasis"] == 1000.0
    assert data["unit"] == "M units"

    assert "not zero-filled" in html
    assert "₹100 ladder" in html
    assert 'data-rv-chart="flow_heatmap"' in html


def test_flow_heatmap_validates_shape_and_emphasis():
    with pytest.raises(ValueError):
        flow_heatmap(["09:15"], [1000, 950], [[1.0]], spec=sensex())
    with pytest.raises(ValueError):
        flow_heatmap(["09:15", "09:20"], [1000], [[1.0]], spec=sensex())
    with pytest.raises(ValueError):
        flow_heatmap(["09:15"], [1000], [[1.0]], spec=sensex(), emphasis=1200)
    with pytest.raises(ValueError):
        flow_heatmap(["09:15"], [1000, 1000], [[1.0], [2.0]], spec=sensex())


def test_flow_heatmap_height_grows_with_the_ladder():
    short = flow_heatmap(["09:15"], [1000, 950], [[1.0], [2.0]], spec=sensex())
    long = flow_heatmap(
        [f"09:{minute:02d}" for minute in range(15, 55, 5)],
        [1000 - 50 * i for i in range(12)],
        [[1.0] * 8 for _ in range(12)],
        spec=sensex(),
    )
    assert "--rv-chart-height:260px" in short
    assert "--rv-chart-height:322px" in long
    assert "rv-span-1" in long




def test_flow_top_itm_ranks_and_derives_share():
    html = flow_top_itm(
        [
            {"strike": 25500, "pe_itm": 30_000_000, "pe": 30_000_000},
            {"strike": 25400, "pe_itm": 50_000_000, "pe": 80_000_000, "itm_share": 37.1},
            {"strike": 25600, "pe_itm": 20_000_000, "pe": 25_000_000},
        ],
        spec=sensex(),
        unit="M units",
        scale=1e6,
        limit=2,
    )
    data = payload(html)["data"]

    assert [row["strike"] for row in data["rows"]] == [25400.0, 25500.0]
    assert data["rows"][0]["pe_itm"] == 50.0
    assert data["rows"][0]["itm_share"] == 37.1
    assert data["rows"][0]["share"] == pytest.approx(62.5)
    assert data["rows"][1]["share"] == pytest.approx(37.5)
    assert data["share_label"] == "share of ITM PE"
    assert data["unit"] == "M units"
    assert "NIFTY" not in html




def test_iv_smile_keeps_missing_quotes_as_gaps():
    html = iv_smile(
        [
            {"strike": 100, "ce_iv": 30.0, "pe_iv": 25.0, "ce_delta": 0.9, "pe_delta": -0.1},
            {"strike": 120, "ce_iv": None, "pe_iv": 24.0},
            {"strike": 140, "ce_iv": 28.0, "pe_iv": None},
            {"strike": 160, "ce_iv": 26.0, "pe_iv": 22.0},
        ],
        spot=131,
        spec=stock(),
    )
    data = payload(html)["data"]

    assert data["strikes"] == [100.0, 120.0, 140.0, 160.0]
    assert data["ce_iv"] == [30.0, None, 28.0, 26.0]
    assert data["pe_iv"] == [25.0, 24.0, None, 22.0]
    assert data["ce_iv"][1] is None and data["pe_iv"][2] is None
    assert data["spot"] == 131.0
    assert data["atm"] == 140.0
    assert data["strike_step"] == 20.0
    assert data["spot_label"] == "Reliance"
    assert data["ce_delta"] == [0.9, None, None, None]

    assert "blank = no quote" in html
    assert "₹20 ladder" in html
    assert "NIFTY" not in html


def test_iv_smile_rejects_bad_input():
    with pytest.raises(ValueError):
        iv_smile([{"strike": 100, "ce_iv": 20.0}], spot=100, spec=stock())
    with pytest.raises(ValueError):
        iv_smile(
            [{"strike": 100, "ce_iv": None}, {"strike": 120, "pe_iv": None}],
            spot=110,
            spec=stock(),
        )
    with pytest.raises(ValueError):
        iv_smile(
            [{"strike": 100, "ce_iv": 0.0}, {"strike": 120, "ce_iv": 20.0}],
            spot=110,
            spec=stock(),
        )




def test_levels_distance_derives_sign_and_uses_spec_currency():
    html = levels_distance(
        [
            {"label": "Max pain", "kind": "max_pain", "strike": 81950},
            {"label": "Call #1", "kind": "call", "strike": 82050, "oi": 26_173_940},
            {"label": "Put #1", "kind": "put", "strike": 81900},
            {"label": "Gap", "kind": "level", "strike": 81980, "distance": -12.5},
        ],
        spot=82000,
        spec=sensex(),
    )
    data = payload(html)["data"]

    levels = {row["label"]: row for row in data["levels"]}
    assert levels["Max pain"]["kind"] == "maxpain"
    assert levels["Max pain"]["distance"] == -50.0
    assert levels["Call #1"]["distance"] == 50.0
    assert levels["Put #1"]["distance"] == -100.0
    assert levels["Gap"]["distance"] == -12.5
    assert levels["Call #1"]["oi"] == 26_173_940.0

    assert data["spot"] == 82000.0
    assert data["unit"] == "pts"
    assert data["spot_label"] == "SENSEX"
    assert data["strike_step"] == 100.0
    assert data["price_label"] == "₹ 2d"
    assert "distance is strike − spot" in html


def test_levels_distance_rejects_empty_and_bad_strike():
    with pytest.raises(ValueError):
        levels_distance([], spot=100, spec=stock())
    with pytest.raises(ValueError):
        levels_distance([{"label": "x", "kind": "call"}], spot=100, spec=stock())




def test_flow_asset_registers_names_and_keeps_nulls_blank():
    text = asset("flow.js")
    for name in ("flow_stream", "flow_share", "flow_heatmap", "flow_top_itm"):
        assert f'RV.register("{name}"' in text

    assert "RV.onResize" in text
    assert "RV.tip" in text
    assert "RV.timeTicks" in text
    assert "pointDecimals(spec)" in text
    assert "RV.money(spec" in text
    assert 'v + "%"' in text
    assert "d.label" in text
    assert "missing(" in text
    assert "isBlank" in text
    assert "merge = wide ? 1 : 3" in text
    assert "Math.max(320" in text
    assert "Plotly" not in text
    assert "NIFTY" not in text
    assert "₹" not in text


def test_volatility_asset_registers_names_and_breaks_lines_on_gaps():
    text = asset("volatility.js")
    for name in ("iv_smile", "levels_distance"):
        assert f'RV.register("{name}"' in text

    assert "RV.onResize" in text
    assert "RV.tip" in text
    assert "strikeDecimals(spec)" in text
    assert "d.strike_step" in text
    assert "RV.money(spec" in text
    assert 'RV.fmt(p.ce, 2) + "%"' in text
    assert ".defined(function (p) { return !missing(p.ce); })" in text
    assert ".defined(function (p) { return !missing(p.pe); })" in text
    assert "width >= 520" in text
    assert "Plotly" not in text
    assert "NIFTY" not in text
    assert "₹" not in text


def test_builders_have_no_instrument_literals():
    for name in ("flow.py", "volatility.py"):
        text = (Path(__file__).resolve().parents[1] / "charts" / name).read_text()
        assert "NIFTY" not in text
        assert "25500" not in text
        assert "₹" not in text
