"""Contract tests for the pin / spot / wall panels (pure, offline)."""

from __future__ import annotations

import json
import re

import pytest

from scripts.market.report_viz import InstrumentSpec, render_page
from scripts.market.report_viz.charts.pin import (
    pin_null,
    pin_score,
    spot_pin,
    wall_migration,
)

TIMES = ("09:15", "09:20", "09:25", "09:30", "09:35")

SPOT = {
    "t": list(TIMES),
    "spot": [25110.0, 25085.4, None, 25070.2, 25096.8],
    "max_pain": [25000.0, 25000.0, 25050.0, 25050.0, 25000.0],
    "call_wall": [25200.0, 25200.0, 25200.0, 25250.0, 25250.0],
    "put_wall": [25000.0, 25000.0, None, 25050.0, 25000.0],
    "pin_band": 25.0,
}

SCORE = {
    "t": list(TIMES),
    "pin_score": [80.0, 60.0, None, 92.0, 70.0],
    "dist_pin": [10.0, 20.0, None, 4.0, 15.0],
    "band": 25.0,
}

NULL = {
    "t": list(TIMES),
    "obs": [10.0, 20.0, None, 10.0, 30.0],
    "p05": [5.0, 8.0, None, 7.0, 12.0],
    "p50": [20.0, 30.0, None, 20.0, 40.0],
    "p95": [60.0, 70.0, None, 64.0, 80.0],
}

WALLS = {
    "t": list(TIMES),
    "spot": [25110.0, 25085.4, None, 25070.2, 25096.8],
    "max_pain": [25000.0, 25000.0, 25050.0, 25050.0, 25000.0],
    "call_wall": [25200.0, 25200.0, 25200.0, 25250.0, 25250.0],
    "put_wall": [25000.0, 25000.0, None, 25050.0, 25000.0],
}

BUILDERS = [
    (spot_pin, "spot_pin", SPOT),
    (pin_score, "pin_score", SCORE),
    (pin_null, "pin_null", NULL),
    (wall_migration, "wall_migration", WALLS),
]

_PAYLOAD_RE = re.compile(
    r'<script type="application/json" class="rv-data">(.*?)</script>', re.S
)


def _spec(**overrides):
    base = dict(
        symbol="NIFTY",
        name="NIFTY",
        currency_symbol="₹",
        strike_step=50.0,
        lot_size=75,
        is_index=True,
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _sensex(**overrides):
    base = dict(
        symbol="SENSEX",
        name="SENSEX",
        currency_symbol="₹",
        strike_step=100.0,
        lot_size=20,
        is_index=True,
        venue="BSE",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _payload(html):
    match = _PAYLOAD_RE.search(html)
    assert match, "panel has no rv-data payload"
    return json.loads(match.group(1).replace("<\\/", "</"))


@pytest.mark.parametrize("builder, chart, data", BUILDERS, ids=[b[1] for b in BUILDERS])
def test_each_builder_emits_its_chart_name(builder, chart, data):
    html = builder(data, spec=_spec())
    assert f'data-rv-chart="{chart}"' in html
    assert _payload(html)["data"] is not None


def test_spot_pin_keeps_nulls_as_gaps():
    payload = _payload(spot_pin(SPOT, spec=_spec(), title="Pin"))
    assert payload["data"]["put_wall"][2] is None
    assert payload["data"]["spot"][2] is None
    assert payload["data"]["pin_band"] == 25.0


def test_missing_fields_are_none_not_zero():
    payload = _payload(spot_pin({"t": ["09:15"]}, spec=_spec()))
    data = payload["data"]
    assert data["spot"] == [None]
    assert data["max_pain"] == [None]
    assert data["call_wall"] == [None]
    assert data["put_wall"] == [None]
    # The band is a unit default, not a fabricated price.
    assert data["pin_band"] == 25.0


def test_null_cone_and_walls_keep_their_gaps():
    null_payload = _payload(pin_null(NULL, spec=_spec()))
    assert null_payload["data"]["obs"][2] is None
    assert null_payload["data"]["p95"][2] is None
    wall_payload = _payload(wall_migration(WALLS, spec=_spec()))
    assert wall_payload["data"]["put_wall"][2] is None
    assert "pin_band" not in wall_payload["data"]


def test_non_finite_values_become_gaps():
    payload = _payload(
        spot_pin(
            {"t": ["09:15", "09:20"], "spot": [float("nan"), 25100.0], "max_pain": [float("inf"), None]},
            spec=_spec(),
        )
    )
    assert payload["data"]["spot"] == [None, 25100.0]
    assert payload["data"]["max_pain"] == [None, None]


def test_pin_band_defaults_to_half_a_strike_step():
    data = {"t": ["09:15"], "spot": [25100.0], "max_pain": [25000.0]}
    assert _payload(spot_pin(data, spec=_spec()))["data"]["pin_band"] == 25.0
    assert _payload(spot_pin(data, spec=_sensex()))["data"]["pin_band"] == 50.0
    stock = _spec(symbol="RELIANCE", name="Reliance", strike_step=20.0, is_index=False)
    assert _payload(spot_pin(data, spec=stock))["data"]["pin_band"] == 10.0


def test_pin_score_accepts_band_alias():
    payload = _payload(pin_score(SCORE, spec=_spec()))
    assert payload["data"]["pin_band"] == 25.0
    assert payload["data"]["pin_score"][2] is None


def test_per_minute_band_survives_normalisation():
    data = dict(SPOT, pin_band=[20.0, 25.0, None, 30.0, 25.0])
    payload = _payload(spot_pin(data, spec=_spec()))
    assert payload["data"]["pin_band"] == [20.0, 25.0, None, 30.0, 25.0]


def test_spec_changes_labels_and_units_not_data():
    nifty = spot_pin(SPOT, spec=_spec())
    sensex = spot_pin(SPOT, spec=_sensex())

    assert _payload(nifty)["data"] == _payload(sensex)["data"]
    assert "NIFTY" in nifty and "SENSEX" in sensex
    assert "NIFTY" not in sensex
    assert "₹50 ladder" in nifty
    assert "₹100 ladder" in sensex
    assert "₹50" in nifty and "₹100" in sensex


@pytest.mark.parametrize("builder, chart, data", BUILDERS, ids=[b[1] for b in BUILDERS])
def test_same_data_under_two_specs_differs_only_in_spec_text(builder, chart, data):
    nifty = builder(data, spec=_spec())
    sensex = builder(data, spec=_sensex())

    assert _payload(nifty)["data"] == _payload(sensex)["data"]
    assert "NIFTY" in nifty
    assert "SENSEX" in sensex
    assert "NIFTY" not in sensex


def test_generic_panel_has_no_nifty_or_nifty_unit_literals():
    spec = _spec(
        symbol="RELIANCE",
        name="Reliance",
        venue="NASDAQ",
        currency="USD",
        currency_symbol="$",
        value_unit="$ M/pt",
        strike_step=20.0,
        lot_size=1,
        is_index=False,
        session_open="09:30",
        session_close="16:00",
        timezone="America/New_York",
    )
    labels = ["09:30", "09:35", "09:40"]
    data = {
        "t": labels,
        "spot": [25010.0, 25020.0, None],
        "max_pain": [25000.0, 25000.0, 25020.0],
        "call_wall": [25020.0, 25040.0, 25040.0],
        "put_wall": [24980.0, 25000.0, 25000.0],
        "pin_score": [80.0, 60.0, None],
        "dist_pin": [10.0, 20.0, None],
        "obs": [10.0, 20.0, None],
        "p05": [5.0, 8.0, None],
        "p50": [20.0, 30.0, None],
        "p95": [60.0, 70.0, None],
    }
    html = "\n".join(
        builder(dict(data), spec=spec)
        for builder in (spot_pin, pin_score, pin_null, wall_migration)
    )

    assert "NIFTY" not in html
    assert "25,000" not in html
    assert "09:15" not in html
    assert "15:30" not in html
    assert "₹" not in html
    assert "$" in html
    assert "09:30" in html and "16:00" in html
    assert "Reliance" in html


def test_pin_null_note_reports_observed_and_null_means():
    html = pin_null(NULL, spec=_spec())
    assert "observed mean 17.5 pts" in html
    assert "null median 27.5 pts" in html


def test_kwargs_override_chrome_defaults():
    html = spot_pin(
        SPOT,
        spec=_spec(),
        title="Custom pin",
        subtitle="Custom subtitle",
        span=1,
        height=222,
    )
    assert "Custom pin" in html
    assert "Custom subtitle" in html
    assert "rv-span-1" in html
    assert "--rv-chart-height:222px" in html


def test_render_page_inlines_all_four_registrations():
    panels = [builder(data, spec=_sensex()) for builder, _, data in BUILDERS]
    html = render_page(title="Generic pin report", spec=_sensex(), panels=panels)

    for _, chart, _ in BUILDERS:
        assert f'data-rv-chart="{chart}"' in html
        assert f'RV.register("{chart}"' in html
    assert "/* pin.js */" in html


def test_rejects_non_mapping_payload():
    with pytest.raises(TypeError):
        spot_pin([1, 2, 3], spec=_spec())  # type: ignore[arg-type]
