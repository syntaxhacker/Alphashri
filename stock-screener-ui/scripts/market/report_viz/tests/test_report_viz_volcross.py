from __future__ import annotations

import json
import math
import re
from pathlib import Path

import pytest

from scripts.market.report_viz import InstrumentSpec, render_page
from scripts.market.report_viz.charts.volcross import (
    basis_3d,
    basis_regime_strip,
    event_study,
    futures_quadrants,
    lead_lag,
    nifty_vs_sensex,
    pe_premium_ribbon,
    premium_vs_intrinsic,
    skew_rotation,
    smile_four_clocks,
    theta_decomposition,
)

ASSET = Path(__file__).resolve().parents[1] / "assets" / "volcross.js"
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


RIBBON_ROWS = [
    {"t": "09:15", "strike": 100.0, "premium": 12.5, "spot": 105.0},
    {"t": "09:15", "strike": 120.0, "premium": 30.0, "spot": 105.0},
    {"t": "09:16", "strike": 100.0, "premium": None, "spot": 106.0},
    {"t": "09:16", "strike": 120.0, "premium": 28.0, "spot": 106.0},
    {"t": "09:17", "strike": 100.0, "premium": 10.0, "spot": 105.5},
    {"t": "09:17", "strike": 120.0, "premium": 26.0, "spot": 105.5},
]

SURFACE = {
    "t": ["09:15", "09:16"],
    "strikes": [100.0, 120.0],
    "z": [[12.5, None], [30.0, 28.0]],
    "spot": [105.0, 106.0],
}

SMILES = [
    {
        "clock": "09:15",
        "spot": 100.0,
        "points": [
            {"strike": 90.0, "ce_iv": 22.0, "pe_iv": 30.0},
            {"strike": 100.0, "ce_iv": 20.0, "pe_iv": 20.0},
            {"strike": 110.0, "ce_iv": 18.0, "pe_iv": 26.0},
        ],
    },
    {
        "clock": "10:15",
        "spot": 101.0,
        "points": [
            {"strike": 90.0, "ce_iv": 23.0, "pe_iv": 31.0},
            {"strike": 100.0, "ce_iv": 21.0, "pe_iv": None},
            {"strike": 110.0, "ce_iv": 19.0, "pe_iv": 27.0},
        ],
    },
    {
        "clock": "11:15",
        "spot": 102.0,
        "points": [
            {"strike": 90.0, "ce_iv": 24.0, "pe_iv": 32.0},
            {"strike": 100.0, "ce_iv": 22.0, "pe_iv": 24.0},
            {"strike": 110.0, "ce_iv": 20.0, "pe_iv": 28.0},
        ],
    },
    {
        "clock": "12:15",
        "spot": 103.0,
        "points": [
            {"strike": 90.0, "ce_iv": 25.0, "pe_iv": 33.0},
            {"strike": 100.0, "ce_iv": 23.0, "pe_iv": 25.0},
            {"strike": 110.0, "ce_iv": 21.0, "pe_iv": 29.0},
        ],
    },
]

CONTRACTS = [
    {
        "label": "100 PE",
        "side": "pe",
        "strike": 100.0,
        "points": [
            {"t": "09:15", "premium": 12.5, "intrinsic": 10.0},
            {"t": "09:16", "premium": None, "intrinsic": 10.5},
            {"t": "09:17", "premium": 9.0, "intrinsic": 10.0},
        ],
        "frozen": [
            {"t": "09:15", "premium": 12.5},
            {"t": "09:17", "premium": 11.0},
        ],
    },
    {
        "label": "100 CE",
        "side": "ce",
        "strike": 100.0,
        "points": [
            {"t": "09:15", "premium": 4.0, "intrinsic": 0.0},
            {"t": "09:16", "premium": 5.0, "intrinsic": 1.0},
            {"t": "09:17", "premium": 7.0, "intrinsic": 2.0},
        ],
    },
]

THETA_ROWS = [
    {
        "t": "09:15",
        "label": "100 PE",
        "dp": -10.0,
        "spot": -8.0,
        "theta": -1.5,
        "iv": -0.5,
        "wedge": 0.0,
        "naive_theta": -6.0,
    },
    {
        "t": "09:16",
        "label": "120 PE",
        "dp": -5.0,
        "spot": -4.0,
        "theta": None,
        "iv": -1.0,
        "wedge": 0.0,
        "naive_theta": -2.0,
    },
]

SKEW = {
    "points": [
        {"t": "09:15", "atm_iv": 20.0, "ce25": 21.0, "pe25": 22.0},
        {"t": "09:16", "atm_iv": 21.0, "ce25": 22.0, "pe25": None},
        {"t": "09:17", "atm_iv": 22.0, "ce25": 23.0, "pe25": 24.0},
    ],
    "fixed": [
        {
            "strike": 100.0,
            "points": [
                {"t": "09:15", "gap": -1.0},
                {"t": "09:16", "gap": None},
                {"t": "09:17", "gap": 2.5},
            ],
        }
    ],
}

BASIS_ROWS = [
    {"t": "09:15", "basis": None, "oi": 1000, "doi": 0, "price": 100.0, "spot": 99.0, "volume": 10},
    {"t": "09:16", "basis": 5.0, "oi": 1100, "doi": 100, "price": 101.0, "spot": 96.0, "volume": 20},
    {"t": "09:17", "basis": 7.0, "oi": None, "doi": None, "price": 102.0, "spot": 95.0, "volume": 30},
    {"t": "09:18", "basis": 6.0, "oi": 1200, "doi": 100, "price": 103.0, "spot": 97.0, "volume": 40},
]

REGIME_ROWS = [
    {"t": "09:15", "basis": 10.0, "spot": 99.0},
    {"t": "09:16", "basis": 12.0, "spot": 100.0},
    {"t": "09:17", "basis": 11.0, "spot": 101.0},
    {"t": "09:18", "basis": 8.0, "spot": 100.5},
    {"t": "09:19", "basis": 9.0, "spot": 101.5},
]


def _lead_fixture() -> dict:
    def value(minute: int) -> float:
        return 100.0 + (minute % 7) * 3.0 + (minute % 11) * 5.0

    head = [
        {"t": f"09:{minute:02d}", "value": value(minute)}
        for minute in range(15, 41)
        if minute != 25
    ]
    reference = [
        {"t": f"09:{minute:02d}", "value": value(minute)}
        for minute in range(15, 41)
    ]
    return {"a": head, "b": reference, "lags": [-1, 0, 1]}


CROSS = {
    "series": [
        {
            "label": "Alpha",
            "points": [
                {"t": "09:15", "value": 100.0},
                {"t": "09:16", "value": None},
                {"t": "09:17", "value": 101.0},
                {"t": "09:18", "value": 102.0},
            ],
        },
        {
            "label": "Beta",
            "points": [
                {"t": "09:15", "value": 200.0},
                {"t": "09:16", "value": 202.0},
                {"t": "09:17", "value": 201.0},
                {"t": "09:18", "value": 204.0},
            ],
        },
    ]
}

QUADRANTS = [
    {"t": "09:15", "label": "Q1", "dp": 10.0, "doi": 1000, "volume": 100},
    {"t": "09:16", "label": "Q2", "dp": -10.0, "doi": 1000, "volume": 120},
    {"t": "09:17", "label": "Q3", "dp": -5.0, "doi": -500, "volume": 80},
    {"t": "09:18", "label": "Q4", "dp": 5.0, "doi": -500, "volume": 60},
]

EVENTS = {
    "events": [
        {
            "id": "E1",
            "label": "Morning",
            "start": "09:30",
            "end": "09:35",
            "anchor": "09:30",
            "path": [
                {"offset": -2, "value": 0.0},
                {"offset": -1, "value": 1.0},
                {"offset": 0, "value": 0.0},
                {"offset": 1, "value": None},
                {"offset": 2, "value": 3.0},
            ],
        },
        {
            "id": "E2",
            "label": "Noon",
            "start": "12:00",
            "end": "12:05",
            "anchor": "12:00",
            "path": [
                {"offset": -1, "value": 0.0},
                {"offset": 0, "value": 0.0},
                {"offset": 1, "value": -2.0},
            ],
        },
    ],
    "window": [-30, 30],
}


def test_premium_ribbon_rows_pivot_into_one_series_per_strike() -> None:
    html = pe_premium_ribbon(RIBBON_ROWS, spec=_sensex())
    payload = _payload(html)
    data = payload["data"]

    assert 'data-rv-chart="pe_premium_ribbon"' in html
    assert data["t"] == ["09:15", "09:16", "09:17"]
    assert data["strikes"] == [100.0, 120.0]
    assert [series["strike"] for series in data["series"]] == [100.0, 120.0]
    assert data["series"][0]["premium"] == [12.5, None, 10.0]
    assert data["series"][0]["last"] == 10.0
    assert data["series"][1]["premium"] == [30.0, 28.0, 26.0]
    assert data["spot"] == [105.0, 106.0, 105.5]
    assert data["stats"]["points"] == 5
    assert data["stats"]["nulls"] == 1
    assert data["unit"] == "₹ premium"
    assert "blank = no quote" in html


def test_premium_ribbon_accepts_a_surface_matrix_and_keeps_the_hole() -> None:
    payload = _payload(pe_premium_ribbon(SURFACE, spec=_sensex()))
    data = payload["data"]
    assert data["t"] == ["09:15", "09:16"]
    assert data["strikes"] == [100.0, 120.0]
    assert data["series"][0]["premium"] == [12.5, None]
    assert data["series"][1]["premium"] == [30.0, 28.0]
    assert data["stats"]["nulls"] == 1


def test_premium_ribbon_accepts_the_source_time_major_surface() -> None:
    source = {
        "premium_surface": {
            "clocks": ["09:15", "09:16"],
            "strikes": [100.0, 120.0],
            "z": [[12.5, 30.0], [None, 28.0]],
            "spot": [105.0, 106.0],
        }
    }
    payload = _payload(pe_premium_ribbon(source, spec=_sensex()))
    data = payload["data"]
    assert data["t"] == ["09:15", "09:16"]
    assert data["series"][0]["premium"] == [12.5, None]
    assert data["series"][1]["premium"] == [30.0, 28.0]
    assert data["spot"] == [105.0, 106.0]


def test_smile_panels_group_by_clock_and_keep_null_quotes() -> None:
    payload = _payload(smile_four_clocks(SMILES, spec=_sensex()))
    panels = payload["data"]["panels"]

    assert [panel["clock"] for panel in panels] == ["09:15", "10:15", "11:15", "12:15"]
    assert panels[0]["strikes"] == [90.0, 100.0, 110.0]
    assert panels[0]["ce_iv"] == [22.0, 20.0, 18.0]
    assert panels[0]["atm"] == 100.0
    assert panels[0]["atm_iv"] == 20.0
    assert panels[0]["atm_gap"] == 0.0
    assert panels[1]["pe_iv"] == [31.0, None, 27.0]
    assert panels[1]["atm_gap"] is None
    assert panels[1]["atm_iv"] == 21.0
    assert payload["data"]["stats"]["nulls"] == 1
    assert payload["data"]["stats"]["clocks"] == 4
    assert payload["data"]["unit"] == "vol pts"


def test_smile_rejects_non_positive_iv_and_missing_spot() -> None:
    bad = [{"clock": "09:15", "spot": 100.0, "points": [{"strike": 100.0, "ce_iv": 0.0}]}]
    with pytest.raises(ValueError, match="positive or blank"):
        smile_four_clocks(bad, spec=_sensex())
    with pytest.raises(ValueError, match="spot is required"):
        smile_four_clocks([{"clock": "09:15", "points": []}], spec=_sensex())


def test_smile_accepts_source_points_that_use_k_for_strike() -> None:
    smiles = [
        {
            "clock": "09:15",
            "spot": 100.0,
            "atm_iv": 20.5,
            "gap_atm": -1.0,
            "points": [
                {"k": 90.0, "ce_iv": 22.0, "pe_iv": 30.0},
                {"k": 100.0, "ce_iv": 20.0, "pe_iv": 21.0},
            ],
        }
    ]
    panel = _payload(smile_four_clocks(smiles, spec=_sensex()))["data"]["panels"][0]
    assert panel["strikes"] == [90.0, 100.0]
    assert panel["atm_iv"] == 20.5
    assert panel["atm_gap"] == -1.0


def test_premium_vs_intrinsic_keeps_gaps_and_reports_time_value() -> None:
    payload = _payload(premium_vs_intrinsic(CONTRACTS, spec=_sensex()))
    contracts = payload["data"]["contracts"]

    assert len(contracts) == 2
    first = contracts[0]
    assert first["label"] == "100 PE"
    assert [point["premium"] for point in first["points"]] == [12.5, None, 9.0]
    assert first["stats"]["nulls"] == 1
    assert first["stats"]["change"] == -3.5
    assert first["stats"]["intrinsic_change"] == 0.0
    assert first["stats"]["time_value_start"] == 2.5
    assert first["stats"]["time_value_end"] == -1.0
    assert first["stats"]["frozen_change"] == -1.5
    assert contracts[1]["side"] == "ce"
    assert payload["data"]["unit"] == "₹ premium"


def test_premium_vs_intrinsic_subtitle_uses_the_spec_currency() -> None:
    html = premium_vs_intrinsic(CONTRACTS, spec=_stock())
    assert "$ premium" in html
    assert "₹" not in html


def test_premium_vs_intrinsic_accepts_source_px_and_intr_fields() -> None:
    contracts = [
        {
            "label": "100 PE",
            "side": "pe",
            "strike": 100.0,
            "points": [
                {"t": 555.0, "px": 12.5, "intr": 10.0},
                {"t": 556.0, "px": None, "intr": 10.5},
                {"t": 557.0, "px": 9.0, "intr": 10.0},
            ],
            "frozen": [{"t": 555.0, "px": 12.5}, {"t": 557.0, "px": 11.0}],
        }
    ]
    contract = _payload(premium_vs_intrinsic(contracts, spec=_sensex()))["data"]["contracts"][0]
    assert [point["premium"] for point in contract["points"]] == [12.5, None, 9.0]
    assert [point["intrinsic"] for point in contract["points"]] == [10.0, 10.5, 10.0]
    assert contract["stats"]["frozen_change"] == -1.5


def test_theta_decomposition_sums_buckets_and_flags_overstatement() -> None:
    payload = _payload(theta_decomposition(THETA_ROWS, spec=_sensex()))
    data = payload["data"]
    stats = data["stats"]

    assert [row["label"] for row in data["rows"]] == ["100 PE", "120 PE"]
    assert data["rows"][0]["priced_theta"] == -1.5
    assert data["rows"][1]["theta"] is None
    assert stats["dp"] == -15.0
    assert stats["spot"] == -12.0
    assert stats["theta"] == -1.5
    assert stats["naive_theta"] == -8.0
    assert stats["overstatement"] == pytest.approx(5.33, abs=0.01)
    assert data["unit"] == "premium points"


def test_theta_decomposition_window_is_carried_into_the_payload() -> None:
    payload = _payload(theta_decomposition({"rows": THETA_ROWS, "window": "09:15 → 09:16"}, spec=_sensex()))
    assert payload["data"]["window"] == "09:15 → 09:16"


def test_skew_rotation_keeps_the_fixed_strike_gap_and_stats() -> None:
    payload = _payload(skew_rotation(SKEW, spec=_sensex()))
    data = payload["data"]

    assert data["points"][1]["pe25"] is None
    assert data["fixed"][0]["strike"] == 100.0
    assert [point["gap"] for point in data["fixed"][0]["points"]] == [-1.0, None, 2.5]
    assert data["fixed"][0]["stats"] == {
        "start_t": "09:15",
        "start": -1.0,
        "end_t": "09:17",
        "end": 2.5,
        "change": 3.5,
    }
    assert data["stats"]["atm_start"] == 20.0
    assert data["stats"]["atm_end"] == 22.0
    assert data["unit"] == "vol pts"


def test_basis_3d_payload_keeps_null_rows_out_of_the_path() -> None:
    payload = _payload(basis_3d(BASIS_ROWS, spec=_sensex()))
    data = payload["data"]

    assert data["minutes"] == [555, 556, 557, 558]
    assert data["basis"] == [None, 5.0, 7.0, 6.0]
    assert data["oi"] == [1000, 1100, None, 1200]
    assert data["stats"]["points"] == 2
    assert data["stats"]["nulls"] == 2
    assert data["stats"]["basis_last"] == 6.0
    assert data["stats"]["oi_last"] == 1200
    assert data["domain"]["basis"][0] < 5.0
    assert data["domain"]["oi"][1] > 1200
    assert data["unit"] == "pts"


def test_basis_3d_accepts_source_short_field_names() -> None:
    source = {
        "basis": {
            "rows": [
                {"m": 555.0, "t": "09:15", "b": 4.0, "oi": 1000, "doi": 10, "v": 50, "f": 100.0, "s": 96.0},
                {"m": 556.0, "t": "09:16", "b": 6.0, "oi": 1100, "doi": 20, "v": 60, "f": 101.0, "s": 95.0},
            ]
        }
    }
    data = _payload(basis_3d(source, spec=_sensex()))["data"]
    assert data["minutes"] == [555, 556]
    assert data["basis"] == [4.0, 6.0]
    assert data["price"] == [100.0, 101.0]
    assert data["spot"] == [96.0, 95.0]
    assert data["volume"] == [50, 60]


def test_basis_regime_strip_derives_runs_when_no_regime_is_supplied() -> None:
    payload = _payload(basis_regime_strip(REGIME_ROWS, spec=_sensex()))
    bands = payload["data"]["bands"]

    assert [band["regime"] for band in bands] == [
        "basis_rising",
        "basis_falling",
        "basis_rising",
    ]
    assert [(band["start"], band["end"]) for band in bands] == [
        ("09:15", "09:16"),
        ("09:16", "09:18"),
        ("09:18", "09:19"),
    ]
    assert bands[0]["dp"] == 2.0
    assert bands[1]["dp"] == -4.0
    assert bands[2]["dp"] == 1.0
    assert payload["data"]["stats"]["mean"] == 10.0
    categories = {item["id"]: item for item in payload["data"]["categories"]}
    assert categories["basis_rising"]["tone"] == "green"
    assert categories["basis_falling"]["tone"] == "red"


def test_basis_regime_strip_accepts_prebuilt_bands_and_custom_labels() -> None:
    data = {
        "bands": [
            {"start": "09:15", "end": "09:30", "regime": "long_buildup", "dp": 10.0},
            {"start": "09:30", "end": "09:45", "regime": "mystery", "dp": -2.0},
        ],
        "regime_labels": {"long_buildup": "Build-up"},
        "bucket_minutes": 15,
    }
    payload = _payload(basis_regime_strip(data, spec=_sensex()))
    bands = payload["data"]["bands"]
    categories = {item["id"]: item for item in payload["data"]["categories"]}

    assert [(band["start"], band["end"]) for band in bands] == [
        ("09:15", "09:30"),
        ("09:30", "09:45"),
    ]
    assert categories["long_buildup"]["label"] == "Build-up"
    assert categories["mystery"]["label"] == "Mystery"
    assert categories["mystery"]["tone"] == "muted"
    assert payload["data"]["minutes"] == [555, 570, 585]


def test_lead_lag_clock_alignment_beats_naive_gap_pairing() -> None:
    html = lead_lag(_lead_fixture(), spec=_sensex())
    payload = _payload(html)
    data = payload["data"]
    stats = data["stats"]
    concurrent = next(row for row in data["rows"] if row["lag"] == 0)

    assert stats["common_clocks"] == 25
    assert stats["aligned_n"] == 24
    assert stats["naive_n"] == 24
    assert concurrent["aligned"] == pytest.approx(1.0)
    assert concurrent["naive"] < 0.99
    assert stats["best_lag_aligned"] == 0
    assert data["labels"]["aligned"] == "clock-aligned"
    assert "naive row order" in html


def test_lead_lag_accepts_precomputed_rows_and_ci_whiskers() -> None:
    payload = _payload(
        lead_lag(
            {
                "rows": [
                    {
                        "lag": -1,
                        "naive": 0.12,
                        "aligned": 0.31,
                        "naive_n": 90,
                        "aligned_n": 80,
                        "aligned_ci": [0.1, 0.5],
                    },
                    {
                        "lag": 0,
                        "naive": 0.22,
                        "aligned": 0.44,
                        "naive_n": 90,
                        "aligned_n": 80,
                    },
                ],
                "labels": {"aligned": "close-aligned"},
            },
            spec=_sensex(),
        )
    )
    rows = payload["data"]["rows"]

    assert [row["lag"] for row in rows] == [-1, 0]
    assert rows[0]["aligned"] == 0.31
    assert rows[0]["aligned_ci"] == [0.1, 0.5]
    assert payload["data"]["labels"]["aligned"] == "close-aligned"


def test_lead_lag_accepts_source_sync_and_n_sync_fields() -> None:
    source = {
        "leadlag": {
            "rows": [
                {"lag": -1, "naive": 0.11, "sync": 0.3, "n_naive": 80, "n_sync": 70, "sync_ci": [-0.1, 0.6]},
                {"lag": 0, "naive": 0.2, "sync": 0.5, "n_naive": 80, "n_sync": 70},
            ]
        }
    }
    rows = _payload(lead_lag(source, spec=_sensex()))["data"]["rows"]
    assert rows[0]["aligned"] == 0.3
    assert rows[0]["aligned_n"] == 70
    assert rows[0]["naive_n"] == 80
    assert rows[0]["aligned_ci"] == [-0.1, 0.6]


def test_cross_paths_rebase_each_series_and_drop_a_missing_spread_minute() -> None:
    payload = _payload(nifty_vs_sensex(CROSS, spec=_sensex()))
    data = payload["data"]

    assert [item["label"] for item in data["series"]] == ["Alpha", "Beta"]
    assert data["series"][0]["pct"] == [0.0, None, 1.0, 2.0]
    assert data["series"][1]["pct"] == [0.0, 1.0, 0.5, 2.0]
    assert data["spread"] == [
        {"t": "09:15", "m": 555, "bps": 0.0},
        {"t": "09:17", "m": 557, "bps": 50.0},
        {"t": "09:18", "m": 558, "bps": 0.0},
    ]
    assert data["spread_unit"] == "bps"
    assert data["stats"]["spread_points"] == 3
    assert data["spread_pair"] == ["Alpha", "Beta"]


def test_cross_paths_require_a_payload_label_and_render_it() -> None:
    html = nifty_vs_sensex(CROSS, spec=_sensex())
    assert "Alpha" in html
    assert "Beta" in html
    assert "NIFTY" not in html
    assert "SENSEX" in html

    with pytest.raises(ValueError, match="label is required"):
        nifty_vs_sensex(
            {"series": [{"points": [{"t": "09:15", "value": 1.0}]}]}, spec=_sensex()
        )


def test_cross_paths_accept_source_rows_when_labels_come_from_the_payload() -> None:
    source = {
        "cross": {
            "rows": [
                {"m": 555.0, "t": "09:15", "n": 100.0, "s": 200.0},
                {"m": 556.0, "t": "09:16", "n": 101.0, "s": 202.0},
            ]
        },
        "labels": ["Alpha", "Beta"],
        "fields": ["n", "s"],
    }
    payload = _payload(nifty_vs_sensex(source, spec=_sensex()))
    data = payload["data"]
    assert [item["label"] for item in data["series"]] == ["Alpha", "Beta"]
    assert data["series"][0]["pct"] == [0.0, 1.0]
    assert data["series"][1]["pct"] == [0.0, 1.0]
    assert data["spread"][1]["bps"] == 0.0


def test_cross_paths_accept_column_series_and_label_keyed_series() -> None:
    payload = _payload(
        nifty_vs_sensex(
            {
                "series": {
                    "Alpha": {"t": ["09:15", "09:16"], "value": [100.0, 102.0]},
                    "Beta": {"t": ["09:15", "09:16"], "close": [200.0, 198.0]},
                }
            },
            spec=_sensex(),
        )
    )
    data = payload["data"]
    assert [item["label"] for item in data["series"]] == ["Alpha", "Beta"]
    assert data["series"][0]["pct"] == [0.0, 2.0]
    assert data["series"][1]["pct"] == [0.0, -1.0]
    assert data["spread"][1]["bps"] == 300.0


def test_quadrants_classify_all_four_sign_combinations() -> None:
    payload = _payload(futures_quadrants(QUADRANTS, spec=_sensex()))
    points = payload["data"]["points"]

    assert [point["regime"] for point in points] == [
        "long_buildup",
        "short_buildup",
        "long_unwinding",
        "short_covering",
    ]
    assert payload["data"]["stats"]["counts"] == {
        "long_buildup": 1,
        "short_buildup": 1,
        "long_unwinding": 1,
        "short_covering": 1,
    }
    assert payload["data"]["stats"]["buckets"] == 4
    assert payload["data"]["stats"]["nulls"] == 0
    categories = {item["id"]: item for item in payload["data"]["categories"]}
    assert categories["long_buildup"]["tone"] == "green"
    assert categories["short_covering"]["tone"] == "blue"


def test_quadrants_keep_a_bucket_with_a_missing_leg_but_do_not_plot_it() -> None:
    rows = [
        {"t": "09:15", "dp": 10.0, "doi": None, "volume": 10},
        {"t": "09:16", "dp": None, "doi": 100, "volume": 20},
        {"t": "09:17", "dp": 1.0, "doi": 100, "volume": 30},
    ]
    payload = _payload(futures_quadrants(rows, spec=_sensex()))
    data = payload["data"]
    assert len(data["points"]) == 3
    assert data["stats"]["nulls"] == 2
    assert data["points"][0]["regime"] == "neutral"


def test_event_study_preserves_offsets_duration_and_a_null_point() -> None:
    payload = _payload(event_study(EVENTS, spec=_sensex()))
    data = payload["data"]

    assert data["window"] == [-30, 30]
    assert len(data["events"]) == 2
    first = data["events"][0]
    assert first["id"] == "E1"
    assert first["duration"] == 5
    assert first["move"] == 3.0
    assert [point["offset"] for point in first["path"]] == [-2, -1, 0, 1, 2]
    assert first["path"][3]["value"] is None
    assert data["stats"]["nulls"] == 1
    assert data["stats"]["points"] == 8


def test_event_study_converts_clock_offsets_against_the_anchor() -> None:
    data = {
        "events": [
            {
                "id": "E1",
                "start": "09:30",
                "end": "09:35",
                "anchor": "09:30",
                "path": [
                    {"t": "09:29", "value": 0.0},
                    {"t": "09:31", "value": 2.0},
                ],
            }
        ]
    }
    payload = _payload(event_study(data, spec=_sensex()))
    assert [point["offset"] for point in payload["data"]["events"][0]["path"]] == [-1, 1]


def test_event_study_accepts_the_source_small_multiple_shape() -> None:
    source = {
        "smallmult": [
            {
                "id": "E1",
                "label": "Leg one",
                "move": 8.5,
                "path": [
                    {"m": -2.0, "p": 0.0},
                    {"m": -1.0, "p": 1.5},
                    {"m": 0.0, "p": 0.0},
                    {"m": 1.0, "p": None},
                    {"m": 2.0, "p": 8.5},
                ],
            }
        ]
    }
    event = _payload(event_study(source, spec=_sensex()))["data"]["events"][0]
    assert event["id"] == "E1"
    assert event["label"] == "Leg one"
    assert [point["offset"] for point in event["path"]] == [-2, -1, 0, 1, 2]
    assert event["path"][3]["value"] is None
    assert event["move"] == 8.5


# registration and browser contract
NAMES = (
    "pe_premium_ribbon",
    "smile_four_clocks",
    "premium_vs_intrinsic",
    "theta_decomposition",
    "skew_rotation",
    "basis_3d",
    "basis_regime_strip",
    "lead_lag",
    "nifty_vs_sensex",
    "futures_quadrants",
    "event_study",
)


def test_asset_registers_all_eleven_renderers_exactly_once() -> None:
    text = ASSET.read_text()
    for name in NAMES:
        assert text.count(f'RV.register("{name}"') == 1, name
    assert text.count("RV.register(") == len(NAMES)


def test_asset_uses_rv_helpers_and_plotly_only_for_the_3d_chart() -> None:
    text = ASSET.read_text()
    for helper in ("RV.onResize", "RV.tip", "RV.svg", "RV.timeTicks", "RV.money", "RV.plotly"):
        assert helper in text
    assert "d3.line" in text
    assert ".defined(" in text
    assert 'type: "scatter3d"' in text
    assert text.count("RV.plotly(") == 1
    assert "NIFTY" not in text
    assert "25,000" not in text and "25000" not in text
    assert "₹" not in text
    assert "09:15" not in text and "15:30" not in text


def test_render_page_inlines_the_asset_once() -> None:
    html = render_page(
        title="Vol-cross fixture",
        spec=_sensex(),
        panels=[
            pe_premium_ribbon(RIBBON_ROWS, spec=_sensex()),
            basis_3d(BASIS_ROWS, spec=_sensex()),
            event_study(EVENTS, spec=_sensex()),
        ],
    )
    assert "/* volcross.js */" in html
    assert html.count("/* core.js */") == 1
    assert html.count("d3@7.9.0") == 1
    for name in NAMES:
        assert f'RV.register("{name}"' in html


def _panels(spec: InstrumentSpec) -> list[str]:
    return [
        pe_premium_ribbon(RIBBON_ROWS, spec=spec),
        pe_premium_ribbon(SURFACE, spec=spec),
        smile_four_clocks(SMILES, spec=spec),
        premium_vs_intrinsic(CONTRACTS, spec=spec),
        theta_decomposition(THETA_ROWS, spec=spec),
        skew_rotation(SKEW, spec=spec),
        basis_3d(BASIS_ROWS, spec=spec),
        basis_regime_strip(REGIME_ROWS, spec=spec),
        lead_lag(_lead_fixture(), spec=spec),
        nifty_vs_sensex(CROSS, spec=spec),
        futures_quadrants(QUADRANTS, spec=spec),
        event_study(EVENTS, spec=spec),
    ]


def test_sensex_and_stock_render_from_the_same_builders_with_their_own_units() -> None:
    sensex_html = "".join(_panels(_sensex()))
    stock_html = "".join(_panels(_stock()))

    sensex_payload = _payload(pe_premium_ribbon(RIBBON_ROWS, spec=_sensex()))
    stock_payload = _payload(pe_premium_ribbon(RIBBON_ROWS, spec=_stock()))
    assert sensex_payload["spec"]["strike_step"] == 100.0
    assert stock_payload["spec"]["strike_step"] == 20.0
    assert sensex_payload["spec"]["price_decimals"] == 2
    assert stock_payload["spec"]["price_decimals"] == 1
    assert sensex_payload["spec"]["is_index"] is True
    assert stock_payload["spec"]["is_index"] is False

    assert "₹" in sensex_html
    assert "₹" not in stock_html
    assert "$" in stock_html
    assert "09:30–16:00" in stock_html
    assert "NIFTY" not in sensex_html + stock_html
    assert "25,000" not in sensex_html + stock_html
    assert "25000" not in sensex_html + stock_html


def test_all_builder_chrome_avoids_instrument_literals_and_hardcoded_hex() -> None:
    for html in _panels(_stock()):
        chrome = html.split('class="rv-data"', 1)[0]
        assert "NIFTY" not in chrome
        assert "25,000" not in chrome
        assert "25000" not in chrome
        assert re.search(r"#[0-9A-Fa-f]{6}", chrome) is None


def test_empty_inputs_render_empty_payloads_instead_of_crashing() -> None:
    assert _payload(pe_premium_ribbon([], spec=_sensex()))["data"]["series"] == []
    assert _payload(theta_decomposition([], spec=_sensex()))["data"]["rows"] == []
    assert _payload(skew_rotation([], spec=_sensex()))["data"]["points"] == []
    assert _payload(basis_3d([], spec=_sensex()))["data"]["minutes"] == []
    assert _payload(basis_regime_strip([], spec=_sensex()))["data"]["bands"] == []
    assert _payload(futures_quadrants([], spec=_sensex()))["data"]["points"] == []
    assert _payload(event_study([], spec=_sensex()))["data"]["events"] == []


def test_nan_is_a_missing_print_not_zero() -> None:
    rows = [
        {"t": "09:15", "strike": 100.0, "premium": math.nan, "spot": 100.0},
        {"t": "09:16", "strike": 100.0, "premium": 10.0, "spot": 101.0},
    ]
    payload = _payload(pe_premium_ribbon(rows, spec=_sensex()))
    assert payload["data"]["series"][0]["premium"] == [None, 10.0]
    assert payload["data"]["stats"]["nulls"] == 1
