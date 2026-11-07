"""The SPOT poller's day-open baseline must not survive the overnight gap.

``change_pct`` is measured against the first spot the poller saw. The poller
runs for the life of the process, so without a per-IST-day reset the second
trading day of a long-lived API measured the change against YESTERDAY's open
while the UI labelled it today's change.
"""

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.reports_api import nifty_ws as nifty_ws_module  # noqa: E402


@pytest.fixture
def _clean_state():
    nifty_ws_module._reset_spot_state_for_tests()
    yield
    nifty_ws_module._reset_spot_state_for_tests()


async def _run_poller(monkeypatch, today_box, spot_box, seconds=0.08):
    monkeypatch.setattr("trading.utils.is_market_open", lambda *a, **k: True)
    monkeypatch.setattr(nifty_ws_module, "_ist_today", lambda: today_box["d"])

    async def _ok(underlying: str):
        return {"status": "ok", "underlying": underlying, "spot": spot_box["v"]}

    monkeypatch.setattr("api.options.get_spot_price", _ok)
    task = asyncio.create_task(
        nifty_ws_module.nifty_spot_tick_task(interval_sec=0.01)
    )
    try:
        await asyncio.sleep(seconds)
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    return task


async def test_change_pct_is_measured_against_the_current_day_open(
    _clean_state, monkeypatch
):
    today_box = {"d": "2026-10-21"}
    spot_box = {"v": 22700.0}
    await _run_poller(monkeypatch, today_box, spot_box)

    snap = nifty_ws_module.latest_spot()
    assert snap["spot"] == 22700.0
    assert snap["change_pct"] == 0.0  # first reading is its own baseline

    spot_box["v"] = 22800.0
    await _run_poller(monkeypatch, today_box, spot_box)
    snap = nifty_ws_module.latest_spot()
    assert snap["change_pct"] == pytest.approx(
        (22800.0 - 22700.0) / 22700.0 * 100.0, rel=1e-6
    )


async def test_baseline_resets_when_the_ist_day_rolls_over(
    _clean_state, monkeypatch
):
    today_box = {"d": "2026-10-21"}
    spot_box = {"v": 22700.0}
    await _run_poller(monkeypatch, today_box, spot_box)

    spot_box["v"] = 22800.0
    await _run_poller(monkeypatch, today_box, spot_box)
    assert nifty_ws_module.latest_spot()["change_pct"] != 0.0

    # Overnight: the session date moves on and the first reading of the new
    # day must become the new baseline (not yesterday's open).
    today_box["d"] = "2026-10-22"
    spot_box["v"] = 23000.0
    await _run_poller(monkeypatch, today_box, spot_box)

    snap = nifty_ws_module.latest_spot()
    assert snap["spot"] == 23000.0
    assert snap["change_pct"] == 0.0
    assert nifty_ws_module._day_open == 23000.0
    assert nifty_ws_module._day_open_date == "2026-10-22"


def test_ist_now_iso_is_timezone_aware():
    stamp = nifty_ws_module._ist_now_iso()
    assert "T" in stamp
    # Either an explicit offset or a UTC marker - never a naive local stamp.
    assert stamp.endswith("+05:30") or stamp.endswith("Z") or "+" in stamp
