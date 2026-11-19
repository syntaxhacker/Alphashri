"""Contracts for the shared futures-recorder machinery (``futures_common``).

The two capture suites pin each recorder's file contract; these tests pin what
must stay **different** between them (search params, symbol gates, spot policy)
and prove the thin module wrappers still resolve the module globals that tests
and operators monkeypatch.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path

import pytest

import config
from api.reports_api import futures_common as common
from api.reports_api import nifty_futures as nf
from api.reports_api import sensex_futures as sf

TODAY = "2026-11-18"


def _now(hour: int = 10, minute: int = 5) -> datetime:
    return datetime(2026, 11, 18, hour, minute, tzinfo=config.IST)


def _row(symbol: str, *, itype: str = "FUT", seg: str = "FO",
         key: str = "X|1", expiry: str = "2026-11-26", lot: int = 20) -> dict:
    return {"instrument_key": key, "trading_symbol": symbol,
            "instrument_type": itype, "segment": seg,
            "expiry": expiry, "lot_size": lot}


def _candles(close: float = 100.0, ts: str = "2026-11-18T09:15:00+05:30") -> dict:
    return {"data": {"candles": [[ts, close, close, close, close, 10, 1000]]}}


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch):
    for mod in (nf, sf):
        monkeypatch.setattr(mod, "DATA_ROOT", tmp_path)
        mod._reset_state()
    yield tmp_path
    for mod in (nf, sf):
        mod._reset_state()


# --------------------------------------------------------------------------- #
# spec differences
# --------------------------------------------------------------------------- #
def test_search_params_differ_only_by_the_exchange_pin():
    assert nf._SPEC.search_params == {
        "query": "NIFTY",
        "exchanges": "NSE",
        "segments": "FO",
        "instrument_types": "FUT",
        "records": common.SEARCH_RECORDS,
    }
    assert sf._SPEC.search_params == {
        "query": "SENSEX",
        "segments": "FO",
        "instrument_types": "FUT",
        "records": common.SEARCH_RECORDS,
    }
    assert "exchanges" not in sf._SPEC.search_params


async def test_nifty_search_sends_the_pinned_exchange(monkeypatch):
    seen: dict = {}

    async def _get_json(url, params, token):
        seen["url"] = url
        seen["params"] = params
        return {"data": []}

    monkeypatch.setattr(nf, "_get_json", _get_json)

    await nf.search_contracts("tok")

    assert seen["url"] == "https://api.upstox.com/v2/instruments/search"
    assert seen["params"]["exchanges"] == "NSE"
    assert seen["params"]["query"] == "NIFTY"


def test_each_spec_rejects_the_other_index_and_its_sibling():
    assert nf._SPEC.is_contract("NIFTY FUT 26 NOV 26")
    assert not nf._SPEC.is_contract("BANKNIFTY FUT 26 NOV 26")
    assert not nf._SPEC.is_contract("NIFTYFPI FUT 26 NOV 26")
    assert sf._SPEC.is_contract("SENSEX FUT 26 NOV 26")
    assert not sf._SPEC.is_contract("SENSEX50 FUT 26 NOV 26")


def test_sensex_accepts_a_symbol_tagged_futures_row():
    # The verified BSE payload tags the contract in the symbol only; NSE rows
    # always carry the segment/instrument type, so NIFTY must not widen.
    payload = {"data": [_row("SENSEX FUT 26 NOV 26", itype="", seg="")]}

    assert [r["instrument_key"] for r in sf.parse_search_payload(payload)] == ["X|1"]
    assert common.parse_search_payload(payload, nf._SPEC) == []
    assert nf._SPEC.symbol_futures_marker is False
    assert sf._SPEC.symbol_futures_marker is True


async def test_sensex_no_contract_when_only_the_sibling_is_listed(monkeypatch):
    async def _get_json(url, params, token):
        return {"data": [_row("SENSEX50 FUT 26 NOV 26", key="BSE_FO|50")]}

    monkeypatch.setattr(sf, "_token", lambda: "tok")
    monkeypatch.setattr(sf, "_get_json", _get_json)

    out = await sf.record_tick(_now())

    assert out["status"] == "no-contract"
    assert "no current-month SENSEX future" in sf.status()["last_error"]
    assert not sf.day_path(TODAY).exists()


# --------------------------------------------------------------------------- #
# wrappers resolve module globals per call
# --------------------------------------------------------------------------- #
async def test_patched_hooks_are_read_on_every_tick(tmp_path, monkeypatch):
    calls = {"token": 0, "term": 0, "spot": 0}

    def _token():
        calls["token"] += 1
        return ""

    async def _term(_ts):
        calls["term"] += 1
        return 0

    def _spot():
        calls["spot"] += 1
        return 999.0

    monkeypatch.setattr(nf, "_token", _token)
    monkeypatch.setattr(nf, "_write_term", _term)
    monkeypatch.setattr(nf, "_live_spot", _spot)

    first = await nf.record_tick(_now())
    assert first["status"] == "no-token"
    assert calls == {"token": 1, "term": 0, "spot": 0}

    tape = tmp_path / "nifty_tape" / f"{TODAY}.jsonl"
    tape.parent.mkdir(parents=True)
    tape.write_text(json.dumps({"t": f"{TODAY}T09:15:00+05:30", "spot": 99.0}) + "\n")

    async def _get_json(url, params, token):
        if url.endswith("/instruments/search"):
            return {"data": [_row("NIFTY FUT 26 NOV 26", key="NSE_FO|9")]}
        return _candles()

    monkeypatch.setattr(nf, "_token", lambda: "tok")
    monkeypatch.setattr(nf, "_get_json", _get_json)

    second = await nf.record_tick(_now())

    assert second["status"] == "ok"
    assert calls["term"] == 1
    # ``spot_always``: the websocket read is free, so it runs even when the
    # tape already covers the newest minute — and the tape still wins.
    assert calls["spot"] == 1
    row = json.loads(nf.day_path(TODAY).read_text().splitlines()[0])
    assert row["spot"] == 99.0


async def test_sensex_skips_the_live_spot_when_the_tape_covers_the_newest_minute(
        tmp_path, monkeypatch):
    calls = {"spot": 0}

    async def _spot(_date_str):
        calls["spot"] += 1
        return 999.0

    async def _term(_ts):
        return 0

    async def _get_json(url, params, token):
        if url.endswith("/instruments/search"):
            return {"data": [_row("SENSEX FUT 26 NOV 26", key="BSE_FO|1")]}
        return _candles(82050.0)

    tape = tmp_path / "options_tape" / "SENSEX" / f"{TODAY}.jsonl"
    tape.parent.mkdir(parents=True)
    tape.write_text(json.dumps({"t": f"{TODAY}T09:15:00+05:30", "spot": 82000.0}) + "\n")

    monkeypatch.setattr(sf, "_live_spot", _spot)
    monkeypatch.setattr(sf, "_write_term", _term)
    monkeypatch.setattr(sf, "_token", lambda: "tok")
    monkeypatch.setattr(sf, "_get_json", _get_json)

    out = await sf.record_tick(_now())

    assert out["records"] == 1
    assert calls["spot"] == 0
    row = json.loads(sf.day_path(TODAY).read_text().splitlines()[0])
    assert row["spot"] == 82000.0


# --------------------------------------------------------------------------- #
# shared contract + term logic
# --------------------------------------------------------------------------- #
def test_contract_cache_keys_are_distinct():
    assert nf._SPEC.contract_cache_key == "nifty"
    assert sf._SPEC.contract_cache_key == "sensex"


async def test_live_cached_contract_short_circuits_the_search():
    cached = {"instrument_key": "BSE_FO|1", "expiry": "2026-11-26", "lot_size": 20}
    sf._contract_cache["sensex"] = {"ts": time.monotonic(), "row": cached}

    assert await sf.resolve_contract(TODAY, "tok") is cached
    assert "nifty" not in sf._contract_cache


async def test_expired_cached_contract_is_replaced_by_a_fresh_search(monkeypatch):
    stale = {"instrument_key": "BSE_FO|old", "expiry": "2026-10-30", "lot_size": 20}
    sf._contract_cache["sensex"] = {"ts": time.monotonic(), "row": stale}

    async def _get_json(url, params, token):
        assert params["query"] == "SENSEX"
        return {"data": [_row("SENSEX FUT 26 NOV 26", key="BSE_FO|new")]}

    monkeypatch.setattr(sf, "_get_json", _get_json)

    got = await sf.resolve_contract(TODAY, "tok")

    assert got is not None
    assert got["instrument_key"] == "BSE_FO|new"
    assert sf._contract_cache["sensex"]["row"] is got


async def test_term_snapshot_queries_each_module_underlying(monkeypatch):
    import api.options as options

    seen: list[str] = []

    async def _expiries(underlying):
        seen.append(underlying)
        return {"expiries": [{"date": TODAY}]}

    async def _chain(underlying, expiry):
        return {"spot": 1.0, "summary": {"atm_iv": 1, "max_pain": 1, "pcr": 1}}

    monkeypatch.setattr(options, "get_expiries", _expiries)
    monkeypatch.setattr(options, "get_option_chain", _chain)

    await nf.record_term_snapshot(_now())
    await sf.record_term_snapshot(_now())

    assert seen == ["NIFTY", "SENSEX"]


async def test_term_write_is_deduped_across_a_restart(monkeypatch):
    import api.options as options

    path = sf.term_path(TODAY)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"t": f"{TODAY}T10:05:00+05:30", "expiry": TODAY}) + "\n")

    async def _expiries(_underlying):
        return {"expiries": [{"date": TODAY}]}

    async def _chain(_underlying, _expiry):
        return {"spot": 82000.0, "summary": {"atm_iv": 1, "max_pain": 1, "pcr": 1}}

    monkeypatch.setattr(options, "get_expiries", _expiries)
    monkeypatch.setattr(options, "get_option_chain", _chain)

    assert await sf._write_term(_now()) == 0
    assert len(path.read_text().splitlines()) == 1

    # A later minute is a new row (the 15-minute throttle has passed).
    assert await sf._write_term(_now(10, 21)) == 1
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert [r["t"][11:16] for r in rows] == ["10:05", "10:21"]


def test_expiry_dates_normalises_dedupes_and_sorts():
    listing = {"expiries": [
        {"date": "2026-12-03T00:00:00"},
        "2026-11-26",
        {"date": "not-a-date"},
        {"date": "2026-11-26"},
    ]}

    assert common._expiry_dates(listing) == ["2026-11-26", "2026-12-03"]
    assert common._expiry_dates(None) == []


def test_merge_rows_dedupes_sorts_and_refreshes_the_seen_cache(tmp_path):
    path = tmp_path / "day.jsonl"
    cache: dict[str, set[str]] = {}

    rows = [
        {"t": f"{TODAY}T09:17:00+05:30", "close": 2.0},
        {"t": f"{TODAY}T09:15:00+05:30", "close": 1.0},
    ]

    assert common.merge_rows(path, rows, cache) == 2
    # An already-recorded minute keeps its first observation.
    assert common.merge_rows(
        path, [{"t": f"{TODAY}T09:15:00+05:30", "close": 9.0}], cache) == 0

    written = [json.loads(line) for line in path.read_text().splitlines()]
    assert [r["t"][11:16] for r in written] == ["09:15", "09:17"]
    assert written[0]["close"] == 1.0
    assert cache[str(path)] == {f"{TODAY}T09:15", f"{TODAY}T09:17"}


# --------------------------------------------------------------------------- #
# single-writer guard
# --------------------------------------------------------------------------- #
async def test_single_writer_guard_rejects_a_second_loop():
    async def _noop():
        return None

    first = asyncio.create_task(_noop())
    second = asyncio.create_task(_noop())
    try:
        assert nf._claim_task(first) is True
        assert nf._task is first
        assert nf._claim_task(second) is False
        assert nf._claim_task(first) is True
    finally:
        first.cancel()
        second.cancel()
