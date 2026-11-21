"""Contracts for the NIFTY futures / basis recorder.

Everything upstream is mocked (token, instrument search, candles) so these
tests describe the file contract, the session/backfill rules and the failure
behaviour — not the Upstox API.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

import config
from api.reports_api import nifty_futures as nf

TODAY = "2026-11-18"
KEY = "NSE_FO|61471"
EXPIRY = "2026-11-23"
_REAL_WRITE_TERM = nf._write_term


def _candle(ts: str, close: float, volume: int = 100, oi: int = 1000) -> list:
    return [ts, close, close, close, close, volume, oi]


def _search_payload() -> dict:
    return {
        "status": "success",
        "data": [
            {"instrument_key": "NSE_FO|1", "trading_symbol": "BANKNIFTY FUT 23 NOV 26",
             "instrument_type": "FUT", "segment": "NSE_FO",
             "expiry": "2026-11-23", "lot_size": 35},
            {"instrument_key": "NSE_FO|2", "trading_symbol": "NIFTYNXT50 FUT 23 NOV 26",
             "instrument_type": "FUT", "segment": "NSE_FO",
             "expiry": "2026-11-23", "lot_size": 25},
            {"instrument_key": "NSE_FO|3", "trading_symbol": "NIFTYFPI FUT 23 NOV 26",
             "instrument_type": "FUT", "segment": "NSE_FO",
             "expiry": "2026-11-23", "lot_size": 65},
            {"instrument_key": "NSE_FO|9", "trading_symbol": "NIFTY FUT 30 OCT 26",
             "instrument_type": "FUT", "segment": "NSE_FO",
             "expiry": "2026-10-30", "lot_size": 65},
            {"instrument_key": "NSE_FO|61472", "trading_symbol": "NIFTY FUT 26 JAN 27",
             "instrument_type": "FUT", "segment": "NSE_FO",
             "expiry": "2027-01-26", "lot_size": 65},
            {"instrument_key": KEY, "trading_symbol": "NIFTY FUT 23 NOV 26",
             "instrument_type": "FUT", "segment": "NSE_FO",
             "expiry": EXPIRY, "lot_size": 65},
            "junk",
        ],
    }


def _candles_payload() -> dict:
    # Newest-first, as Upstox returns them, including the still-forming minute.
    return {"data": {"candles": [
        _candle("2026-11-18T09:18:00+05:30", 103.0, 40, 1900),
        _candle("2026-11-18T09:17:00+05:30", 102.0, 30, 1800),
        _candle("2026-11-18T09:16:00+05:30", 101.0, 20, 1400),
        _candle("2026-11-18T09:15:00+05:30", 100.0, 10, 1000),
    ]}}


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(nf, "DATA_ROOT", tmp_path)
    monkeypatch.setattr(nf, "ENABLED", True)
    # The term snapshot talks to the real chain endpoint; each test opts in.
    async def _skip_term(_now):
        return 0

    monkeypatch.setattr(nf, "_write_term", _skip_term)
    # Importing the websocket module is heavy and irrelevant here.
    monkeypatch.setattr(nf, "_live_spot", lambda: None)
    nf._reset_state()
    yield tmp_path
    nf._reset_state()


def _write_tape(tmp_path: Path, spots: dict[str, float]) -> None:
    path = tmp_path / "nifty_tape" / f"{TODAY}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        for minute, spot in spots.items():
            fh.write(json.dumps({"t": f"{minute}:00+05:30", "spot": spot}) + "\n")


def _now(hour: int = 9, minute: int = 18, second: int = 30) -> datetime:
    return datetime(2026, 11, 18, hour, minute, second, tzinfo=config.IST)


def test_contract_pick_skips_other_indices_and_expired():
    rows = nf.parse_search_payload(_search_payload())

    assert [r["instrument_key"] for r in rows] == ["NSE_FO|9", "NSE_FO|61472", KEY]

    pick = nf.pick_current_month(rows, TODAY)
    assert pick is not None
    assert pick["instrument_key"] == KEY
    assert pick["expiry"] == EXPIRY
    assert pick["lot_size"] == 65


def test_pick_current_month_has_no_candidate_after_roll():
    rows = nf.parse_search_payload(_search_payload())
    assert nf.pick_current_month(rows, "2027-02-01") is None


def test_parse_candles_newest_first_becomes_oldest_first():
    bars = nf.parse_candles(_candles_payload())

    assert [b["ts"][11:16] for b in bars] == ["09:15", "09:16", "09:17", "09:18"]
    assert [b["close"] for b in bars] == [100.0, 101.0, 102.0, 103.0]
    assert [b["oi"] for b in bars] == [1000, 1400, 1800, 1900]


def test_build_rows_computes_basis_and_minute_deltas():
    bars = nf.parse_candles(_candles_payload())
    spots = {"2026-11-18T09:15": 99.0, "2026-11-18T09:16": 100.0,
             "2026-11-18T09:17": 101.0, "2026-11-18T09:18": 102.0}

    rows = nf.build_rows(bars, KEY, EXPIRY, spots)

    assert rows[0]["basis"] == 1.0
    assert rows[1]["basis"] == 1.0
    assert rows[0]["change_1m"] is None
    assert rows[1]["change_1m"] == 1.0
    assert rows[1]["oi_change_1m"] == 400


def test_build_rows_uses_live_spot_only_for_the_newest_bar():
    bars = nf.parse_candles(_candles_payload())
    rows = nf.build_rows(bars, KEY, EXPIRY, {}, live_spot=104.0)

    assert rows[-1]["spot"] == 104.0
    assert rows[-1]["basis"] == -1.0
    assert rows[0]["spot"] is None
    assert rows[0]["basis"] is None


def test_complete_bars_excludes_the_forming_minute():
    bars = nf.parse_candles(_candles_payload())
    complete = nf.complete_bars(bars, _now())
    assert [b["ts"][11:16] for b in complete] == ["09:15", "09:16", "09:17"]


@pytest.mark.asyncio
async def test_record_tick_writes_sorted_rows_with_tape_spot(tmp_path, monkeypatch):
    _write_tape(tmp_path, {"2026-11-18T09:15": 99.0,
                           "2026-11-18T09:16": 100.0,
                           "2026-11-18T09:17": 101.0})

    async def _get_json(url, params, token):
        return _search_payload() if url.endswith("/instruments/search") else _candles_payload()

    monkeypatch.setattr(nf, "_token", lambda: "tok")
    monkeypatch.setattr(nf, "_get_json", _get_json)

    out = await nf.record_tick(_now())

    assert out["status"] == "ok"
    assert out["records"] == 3
    rows = [json.loads(line) for line in nf.day_path(TODAY).read_text().splitlines()]
    assert [r["t"][11:16] for r in rows] == ["09:15", "09:16", "09:17"]
    assert rows[1]["basis"] == 1.0
    assert rows[1]["change_1m"] == 1.0
    assert rows[1]["oi_change_1m"] == 400
    assert rows[0]["instrument_key"] == KEY
    assert rows[0]["expiry"] == EXPIRY


@pytest.mark.asyncio
async def test_backfill_is_idempotent_and_sorts_a_partial_file(tmp_path, monkeypatch):
    # A minute already on disk (09:16) must not be duplicated, and its recorded
    # close must win over the freshly fetched one.
    path = nf.day_path(TODAY)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "t": "2026-11-18T09:16:00+05:30", "instrument_key": KEY, "expiry": EXPIRY,
        "close": 999.0, "oi": 1, "volume": 1, "spot": 100.0, "basis": 899.0,
        "change_1m": None, "oi_change_1m": None,
    }) + "\n")

    async def _get_json(url, params, token):
        return _search_payload() if url.endswith("/instruments/search") else _candles_payload()

    monkeypatch.setattr(nf, "_token", lambda: "tok")
    monkeypatch.setattr(nf, "_get_json", _get_json)

    first = await nf.record_tick(_now())
    assert first["records"] == 2  # 09:15 and 09:17 fill around the existing 09:16

    second = await nf.record_tick(_now())
    assert second["records"] == 0

    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert [r["t"][11:16] for r in rows] == ["09:15", "09:16", "09:17"]
    assert rows[1]["close"] == 999.0


@pytest.mark.asyncio
async def test_candle_fetch_retries_once(monkeypatch):
    calls = {"candles": 0}

    async def _get_json(url, params, token):
        if url.endswith("/instruments/search"):
            return _search_payload()
        calls["candles"] += 1
        if calls["candles"] == 1:
            raise RuntimeError("upstox 429")
        return _candles_payload()

    monkeypatch.setattr(nf, "_token", lambda: "tok")
    monkeypatch.setattr(nf, "_get_json", _get_json)
    nf._contract_cache.clear()

    out = await nf.record_tick(_now())

    assert calls["candles"] == 2
    assert out["records"] == 3


@pytest.mark.asyncio
async def test_candle_failure_twice_is_logged_not_raised(monkeypatch):
    async def _get_json(url, params, token):
        if url.endswith("/instruments/search"):
            return _search_payload()
        raise RuntimeError("upstox 503")

    monkeypatch.setattr(nf, "_token", lambda: "tok")
    monkeypatch.setattr(nf, "_get_json", _get_json)

    out = await nf.record_tick(_now())

    assert out["status"] == "candles-failed"
    assert "upstox 503" in str(nf.status()["last_error"])
    assert not nf.day_path(TODAY).exists()


@pytest.mark.asyncio
async def test_stale_cache_survives_a_failed_search(monkeypatch):
    cached = {"instrument_key": KEY, "trading_symbol": "NIFTY FUT 23 NOV 26",
              "expiry": EXPIRY, "lot_size": 65}
    nf._contract_cache["nifty"] = {"ts": 0.0, "row": cached}

    async def _get_json(url, params, token):
        raise RuntimeError("upstox 503")

    monkeypatch.setattr(nf, "_get_json", _get_json)

    assert await nf.resolve_contract(TODAY, "tok") is cached


@pytest.mark.asyncio
async def test_missing_token_records_nothing(monkeypatch):
    monkeypatch.setattr(nf, "_token", lambda: "")

    out = await nf.record_tick(_now())

    assert out["status"] == "no-token"
    assert not nf.day_path(TODAY).exists()


@pytest.mark.asyncio
async def test_disabled_flag_does_not_start_a_loop(monkeypatch):
    monkeypatch.setattr(nf, "ENABLED", False)

    assert await nf.start_nifty_futures_task() is None
    assert nf._task is None


@pytest.mark.asyncio
async def test_term_snapshot_writes_two_expiries(tmp_path, monkeypatch):
    import api.options as options

    async def _expiries(_underlying):
        return {"expiries": [{"date": "2026-11-30"}, {"date": "2026-10-30"},
                             {"date": TODAY}, {"date": "2026-12-28"}]}

    async def _chain(_underlying, expiry):
        return {"spot": 24000.0,
                "summary": {"atm_iv": 12.5, "max_pain": 24000, "pcr": 1.1}}

    monkeypatch.setattr(options, "get_expiries", _expiries)
    monkeypatch.setattr(options, "get_option_chain", _chain)

    rows = await nf.record_term_snapshot(_now(10, 5))

    assert [r["expiry"] for r in rows] == [TODAY, "2026-11-30"]
    assert rows[0]["atm_iv"] == 12.5
    assert rows[0]["pcr"] == 1.1


@pytest.mark.asyncio
async def test_term_snapshot_failure_is_reported_as_skip(monkeypatch):
    import api.options as options

    async def _expiries(_underlying):
        raise RuntimeError("upstox 401")

    monkeypatch.setattr(options, "get_expiries", _expiries)
    # The autouse fixture stubs the writer so no test hits the chain endpoint;
    # this one exercises the real failure path.
    monkeypatch.setattr(nf, "_write_term", _REAL_WRITE_TERM)
    nf._status["term_last_attempt"] = None
    nf._status["term_last_skip"] = None

    written = await nf._write_term(_now(10, 5))

    assert written == 0
    assert "upstox 401" in str(nf.status()["term_last_skip"])
