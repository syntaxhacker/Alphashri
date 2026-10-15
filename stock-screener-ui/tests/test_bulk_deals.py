"""Offline tests for ``india_board/scripts/bulk_deals.py`` (playbook P8).

No network: the snapshot / CSV fetchers are monkeypatched or exercised through
their pure parsers, and Fyers history is injected. Disk round-trips use
``tmp_path``. The live ``data/bulk_deals`` and ``data/signals`` trees are never
touched (a pytest guard redirects both to temp).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import bulk_deals as b

IST = ZoneInfo("Asia/Kolkata")
DAY = "2026-09-30"  # a Wednesday
WED = datetime(2026, 9, 30, 18, 30, tzinfo=IST)
SAT = datetime(2026, 10, 3, 18, 30, tzinfo=IST)


# ---------------------------------------------------------------------------
# builders
# ---------------------------------------------------------------------------
def _row(
    symbol="EBGNG",
    client="SBI MUTUAL FUND",
    side="BUY",
    qty="1000000",
    watp="600",
    name="GNG Electronics Limited",
    deal_type="bulk",
    date="30-SEP-2026",
):
    return {
        "symbol": symbol,
        "clientName": client,
        "buySell": side,
        "qty": qty,
        "watp": watp,
        "name": name,
        "date": date,
        "deal_type": deal_type,
        "remarks": "",
    }


def _candles(n=25, base=100.0):
    """Rising daily series; last session has an outsized volume."""
    out = []
    for i in range(n):
        c = base + i
        v = 1000.0 + (i % 5) * 50.0
        out.append([1_700_000_000 + i * 86400, c - 0.5, c + 1.0, c - 1.0, c, v])
    out[-1][5] = 5000.0
    return out


def _read_jsonl(path: Path):
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def _deal(value_cr, side="BUY", ctype="mutual_fund", itype="equity"):
    return {
        "side": side,
        "client_type": ctype,
        "instrument_type": itype,
        "value_cr": value_cr,
    }


# ---------------------------------------------------------------------------
# classifier
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "name,expected_type,expected_conf",
    [
        ("UNIFI CAPITAL PRIVATE LIMITED", "pms", "high"),
        ("NEO TREASURY PLUS FUND", "mutual_fund", "medium"),
        ("INVESCO SBI FUND", "mutual_fund", "high"),
        ("SBI MUTUAL FUND", "mutual_fund", "high"),
        ("LIFE INSURANCE CORPORATION OF INDIA", "insurance", "high"),
        ("X MASTER FUND LTD", "fpi", "high"),
        ("VIDHI S KHANDELWAL", "individual", "low"),
    ],
)
def test_classify_client_cases(name, expected_type, expected_conf):
    res = b.classify_client(name)
    assert res["client_type"] == expected_type
    assert res["client_confidence"] == expected_conf
    assert res["matched_pattern"] is not None or expected_type == "individual"


def test_welfare_foundation_is_not_mutual_fund():
    res = b.classify_client("L AND T EMPLOYEES WELFARE FOUNDATION PRIVATE")
    assert res["client_type"] != "mutual_fund"
    assert res["client_type"] in {"trust", "corporate"}


def test_classify_blank_is_unknown():
    assert b.classify_client("")["client_type"] == "unknown"
    assert b.classify_client("   ")["client_type"] == "unknown"


def test_master_fund_ltd_is_fpi_not_mf():
    # FPI patterns must win over the MF "MASTER FUND" marker.
    assert b.classify_client("ACME MASTER FUND LTD")["client_type"] == "fpi"


# ---------------------------------------------------------------------------
# normalize
# ---------------------------------------------------------------------------
def test_normalize_dedupe_and_math():
    raw = [
        _row(),
        _row(),  # exact duplicate — the snapshot repeats rows
        _row(symbol="TCS", client="HDFC MUTUAL FUND", qty="500000", watp="3000"),
    ]
    out = b.normalize(raw, date=DAY)
    assert len(out) == 2
    e = next(r for r in out if r["symbol"] == "EBGNG")
    assert e["date"] == DAY
    assert e["side"] == "BUY"
    assert e["deal_type"] == "bulk"
    assert e["qty"] == 1_000_000
    assert e["watp"] == 600.0
    assert e["value_cr"] == 60.0
    assert e["client_type"] == "mutual_fund"


def test_normalize_coercion_and_json_safe():
    raw = [
        _row(qty="2,012,345", watp="674.00"),
        _row(symbol="X", client="Y", qty=None, watp=""),
        _row(symbol="Z", client="W", qty="abc", watp="nan"),
    ]
    out = b.normalize(raw, date=DAY)
    first = out[0]
    assert first["qty"] == 2_012_345
    assert first["watp"] == 674.0
    assert first["value_cr"] == round(2_012_345 * 674.0 / 1e7, 2)
    for rec in out:
        json.dumps(rec, allow_nan=False)  # raises if NaN/Inf slipped through
    assert out[1]["value_cr"] == 0.0


def test_normalize_instrument_type():
    raw = [
        _row(symbol="EMBASSY", name="Embassy Office Parks REIT"),
        _row(symbol="NIFTYBEES", name="Nippon India ETF Nifty 50 BeES"),
        _row(symbol="TCS", name="Tata Consultancy Services Limited"),
    ]
    out = b.normalize(raw, date=DAY)
    types = {r["symbol"]: r["instrument_type"] for r in out}
    assert types["EMBASSY"] == "invit"
    assert types["NIFTYBEES"] == "etf"
    assert types["TCS"] == "equity"


def test_normalize_respects_row_deal_type():
    out = b.normalize([_row(deal_type="block")], date=DAY)
    assert out[0]["deal_type"] == "block"


# ---------------------------------------------------------------------------
# qualifying
# ---------------------------------------------------------------------------
def test_qualifying_threshold_is_inclusive():
    deals = [
        _deal(50.0),                       # exactly at the line -> included
        _deal(49.99),                      # below -> excluded
        _deal(60.0, side="SELL"),          # sell -> excluded
        _deal(60.0, itype="invit"),        # invit -> excluded
        _deal(60.0, ctype="individual"),   # individual -> excluded
        _deal(60.0, ctype="unknown"),      # unknown -> excluded
    ]
    q = b.qualifying(deals, min_cr=50.0)
    assert len(q) == 1
    assert q[0]["value_cr"] == 50.0
    assert q[0]["qualifying"] is True
    assert q[0]["threshold_cr"] == 50.0


def test_qualifying_env_override(monkeypatch):
    monkeypatch.setenv("BULK_DEAL_MIN_CR", "10")
    q = b.qualifying([_deal(12.0)])
    assert len(q) == 1
    assert q[0]["threshold_cr"] == 10.0


def test_min_cr_default(monkeypatch):
    monkeypatch.delenv("BULK_DEAL_MIN_CR", raising=False)
    assert b._min_cr() == 50.0


# ---------------------------------------------------------------------------
# persistence
# ---------------------------------------------------------------------------
def test_persist_read_history_roundtrip(tmp_path):
    recs = [{"date": DAY, "symbol": "A", "value_cr": 1.0},
            {"date": DAY, "symbol": "B", "value_cr": 2.0}]
    assert b.persist(recs, root=tmp_path) == 2
    day = b.read_day(DAY, root=tmp_path)
    assert [r["symbol"] for r in day] == ["A", "B"]
    assert len(b.history(root=tmp_path)) == 2
    assert len(b.history(days=1, root=tmp_path)) == 2


def test_persist_is_append_only(tmp_path):
    b.persist([{"date": DAY, "symbol": "A"}], root=tmp_path)
    b.persist([{"date": DAY, "symbol": "B"}], root=tmp_path)
    assert len(b.read_day(DAY, root=tmp_path)) == 2


def test_read_day_skips_malformed(tmp_path):
    path = tmp_path / f"{DAY}.jsonl"
    path.write_text('{"symbol":"A"}\nnot json\n\n{"symbol":"B"}\n', encoding="utf-8")
    rows = b.read_day(DAY, root=tmp_path)
    assert [r["symbol"] for r in rows] == ["A", "B"]


def test_prune_removes_old_files(tmp_path):
    b.persist([{"date": DAY, "symbol": "A"}], root=tmp_path)
    old = tmp_path / "2020-01-01.jsonl"
    old.write_text('{"symbol":"OLD"}\n', encoding="utf-8")
    removed = b.prune_bulk_deals(root=tmp_path, keep_days=400, today=DAY)
    assert removed == 1
    assert not old.exists()
    assert len(b.read_day(DAY, root=tmp_path)) == 1


def test_prune_uses_explicit_today_string(tmp_path):
    # If the explicit string `today` were ignored (wall clock used instead),
    # this 2026-06-01 file would survive; with the string honored it is pruned.
    stale = tmp_path / "2026-06-01.jsonl"
    stale.write_text('{"symbol":"STALE"}\n', encoding="utf-8")
    removed = b.prune_bulk_deals(root=tmp_path, keep_days=200, today="2027-01-01")
    assert removed == 1
    assert not stale.exists()


# ---------------------------------------------------------------------------
# run_once
# ---------------------------------------------------------------------------
def _run_rows():
    return [
        _row(symbol="EBGNG", client="SBI MUTUAL FUND", qty="1000000", watp="600"),
        _row(symbol="EBGNG", client="SBI MUTUAL FUND", side="SELL",
             qty="1000000", watp="600"),
        _row(symbol="TCS", client="VIDHI S KHANDELWAL", qty="100000", watp="3000",
             name="Tata Consultancy Services Limited"),
        _row(symbol="EMBASSY", client="HDFC MUTUAL FUND", qty="100000", watp="400",
             name="Embassy Office Parks REIT"),
    ]


def test_run_once_injected_sources(tmp_path):
    sig_root = tmp_path / "signals"
    calls = []

    def hist(symbol, deal_date):
        calls.append(symbol)
        return _candles() if symbol == "EBGNG" else None

    out = b.run_once(
        date=DAY,
        root=tmp_path,
        signal_root=sig_root,
        fetcher=lambda: (_run_rows(), "nse_snapshot"),
        history_fn=hist,
    )
    assert out == {
        "date": DAY,
        "total": 4,
        "qualifying": 1,
        "qualifying_value_cr": 60.0,
        "by_client_type": {"mutual_fund": 1},
        "source": "nse_snapshot",
        "enriched": 1,
        "signals": 1,
    }
    assert calls == ["EBGNG"]  # one history fetch per qualifying symbol

    # persisted JSONL: one line per deduped deal, schema-complete
    day = b.read_day(DAY, root=tmp_path)
    assert len(day) == 4
    q = [r for r in day if r["qualifying"]]
    assert len(q) == 1
    assert q[0]["vol_z20"] is not None
    assert q[0]["close"] == 124.0
    assert q[0]["signal_id"]
    assert q[0]["source"] == "nse_snapshot"
    assert q[0]["captured_at"]
    for rec in day:
        for key in ("vol_z20", "close", "chg_pct", "signal_id", "captured_at", "source"):
            assert key in rec

    # exactly one P8 signal for the qualifying deal
    files = list(sig_root.glob("*.jsonl"))
    assert len(files) == 1
    sigs = _read_jsonl(files[0])
    assert len(sigs) == 1
    sig = sigs[0]
    assert sig["playbook"] == "P8"
    assert sig["ticker"] == "EBGNG"
    assert sig["side"] == "LONG"
    assert sig["source"] == "bulk_deal"
    for key in ("value_cr", "client_type", "client", "qty", "watp",
                "deal_type", "vol_z20", "min_cr", "stop_basis"):
        assert key in sig["features"]
    assert sig["features"]["stop_basis"] == "atr20"
    assert sig["entry_ref"] == 124.0


def test_run_once_no_live_write(tmp_path):
    live = b.ROOT / "data" / "bulk_deals"
    before = {p.name for p in live.glob("*.jsonl")} if live.is_dir() else set()
    b.run_once(
        date=DAY,
        root=None,  # must redirect to the pytest temp root
        signal_root=tmp_path / "s",
        fetcher=lambda: ([_row()], "nse_snapshot"),
        history_fn=lambda s, d: _candles(),
    )
    after = {p.name for p in live.glob("*.jsonl")} if live.is_dir() else set()
    assert before == after


def test_pytest_data_root_redirects_under_pytest():
    root = b._pytest_data_root()
    assert root is not None
    assert Path(b._data_root(None)) == root
    assert Path(b._data_root(None)) != b.ROOT / "data" / "bulk_deals"
    assert "test_bulk_deals" in str(root)


# ---------------------------------------------------------------------------
# fetch fallbacks (no network)
# ---------------------------------------------------------------------------
def test_fetch_deals_prefers_snapshot(monkeypatch):
    monkeypatch.setattr(b, "fetch_snapshot", lambda: {"BULK_DEALS_DATA": [_row()]})
    monkeypatch.setattr(b, "fetch_bulk_csv", lambda: [_row()])
    rows, src = b.fetch_deals()
    assert src == "nse_snapshot"
    assert len(rows) == 1


def test_fetch_deals_falls_back_to_csv(monkeypatch):
    monkeypatch.setattr(b, "fetch_snapshot", lambda: {})
    monkeypatch.setattr(b, "fetch_bulk_csv", lambda: [_row()])
    rows, src = b.fetch_deals()
    assert src == "nse_bulk_csv"
    assert len(rows) == 1


def test_fetch_deals_unavailable(monkeypatch):
    monkeypatch.setattr(b, "fetch_snapshot", lambda: {})
    monkeypatch.setattr(b, "fetch_bulk_csv", lambda: [])
    assert b.fetch_deals() == ([], "unavailable")


def test_fetch_never_raises_without_requests(monkeypatch):
    monkeypatch.setitem(sys.modules, "requests", None)
    assert b.fetch_snapshot() == {}
    assert b.fetch_bulk_csv() == []


def test_parse_bulk_csv_roundtrip():
    text = (
        "Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,"
        "Trade Price / Wght. Avg. Pr,Remarks\n"
        "30-SEP-2026,EBGNG,GNG Electronics Limited,SBI MUTUAL FUND,BUY,"
        "1000000,600.00,-\n"
    )
    rows = b._parse_bulk_csv(text)
    assert len(rows) == 1
    assert rows[0]["symbol"] == "EBGNG"
    assert rows[0]["deal_type"] == "bulk"
    out = b.normalize(rows, date=DAY)
    assert out[0]["side"] == "BUY"
    assert out[0]["client_type"] == "mutual_fund"
    assert out[0]["value_cr"] == 60.0


# ---------------------------------------------------------------------------
# enrichment
# ---------------------------------------------------------------------------
def test_enrich_cap_and_missing():
    recs = [{"qualifying": True, "symbol": f"S{i}", "date": DAY} for i in range(20)]
    calls = []

    def hist(symbol, deal_date):
        calls.append(symbol)
        return _candles()

    out, enriched, metrics = b.enrich(recs, history_fn=hist, cap=15)
    assert len(calls) == 15
    assert enriched == 15  # only the 15 fetched symbols get metrics
    assert out[0]["vol_z20"] is not None
    assert out[-1]["vol_z20"] is None


def test_series_metrics_json_safe():
    m = b._series_metrics(_candles())
    assert m["close"] == 124.0
    assert m["vol_z20"] is not None
    assert m["atr20"] is not None
    assert b._series_metrics([]) == {
        "vol_z20": None, "close": None, "chg_pct": None, "atr20": None
    }


# ---------------------------------------------------------------------------
# scheduler
# ---------------------------------------------------------------------------
def test_is_due_before_hour():
    assert b._is_due(datetime(2026, 9, 30, 17, 30, tzinfo=IST), None) is False


def test_is_due_after_hour_once():
    assert b._is_due(WED, None) is True
    assert b._is_due(WED, DAY) is False  # already ran today


def test_is_due_weekend():
    assert SAT.weekday() == 5
    assert b._is_due(SAT, None) is False


def test_is_due_hour_env(monkeypatch):
    monkeypatch.setenv("BULK_DEAL_HOUR", "20")
    assert b._is_due(datetime(2026, 9, 30, 19, 0, tzinfo=IST), None) is False
    assert b._is_due(datetime(2026, 9, 30, 20, 15, tzinfo=IST), None) is True


def test_ensure_started_idempotent(monkeypatch):
    started = []

    class _FakeThread:
        def __init__(self, *a, **k):
            self._name = k.get("name")

        def start(self):
            started.append(self._name)

    monkeypatch.setattr(b.threading, "Thread", _FakeThread)
    b._STARTED = False
    try:
        b.ensure_started()
        b.ensure_started()
    finally:
        b._STARTED = False
    assert started == ["bulk-deals"]


# ---------------------------------------------------------------------------
# Cross-feed dedupe: NSE lists the same trade in bulk AND block lists
# ---------------------------------------------------------------------------


def test_same_trade_in_both_feeds_is_counted_once():
    """13 of 14 block deals also appear in the bulk list — value must not double."""
    row = {
        "symbol": "EBGNG", "clientName": "UNIFI CAPITAL PRIVATE LIMITED",
        "buySell": "BUY", "qty": "2012345", "watp": "674.0",
        "date": "30-Sep-2026", "name": "GNG Electronics Limited",
    }
    bulk = dict(row, deal_type="bulk")
    block = dict(row, deal_type="block")
    out = b.normalize([bulk, block], date="2026-09-30")
    assert len(out) == 1, "the same trade must yield a single record"
    rec = out[0]
    assert rec["value_cr"] == pytest.approx(round(2012345 * 674.0 / 1e7, 2), abs=0.01)
    assert rec["deal_type"] == "bulk"
    assert rec.get("deal_type_alt") == "block"


def test_normalize_still_dedupes_exact_duplicates():
    row = {"symbol": "X", "clientName": "SBI MUTUAL FUND", "buySell": "BUY",
           "qty": "100", "watp": "10", "date": "30-Sep-2026", "name": "X Ltd",
           "deal_type": "bulk"}
    assert len(b.normalize([row, dict(row)], date="2026-09-30")) == 1


def test_persist_replace_is_idempotent(tmp_path):
    """Re-capturing the same day must not duplicate every deal."""
    row = {"symbol": "X", "clientName": "SBI MUTUAL FUND", "buySell": "BUY",
           "qty": "100", "watp": "10", "date": "30-Sep-2026", "name": "X Ltd",
           "deal_type": "bulk"}
    recs = b.normalize([row], date="2026-09-30")
    b.persist(recs, date="2026-09-30", root=tmp_path)
    b.persist(recs, date="2026-09-30", root=tmp_path)               # append path
    assert len(b.read_day("2026-09-30", root=tmp_path)) == 2         # documents append
    b.persist(recs, date="2026-09-30", root=tmp_path, replace=True)  # snapshot path
    assert len(b.read_day("2026-09-30", root=tmp_path)) == 1
