"""Tests for the order-flow JSONL journal and signal backtest."""

import json
import queue as thr_queue
from pathlib import Path
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


class TestBufferedWrites:
    """Handles are pooled and buffered, so durability semantics are pinned.

    Reusing one append handle per file removed an open/write/close cycle per
    tick; these tests make sure that did not quietly make records unreadable.
    """

    def test_handle_is_reused_across_appends(self, journal_tmp):
        orderflow_journal.append("SBIN", "tick", {"ltp": 1.0})
        first = orderflow_journal._handles[str(orderflow_journal.journal_path("SBIN"))]
        orderflow_journal.append("SBIN", "tick", {"ltp": 2.0})
        second = orderflow_journal._handles[str(orderflow_journal.journal_path("SBIN"))]
        assert first is second

    def test_records_are_readable_without_an_explicit_flush(self, journal_tmp):
        for price in (1.0, 2.0, 3.0):
            orderflow_journal.append("SBIN", "tick", {"ltp": price})
        assert [r["data"]["ltp"] for r in orderflow_journal.read("SBIN")] == [1.0, 2.0, 3.0]

    def test_signal_is_flushed_immediately(self, journal_tmp):
        orderflow_journal.flush()
        orderflow_journal.append("SBIN", "signal", {"side": "SELL", "score": -0.5})
        path = orderflow_journal.journal_path("SBIN")
        # Bypass read()'s flush to prove the signal is already on disk.
        with path.open("r", encoding="utf-8") as fh:
            assert "SELL" in fh.read()

    def test_close_all_flushes_and_releases_handles(self, journal_tmp):
        orderflow_journal.append("SBIN", "tick", {"ltp": 9.0})
        orderflow_journal.close_all()
        assert orderflow_journal._handles == {}
        assert [r["data"]["ltp"] for r in orderflow_journal.read("SBIN")] == [9.0]

    def test_handle_pool_is_bounded(self, journal_tmp):
        for i in range(orderflow_journal._MAX_OPEN_HANDLES + 8):
            orderflow_journal.append(f"SYM{i}", "tick", {"ltp": float(i)})
        assert len(orderflow_journal._handles) <= orderflow_journal._MAX_OPEN_HANDLES
        orderflow_journal.close_all()

    def test_day_rollover_closes_previous_day_handles(self, journal_tmp):
        orderflow_journal.append("SBIN", "tick", {"ltp": 1.0})
        yesterday = orderflow_journal.journal_path("SBIN", day="2020-01-01")
        yesterday.write_text("", encoding="utf-8")
        orderflow_journal._roll_day_locked(yesterday)
        assert str(orderflow_journal.journal_path("SBIN")) not in orderflow_journal._handles
        orderflow_journal.close_all()


class TestInferBroker:
    """Broker is inferred from the stored tick's shape — the only reliable tell.

    File names are per symbol per day and do not carry the broker, which is how
    two feeds previously ended up in one file unnoticed.
    """

    def test_50_level_depth_is_fyers_tbt(self):
        tick = {"depth": {"buy": [{"price": 1, "quantity": 1, "orders": 1}] * 50, "sell": []}}
        assert orderflow_journal.infer_broker(tick) == "fyers_tbt"

    def test_sequence_number_alone_is_enough(self):
        tick = {"seq": 123, "depth": {"buy": [{"price": 1, "quantity": 1, "orders": 0}], "sell": []}}
        assert orderflow_journal.infer_broker(tick) == "fyers_tbt"

    def test_order_counts_without_depth_size_is_fyers(self):
        tick = {"depth": {"buy": [{"price": 1, "quantity": 5, "orders": 7}], "sell": []}}
        assert orderflow_journal.infer_broker(tick) == "fyers"

    def test_plain_five_level_is_upstox(self):
        tick = {"depth": {"buy": [{"price": 1, "quantity": 5, "orders": 0}], "sell": []}}
        assert orderflow_journal.infer_broker(tick) == "upstox"

    def test_no_depth_is_unknown(self):
        assert orderflow_journal.infer_broker({"ltp": 1.0}) == "unknown"
        assert orderflow_journal.infer_broker(None) == "unknown"


def _ms(day, hour, minute):
    return int(datetime(day.year, day.month, day.day, hour, minute, tzinfo=config.IST).timestamp() * 1000)


def _write_journal(tmp_path, symbol, day, entries):
    path = tmp_path / f"{symbol}_{day.strftime('%Y-%m-%d')}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for ts, tick in entries:
            fh.write(json.dumps({"ts": ts, "kind": "tick", "data": tick}) + "\n")
    return path


TBT_TICK = {"seq": 1, "depth": {"buy": [{"price": 1, "quantity": 1, "orders": 1}] * 50, "sell": []}}
UPSTOX_TICK = {"depth": {"buy": [{"price": 1, "quantity": 1, "orders": 0}] * 5, "sell": []}}


class TestSummarizeDay:
    def test_reports_broker_records_and_coverage(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "RELIANCE", day, [
            (_ms(day, 9, 15), TBT_TICK),
            (_ms(day, 9, 15), TBT_TICK),
            (_ms(day, 9, 17), TBT_TICK),
        ])

        out = orderflow_journal.summarize_day("2026-09-17")

        assert out["session_minutes"] == 375
        row = out["rows"][0]
        assert row["symbol"] == "RELIANCE"
        assert row["broker"] == "fyers_tbt"
        assert row["records"] == 3
        assert row["covered_minutes"] == 2
        assert row["coverage_pct"] == round(2 / 375 * 100, 1)

    def test_zero_depth_ticks_do_not_make_a_file_mixed(self, journal_tmp):
        """A depth-less tick is not a second broker."""
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "TCS", day, [
            (_ms(day, 9, 15), TBT_TICK),
            (_ms(day, 9, 15), {"ltp": 1.0}),  # no depth
        ])

        row = orderflow_journal.summarize_day("2026-09-17")["rows"][0]
        assert row["broker"] == "fyers_tbt"
        assert row["brokers_seen"] == ["fyers_tbt", "unknown"]

    def test_two_feeds_in_one_file_is_flagged_mixed(self, journal_tmp):
        """Exactly the failure that hid a whole session of the wrong feed."""
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        entries = [(_ms(day, 9, 15 + i), TBT_TICK) for i in range(3)]
        entries += [(_ms(day, 9, 30 + i), UPSTOX_TICK) for i in range(3)]
        _write_journal(journal_tmp, "SBIN", day, entries)

        row = orderflow_journal.summarize_day("2026-09-17")["rows"][0]
        assert row["broker"] == "mixed"
        assert set(row["brokers_seen"]) == {"fyers_tbt", "upstox"}

    def test_reports_the_largest_gap_first(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "INFY", day, [
            (_ms(day, 9, 15), TBT_TICK),
            (_ms(day, 9, 20), TBT_TICK),   # 09:16-09:19 missing (4m)
            (_ms(day, 9, 30), TBT_TICK),   # 09:21-09:29 missing (9m)
        ])

        # Narrow window, otherwise the run to 15:30 is the biggest gap by far.
        row = orderflow_journal.summarize_day(
            "2026-09-17", session_start=(9, 15), session_close=(9, 35)
        )["rows"][0]
        assert row["gaps"][0]["minutes"] == 9
        assert row["gaps"][0]["from"] == "09:21"

    def test_empty_day_is_safe(self, journal_tmp):
        out = orderflow_journal.summarize_day("2026-09-17")
        assert out["rows"] == []
        assert out["overall_coverage_pct"] == 0.0
        assert out["total_bytes"] == 0

    def test_malformed_lines_are_counted_not_fatal(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        path = _write_journal(journal_tmp, "WIPRO", day, [(_ms(day, 9, 15), TBT_TICK)])
        with path.open("a", encoding="utf-8") as fh:
            fh.write("not json at all\n")

        out = orderflow_journal.summarize_day("2026-09-17")
        assert out["rows"][0]["records"] >= 1
        assert out["rows"][0]["broker"] == "fyers_tbt"


class TestAvailableDays:
    def test_lists_days_newest_first(self, journal_tmp):
        for day in ("2026-09-15", "2026-09-17", "2026-09-16"):
            (journal_tmp / f"RELIANCE_{day}.jsonl").write_text("", encoding="utf-8")
        assert orderflow_journal.available_days() == ["2026-09-17", "2026-09-16", "2026-09-15"]

    def test_ignores_non_journal_files(self, journal_tmp):
        (journal_tmp / "notes.txt").write_text("x", encoding="utf-8")
        assert orderflow_journal.available_days() == []

    def test_infer_broker_from_line_matches_dict_version(self, journal_tmp):
        """The fast line probe must agree with the parsed-tick version."""
        ticks = [TBT_TICK, UPSTOX_TICK, {"ltp": 1.0}, {"seq": 9, "depth": {"buy": [], "sell": []}}]
        for tick in ticks:
            line = json.dumps({"ts": 1, "kind": "tick", "data": tick})
            assert orderflow_journal.infer_broker_from_line(line) == (
                orderflow_journal.infer_broker(tick)
            ), line[:80]

    def test_whitespace_in_json_does_not_break_coverage(self, journal_tmp):
        """Real journals use compact separators; tolerate spaced JSON too."""
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        path = journal_tmp / "SPACED_2026-09-17.jsonl"
        path.write_text(
            json.dumps({"ts": _ms(day, 9, 15), "kind": "tick", "data": TBT_TICK}) + "\n",
            encoding="utf-8",
        )
        row = orderflow_journal.summarize_day("2026-09-17", session_start=(9, 15),
                                              session_close=(9, 35))["rows"][0]
        assert row["covered_minutes"] == 1


class TestBrokerScopedNames:
    """One file must hold one broker's data.

    File names carry the broker so a mixed file is impossible by construction,
    while the changeover keeps an in-progress day on its original file.
    """

    def test_name_carries_the_broker(self):
        assert orderflow_journal.journal_name("RELIANCE", "2026-09-18", "fyers_tbt") == (
            "fyers_tbt_RELIANCE_2026-09-18.jsonl"
        )

    def test_name_without_a_broker_is_the_legacy_shape(self):
        assert orderflow_journal.journal_name("RELIANCE", "2026-09-18") == (
            "RELIANCE_2026-09-18.jsonl"
        )

    def test_instrument_keys_and_spaces_are_safe(self):
        name = orderflow_journal.journal_name("NSE_INDEX|Nifty 50", "2026-09-18", "fyers_tbt")
        assert "|" not in name and " " not in name
        assert name == "fyers_tbt_NSE_INDEX_NIFTY_50_2026-09-18.jsonl"

    def test_new_day_uses_the_prefixed_file(self, journal_tmp):
        path = orderflow_journal.journal_path("RELIANCE", "2026-09-18", broker="fyers_tbt")
        assert path.name == "fyers_tbt_RELIANCE_2026-09-18.jsonl"

    def test_started_day_keeps_its_legacy_file(self, journal_tmp):
        """Enabling the prefix must not split today's session in two."""
        legacy = orderflow_journal.legacy_path("RELIANCE", "2026-09-17")
        legacy.write_text("", encoding="utf-8")

        path = orderflow_journal.journal_path("RELIANCE", "2026-09-17", broker="fyers_tbt")
        assert path == legacy

    def test_existing_prefixed_file_wins_over_legacy(self, journal_tmp):
        prefixed = journal_tmp / "fyers_tbt_RELIANCE_2026-09-18.jsonl"
        prefixed.write_text("", encoding="utf-8")
        assert orderflow_journal.journal_path("RELIANCE", "2026-09-18", broker="fyers_tbt") == prefixed

    def test_append_with_broker_writes_the_prefixed_file(self, journal_tmp):
        orderflow_journal.append("TCS", "tick", {"ltp": 1.0}, broker="fyers_tbt")
        names = sorted(p.name for p in journal_tmp.glob("*.jsonl"))
        assert names == ["fyers_tbt_TCS_2026-09-17.jsonl"] or names == [
            f"fyers_tbt_TCS_{datetime.now(config.IST).strftime('%Y-%m-%d')}.jsonl"
        ]

    def test_append_without_broker_keeps_the_legacy_name(self, journal_tmp):
        orderflow_journal.append("SBIN", "tick", {"ltp": 1.0})
        assert (journal_tmp / f"SBIN_{datetime.now(config.IST).strftime('%Y-%m-%d')}.jsonl").exists()


class TestSplitJournalName:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("fyers_tbt_RELIANCE_2026-09-17.jsonl", ("fyers_tbt", "RELIANCE", "2026-09-17")),
            ("fyers_TCS_2026-09-17.jsonl", ("fyers", "TCS", "2026-09-17")),
            ("upstox_SBIN_2026-09-17.jsonl", ("upstox", "SBIN", "2026-09-17")),
            ("RELIANCE_2026-09-17.jsonl", (None, "RELIANCE", "2026-09-17")),
            # sorted longest-prefix-first: fyers_tbt must not read as fyers
            ("fyers_tbt_NSE_INDEX_NIFTY_50_2026-09-17.jsonl",
             ("fyers_tbt", "NSE_INDEX_NIFTY_50", "2026-09-17")),
        ],
    )
    def test_parses_both_schemes(self, name, expected):
        assert orderflow_journal.split_journal_name(Path(name)) == expected


class TestReadAcrossTheChangeover:
    def test_broker_read_prefers_its_own_file_but_still_includes_legacy(self, journal_tmp):
        """A day recorded before the prefix existed must still replay."""
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        legacy = journal_tmp / "RELIANCE_2026-09-17.jsonl"
        legacy.write_text(
            json.dumps({"ts": _ms(day, 9, 15), "kind": "tick", "data": TBT_TICK}) + "\n",
            encoding="utf-8",
        )
        prefixed = journal_tmp / "fyers_tbt_RELIANCE_2026-09-17.jsonl"
        prefixed.write_text(
            json.dumps({"ts": _ms(day, 9, 16), "kind": "tick", "data": TBT_TICK}) + "\n",
            encoding="utf-8",
        )

        records = orderflow_journal.read("RELIANCE", day="2026-09-17", broker="fyers_tbt")
        assert len(records) == 2, "both halves of the session must be readable"

    def test_read_without_a_broker_uses_only_the_legacy_file(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        (journal_tmp / "RELIANCE_2026-09-17.jsonl").write_text(
            json.dumps({"ts": _ms(day, 9, 15), "kind": "tick", "data": TBT_TICK}) + "\n",
            encoding="utf-8",
        )
        (journal_tmp / "fyers_tbt_RELIANCE_2026-09-17.jsonl").write_text(
            json.dumps({"ts": _ms(day, 9, 16), "kind": "tick", "data": TBT_TICK}) + "\n",
            encoding="utf-8",
        )

        assert len(orderflow_journal.read("RELIANCE", day="2026-09-17")) == 1


class TestBrokerNameVerification:
    """The prefix is a promise; the summary checks the content keeps it."""

    def test_summary_reports_the_named_broker(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal_named(journal_tmp, "fyers_tbt", "RELIANCE", day, [(_ms(day, 9, 15), TBT_TICK)])

        row = orderflow_journal.summarize_day("2026-09-17")["rows"][0]
        assert row["named_broker"] == "fyers_tbt"
        assert row["symbol"] == "RELIANCE"
        assert row["broker"] == "fyers_tbt"
        assert row["broker_mismatch"] is False

    def test_flags_a_named_file_holding_another_feed(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal_named(journal_tmp, "fyers_tbt", "RELIANCE", day, [(_ms(day, 9, 15), UPSTOX_TICK)])

        row = orderflow_journal.summarize_day("2026-09-17")["rows"][0]
        assert row["named_broker"] == "fyers_tbt"
        assert row["broker"] == "upstox"
        assert row["broker_mismatch"] is True

    def test_legacy_files_report_no_named_broker(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "RELIANCE", day, [(_ms(day, 9, 15), TBT_TICK)])

        row = orderflow_journal.summarize_day("2026-09-17")["rows"][0]
        assert row["named_broker"] is None
        assert row["broker_mismatch"] is False


def _write_journal_named(tmp_path, broker, symbol, day, entries):
    path = tmp_path / f"{broker}_{symbol}_{day.strftime('%Y-%m-%d')}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for ts, tick in entries:
            fh.write(json.dumps({"ts": ts, "kind": "tick", "data": tick}) + "\n")
    return path


class TestReadAllAndSources:
    """Analysis tools need the whole day, and to know which feeds it spans."""

    def test_read_all_spans_every_broker_file(self, journal_tmp):
        day = datetime(2026, 9, 18, tzinfo=config.IST)
        _write_journal_named(journal_tmp, "fyers_tbt", "RELIANCE", day, [(_ms(day, 9, 15), TBT_TICK)])
        _write_journal_named(journal_tmp, "upstox", "RELIANCE", day, [(_ms(day, 9, 16), UPSTOX_TICK)])

        records = orderflow_journal.read_all("RELIANCE", day="2026-09-18", kind="tick")
        assert len(records) == 2
        assert set(orderflow_journal.sources("RELIANCE", day="2026-09-18")) == {
            "fyers_tbt", "upstox"
        }

    def test_sources_reports_legacy_for_unprefixed_files(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "SBIN", day, [(_ms(day, 9, 15), TBT_TICK)])

        assert orderflow_journal.sources("SBIN", day="2026-09-17") == ["legacy"]
        assert len(orderflow_journal.read_all("SBIN", day="2026-09-17", kind="tick")) == 1

    def test_read_all_is_empty_for_an_unknown_symbol(self, journal_tmp):
        assert orderflow_journal.read_all("NOPE") == []
        assert orderflow_journal.sources("NOPE") == []


class TestAuctionWindow:
    """NSE's closing auction starts at 15:15 and prints no trades.

    Coverage must therefore be measured to the continuous close, or a flawless
    day can never reach 100% and every summary looks 4% short.
    """

    def test_continuous_close_is_the_coverage_denominator(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "RELIANCE", day, [(_ms(day, 9, 15), TBT_TICK)])

        out = orderflow_journal.summarize_day(
            "2026-09-17",
            session_start=(9, 15),
            session_close=(15, 15),
            full_session_close=(15, 30),
        )
        assert out["session_start"] == "09:15"
        assert out["session_close"] == "15:15"
        assert out["session_minutes"] == 360
        assert out["full_session_close"] == "15:30"
        assert out["full_session_minutes"] == 375
        assert out["auction_minutes"] == 15

    def test_no_auction_tail_when_the_window_already_ends_at_the_close(self, journal_tmp):
        out = orderflow_journal.summarize_day("2026-09-17")
        assert out["auction_minutes"] == 0
        assert out["full_session_close"] == out["session_close"]

    def test_coverage_ignores_auction_minutes(self, journal_tmp):
        """A record at 15:20 is inside the auction, so it must not count."""
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "RELIANCE", day, [
            (_ms(day, 9, 15), TBT_TICK),   # during continuous trading
            (_ms(day, 15, 20), TBT_TICK),  # during the closing auction
        ])

        out = orderflow_journal.summarize_day(
            "2026-09-17",
            session_start=(9, 15),
            session_close=(15, 15),
            full_session_close=(15, 30),
        )
        assert out["rows"][0]["covered_minutes"] == 1
        assert out["rows"][0]["gaps"][0]["minutes"] == 359


class TestListJournalFiles:
    """The replay picker reads names + stat only, so it stays fast."""

    def test_lists_files_newest_day_first(self, journal_tmp):
        _write_journal_named(journal_tmp, "fyers_tbt", "RELIANCE", datetime(2026, 9, 18, tzinfo=config.IST), [])
        _write_journal_named(journal_tmp, "upstox", "TCS", datetime(2026, 9, 17, tzinfo=config.IST), [])

        rows = orderflow_journal.list_journal_files()
        assert [r["day"] for r in rows] == ["2026-09-18", "2026-09-17"]
        assert rows[0]["broker"] == "fyers_tbt" and rows[0]["symbol"] == "RELIANCE"
        assert rows[1]["broker"] == "upstox" and rows[1]["symbol"] == "TCS"

    def test_reports_legacy_files_without_a_broker_prefix(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "SBIN", day, [(_ms(day, 9, 15), TBT_TICK)])

        row = orderflow_journal.list_journal_files()[0]
        assert row["broker"] == "legacy"
        assert row["bytes"] > 0

    def test_day_limit_keeps_only_the_newest(self, journal_tmp):
        for day in ("2026-09-14", "2026-09-15", "2026-09-16"):
            _write_journal_named(journal_tmp, "fyers_tbt", "RELIANCE",
                                 datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=config.IST), [])
        assert [r["day"] for r in orderflow_journal.list_journal_files(days=2)] == [
            "2026-09-16", "2026-09-15"
        ]

    def test_empty_directory_is_safe(self, journal_tmp):
        assert orderflow_journal.list_journal_files() == []


class TestIterSession:
    """Streams stored records one at a time, in the shape the bridge replays."""

    def test_yields_raw_stored_lines(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "RELIANCE", day, [
            (_ms(day, 9, 15), TBT_TICK),
            (_ms(day, 9, 16), TBT_TICK),
        ])

        lines = list(orderflow_journal.iter_session("RELIANCE", day="2026-09-17"))
        assert len(lines) == 2
        record = json.loads(lines[0])
        assert set(record) == {"ts", "kind", "data"}   # same shape the bridge sends
        assert orderflow_journal.infer_broker(record["data"]) == "fyers_tbt"

    def test_window_filters_by_minute_of_day(self, journal_tmp):
        day = datetime(2026, 9, 17, tzinfo=config.IST)
        _write_journal(journal_tmp, "RELIANCE", day, [
            (_ms(day, 9, 15), TBT_TICK),
            (_ms(day, 12, 0), TBT_TICK),
            (_ms(day, 15, 20), TBT_TICK),
        ])

        # inclusive start, exclusive end, minutes-of-day in IST
        lines = list(orderflow_journal.iter_session(
            "RELIANCE", day="2026-09-17", start_minute=9 * 60 + 15, end_minute=13 * 60
        ))
        assert len(lines) == 2

    def test_unknown_symbol_yields_nothing(self, journal_tmp):
        assert list(orderflow_journal.iter_session("NOPE", day="2026-09-17")) == []
