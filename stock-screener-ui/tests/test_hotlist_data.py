"""Offline tests for ``india_board/scripts/hotlist_data.py`` (wave W4a).

No network: every external input (scan payload, signals, chain fetch, budget
probe) is injected. Disk round-trips use ``tmp_path``. The Fyers pacer is never
touched.
"""
from __future__ import annotations

import importlib
import json
import math
from datetime import datetime, timedelta

import sys

import pytest

from india_board.scripts import hotlist_data as h

@pytest.fixture(autouse=True)
def _no_live_inputs(tmp_path, monkeypatch):
    """Keep the suite hermetic: never read today's real signal archive.

    ``build_hotlist`` defaults to today's logged signals on disk; without this
    the P8 bulk-deal signals emitted by the live board leak into fixtures.
    Both module instances (flat ``signal_log`` and
    ``india_board.scripts.signal_log``) must be redirected.
    """
    import signal_log as _flat

    patched = set()
    for name, mod in list(sys.modules.items()):
        if mod is None or not (name == "signal_log" or name.endswith(".signal_log")):
            continue
        if id(mod) in patched:
            continue
        patched.add(id(mod))
        monkeypatch.setattr(mod, "DATA_DIR", tmp_path / "_no_signals", raising=False)
    monkeypatch.setattr(_flat, "DATA_DIR", tmp_path / "_no_signals", raising=False)

from india_board.scripts.hotlist_data import IST


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
_HIGH_BUDGET = lambda: {"remaining": 1_000_000}  # noqa: E731  (test probe)


def _scan() -> dict:
    """Synthetic scan payload covering all four candidate sources."""
    return {
        "generated_at": "2026-09-28T10:00:00+05:30",
        "sections": {
            "rows": [
                {
                    "ticker": "RELIANCE",
                    "spot": 2900.0,
                    "call_oi": 100.0,
                    "put_oi": 120.0,
                    "top_call": {"strike": 3000.0, "oi": 80.0, "oich": 5000.0},
                    "top_put": {"strike": 2800.0, "oi": 90.0, "oich": -3000.0},
                },
                {
                    "ticker": "INFY",
                    "spot": 1500.0,
                    "call_oi": 50.0,
                    "put_oi": 60.0,
                    "top_call": {"strike": 1600.0, "oi": 40.0, "oich": 100.0},
                    "top_put": {"strike": 1400.0, "oi": 30.0, "oich": 50.0},
                },
            ],
            "tape": {
                "status": "ok",
                "rows": [
                    {"ticker": "TCS", "premium": 9_000_000.0, "oi_change": 1200.0},
                    {"ticker": "RELIANCE", "premium": 5_000_000.0, "oi_change": -800.0},
                    {"ticker": "INFY", "premium": 1_000_000.0, "oi_change": 300.0},
                ],
            },
            "opportunities": {
                "status": "ok",
                "rows": [
                    {"ticker": "SBIN", "score": 42.0, "oi_change": 2000.0},
                    {"ticker": "TCS", "score": 15.0, "oi_change": 900.0},
                ],
            },
        },
    }


def _fake_chain(ticker: str) -> dict:
    return {
        "ticker": ticker,
        "spot": 100.0,
        "strikes": [
            {"strike": 95.0, "ce_oi": 10.0, "pe_oi": 20.0, "ce_oich": 1.0, "pe_oich": 2.0},
            {"strike": 100.0, "ce_oi": 30.0, "pe_oi": 15.0, "ce_oich": 5.0, "pe_oich": -3.0},
            {"strike": 105.0, "ce_oi": 8.0, "pe_oi": 40.0, "ce_oich": 0.0, "pe_oich": 7.0},
        ],
        "call_oi": 48.0,
        "put_oi": 75.0,
    }


# ---------------------------------------------------------------------------
# build_hotlist
# ---------------------------------------------------------------------------
def test_build_hotlist_picks_top_sources_and_indices():
    out = h.build_hotlist(_scan(), limit=10)
    tickers = out["tickers"]
    # Always-present indices, in declared order.
    assert tickers[0] == "NIFTY"
    assert tickers[1] == "BANKNIFTY"
    # (a) tape top, (b) opportunities top, (c) largest |ΔOI| from rows.
    assert "TCS" in tickers
    assert "SBIN" in tickers
    assert "RELIANCE" in tickers
    assert out["count"] == len(tickers)
    assert out["source_counts"]["tape"] == 3
    assert out["source_counts"]["opportunities"] == 2
    assert out["source_counts"]["indices"] == 2
    # reasons populated for a multi-source name
    assert "premium" in out["reasons"]["TCS"]
    assert "burst" in out["reasons"]["TCS"]
    assert "index" in out["reasons"]["NIFTY"]
    # NIFTY may also appear as a logged signal (the fixture logs one) — that is
    # additive documentation, not a contradiction.
    assert set(out["reasons"]["NIFTY"]) <= {"index", "signal"}


def test_build_hotlist_respects_limit():
    out = h.build_hotlist(_scan(), limit=1)
    assert out["count"] == 3  # 2 indices + 1 body
    body = [t for t in out["tickers"] if t not in ("NIFTY", "BANKNIFTY")]
    assert len(body) == 1


def test_build_hotlist_limit_zero_is_indices_only():
    out = h.build_hotlist(_scan(), limit=0)
    assert out["tickers"] == ["NIFTY", "BANKNIFTY"]
    assert out["count"] == 2


def test_build_hotlist_empty_scan_returns_indices():
    out = h.build_hotlist({}, limit=20)
    assert out["tickers"] == ["NIFTY", "BANKNIFTY"]
    assert out["reasons"]["BANKNIFTY"] == ["index"]


def test_build_hotlist_dedupes_multi_source_name():
    signals = [{"ticker": "TCS"}, {"ticker": "TCS"}, {"ticker": "INFY"}]
    out = h.build_hotlist(_scan(), signals, limit=10)
    assert out["tickers"].count("TCS") == 1
    why = out["reasons"]["TCS"]
    assert "premium" in why and "burst" in why and "signal" in why


def test_build_hotlist_signals_today_variants():
    # dict mapping form
    out = h.build_hotlist({"sections": {}}, {"HDFCBANK": 3, "ITC": ["a", "b"]}, limit=10)
    assert "HDFCBANK" in out["tickers"]
    assert "ITC" in out["tickers"]
    assert out["source_counts"]["signals"] == 2
    # callable form
    out2 = h.build_hotlist(
        {"sections": {}}, lambda: [{"ticker": "WIPRO"}], limit=10
    )
    assert "WIPRO" in out2["tickers"]


def test_build_hotlist_deterministic_tiebreak():
    scan = {
        "sections": {
            "tape": {"rows": [{"ticker": "ZZZ", "premium": 100.0}]},
            "opportunities": {"rows": [{"ticker": "AAA", "score": 10.0}]},
        }
    }
    first = h.build_hotlist(scan, limit=10)["tickers"]
    second = h.build_hotlist(scan, limit=10)["tickers"]
    assert first == second
    # equal score (each rank 1 in its source) -> ticker name breaks the tie
    body = [t for t in first if t not in ("NIFTY", "BANKNIFTY")]
    assert body == ["AAA", "ZZZ"]


def test_build_hotlist_is_json_safe():
    scan = {
        "sections": {
            "tape": {
                "rows": [
                    {"ticker": "AAA", "premium": float("nan")},
                    {"ticker": "BBB", "premium": float("inf")},
                ]
            }
        }
    }
    out = h.build_hotlist(scan, limit=10)
    text = json.dumps(out)
    assert "NaN" not in text and "Infinity" not in text
    assert math.isfinite(0.0)


# ---------------------------------------------------------------------------
# refresh_once
# ---------------------------------------------------------------------------
_EXPECTED_KEYS = {
    "ts",
    "ticker",
    "spot",
    "pcr",
    "top_call",
    "top_put",
    "oich_total",
    "atm_strike",
}


def test_refresh_once_writes_jsonl_and_roundtrips(tmp_path):
    res = h.refresh_once(
        ["NIFTY", "RELIANCE"],
        chain_fn=_fake_chain,
        root=tmp_path,
        budget_probe=_HIGH_BUDGET,
    )
    assert res["ok"] == 2 and res["failed"] == 0 and res["skipped"] == 0
    assert res["calls"] == 2

    hist = h.history("RELIANCE", root=tmp_path)
    assert len(hist) == 1
    rec = hist[0]
    assert set(rec.keys()) == _EXPECTED_KEYS
    assert rec["ticker"] == "RELIANCE"
    assert rec["spot"] == 100.0
    assert rec["pcr"] == pytest.approx(75.0 / 48.0)
    assert rec["top_call"] == {"strike": 100.0, "oi": 30.0}
    assert rec["top_put"] == {"strike": 105.0, "oi": 40.0}
    assert rec["oich_total"] == pytest.approx(1 + 2 + 5 - 3 + 0 + 7)
    assert rec["atm_strike"] == 100.0

    last = h.latest("RELIANCE", root=tmp_path)
    assert last == rec
    assert h.latest("NODO", root=tmp_path) is None


def test_refresh_once_counts_failures(tmp_path):
    def flaky(ticker):
        if ticker == "NIFTY":
            raise RuntimeError("boom")
        return _fake_chain(ticker)

    res = h.refresh_once(
        ["NIFTY", "RELIANCE"],
        chain_fn=flaky,
        root=tmp_path,
        budget_probe=_HIGH_BUDGET,
    )
    assert res["ok"] == 1
    assert res["failed"] == 1
    assert res["failed_tickers"] == ["NIFTY"]
    assert res["calls"] == 2
    assert h.history("NIFTY", root=tmp_path) == []


def test_refresh_once_honours_call_cap(tmp_path, monkeypatch):
    monkeypatch.setattr(h, "HOTLIST_MAX_CALLS", 1)
    res = h.refresh_once(
        ["AAA", "BBB", "CCC"],
        chain_fn=_fake_chain,
        root=tmp_path,
        budget_probe=_HIGH_BUDGET,
    )
    assert res["calls"] == 1
    assert res["ok"] == 1
    assert res["skipped"] == 2
    assert res["skipped_tickers"] == ["BBB", "CCC"]
    assert res["max_calls"] == 1
    statuses = {d["ticker"]: d["status"] for d in res["details"]}
    assert statuses == {"AAA": "ok", "BBB": "skipped", "CCC": "skipped"}


def test_refresh_once_skips_when_budget_low(tmp_path):
    called: list[str] = []

    def spy(ticker):
        called.append(ticker)
        return _fake_chain(ticker)

    res = h.refresh_once(
        ["NIFTY", "RELIANCE"],
        chain_fn=spy,
        root=tmp_path,
        budget_probe=lambda: {"remaining": 5},
    )
    assert res["ok"] == 0
    assert res["skipped"] == 2
    assert called == []
    assert h.history(root=tmp_path) == []
    assert all(d["skipped"] is True for d in res["details"])


def test_budget_probe_shapes():
    assert h._budget_low(lambda: {"remaining": 1}, 1000) is True
    assert h._budget_low(lambda: {"remaining": 5000}, 1000) is False
    assert h._budget_low(lambda: {"used": 999, "cap": 1000}, 10) is True
    assert h._budget_low(lambda: {"low": True}, 10) is True
    assert h._budget_low(lambda: 3, 10) is True
    assert h._budget_low(lambda: 300, 10) is False


# ---------------------------------------------------------------------------
# interval floor + env override
# ---------------------------------------------------------------------------
def test_interval_floor_and_env_override(monkeypatch):
    monkeypatch.setenv("HOTLIST_INTERVAL_SEC", "10")
    assert h._env_interval() == 20.0  # < 20 -> clamped to the floor

    monkeypatch.setenv("HOTLIST_INTERVAL_SEC", "75")
    assert h._env_interval() == 75.0

    monkeypatch.setenv("HOTLIST_INTERVAL_SEC", "30")
    importlib.reload(h)
    assert h.HOTLIST_INTERVAL_SEC == 30

    # restore module state for subsequent tests
    monkeypatch.delenv("HOTLIST_INTERVAL_SEC", raising=False)
    importlib.reload(h)
    assert h.HOTLIST_INTERVAL_SEC == 45


# ---------------------------------------------------------------------------
# persistence: malformed lines + prune
# ---------------------------------------------------------------------------
def test_history_skips_malformed_lines(tmp_path):
    day = datetime.now(IST).date().isoformat()
    path = tmp_path / f"{day}.jsonl"
    path.write_text(
        '{"ticker":"AAA","ts":"2026-09-28T10:00:00+05:30"}\n'
        "this is not json\n"
        "\n"
        '{"ticker":"BBB","ts":"2026-09-28T10:01:00+05:30"}\n',
        encoding="utf-8",
    )
    recs = h.history(root=tmp_path)
    assert {r["ticker"] for r in recs} == {"AAA", "BBB"}
    recs_a = h.history("AAA", root=tmp_path)
    assert [r["ticker"] for r in recs_a] == ["AAA"]


def test_latest_without_ticker_returns_map(tmp_path):
    day = datetime.now(IST).date().isoformat()
    (tmp_path / f"{day}.jsonl").write_text(
        '{"ticker":"AAA","ts":"2026-09-28T10:00:00+05:30"}\n'
        '{"ticker":"AAA","ts":"2026-09-28T10:05:00+05:30"}\n'
        '{"ticker":"BBB","ts":"2026-09-28T10:01:00+05:30"}\n',
        encoding="utf-8",
    )
    latest = h.latest(root=tmp_path)
    assert set(latest) == {"AAA", "BBB"}
    assert latest["AAA"]["ts"] == "2026-09-28T10:05:00+05:30"


def test_prune_keeps_recent_and_removes_old(tmp_path):
    today = datetime.now(IST).date()
    old = (today - timedelta(days=40)).isoformat()
    recent = (today - timedelta(days=1)).isoformat()
    (tmp_path / f"{old}.jsonl").write_text("{}\n", encoding="utf-8")
    (tmp_path / f"{recent}.jsonl").write_text("{}\n", encoding="utf-8")
    (tmp_path / "not-a-date.jsonl").write_text("{}\n", encoding="utf-8")

    removed = h.prune(root=tmp_path, keep_days=30)
    assert removed == 1
    assert (tmp_path / f"{recent}.jsonl").exists()
    assert (tmp_path / "not-a-date.jsonl").exists()
    assert not (tmp_path / f"{old}.jsonl").exists()


# ---------------------------------------------------------------------------
# market-hours gate
# ---------------------------------------------------------------------------
def test_market_hours_gate_saturday():
    saturday = datetime(2026, 9, 26, 10, 0, tzinfo=IST)
    assert h._is_market_open(saturday) is False
    # a Saturday cycle is a no-op (never touches the network)
    assert h._run_due_cycle(saturday) is False


def test_market_hours_open_on_weekday():
    monday = datetime(2026, 9, 28, 10, 0, tzinfo=IST)
    assert h._is_market_open(monday) is True
    # outside the session -> closed
    assert h._is_market_open(datetime(2026, 9, 28, 8, 0, tzinfo=IST)) is False
    assert h._is_market_open(datetime(2026, 9, 28, 16, 0, tzinfo=IST)) is False


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
