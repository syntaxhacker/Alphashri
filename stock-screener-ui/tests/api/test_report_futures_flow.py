"""Index Report: futures OI regime + intraday ITM put flow.

Every network path is mocked; the tape fixture is the exact per-strike chain
shape the recorder writes (``chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi,
ce_vol, pe_vol]``).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

import api.reports_api.futures as fut
import api.reports_api.nifty as nifty

pytestmark = pytest.mark.unit

TODAY = "2026-11-17"

SEARCH_PAYLOAD = {
    "status": "success",
    "data": [
        {"instrument_key": "NSE_FO|61470", "trading_symbol": "NIFTY 27 NOV 26 FUT",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2026-11-24"},
        {"instrument_key": "NSE_FO|61471", "trading_symbol": "NIFTY FUT 25 NOV 26",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2026-11-23"},
        {"instrument_key": "NSE_FO|70000", "trading_symbol": "BANKNIFTY 27 NOV 26 FUT",
         "instrument_type": "FUT", "segment": "NSE_FO", "expiry": "2026-11-24"},
    ],
}


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    fut.clear_cache()
    monkeypatch.setattr(fut, "today_str", lambda: TODAY)
    monkeypatch.setattr(fut, "_session_open", lambda: True)
    monkeypatch.setattr(nifty, "_today_str", lambda: TODAY)
    yield
    fut.clear_cache()


def candles(closes, ois, volumes, start="11:45"):
    base = datetime.fromisoformat(f"2026-11-17T{start}:00+05:30")
    rows = [
        [(base + timedelta(minutes=i)).isoformat(), c, c, c, c, v, oi]
        for i, (c, oi, v) in enumerate(zip(closes, ois, volumes))
    ]
    return {"status": "success", "data": {"candles": list(reversed(rows))}}


def _patch_http(monkeypatch, intraday):
    calls: list[str] = []

    async def fake(url, params=None):
        calls.append(url)
        if url.endswith("/instruments/search"):
            return SEARCH_PAYLOAD
        return intraday

    monkeypatch.setattr(fut, "_json", fake)
    return calls



async def test_futures_15m_long_buildup(monkeypatch):
    payload = candles([25296.5] * 15 + [25347.0],
                      [11380265] * 15 + [11482705],
                      [1000] * 15 + [77480])
    calls = _patch_http(monkeypatch, payload)

    block = await fut.get_nifty_futures_block(TODAY)

    assert block["symbol"] == "NIFTY"
    assert block["instrument_key"] == "NSE_FO|61471"
    assert block["expiry"] == "2026-11-23"
    assert block["change_pts"] == 50.5
    assert block["oi_change"] == 102440
    assert block["regime"] == "long_buildup"
    assert block["as_of"] == "2026-11-17T12:00:00+05:30"
    assert len(block["series"]) == 16
    assert block["series"][-1] == {
        "t": "2026-11-17T12:00:00+05:30",
        "close": 25347.0,
        "oi": 11482705,
        "volume": 77480,
    }
    assert calls[-1].endswith("/intraday/NSE_FO%7C61471/minutes/1")


async def test_futures_short_covering(monkeypatch):
    payload = candles([25300.0] * 15 + [25320.0],
                      [11000000] * 15 + [10995000], [10] * 16)
    _patch_http(monkeypatch, payload)

    block = await fut.get_nifty_futures_block(TODAY)

    assert block["change_pts"] == 20.0
    assert block["oi_change"] == -5000
    assert block["regime"] == "short_covering"


@pytest.mark.parametrize("change,oi,expected", [
    (-12.5, 400, "short_buildup"),
    (-12.5, -400, "long_unwinding"),
    (12.5, 0, "neutral"),
    (0.0, 400, "neutral"),
])
def test_regime_matrix(change, oi, expected):
    assert fut.regime(change, oi) == expected


async def test_futures_null_on_failure_and_failure_is_cached(monkeypatch):
    mock = AsyncMock(side_effect=RuntimeError("401 expired"))
    monkeypatch.setattr(fut, "_json", mock)

    assert await fut.get_nifty_futures_block(TODAY) is None
    assert await fut.get_nifty_futures_block(TODAY) is None
    assert mock.await_count == 1


async def test_replay_date_is_null_without_any_http(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(fut, "_json", mock)

    assert await fut.get_nifty_futures_block("2026-11-10") is None
    mock.assert_not_awaited()


def test_parse_series_drops_previous_session_and_bad_rows():
    payload = {
        "data": {"candles": [
            ["2026-11-17T09:16:00+05:30", 1, 1, 1, 25300.0, 5, 100],
            ["2026-11-16T15:29:00+05:30", 1, 1, 1, 25200.0, 5, 100],
            ["2026-11-17T09:15:00+05:30", 1, 1, 1, 25290.0, 4, 90],
            ["2026-11-17T09:17:00+05:30", 1, 1, 1, 0, 4, 90],
        ]},
    }

    series = fut.parse_series(payload, "2026-11-17")

    assert [row["t"] for row in series] == [
        "2026-11-17T09:15:00+05:30", "2026-11-17T09:16:00+05:30"]



def _cell(ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol):
    return [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]


def _tape_row(t, spot, pe_vols, pe_ois, ce_vol=0):
    chain = {
        strike: _cell(10.0, 20.0, 0, oi, ce_vol, vol)
        for strike, vol, oi in zip((25400, 25500, 25600), pe_vols, pe_ois)
    }
    return {"t": t, "spot": spot, "chain": chain}


TAPE = [
    _tape_row("2026-11-17T11:55:00+05:30", 25483.8, [1000, 5000, 2000],
              [900000, 700000, 300000]),
    _tape_row("2026-11-17T11:56:00+05:30", 25490.0, [1200, 6200, 2100],
              [900000, 700000, 300000]),
    _tape_row("2026-11-17T11:57:00+05:30", 25490.0, [1300, 300, 2200],
              [900000, 705000, 300000]),
]


def test_itm_pe_flow_deltas_share_and_reset():
    block = nifty.compute_itm_pe_flow(TAPE)

    assert block["as_of"] == "2026-11-17T11:57:00+05:30"
    assert [row["t"][11:16] for row in block["series"]] == ["11:56", "11:57"]
    first, second = block["series"]
    # 11:56 — ITM = 25500 + 25600 (both above 25490); 25400 is OTM.
    assert first["itm_pe_vol"] == 1300
    assert first["total_pe_vol"] == 1500
    assert first["share_pct"] == pytest.approx(86.67, abs=0.01)
    assert first["spot"] == 25490.0
    # 11:57 — 25500's cumulative volume reset (6200 -> 300): skipped, and the
    # reset is NOT subtracted from the total.
    assert second["itm_pe_vol"] == 100
    assert second["total_pe_vol"] == 200
    assert second["share_pct"] == 50.0


def test_itm_pe_flow_top_is_incremental_and_ordered():
    top = nifty.compute_itm_pe_flow(TAPE)["top"]

    assert [row["strike"] for row in top] == [25500, 25600]
    assert top[0]["volume"] == 1200
    assert top[0]["oi"] == 705000
    assert top[1]["volume"] == 200


def test_itm_pe_flow_zero_total_share_is_zero():
    flat = [
        _tape_row("2026-11-17T11:55:00+05:30", 25490.0, [5, 5, 5],
                  [1, 1, 1]),
        _tape_row("2026-11-17T11:56:00+05:30", 25490.0, [5, 5, 5],
                  [1, 1, 1]),
    ]

    row = nifty.compute_itm_pe_flow(flat)["series"][0]

    assert row["itm_pe_vol"] == 0
    assert row["total_pe_vol"] == 0
    assert row["share_pct"] == 0.0


def test_itm_pe_flow_needs_two_rows():
    assert nifty.compute_itm_pe_flow([]) is None
    assert nifty.compute_itm_pe_flow(TAPE[:1]) is None



async def test_payload_keeps_building_when_futures_raises(monkeypatch):
    boom = AsyncMock(side_effect=RuntimeError("feed down"))
    monkeypatch.setattr(fut, "get_nifty_futures_block", boom)

    report: dict = {}
    await nifty.attach_futures_flow(report, TAPE, None)

    assert report["futures"] is None
    assert report["itm_pe_flow"]["as_of"] == "2026-11-17T11:57:00+05:30"


async def test_payload_attaches_futures_when_available(monkeypatch):
    block = {"symbol": "NIFTY", "regime": "long_buildup"}
    monkeypatch.setattr(fut, "get_nifty_futures_block", AsyncMock(return_value=block))

    report: dict = {}
    await nifty.attach_futures_flow(report, TAPE, TODAY)

    assert report["futures"] is block
    assert report["itm_pe_flow"] is not None


async def test_payload_replay_date_returns_nulls(monkeypatch):
    mock = AsyncMock(return_value={"symbol": "NIFTY"})
    monkeypatch.setattr(fut, "get_nifty_futures_block", mock)
    monkeypatch.setattr(nifty, "_today_str", lambda: TODAY)

    report: dict = {}
    await nifty.attach_futures_flow(report, TAPE, "2026-11-10")

    assert report == {"futures": None, "itm_pe_flow": None}
    mock.assert_not_awaited()


def test_saved_past_snapshot_carries_null_blocks(monkeypatch):
    monkeypatch.setattr(nifty, "read_snapshot",
                        lambda date: {"spot": 25400.0, "strikes": []})
    monkeypatch.setattr(nifty, "_derived_snapshot", lambda date, data: dict(data))

    out = nifty.get_nifty_report("2026-11-10")

    assert out["futures"] is None
    assert out["itm_pe_flow"] is None


def test_replay_frame_carries_null_blocks_when_absent():
    out = nifty._slim_replay_report({"spot": 25400.0, "strikes": [], "emas": []})

    assert out["futures"] is None
    assert out["itm_pe_flow"] is None


def test_replay_frame_keeps_recorded_blocks():
    block = {"symbol": "NIFTY", "regime": "long_buildup"}
    flow = {"series": [], "top": [], "as_of": f"{TODAY}T12:00:00+05:30"}

    out = nifty._slim_replay_report({"futures": block, "itm_pe_flow": flow})

    assert out["futures"] is block
    assert out["itm_pe_flow"] is flow
