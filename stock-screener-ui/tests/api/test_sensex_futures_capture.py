"""Contracts for the SENSEX futures / basis+term recorder.

Everything upstream is mocked (token, instrument search, candles, chain) so
these tests describe the file contract, the BSE contract pick, the session and
backfill rules, the spot fallbacks and the failure behaviour.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

import config
from api.reports_api import sensex_futures as sf

TODAY = "2026-11-18"
KEY = "BSE_FO|1100929"
EXPIRY = "2026-11-26"
SPOT = "SENSEX"
_REAL_WRITE_TERM = sf._write_term


def _candle(ts: str, close: float, volume: int = 100, oi: int = 1000) -> list:
    return [ts, close, close, close, close, volume, oi]


def _search_payload() -> dict:
    return {
        "status": "success",
        "data": [
            {"instrument_key": KEY, "trading_symbol": "SENSEX FUT 26 NOV 26",
             "instrument_type": "FUT", "segment": "BSE_FO",
             "expiry": EXPIRY, "lot_size": 20},
            {"instrument_key": "BSE_FO|1145756", "trading_symbol": "SENSEX FUT 31 DEC 26",
             "instrument_type": "FUT", "segment": "BSE_FO",
             "expiry": "2026-12-31", "lot_size": 20},
            {"instrument_key": "BSE_FO|9", "trading_symbol": "SENSEX FUT 30 OCT 26",
             "instrument_type": "FUT", "segment": "BSE_FO",
             "expiry": "2026-10-30", "lot_size": 20},
            {"instrument_key": "BSE_FO|1112362", "trading_symbol": "SENSEX50 FUT 26 NOV 26",
             "instrument_type": "FUT", "segment": "BSE_FO",
             "expiry": "2026-11-26", "lot_size": 75},
            {"instrument_key": "BSE_FO|1138868", "trading_symbol": "SENSEX50 FUT 31 DEC 26",
             "instrument_type": "FUT", "segment": "BSE_FO",
             "expiry": "2026-12-31", "lot_size": 75},
            "junk",
        ],
    }


def _candles_payload() -> dict:
    # Newest-first, as Upstox returns them, including the still-forming minute.
    return {"data": {"candles": [
        _candle("2026-11-18T09:18:00+05:30", 82200.0, 40, 1900),
        _candle("2026-11-18T09:17:00+05:30", 82150.0, 30, 1800),
        _candle("2026-11-18T09:16:00+05:30", 82100.0, 20, 1400),
        _candle("2026-11-18T09:15:00+05:30", 82050.0, 10, 1000),
    ]}}


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sf, "DATA_ROOT", tmp_path)
    monkeypatch.setattr(sf, "ENABLED", True)

    async def _skip_term(_now):
        return 0

    monkeypatch.setattr(sf, "_write_term", _skip_term)

    async def _no_live_spot(_date_str):
        return None

    monkeypatch.setattr(sf, "_live_spot", _no_live_spot)
    sf._reset_state()
    yield tmp_path
    sf._reset_state()


def _write_tape(tmp_path: Path, spots: dict[str, float]) -> None:
    path = tmp_path / "options_tape" / SPOT / f"{TODAY}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        for minute, spot in spots.items():
            fh.write(json.dumps({"t": f"{minute}:00+05:30", "spot": spot}) + "\n")


def _write_report(tmp_path: Path, spot: float) -> None:
    path = tmp_path / "options_snapshots" / SPOT / f"{TODAY}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"spot": spot, "expiry": "2026-11-19"}))


def _now(hour: int = 9, minute: int = 18, second: int = 30) -> datetime:
    return datetime(2026, 11, 18, hour, minute, second, tzinfo=config.IST)


def test_contract_pick_skips_sensex50_and_expired():
    rows = sf.parse_search_payload(_search_payload())

    assert [r["instrument_key"] for r in rows] == [KEY, "BSE_FO|1145756", "BSE_FO|9"]

    pick = sf.pick_current_month(rows, TODAY)
    assert pick is not None
    assert pick["instrument_key"] == KEY
    assert pick["expiry"] == EXPIRY
    assert pick["lot_size"] == 20


def test_is_sensex_futures_rejects_the_sibling_index():
    assert sf.is_sensex_futures("SENSEX FUT 26 NOV 26")
    assert not sf.is_sensex_futures("SENSEX50 FUT 26 NOV 26")
    assert not sf.is_sensex_futures("BANKEX FUT 26 NOV 26")


def test_pick_current_month_has_no_candidate_after_roll():
    rows = sf.parse_search_payload(_search_payload())
    assert sf.pick_current_month(rows, "2027-02-01") is None


def test_parse_candles_newest_first_becomes_oldest_first():
    bars = sf.parse_candles(_candles_payload())

    assert [b["ts"][11:16] for b in bars] == ["09:15", "09:16", "09:17", "09:18"]
    assert [b["close"] for b in bars] == [82050.0, 82100.0, 82150.0, 82200.0]
    assert [b["oi"] for b in bars] == [1000, 1400, 1800, 1900]


def test_build_rows_computes_basis_and_minute_deltas():
    bars = sf.parse_candles(_candles_payload())
    spots = {"2026-11-18T09:15": 82000.0, "2026-11-18T09:16": 82050.0,
             "2026-11-18T09:17": 82100.0, "2026-11-18T09:18": 82150.0}

    rows = sf.build_rows(bars, KEY, EXPIRY, spots)

    assert rows[0]["basis"] == 50.0
    assert rows[1]["basis"] == 50.0
    assert rows[0]["change_1m"] is None
    assert rows[1]["change_1m"] == 50.0
    assert rows[1]["oi_change_1m"] == 400


def test_build_rows_uses_live_spot_only_for_the_newest_bar():
    bars = sf.parse_candles(_candles_payload())
    rows = sf.build_rows(bars, KEY, EXPIRY, {}, live_spot=82100.0)

    assert rows[-1]["spot"] == 82100.0
    assert rows[-1]["basis"] == 100.0
    assert rows[0]["spot"] is None
    assert rows[0]["basis"] is None


def test_complete_bars_excludes_the_forming_minute():
    bars = sf.parse_candles(_candles_payload())
    complete = sf.complete_bars(bars, _now())
    assert [b["ts"][11:16] for b in complete] == ["09:15", "09:16", "09:17"]


@pytest.mark.asyncio
async def test_record_tick_writes_sorted_rows_with_tape_spot(tmp_path, monkeypatch):
    _write_tape(tmp_path, {"2026-11-18T09:15": 82000.0,
                           "2026-11-18T09:16": 82050.0,
                           "2026-11-18T09:17": 82100.0})

    async def _get_json(url, params, token):
        return _search_payload() if url.endswith("/instruments/search") else _candles_payload()

    monkeypatch.setattr(sf, "_token", lambda: "tok")
    monkeypatch.setattr(sf, "_get_json", _get_json)

    out = await sf.record_tick(_now())

    assert out["status"] == "ok"
    assert out["records"] == 3
    rows = [json.loads(line) for line in sf.day_path(TODAY).read_text().splitlines()]
    assert [r["t"][11:16] for r in rows] == ["09:15", "09:16", "09:17"]
    assert rows[1]["basis"] == 50.0
    assert rows[1]["change_1m"] == 50.0
    assert rows[1]["oi_change_1m"] == 400
    assert rows[0]["instrument_key"] == KEY
    assert rows[0]["expiry"] == EXPIRY
    assert rows[0]["spot"] == 82000.0


@pytest.mark.asyncio
async def test_search_uses_the_verified_bse_query(monkeypatch):
    seen: dict = {}

    async def _get_json(url, params, token):
        seen["url"] = url
        seen["params"] = params
        return _search_payload()

    monkeypatch.setattr(sf, "_get_json", _get_json)

    await sf.search_contracts("tok")

    assert seen["url"] == "https://api.upstox.com/v2/instruments/search"
    assert seen["params"] == {
        "query": "SENSEX",
        "segments": "FO",
        "instrument_types": "FUT",
        "records": 10,
    }


@pytest.mark.asyncio
async def test_backfill_is_idempotent_and_sorts_a_partial_file(tmp_path, monkeypatch):
    # A minute already on disk (09:16) must not be duplicated, and its recorded
    # close must win over the freshly fetched one.
    path = sf.day_path(TODAY)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "t": "2026-11-18T09:16:00+05:30", "instrument_key": KEY, "expiry": EXPIRY,
        "close": 999.0, "oi": 1, "volume": 1, "spot": 82050.0, "basis": -81151.0,
        "change_1m": None, "oi_change_1m": None,
    }) + "\n")

    async def _get_json(url, params, token):
        return _search_payload() if url.endswith("/instruments/search") else _candles_payload()

    monkeypatch.setattr(sf, "_token", lambda: "tok")
    monkeypatch.setattr(sf, "_get_json", _get_json)

    first = await sf.record_tick(_now())
    assert first["records"] == 2  # 09:15 and 09:17 fill around the existing 09:16

    second = await sf.record_tick(_now())
    assert second["records"] == 0

    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert [r["t"][11:16] for r in rows] == ["09:15", "09:16", "09:17"]
    assert rows[1]["close"] == 999.0


@pytest.mark.asyncio
async def test_newest_bar_falls_back_to_the_latest_report_spot(tmp_path, monkeypatch):
    # Tape covers the older minutes only; the newest minute must use the local
    # report snapshot, not a borrowed past price.
    _write_tape(tmp_path, {"2026-11-18T09:15": 82000.0,
                           "2026-11-18T09:16": 82050.0})
    _write_report(tmp_path, 82125.0)

    async def _local_only(date_str):
        return sf._local_spot(date_str)

    async def _get_json(url, params, token):
        return _search_payload() if url.endswith("/instruments/search") else _candles_payload()

    monkeypatch.setattr(sf, "_live_spot", _local_only)
    monkeypatch.setattr(sf, "_token", lambda: "tok")
    monkeypatch.setattr(sf, "_get_json", _get_json)

    out = await sf.record_tick(_now())

    assert out["records"] == 3
    rows = [json.loads(line) for line in sf.day_path(TODAY).read_text().splitlines()]
    assert rows[-1]["t"][11:16] == "09:17"
    assert rows[-1]["spot"] == 82125.0
    assert rows[-1]["basis"] == 25.0


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

    monkeypatch.setattr(sf, "_token", lambda: "tok")
    monkeypatch.setattr(sf, "_get_json", _get_json)
    sf._contract_cache.clear()

    out = await sf.record_tick(_now())

    assert calls["candles"] == 2
    assert out["records"] == 3


@pytest.mark.asyncio
async def test_candle_failure_twice_is_logged_not_raised(monkeypatch):
    async def _get_json(url, params, token):
        if url.endswith("/instruments/search"):
            return _search_payload()
        raise RuntimeError("upstox 503")

    monkeypatch.setattr(sf, "_token", lambda: "tok")
    monkeypatch.setattr(sf, "_get_json", _get_json)

    out = await sf.record_tick(_now())

    assert out["status"] == "candles-failed"
    assert "upstox 503" in str(sf.status()["last_error"])
    assert not sf.day_path(TODAY).exists()


@pytest.mark.asyncio
async def test_stale_cache_survives_a_failed_search(monkeypatch):
    cached = {"instrument_key": KEY, "trading_symbol": "SENSEX FUT 26 NOV 26",
              "expiry": EXPIRY, "lot_size": 20}
    sf._contract_cache["sensex"] = {"ts": 0.0, "row": cached}

    async def _get_json(url, params, token):
        raise RuntimeError("upstox 503")

    monkeypatch.setattr(sf, "_get_json", _get_json)

    assert await sf.resolve_contract(TODAY, "tok") is cached


@pytest.mark.asyncio
async def test_missing_token_records_nothing(monkeypatch):
    monkeypatch.setattr(sf, "_token", lambda: "")

    out = await sf.record_tick(_now())

    assert out["status"] == "no-token"
    assert not sf.day_path(TODAY).exists()


@pytest.mark.asyncio
async def test_disabled_flag_does_not_start_a_loop(monkeypatch):
    monkeypatch.setattr(sf, "ENABLED", False)

    assert await sf.start_sensex_futures_task() is None
    assert sf._task is None


@pytest.mark.asyncio
async def test_term_snapshot_writes_the_two_nearest_expiries(tmp_path, monkeypatch):
    import api.options as options

    async def _expiries(_underlying):
        return {"expiries": [{"date": "2026-12-03"}, {"date": "2026-11-26"},
                             {"date": "2026-10-30"}, {"date": TODAY},
                             {"date": "2026-11-19"}]}

    async def _chain(underlying, expiry):
        assert underlying == SPOT
        return {"spot": 82031.81,
                "summary": {"atm_iv": 16.55, "max_pain": 82000, "pcr": 0.76}}

    monkeypatch.setattr(options, "get_expiries", _expiries)
    monkeypatch.setattr(options, "get_option_chain", _chain)
    monkeypatch.setattr(sf, "_write_term", _REAL_WRITE_TERM)

    written = await sf._write_term(_now(10, 5))

    assert written == 2
    rows = [json.loads(line) for line in sf.term_path(TODAY).read_text().splitlines()]
    assert [r["expiry"] for r in rows] == [TODAY, "2026-11-19"]
    assert rows[0]["atm_iv"] == 16.55
    assert rows[0]["pcr"] == 0.76
    assert rows[0]["spot"] == 82031.81


@pytest.mark.asyncio
async def test_term_snapshot_is_throttled_within_the_window(monkeypatch):
    import api.options as options

    calls = {"n": 0}

    async def _expiries(_underlying):
        return {"expiries": [{"date": TODAY}]}

    async def _chain(_underlying, _expiry):
        calls["n"] += 1
        return {"spot": 82000.0, "summary": {"atm_iv": 1, "max_pain": 1, "pcr": 1}}

    monkeypatch.setattr(options, "get_expiries", _expiries)
    monkeypatch.setattr(options, "get_option_chain", _chain)
    monkeypatch.setattr(sf, "_write_term", _REAL_WRITE_TERM)
    sf._status["term_last_attempt"] = None

    assert await sf._write_term(_now(10, 5)) == 1
    assert await sf._write_term(_now(10, 5, 30)) == 0
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_term_snapshot_failure_is_reported_as_skip(monkeypatch):
    import api.options as options

    async def _expiries(_underlying):
        raise RuntimeError("upstox 401")

    monkeypatch.setattr(options, "get_expiries", _expiries)
    monkeypatch.setattr(sf, "_write_term", _REAL_WRITE_TERM)
    sf._status["term_last_attempt"] = None
    sf._status["term_last_skip"] = None

    written = await sf._write_term(_now(10, 5))

    assert written == 0
    assert "upstox 401" in str(sf.status()["term_last_skip"])
