"""EOD accounting: journal-sourced equity, through-date curve, ledger recon.

The account block used to read ₹0 from the DB (the agent book is booked under
a different user, and a trade was deleted by hand), while the equity curve
showed a loss. Both now come from the JOURNAL; the DB divergence is reported
as a reconciliation instead of pretending the books agree.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from options_paper import book, eod

ROOT = Path(__file__).resolve().parents[1]


def _row(net, strategy="agent_discretionary", symbol="NIFTY26OCT23000CE",
         entry="2026-10-15T09:20:00+05:30", exit_time="2026-10-15T09:40:00+05:30"):
    return {"strategy": strategy, "symbol": symbol, "net_pnl": net,
            "entry_time": entry, "exit_time": exit_time}


def _install_journal(tmp_path, monkeypatch, days: dict[str, list[dict]]):
    for day, rows in days.items():
        (tmp_path / f"{day}.jsonl").write_text(
            "\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path)
    return tmp_path


# ---------------------------------------------------------------------------
# Journal account
# ---------------------------------------------------------------------------

def test_journal_account_is_never_zero_and_splits_the_books(tmp_path, monkeypatch):
    _install_journal(tmp_path, monkeypatch, {
        "2026-10-15": [_row(500.0), _row(-200.0, strategy="nifty_momentum")],
        "2026-10-16": [_row(-100.0)],
    })

    snap = eod.journal_account_snapshot("2026-10-16")

    assert snap["source"] == "journal"
    assert snap["days"] == 2 and snap["trades"] == 3
    assert snap["realized_pnl"] == pytest.approx(200.0)
    assert snap["equity"] == pytest.approx(book.INITIAL_CAPITAL + 200.0)
    assert snap["equity"] != 0
    assert snap["by_book"]["manual"]["net"] == pytest.approx(400.0)
    assert snap["by_book"]["coded"]["net"] == pytest.approx(-200.0)


def test_journal_account_through_excludes_later_sessions(tmp_path, monkeypatch):
    _install_journal(tmp_path, monkeypatch, {
        "2026-10-15": [_row(500.0)],
        "2026-10-21": [_row(-5000.0)],
    })

    snap = eod.journal_account_snapshot("2026-10-15")

    # A re-run of an old EOD must not see a future day's loss.
    assert snap["days"] == 1
    assert snap["realized_pnl"] == pytest.approx(500.0)
    assert snap["equity"] == pytest.approx(book.INITIAL_CAPITAL + 500.0)


# ---------------------------------------------------------------------------
# Equity curve
# ---------------------------------------------------------------------------

def test_equity_curve_only_includes_days_up_to_through(tmp_path, monkeypatch):
    _install_journal(tmp_path, monkeypatch, {
        "2026-10-15": [_row(100.0)],
        "2026-10-16": [_row(-40.0)],
        "2026-10-21": [_row(900.0)],
    })

    assert eod._equity_curve("2026-10-16") == [
        ("2026-10-15", 100.0),
        ("2026-10-16", 60.0),
    ]
    assert eod._equity_curve()[-1] == ("2026-10-21", 960.0)


def test_equity_curve_carries_a_running_total(tmp_path, monkeypatch):
    _install_journal(tmp_path, monkeypatch, {
        "2026-10-15": [_row(100.0), _row(-250.0)],
        "2026-10-16": [_row(400.0)],
    })
    assert eod._equity_curve("2026-10-16") == [
        ("2026-10-15", -150.0),
        ("2026-10-16", 250.0),
    ]


def test_equity_curve_missing_journal_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(book, "JOURNAL_DIR", tmp_path / "missing")
    assert eod._equity_curve() == []


# ---------------------------------------------------------------------------
# Journal vs DB reconciliation — the 2026-10-19 shape
# ---------------------------------------------------------------------------

def test_reconcile_names_the_2026_10_19_divergence(monkeypatch):
    """Journal 32 / net 2,121.21 vs DB 32 / net 5,385.67 on 2026-10-19.

    The straddle row is in the journal but not the DB (deleted artifact), and
    the 23,100 CE is inserted twice in the DB. The recon must NAME both, not
    average them away.
    """
    journal = [
        _row(-3059.08, symbol="NIFTY 2026-10-19 22850STRADDLE",
             entry="2026-10-19T14:17:01.007695+05:30",
             exit_time="2026-10-19T15:10:00+05:30"),
        _row(205.38, symbol="NIFTY26OCT23100CE",
             entry="2026-10-19T11:09:02.819976",
             exit_time="2026-10-19T11:20:00+05:30"),
        _row(4974.91, symbol="NIFTY26OCT23000PE",
             entry="2026-10-19T10:33:00+05:30"),
    ]
    db_rows = [
        {"id": 1, "symbol": "NIFTY26OCT23100CE",
         "entry_time": "2026-10-19T11:09:02.819976",
         "strategy_name": "agent_discretionary", "net_pnl": 205.38},
        {"id": 2, "symbol": "NIFTY26OCT23100CE",
         "entry_time": "2026-10-19T11:09:02.819976",
         "strategy_name": "agent_discretionary", "net_pnl": 205.38},
        {"id": 3, "symbol": "NIFTY26OCT23000PE",
         "entry_time": "2026-10-19T10:33:00+05:30",
         "strategy_name": "agent_discretionary", "net_pnl": 4974.91},
    ]
    monkeypatch.setattr(eod.book, "read_journal", lambda date: journal)
    monkeypatch.setattr(eod, "_db_options_trades", lambda date: db_rows)

    recon = eod.reconcile_journal_vs_db("2026-10-19")

    assert recon["journal_n"] == 3
    assert recon["db_n"] == 3
    assert recon["journal_net"] == pytest.approx(2121.21, abs=0.01)
    assert recon["db_net"] == pytest.approx(5385.67, abs=0.01)
    assert recon["delta"] == pytest.approx(3264.46, abs=0.01)
    assert recon["in_sync"] is False
    assert [m["symbol"] for m in recon["missing_in_db"]] == [
        "NIFTY 2026-10-19 22850STRADDLE"]
    assert recon["missing_in_journal"] == []
    assert len(recon["duplicates"]) == 1
    dup = recon["duplicates"][0]
    assert dup["symbol"] == "NIFTY26OCT23100CE" and dup["n"] == 2


def test_reconcile_in_sync_when_both_ledgers_match(monkeypatch):
    rows = [_row(100.0)]
    monkeypatch.setattr(eod.book, "read_journal", lambda date: rows)
    monkeypatch.setattr(
        eod, "_db_options_trades",
        lambda date: [{"id": 1, "symbol": "NIFTY26OCT23000CE",
                       "entry_time": "2026-10-15T09:20:00+05:30",
                       "strategy_name": "agent_discretionary", "net_pnl": 100.0}])

    recon = eod.reconcile_journal_vs_db("2026-10-15")

    assert recon["in_sync"] is True
    assert recon["delta"] == 0
    assert recon["missing_in_db"] == []
    assert recon["missing_in_journal"] == []
    assert recon["duplicates"] == []


# ---------------------------------------------------------------------------
# Synthetic 2026-10-13 report fixture
# ---------------------------------------------------------------------------

def test_synthetic_2026_10_13_fixture_is_a_valid_report_snapshot():
    """The 10-13 tape predates ATM premiums; a synthetic snapshot fills the day.

    It must stay clearly synthetic (``mode == "snapshot"``) and carry the
    fields the report reader expects, so it cannot be mistaken for a live
    recording.
    """
    path = ROOT / "experiments" / "data" / "nifty_reports" / "2026-10-13.json"
    assert path.exists(), "missing synthetic 2026-10-13 fixture"
    report = json.loads(path.read_text(encoding="utf-8"))

    assert report["date"] == "2026-10-13"
    assert report["mode"] == "snapshot"
    assert report["source"]
    assert report["spot"] > 0
    assert report["expiry"] == "2026-10-15"
    assert report["strikes"] and report["strikes"][0]["strike"] > 0
    assert {"walls", "gex", "pcr_oi", "pcr_vol", "max_pain"} <= set(report)
    assert report["timeline"]
