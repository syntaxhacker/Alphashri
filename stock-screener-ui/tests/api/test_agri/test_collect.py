"""Collector contract: whole-date paging, normalization, ledger and JSONL.

Every request is served by a fake ``requests.get``; the live data.gov.in API is
never called from this module.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import pytest

import config
from api.agri import registry, store
from scripts.market import agri_collect as collect

DATE = "2026-11-21"
API_DATE = "21/11/2026"


class FakeResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self.payload = payload

    def json(self) -> Any:
        return self.payload


class FakeAPI:
    """Serves a probe plus limit/offset pages over one frozen record list."""

    def __init__(
        self,
        records: list[dict[str, Any]],
        *,
        total: Optional[int] = None,
        updated: str = "2026-11-22 05:12:00",
        status_code: int = 200,
        omit_total: bool = False,
    ) -> None:
        self.records = records
        self.total = len(records) if total is None else total
        self.updated = updated
        self.status_code = status_code
        self.omit_total = omit_total
        self.calls: list[dict[str, Any]] = []

    def __call__(self, url: str, params: Optional[dict[str, Any]] = None,
                 headers: Optional[dict[str, str]] = None, timeout: Any = None) -> FakeResponse:
        query = dict(params or {})
        self.calls.append(query)
        if self.status_code != 200:
            return FakeResponse(self.status_code, {})
        limit = int(query.get("limit", 1000))
        offset = int(query.get("offset", 0))
        if limit == 1 and "offset" not in query:
            payload: dict[str, Any] = {
                "updated_date": self.updated,
                "records": self.records[:1],
            }
            if not self.omit_total:
                payload["total"] = str(self.total)
            return FakeResponse(200, payload)
        return FakeResponse(200, {
            "total": self.total,
            "records": self.records[offset:offset + limit],
        })

    @property
    def page_calls(self) -> list[dict[str, Any]]:
        return [call for call in self.calls if "offset" in call]


def raw(
    commodity: str = "Onion",
    *,
    market: str = "Pune APMC",
    state: str = "Maharashtra",
    district: str = "Pune",
    variety: str = "No 1",
    grade: str = "FAQ",
    modal: float = 1000.0,
    day: str = API_DATE,
    arrivals: Optional[float] = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "Arrival_Date": day, "Commodity": commodity,
        "State": state, "District": district, "Market": market,
        "Variety": variety, "Grade": grade,
        "Min_Price": str(modal - 100), "Max_Price": str(modal + 150),
        "Modal_Price": str(modal), "Unit": "Rs./Quintal",
    }
    if arrivals is not None:
        record["arrival_quantity"] = str(arrivals)
        record["arrival_units"] = "Metric Tonnes"
    return record


def install(monkeypatch: pytest.MonkeyPatch, api: FakeAPI) -> FakeAPI:
    monkeypatch.setattr(collect.requests, "get", api)
    return api


def partition(db_path: Path) -> Optional[dict[str, Any]]:
    conn = store.open_writer(db_path)
    try:
        return store.get_partition(conn, registry.SOURCE_DAILY, DATE)
    finally:
        conn.close()


def test_pages_the_whole_date_and_never_filters_by_commodity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    records = [raw(market=f"M{index:04d}", modal=1000.0 + index) for index in range(2347)]
    api = install(monkeypatch, FakeAPI(records))
    db = tmp_path / "paging.db"

    result = collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db)

    assert result.status == "complete"
    assert result.expected_total == 2347
    assert result.unique_rows == 2347
    assert result.pages == 3
    assert [call["offset"] for call in api.page_calls] == [0, 1000, 2000]

    probe = api.calls[0]
    assert int(probe["limit"]) == 1
    assert "offset" not in probe
    assert probe["filters[Arrival_Date]"] == API_DATE
    for call in api.page_calls:
        assert "filters[Commodity]" not in call
        assert call["filters[Arrival_Date]"] == API_DATE

    conn = store.open_writer(db)
    try:
        assert store.count_rows(conn) == 2347
    finally:
        conn.close()
    assert partition(db)["status"] == "complete"


def test_whole_date_union_keeps_every_alias_spelling(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    specs = [
        ("Rice", "rice"), ("Broken Rice", "broken"),
        ("Paddy(Common)", "paddy"), ("Paddy(Basmati)", "paddy"),
        ("Chilli", "chilli"), ("Dry Chillies", "chilli"), ("Green Chilli", "chilli"),
        ("Coriander(Leaves)", "coriander"), ("Corriander Seed", "coriander"),
        ("Ground Nut Seed", "groundnut"), ("Ground Nut", "groundnut"),
    ]
    records = [
        raw(name, market=f"M{index:02d}")
        for index, (name, _key) in enumerate(specs)
    ]
    install(monkeypatch, FakeAPI(records))
    out = tmp_path / "aliases.jsonl"

    result = collect.collect_date(
        DATE,
        keys=["rice", "paddy", "chilli", "coriander", "groundnut"],
        api_key="test", db_path=tmp_path / "aliases.db", output_jsonl=out,
    )

    assert result.status == "complete"
    assert result.unique_rows == len(specs)
    keys = {json.loads(line)["commodity_key"] for line in out.read_text().splitlines()}
    assert keys == {"rice", "paddy", "chilli", "coriander", "groundnut"}
    forms = [json.loads(line)["product_form"] for line in out.read_text().splitlines()]
    assert forms == ["rice", "broken", "common", "basmati", "", "dry", "green",
                     "leaves", "seed", "seed", ""]


def test_default_date_is_yesterday_in_ist_not_utc():
    # 02:00 IST is still the previous UTC day; a host-local or UTC default
    # would ask for 20/11 instead of 21/11.
    at_2am_ist = datetime(2026, 11, 22, 2, 0, tzinfo=config.IST)
    assert collect.default_arrival_date(at_2am_ist) == "2026-11-21"
    assert collect.default_arrival_date(datetime(2026, 11, 22, 23, 59, tzinfo=config.IST)) == "2026-11-21"
    assert collect.default_arrival_date(datetime(2026, 1, 1, 12, 0, tzinfo=config.IST)) == "2025-12-31"


def test_explicit_date_and_replace_date_repair_the_day(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    db = tmp_path / "replace.db"
    install(monkeypatch, FakeAPI([
        raw(market="A APMC"), raw(market="B APMC"),
    ]))
    first = collect.collect_date(
        collect.parse_arrival_date("21/11/2026"),
        keys=["onion"], api_key="test", db_path=db,
    )
    assert first.status == "complete"
    conn = store.open_writer(db)
    try:
        assert store.count_rows(conn) == 2
    finally:
        conn.close()

    install(monkeypatch, FakeAPI([raw(market="A APMC"), raw(market="C APMC")]))
    skipped = collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db)
    assert skipped.skipped is True
    assert skipped.pages == 0

    replaced = collect.collect_date(
        DATE, keys=["onion"], api_key="test", db_path=db, replace_date=True,
    )
    assert replaced.skipped is False
    conn = store.open_writer(db)
    try:
        markets = {row["market"] for row in store.fetch_rows(conn)}
        assert store.count_rows(conn) == 2
    finally:
        conn.close()
    assert markets == {"A APMC", "C APMC"}


def test_short_page_is_partial_and_the_next_run_retries(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    db = tmp_path / "partial.db"
    install(monkeypatch, FakeAPI([raw(market="A"), raw(market="B")], total=5))
    short = collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db)
    assert short.status == "partial"
    assert short.expected_total == 5
    assert short.unique_rows == 2
    assert "rows_seen 2 != api total 5" in short.reasons[0]
    assert partition(db)["status"] == "partial"
    assert partition(db)["expected_total"] == 5

    install(monkeypatch, FakeAPI([raw(market="A"), raw(market="B")], total=2))
    retry = collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db)
    assert retry.skipped is False
    assert retry.status == "complete"
    assert partition(db)["status"] == "complete"


def test_missing_tracked_key_marks_partial(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    install(monkeypatch, FakeAPI([raw("Onion")], total=1))
    result = collect.collect_date(
        DATE, keys=["onion", "potato"], api_key="test", db_path=tmp_path / "missing.db",
    )
    assert result.status == "partial"
    assert result.missing_keys == ("potato",)
    assert any("missing tracked keys: potato" in reason for reason in result.reasons)


def test_duplicate_natural_keys_are_deduped_not_partial(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    duplicate = raw("Onion")
    install(monkeypatch, FakeAPI([duplicate, dict(duplicate)], total=2))
    result = collect.collect_date(
        DATE, keys=["onion"], api_key="test", db_path=tmp_path / "dupes.db",
    )
    assert result.status == "complete"
    assert result.duplicates == 1
    assert any("deduped 1 duplicate" in reason for reason in result.reasons)


def test_max_pages_cap_marks_partial(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    records = [raw(market=f"M{index:04d}") for index in range(3000)]
    install(monkeypatch, FakeAPI(records, total=3000))
    result = collect.collect_date(
        DATE, keys=["onion"], api_key="test", db_path=tmp_path / "cap.db", max_pages=1,
    )
    assert result.status == "partial"
    assert result.pages == 1
    assert any("--max-pages=1" in reason for reason in result.reasons)


def test_http_429_fails_loudly_and_ledgers_the_attempt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    db = tmp_path / "rate.db"
    install(monkeypatch, FakeAPI([], status_code=429))
    with pytest.raises(collect.FetchError, match="429"):
        collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db)
    row = partition(db)
    assert row["status"] == "failed"
    assert "429" in row["error"]


def test_empty_date_fails_without_allow_empty_and_is_recorded(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    db = tmp_path / "empty.db"
    install(monkeypatch, FakeAPI([], total=0))
    with pytest.raises(collect.EmptyDateError):
        collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db)
    assert partition(db)["status"] == "failed"

    allowed = collect.collect_date(
        DATE, keys=["onion"], api_key="test", db_path=db, allow_empty=True,
    )
    assert allowed.status == "empty"
    assert partition(db)["status"] == "empty"


def test_probe_without_total_is_not_treated_as_empty_success(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    db = tmp_path / "no-total.db"
    install(monkeypatch, FakeAPI([raw()], omit_total=True))
    with pytest.raises(collect.FetchError, match="no total"):
        collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db)
    assert partition(db)["status"] == "failed"


def test_output_jsonl_contract_and_no_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    install(monkeypatch, FakeAPI([raw("Onion", modal=1234.5)]))
    db = tmp_path / "should-not-exist.db"
    out = tmp_path / "nested" / "day.jsonl"

    result = collect.collect_date(
        DATE, keys=["onion"], api_key="test", db_path=db, no_db=True, output_jsonl=out,
    )

    assert result.status == "complete"
    assert not db.exists()
    lines = out.read_text().splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert tuple(payload) == collect.OUTPUT_COLUMNS
    assert payload == {
        "date": DATE,
        "state": "Maharashtra",
        "district": "Pune",
        "market": "Pune APMC",
        "commodity": "Onion",
        "commodity_key": "onion",
        "product_form": "",
        "variety": "No 1",
        "grade": "FAQ",
        "min_price": 1134.5,
        "max_price": 1384.5,
        "modal_price": 1234.5,
        "arrivals_qtl": None,
        "arrival_units": "",
        "price_unit": "Rs./Quintal",
        "source": registry.SOURCE_DAILY,
    }


def test_provenance_columns_and_arrival_unit_conversion(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    records = [
        raw("Onion", market="A"),
        raw("Onion", market="B", arrivals=2.0),
    ]
    install(monkeypatch, FakeAPI(records))
    db = tmp_path / "provenance.db"
    now = datetime(2026, 11, 22, 6, 0, tzinfo=config.IST)

    collect.collect_date(DATE, keys=["onion"], api_key="test", db_path=db, now=now)

    conn = store.open_writer(db)
    try:
        rows = {row["market"]: row for row in store.fetch_rows(conn)}
    finally:
        conn.close()
    plain, with_arrivals = rows["A"], rows["B"]
    assert plain["source_commodity"] == "Onion"
    assert plain["product_form"] == ""
    assert plain["price_source"] == registry.SOURCE_DAILY
    assert plain["arrivals_source"] == "none"
    assert plain["ingested_at"] == "2026-11-22T06:00:00+05:30"
    assert with_arrivals["arrivals_qtl"] == 20.0
    assert with_arrivals["arrival_units"] == "Metric Tonnes"
    assert with_arrivals["arrivals_source"] == "daily"
