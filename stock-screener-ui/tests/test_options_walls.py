"""Wall erosion / 0-DTE pin state — validated against the 2026-10-29 tape.

The SENSEX 0-DTE day is the reference fixture: 14:04 was a touch that faded
(the 74,000 call wall had only eroded -8.9%), 14:10 was pressure (PIN_RISK),
and 14:25:48 was the confirmed break (-13.9% erosion, put build +212%, max
pain drift +100). NIFTY 5-DTE and RELIANCE 25-DTE are the non-expiry controls:
the walls move, but the state stays WALL_WATCH — the gamma/pin push is a
0-1 DTE phenomenon.

The tests read the real recorded tape (read-only) and skip when the fixture
is absent, so CI without `experiments/data` stays green.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.reports_api import options_walls as ow

ROOT = Path(__file__).resolve().parent.parent
SENSEX_TAPE = ROOT / "experiments" / "data" / "options_tape" / "SENSEX" / "2026-10-29.jsonl"
NIFTY_TAPE = ROOT / "experiments" / "data" / "nifty_tape" / "2026-10-29.jsonl"
RELIANCE_TAPE = ROOT / "experiments" / "data" / "options_tape" / "RELIANCE" / "2026-10-29.jsonl"
DATE = "2026-10-29"

pytestmark = pytest.mark.skipif(
    not SENSEX_TAPE.exists(), reason="2026-10-29 SENSEX tape fixture is not present"
)


def _load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _upto(rows: list[dict], hhmmss: str) -> list[dict]:
    subset = [row for row in rows if str(row.get("t", ""))[11:19] <= hhmmss]
    assert subset, f"no rows up to {hhmmss}"
    return subset


def _state(rows: list[dict], hhmmss: str, symbol: str = "SENSEX", **kwargs) -> dict:
    subset = _upto(rows, hhmmss)
    last = datetime.fromisoformat(str(subset[-1]["t"]))
    return ow.compute_wall_state(
        subset,
        symbol=symbol,
        date_str=DATE,
        now=last + timedelta(minutes=1),
        **kwargs,
    )


# ------------------------------------------------------------------ 0-DTE path

def test_1404_touch_is_watch_not_break():
    """The first test of 74,000 failed: -8.9% erosion is below the -10% gate."""
    state = _state(_load(SENSEX_TAPE), "14:04:59")
    assert state["expiry_day"] is True
    assert state["state"] == "WATCH"
    assert state["alert"] is None
    assert state["tracked_call_erosion_30m"] > -ow.EROSION_MIN
    assert state["near"] is True


def test_1410_pressure_is_pin_risk_but_not_a_break():
    state = _state(_load(SENSEX_TAPE), "14:10:59")
    assert state["state"] == "PIN_RISK"
    assert state["alert"] is None
    assert state["alert_eligible"] is False


def test_1425_break_has_erosion_put_build_and_drift():
    state = _state(_load(SENSEX_TAPE), "14:25:59")
    assert state["state"] == "BREAK"
    assert state["alert_eligible"] is True
    alert = state["alert"]
    assert alert is not None
    assert alert["wall"] == 74000
    assert alert["at"].startswith("2026-10-29T14:25:48")
    assert state["tracked_call_erosion_30m"] <= -ow.EROSION_MIN
    assert state["tracked_put_build_30m"] >= ow.PUT_BUILD_MIN
    assert state["max_pain_drift"] > ow.DRIFT_MIN
    assert any(event["kind"] == "BREAK" for event in state["events"])


def test_break_alert_latches_to_the_first_break():
    """Every minute after 14:25 is still BREAK; the alert must not re-fire."""
    early = _state(_load(SENSEX_TAPE), "14:25:59")
    late = _state(_load(SENSEX_TAPE), "15:00:59")
    assert late["state"] == "BREAK"
    assert late["alert"]["at"] == early["alert"]["at"]
    assert late["alert"]["wall"] == early["alert"]["wall"]


def test_tape_gap_marks_the_frame_stale():
    """The 14:44→14:54 recording gap must not be read as a fresh break."""
    state = _state(_load(SENSEX_TAPE), "14:54:20")
    assert state["freshness"]["stale"] is True
    assert state["state"] == "QUIET"
    assert any(gap["seconds"] > 300 for gap in state["freshness"]["gaps"])


def test_expanded_payload_has_all_walls_and_sequence():
    state = _state(_load(SENSEX_TAPE), "15:29:59", top_n=3)
    assert len(state["calls"]) == 3
    assert len(state["puts"]) == 3
    assert state["history"]
    assert state["history"][-1]["t"] == state["freshness"]["last_t"]
    assert {event["kind"] for event in state["events"]} <= {"TOUCH", "BREAK"}
    assert any(event["kind"] == "BREAK" for event in state["events"])


def test_wall_map_is_a_strike_time_erosion_grid():
    state = _state(_load(SENSEX_TAPE), "15:29:59", top_n=3)
    wall_map = state["wall_map"]
    assert wall_map is not None

    strikes = wall_map["strikes"]
    assert len(strikes) == len(wall_map["call_delta"]) == len(wall_map["put_delta"])
    assert len(strikes) == len(wall_map["call_now"]) == len(wall_map["put_now"])
    assert len(strikes) == len(wall_map["call_oi"]) == len(wall_map["put_oi"])
    assert len(strikes) == len(wall_map["call_open"]) == len(wall_map["put_open"])
    assert len(strikes) == len(wall_map["call_delta_open"]) == len(wall_map["put_delta_open"])
    assert len(wall_map["times"]) == len(wall_map["top_call"]) == len(wall_map["top_put"])
    assert len(wall_map["times"]) == len(wall_map["call_delta_open"][0])
    assert len(wall_map["times"]) == len(wall_map["spot"]) == len(wall_map["max_pain"])
    assert len(wall_map["times"]) == len(wall_map["call_delta"][0])
    assert len(wall_map["times"]) == len(wall_map["call_oi"][0])
    assert len(wall_map["times"]) == len(wall_map["pin_band"]["low"]) == len(wall_map["pin_band"]["high"])
    assert len(wall_map["times"]) == 60
    assert wall_map["times"][0].startswith("2026-10-29T14:30")
    assert 74000 in strikes

    idx = strikes.index(74000)
    # First column is the baseline; the 74,000 call wall erodes over the
    # window.  The put side is not sign-asserted: the 74,000 put is not the
    # tracked put wall, and its path can go either way.
    assert wall_map["call_delta"][idx][0] == 0.0
    assert wall_map["call_delta"][idx][-1] < 0
    assert any(value is not None for value in wall_map["put_delta"][idx])
    assert wall_map["call_open"][idx] > 0
    assert wall_map["call_delta_open"][idx][-1] < 0

    early = _state(_load(SENSEX_TAPE), "14:25:59", top_n=3)
    assert early["wall_map"]["times"][-1].startswith("2026-10-29T14:25")


def test_read_regime_and_pin_band_are_backend_owned():
    state = _state(_load(SENSEX_TAPE), "14:25:59")
    assert state["regime"] == "SHORT"
    assert "call wall 74,000" in state["read"]
    assert "broke 74,000" in state["read"]
    assert "SHORT Γ" in state["read"]

    band = state["wall_map"]["pin_band"]
    assert band["low"][-1] < state["max_pain"] < band["high"][-1]


# ------------------------------------------------------------ non-expiry control

@pytest.mark.parametrize(
    "path,symbol",
    [(NIFTY_TAPE, "NIFTY"), (RELIANCE_TAPE, "RELIANCE")],
)
def test_non_expiry_is_wall_watch_not_gamma(path: Path, symbol: str):
    if not path.exists():
        pytest.skip(f"{symbol} tape fixture is not present")
    rows = _load(path)
    last = datetime.fromisoformat(str(rows[-1]["t"]))
    state = ow.compute_wall_state(
        rows, symbol=symbol, date_str=DATE, now=last + timedelta(minutes=1)
    )
    assert state["dte"] is not None and state["dte"] >= 2
    assert state["expiry_day"] is False
    assert state["state"] == "WALL_WATCH"
    assert state["alert"] is None
    assert state["alert_eligible"] is False


# -------------------------------------------------------------------- endpoint

def _client() -> TestClient:
    app = FastAPI()
    app.include_router(ow.router)
    return TestClient(app)


def test_endpoint_returns_the_full_payload():
    response = _client().get(
        "/api/reports/options/SENSEX/walls",
        params={"date": DATE, "window_min": 60, "top": 3},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["symbol"] == "SENSEX"
    assert data["date"] == DATE
    assert data["window_min"] == 60
    assert len(data["calls"]) == 3
    assert len(data["puts"]) == 3
    assert data["history"]
    assert data["events"]
    assert data["freshness"]["rows"] > 0
    assert data["call_wall"]["strike"] is not None


def test_endpoint_honours_top_and_window():
    response = _client().get(
        "/api/reports/options/SENSEX/walls",
        params={"date": DATE, "top": 1, "window_min": 30},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["top"] == 1
    assert len(data["calls"]) <= 1
    assert len(data["puts"]) <= 1
    assert data["window_min"] == 30


def test_endpoint_map_is_opt_in():
    client = _client()
    base = client.get(
        "/api/reports/options/SENSEX/walls", params={"date": DATE}
    )
    assert base.status_code == 200
    assert base.json()["wall_map"] is None

    with_map = client.get(
        "/api/reports/options/SENSEX/walls", params={"date": DATE, "map": 1}
    )
    assert with_map.status_code == 200
    assert with_map.json()["wall_map"] is not None


def test_endpoint_404_for_a_day_with_no_tape():
    response = _client().get(
        "/api/reports/options/SENSEX/walls", params={"date": "2020-01-01"}
    )
    assert response.status_code == 404
    assert "no SENSEX tape" in response.json()["detail"]["message"]


def test_empty_rows_raise_404():
    with pytest.raises(ow.HTTPException) as exc:
        ow.compute_wall_state([], symbol="SENSEX", date_str=DATE)
    assert exc.value.status_code == 404


# --------------------------------------------------------------- replay / OI

def _nifty_rows() -> list[dict]:
    if not NIFTY_TAPE.exists():
        pytest.skip("NIFTY tape fixture is not present")
    return _load(NIFTY_TAPE)


def _nifty_at(hhmmss: str) -> dict:
    rows = [row for row in _nifty_rows() if str(row.get("t", ""))[11:19] <= hhmmss]
    last = datetime.fromisoformat(str(rows[-1]["t"]))
    return ow.compute_wall_state(
        rows,
        symbol="NIFTY",
        date_str=DATE,
        now=last + timedelta(minutes=1),
    )


def test_replay_at_does_not_show_a_future_break():
    """At 09:16 the 14:25 break does not exist yet — the card must not show it."""
    state = _nifty_at("09:16:59")
    assert state["alert"] is None
    assert state["alert_eligible"] is False
    assert not any(event["kind"] == "BREAK" for event in state["events"])
    assert state["freshness"]["last_t"][11:16] <= "09:16"


def test_new_oi_tracks_the_session_open_book():
    state = _nifty_at("14:25:59")
    call = state["calls"][0]
    assert call["oi_open"] is not None
    assert call["new_oi"] is not None
    assert call["new_oi"] == pytest.approx(call["oi"] - call["oi_open"], abs=0.01)
    assert call["new_oi_pct"] is not None
    assert state["call_wall"]["oi_open"] is not None
    assert state["call_wall"]["new_oi"] is not None


def test_endpoint_at_cutoff_hides_future_events():
    client = _client()
    early = client.get(
        "/api/reports/options/NIFTY/walls",
        params={"date": DATE, "at": "09:16"},
    )
    assert early.status_code == 200
    data = early.json()
    assert data["freshness"]["last_t"][11:16] <= "09:16"
    assert data["alert"] is None
    assert not any(event["kind"] == "BREAK" for event in data["events"])

    late = client.get(
        "/api/reports/options/SENSEX/walls",
        params={"date": DATE, "at": "14:25:48"},
    )
    assert late.status_code == 200
    late_data = late.json()
    assert late_data["alert_eligible"] is True
    assert late_data["alert"]["wall"] == 74000
    assert late_data["alert"]["at"].startswith("2026-10-29T14:25:48")
    assert any(event["kind"] == "BREAK" for event in late_data["events"])


def test_endpoint_at_before_the_tape_is_404():
    client = _client()
    response = client.get(
        "/api/reports/options/SENSEX/walls",
        params={"date": DATE, "at": "09:16"},
    )
    assert response.status_code == 404
