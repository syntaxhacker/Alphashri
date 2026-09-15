"""Tests for the order-flow JSONL journal and signal backtest."""

import json
import queue as thr_queue
from datetime import datetime

import pytest

import config
from api import orderflow_journal
from scripts.backtest_orderflow_signals import evaluate


@pytest.fixture
def journal_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(orderflow_journal, "journal_dir", lambda: tmp_path)
    monkeypatch.delenv("ORDERFLOW_JOURNAL", raising=False)
    return tmp_path


def make_tick(ts_sec, ltp, volume, bid, ask, tbq, tsq, vwap, q=1000):
    return {
        "ltp": ltp,
        "volume": volume,
        "ltt": int(ts_sec * 1000),
        "vwap": vwap,
        "tbq": tbq,
        "tsq": tsq,
        "depth": {
            "buy": [{"price": bid, "quantity": q, "orders": 0}],
            "sell": [{"price": ask, "quantity": q, "orders": 0}],
        },
    }


class TestJournalRoundTrip:
    def test_append_and_read_ticks_and_signals(self, journal_tmp):
        orderflow_journal.append("RELIANCE", "tick", {"ltp": 100.0})
        orderflow_journal.append("RELIANCE", "signal", {"side": "BUY", "score": 0.4})

        all_records = orderflow_journal.read("RELIANCE")
        assert [r["kind"] for r in all_records] == ["tick", "signal"]
        assert all(isinstance(r["ts"], int) for r in all_records)
        assert all_records[0]["data"] == {"ltp": 100.0}

        ticks = orderflow_journal.read("RELIANCE", kind="tick")
        assert len(ticks) == 1
        assert ticks[0]["data"]["ltp"] == 100.0

    def test_malformed_lines_are_skipped(self, journal_tmp):
        orderflow_journal.append("INFY", "tick", {"ltp": 50.0})
        path = orderflow_journal.journal_path("INFY")
        with path.open("a", encoding="utf-8") as fh:
            fh.write("not json\n")
            fh.write("[1, 2, 3]\n")
            fh.write("\n")

        orderflow_journal.append("INFY", "tick", {"ltp": 51.0})
        records = orderflow_journal.read("INFY", kind="tick")
        assert [r["data"]["ltp"] for r in records] == [50.0, 51.0]

    def test_read_missing_file_returns_empty(self, journal_tmp):
        assert orderflow_journal.read("NOPE") == []


class TestJournalPath:
    def test_uses_ist_date_and_format(self, journal_tmp):
        expected_day = datetime.now(config.IST).strftime("%Y-%m-%d")
        path = orderflow_journal.journal_path("reliance")
        assert path.name == f"RELIANCE_{expected_day}.jsonl"
        assert path.parent == journal_tmp

    def test_explicit_day_wins(self, journal_tmp):
        path = orderflow_journal.journal_path("TCS", day="2026-01-02")
        assert path.name == "TCS_2026-01-02.jsonl"


class TestJournalEnabled:
    def test_disabled_by_env(self, monkeypatch, journal_tmp):
        monkeypatch.setenv("ORDERFLOW_JOURNAL", "0")
        assert orderflow_journal.is_enabled() is False
        orderflow_journal.append("RELIANCE", "tick", {"ltp": 1.0})
        assert orderflow_journal.read("RELIANCE") == []

    def test_enabled_by_default(self, monkeypatch):
        monkeypatch.delenv("ORDERFLOW_JOURNAL", raising=False)
        assert orderflow_journal.is_enabled() is True

    def test_false_strings_disable(self, monkeypatch):
        monkeypatch.setenv("ORDERFLOW_JOURNAL", "false")
        assert orderflow_journal.is_enabled() is False


class TestWarmStart:
    def test_seeds_engine_cvd_from_journal(self, journal_tmp):
        first = make_tick(1000, 100.0, 1000, 99.95, 100.0, 500_000, 100_000, 99.0)
        second = make_tick(1001, 100.0, 1500, 99.95, 100.0, 500_000, 100_000, 99.0)
        orderflow_journal.append("RELIANCE", "tick", first)
        orderflow_journal.append("RELIANCE", "tick", second)

        q: thr_queue.Queue = thr_queue.Queue()
        stream = orderflow_journal_stream("RELIANCE", q)
        stream.warm_start()

        assert stream._engine.cvd == 500
        assert stream._engine.snapshot()["ticks"] == 2

    def test_no_journal_leaves_fresh_engine(self, journal_tmp):
        q: thr_queue.Queue = thr_queue.Queue()
        stream = orderflow_journal_stream("RELIANCE", q)
        stream.warm_start()
        assert stream._engine.snapshot()["ticks"] == 0


def orderflow_journal_stream(symbol, q):
    from api.orderflow_stream import _UpstoxOrderFlowStream

    return _UpstoxOrderFlowStream("tok", "NSE_EQ|X", q, symbol=symbol)


class TestEvaluate:
    def _buy_ticks(self, n=120):
        ticks = []
        for i in range(n):
            ts = 1000 + i
            ltp = 100.0 + i * 0.012
            ticks.append(make_tick(ts, ltp, 1000 * i, ltp - 0.05, ltp, 500_000, 100_000, 99.0))
        return ticks

    def test_forward_returns_and_win_rate(self):
        result = evaluate(self._buy_ticks(), horizon_sec=60)

        assert result["signal_count"] > 0
        assert result["evaluated"] > 0
        buy = result["sides"]["BUY"]
        strong = result["sides"]["STRONG_BUY"]
        assert buy["count"] + strong["count"] == result["evaluated"]
        assert result["sides"]["SELL"]["count"] == 0
        assert result["sides"]["STRONG_SELL"]["count"] == 0
        assert result["overall"]["win_rate"] == 100.0
        assert result["overall"]["avg_return_pct"] > 0

    def test_sell_forward_return_is_direction_adjusted(self):
        ticks = []
        for i in range(70):
            ts = 1000 + i
            ltp = 100.0 - i * 0.012
            ticks.append(make_tick(ts, ltp, 1000 * i, ltp, ltp + 0.05, 100_000, 500_000, 101.0))
        result = evaluate(ticks, horizon_sec=30)
        assert result["evaluated"] > 0
        assert result["sides"]["SELL"]["count"] + result["sides"]["STRONG_SELL"]["count"] == result["evaluated"]
        assert result["overall"]["win_rate"] == 100.0
        assert result["overall"]["avg_return_pct"] > 0

    def test_empty_ticks(self):
        result = evaluate([], horizon_sec=60)
        assert result["signal_count"] == 0
        assert result["evaluated"] == 0
        assert result["overall"]["count"] == 0
        assert result["overall"]["win_rate"] == 0.0
