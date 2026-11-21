from __future__ import annotations

import math

import pytest

from scripts.market.report_viz import InstrumentSpec, panel, render_page
from scripts.market.report_viz.theme import palette, palette_css


def _spec(**overrides):
    base = dict(
        symbol="SENSEX",
        name="SENSEX",
        currency_symbol="₹",
        strike_step=100.0,
        lot_size=20,
        is_index=True,
        value_unit="₹ Cr/pt",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def test_panel_embeds_spec_and_data_without_html_breakout():
    host = panel(
        "gamma_flip_gex",
        {"t": ["09:15", "09:20"], "spot": [82000.0, 82100.0], "note": "</script>"},
        spec=_spec(),
        title="Gamma flip",
        subtitle="two definitions",
        legend=[("#8E7CC3", "flip")],
        note="null is not zero",
        span=2,
        height=320,
    )

    assert 'data-rv-chart="gamma_flip_gex"' in host
    assert "rv-span-2" in host
    assert "SENSEX" in host
    assert "₹" in host
    assert "<\\/script>" in host
    assert "</script>" not in host.split("rv-data", 1)[1].split("</script>", 1)[0]


def test_page_loads_core_assets_and_cdn_once():
    html = render_page(
        title="Generic report",
        spec=_spec(symbol="RELIANCE", name="Reliance", is_index=False),
        panels=[
            panel("spot_pin", {"spot": [1, None]}, spec=_spec(), title="Spot"),
        ],
    )

    assert html.startswith("<!doctype html>")
    assert "rv-shell" in html
    assert "d3@7.9.0" in html
    assert "plotly-2.35.2" in html
    assert html.count("assets/core.js") == 0  # assets are inlined, not linked


def test_spec_formats_currency_and_price_decimals():
    spec = _spec(currency_symbol="$", price_decimals=2)
    assert spec.money(1234.5) == "$1,234.50"
    assert spec.points(12.34) == "+12.3"


def test_non_finite_payload_is_rejected():
    with pytest.raises(ValueError):
        panel("spot_pin", {"spot": [math.nan]}, spec=_spec(), title="bad")


def test_palette_is_read_from_product_theme():
    p = palette()
    assert p["bg"] == "#000000"
    assert p["surface"] == "#13161C"
    assert "#D9902A" in palette_css().upper()
