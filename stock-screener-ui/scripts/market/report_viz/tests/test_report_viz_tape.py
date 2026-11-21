from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from scripts.market.report_viz import InstrumentSpec
from scripts.market.report_viz.charts import tape

ASSET = Path(__file__).resolve().parents[1] / "assets" / "tape.js"
PAYLOAD_RE = re.compile(r'<script[^>]*class="rv-data"[^>]*>(.*?)</script>', re.S)

CHART_NAMES = (
    "tape_spot_futures",
    "tape_basis",
    "tape_oi_pcr",
    "tape_volume",
    "tape_walls",
    "tape_surface",
    "tape_strikes",
    "tape_oi_change",
    "tape_timeline",
    "rv_iv",
    "straddle_1sigma",
)


def _spec(**overrides) -> InstrumentSpec:
    base = dict(
        symbol="SENSEX",
        name="SENSEX",
        currency_symbol="₹",
        strike_step=100.0,
        lot_size=20,
        is_index=True,
        oi_unit="contracts",
    )
    base.update(overrides)
    return InstrumentSpec(**base)


def _payload(panel_html: str) -> dict:
    match = PAYLOAD_RE.search(panel_html)
    assert match, "panel emitted no rv-data payload"
    return json.loads(match.group(1))


SURFACE = {
    "x": [0, 10, 20],
    "xlabels": ["09:15", "09:25", "09:35"],
    "y": [24800.0, 24900.0],
    "z": [[1.0, None, 3.0], [None, None, 6.0]],
}

PHASES = [
    {"label": "Opening pop", "start": 0, "duration": 2, "change": 22.0},
    {"label": "Opening fade", "start": 2, "duration": 30, "change": -120.5},
    {"label": "Afternoon bounce", "start": 264, "duration": 40, "change": 70.0},
]

CASES = [
    (
        "tape_spot_futures",
        tape.tape_spot_futures,
        {"t": ["09:15", "09:16"], "spot": [81000.0, 81100.0], "futures": [81020.0, 81120.0]},
    ),
    ("tape_basis", tape.tape_basis, {"t": ["09:15", "09:16"], "basis": [-12.5, 3.0]}),
    (
        "tape_oi_pcr",
        tape.tape_oi_pcr,
        {
            "t": ["09:15", "09:16"],
            "ce_oi": [10_000, 11_000],
            "pe_oi": [12_000, 12_500],
            "pcr": [1.2, 1.14],
        },
    ),
    (
        "tape_volume",
        tape.tape_volume,
        {"labels": ["09:15–09:30", "09:30–10:00"], "ce": [1.0, 2.0], "pe": [None, 4.0]},
    ),
    (
        "tape_walls",
        tape.tape_walls,
        {
            "t": ["09:15", "09:16"],
            "spot": [81000.0, 81050.0],
            "max_pain": [81000.0, None],
            "call_wall": [81500.0, 81500.0],
            "put_wall": [80500.0, None],
        },
    ),
    ("tape_surface", tape.tape_surface, SURFACE),
    (
        "tape_strikes",
        tape.tape_strikes,
        {"strike": [81000.0, 81500.0], "ce_oi": [100, 200], "pe_oi": [150, 120]},
    ),
    (
        "tape_oi_change",
        tape.tape_oi_change,
        {"strike": [81000.0, 81500.0], "ce_change": [1200, -3400], "pe_change": [-900, 2500]},
    ),
    ("tape_timeline", tape.tape_timeline, PHASES),
    ("rv_iv", tape.rv_iv, {"t": ["09:45", "09:46"], "iv": [22.5, 22.1], "rv": [21.0, None]}),
    (
        "straddle_1sigma",
        tape.straddle_1sigma,
        {"t": ["09:15", "09:16"], "straddle": [120.0, 118.0], "realised": [None, 40.0]},
    ),
]


@pytest.mark.parametrize("chart, builder, data", CASES)
def test_every_builder_emits_its_registered_panel(chart, builder, data):
    html = builder(data, spec=_spec())

    assert f'data-rv-chart="{chart}"' in html
    payload = _payload(html)
    assert payload["spec"]["symbol"] == "SENSEX"
    assert payload["spec"]["strike_step"] == 100.0
    assert chart in html


def test_asset_registers_every_chart():
    js = ASSET.read_text()

    for name in CHART_NAMES:
        assert f'RV.register("{name}"' in js
    assert "RV.plotly(" in js
    assert "RV.plotlyLayout(" in js
    assert "payload.spec" in js


def test_asset_and_builders_hold_no_instrument_literals():
    js = ASSET.read_text()
    source = Path(tape.__file__).read_text()

    for banned in ("NIFTY", "SENSEX", "25,000", "₹"):
        assert banned not in js
    for banned in ("NIFTY", "25,000", "₹"):
        assert banned not in source


# ---------------------------------------------------------------------------
# surface: nulls stay null, fill is opt-in, metric is configurable
# ---------------------------------------------------------------------------
def test_surface_keeps_missing_cells_blank():
    html = tape.tape_surface(SURFACE, spec=_spec())
    payload = _payload(html)

    assert payload["data"]["z"] == [[1.0, None, 3.0], [None, None, 6.0]]
    assert payload["data"]["forward_fill"] is False
    assert '"z":[[1.0,null,3.0],[null,null,6.0]]' in html


def test_surface_forward_fill_is_opt_in_and_never_backfills():
    payload = _payload(tape.tape_surface(SURFACE, spec=_spec(), forward_fill=True))

    assert payload["data"]["z"] == [[1.0, 1.0, 3.0], [None, None, 6.0]]
    assert payload["data"]["forward_fill"] is True


def test_surface_fill_can_be_declared_by_the_payload():
    declared = dict(SURFACE, forward_fill=True)
    payload = _payload(tape.tape_surface(declared, spec=_spec()))

    assert payload["data"]["forward_fill"] is True
    assert payload["data"]["z"] == [[1.0, 1.0, 3.0], [None, None, 6.0]]


def test_surface_metric_and_unit_are_configurable():
    html = tape.tape_surface(SURFACE, spec=_spec(), metric="ce_oi")
    payload = _payload(html)

    assert payload["data"]["metric"] == "ce_oi"
    assert payload["data"]["label"] == "CE OI"
    assert payload["data"]["unit"] == "contracts"
    assert "CE OI surface" in html
    assert "NIFTY" not in html

    iv_payload = _payload(tape.tape_surface(SURFACE, spec=_spec(), metric="ce_iv"))
    assert iv_payload["data"]["unit"] == "%"


@pytest.mark.parametrize(
    "bad",
    [
        {"x": [0, 1], "xlabels": ["09:15"], "y": [1.0], "z": [[1.0, 2.0]]},
        {"x": [0, 1], "xlabels": ["09:15", "09:16"], "y": [1.0, 2.0], "z": [[1.0, 2.0]]},
        {"x": [0, 1], "xlabels": ["09:15", "09:16"], "y": [1.0], "z": [[1.0]]},
        {"x": [0, 1], "xlabels": ["09:15", "09:16"], "y": [1.0], "z": None},
    ],
)
def test_surface_rejects_misaligned_grids(bad):
    with pytest.raises(ValueError, match="tape_surface"):
        tape.tape_surface(bad, spec=_spec())


# ---------------------------------------------------------------------------
# signed books, phases and clocks
# ---------------------------------------------------------------------------
def test_oi_change_preserves_signed_bars():
    data = {
        "strike": [24800.0, 24900.0, 25000.0],
        "ce_change": [1200, -3400, 0],
        "pe_change": [-900, 2500, -50],
    }
    html = tape.tape_oi_change(data, spec=_spec())
    payload = _payload(html)

    assert payload["data"]["ce_change"] == [1200, -3400, 0]
    assert payload["data"]["pe_change"] == [-900, 2500, -50]
    assert "-3400" in html and "-900" in html


def test_timeline_keeps_phase_start_duration_and_order():
    payload = _payload(tape.tape_timeline(PHASES, spec=_spec()))

    assert payload["data"]["label"] == [
        "Opening pop",
        "Opening fade",
        "Afternoon bounce",
    ]
    assert payload["data"]["start"] == [0, 2, 264]
    assert payload["data"]["duration"] == [2, 30, 40]
    assert payload["data"]["change"] == [22.0, -120.5, 70.0]
    assert payload["data"]["session_open"] == "09:15"


def test_timeline_accepts_columnar_payload_and_legacy_dur():
    data = {"label": ["Leg"], "start": [0], "dur": [15], "change": [5]}
    payload = _payload(tape.tape_timeline(data, spec=_spec()))

    assert payload["data"]["duration"] == [15]


# ---------------------------------------------------------------------------
# units travel with the spec; series are never silently re-aligned
# ---------------------------------------------------------------------------
def test_units_follow_spec_for_sensex_and_a_stock():
    sensex = _spec(symbol="SENSEX", name="SENSEX", strike_step=100.0, lot_size=20)
    stock = _spec(
        symbol="RELIANCE",
        name="Reliance Industries",
        strike_step=20.0,
        lot_size=250,
        is_index=False,
        oi_unit="shares",
    )
    data = {
        "t": ["09:15", "09:16"],
        "spot": [81000.0, 81100.0],
        "futures": [81020.0, 81120.0],
    }

    sensex_html = tape.tape_spot_futures(data, spec=sensex)
    stock_html = tape.tape_spot_futures(data, spec=stock)

    assert "SENSEX" in sensex_html
    assert "Reliance Industries" in stock_html
    assert _payload(stock_html)["spec"]["strike_step"] == 20.0
    assert _payload(stock_html)["spec"]["oi_unit"] == "shares"
    assert "NIFTY" not in stock_html
    assert "25,000" not in stock_html


def test_currency_symbol_is_not_assumed():
    usd = _spec(
        symbol="AAPL",
        name="Apple",
        currency="USD",
        currency_symbol="$",
        venue="NASDAQ",
        strike_step=5.0,
        lot_size=100,
        is_index=False,
        oi_unit="shares",
        value_unit="$/pt",
    )
    html = tape.tape_basis({"t": ["09:30"], "basis": [1.25]}, spec=usd)

    assert "₹" not in html
    assert _payload(html)["spec"]["currency_symbol"] == "$"


def test_misaligned_series_are_rejected_not_padded():
    with pytest.raises(ValueError, match="futures"):
        tape.tape_spot_futures(
            {"t": ["09:15", "09:16"], "spot": [1.0, 2.0], "futures": [1.0]},
            spec=_spec(),
        )


def test_spot_futures_accepts_legacy_fut_column():
    payload = _payload(
        tape.tape_spot_futures(
            {"t": ["09:15"], "spot": [100.0], "fut": [101.0]}, spec=_spec()
        )
    )

    assert payload["data"]["futures"] == [101.0]


# ---------------------------------------------------------------------------
# missing numbers are gaps, never zero
# ---------------------------------------------------------------------------
def test_missing_oi_and_pcr_values_stay_null():
    data = {
        "t": ["09:15", "09:16", "09:17"],
        "ce_oi": [1, None, 3],
        "pe_oi": [2, 3, None],
        "pcr": [1.1, None, 1.2],
    }
    payload = _payload(tape.tape_oi_pcr(data, spec=_spec()))

    assert payload["data"]["ce_oi"][1] is None
    assert payload["data"]["pe_oi"][2] is None
    assert payload["data"]["pcr"][1] is None


def test_unknown_walls_stay_blank():
    data = {
        "t": ["09:15", "09:16"],
        "spot": [100.0, 101.0],
        "max_pain": [100.0, None],
        "call_wall": [None, None],
        "put_wall": [99.0, None],
    }
    payload = _payload(tape.tape_walls(data, spec=_spec()))

    assert payload["data"]["max_pain"] == [100.0, None]
    assert payload["data"]["call_wall"] == [None, None]


def test_volume_buckets_keep_labels_and_gaps():
    data = {"labels": ["09:15–09:30", "09:30–10:00"], "ce": [1.0, 2.0], "pe": [None, 4.0]}
    payload = _payload(tape.tape_volume(data, spec=_spec()))

    assert payload["data"]["labels"] == ["09:15–09:30", "09:30–10:00"]
    assert payload["data"]["pe"] == [None, 4.0]


def test_empty_series_renders_an_empty_panel():
    payload = _payload(tape.tape_basis({"t": [], "basis": []}, spec=_spec()))

    assert payload["data"]["t"] == []
    assert payload["data"]["basis"] == []


# ---------------------------------------------------------------------------
# volatility extras
# ---------------------------------------------------------------------------
def test_rv_iv_keeps_both_series_and_unit():
    data = {"t": ["09:45", "09:46"], "iv": [22.5, 22.1], "rv": [21.0, None]}
    payload = _payload(tape.rv_iv(data, spec=_spec()))

    assert payload["data"]["iv"] == [22.5, 22.1]
    assert payload["data"]["rv"] == [21.0, None]
    assert payload["data"]["unit"] == "%"


def test_straddle_sigma_factor_is_explicit_and_guarded():
    data = {"t": ["09:15"], "straddle": [120.0], "realised": [None]}

    default_payload = _payload(tape.straddle_1sigma(data, spec=_spec()))
    assert default_payload["data"]["sigma_factor"] == pytest.approx(0.7979)
    assert default_payload["data"]["realised"] == [None]

    custom = _payload(tape.straddle_1sigma(data, spec=_spec(), sigma_factor=0.8))
    assert custom["data"]["sigma_factor"] == pytest.approx(0.8)

    with pytest.raises(ValueError, match="sigma_factor"):
        tape.straddle_1sigma(data, spec=_spec(), sigma_factor=0)


# ---------------------------------------------------------------------------
# panel chrome
# ---------------------------------------------------------------------------
def test_panel_chrome_passes_span_height_and_subtitle():
    html = tape.tape_timeline(PHASES, spec=_spec(), height=260, subtitle="session legs")

    assert "rv-span-2" in html
    assert "--rv-chart-height:260px" in html
    assert "session legs" in html
