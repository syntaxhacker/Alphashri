"""Unit tests for india_board/scripts/signal_log.py (no network).

Covers: schema validation, uuid/ts fill, JSON-safety (NaN/Inf -> None),
malformed-line skipping, date-range reads, and retention pruning.
"""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from india_board.scripts import signal_log

IST = ZoneInfo("Asia/Kolkata")
DAY = "2026-09-28"
DAY_D = date(2026, 9, 28)


def _iso(hour: int, minute: int, day: str = DAY) -> str:
    y, m, d = (int(x) for x in day.split("-"))
    return datetime(y, m, d, hour, minute, tzinfo=IST).isoformat()


def _rec(ts: str, **overrides) -> dict:
    """A minimal valid record (signal_id filled by the logger or here)."""
    rec = {
        "signal_id": str(uuid.uuid4()),
        "ts": ts,
        "playbook": "P1",
        "ticker": "RELIANCE",
        "side": "CE",
        "features": {"spread_bp": 12.0},
    }
    rec.update(overrides)
    return rec


# ---------------------------------------------------------------------------
# make_signal / schema
# ---------------------------------------------------------------------------


def test_make_signal_fills_id_ts_and_schema():
    rec = signal_log.make_signal(
        "P1",
        "reliance",
        side="ce",
        features={"spread_bp": 14.2},
        entry_ref=1207.3,
        stop_ref=1195.0,
        target_ref=1230.0,
        strike=1500.0,
        expiry="29-09-2026",
        source="scan",
        notes="wall break",
    )
    assert uuid.UUID(rec["signal_id"])  # valid uuid4
    parsed = datetime.fromisoformat(rec["ts"])
    assert parsed.tzinfo is not None
    assert rec["ticker"] == "RELIANCE"
    assert rec["side"] == "CE"
    assert rec["playbook"] == "P1"
    assert rec["features"] == {"spread_bp": 14.2}
    assert rec["entry_ref"] == 1207.3
    assert rec["stop_ref"] == 1195.0
    assert rec["target_ref"] == 1230.0
    assert rec["source"] == "scan"
    for key in ("signal_id", "ts", "playbook", "ticker", "side", "features"):
        assert key in rec


@pytest.mark.parametrize(
    "kwargs",
    [
        {"playbook": "P9", "ticker": "X"},
        {"playbook": "P1", "ticker": ""},
        {"playbook": "P1", "ticker": "X", "side": "CALL"},
    ],
)
def test_make_signal_rejects_invalid(kwargs):
    with pytest.raises(ValueError):
        signal_log.make_signal(features={}, **kwargs)


# ---------------------------------------------------------------------------
# log_signal / read_signals
# ---------------------------------------------------------------------------


def test_log_signal_returns_id_and_round_trips(tmp_path):
    rec = _rec(_iso(10, 0))
    sid = signal_log.log_signal(rec, root=tmp_path)
    assert sid == rec["signal_id"]

    back = signal_log.read_signals(DAY, root=tmp_path)
    assert [r["signal_id"] for r in back] == [sid]
    assert back[0] == rec
    # One file per day, one record per line.
    assert len((tmp_path / f"{DAY}.jsonl").read_text(encoding="utf-8").splitlines()) == 1


def test_log_signal_fills_uuid_and_ts_when_absent(tmp_path):
    rec = {"playbook": "P3", "ticker": "INFY", "side": "NA", "features": {"a": 1}}
    sid = signal_log.log_signal(rec, root=tmp_path)
    assert sid and uuid.UUID(sid)

    back = signal_log.read_signals(root=tmp_path)  # defaults to today IST
    assert len(back) == 1
    assert back[0]["signal_id"] == sid
    assert datetime.fromisoformat(back[0]["ts"]).tzinfo is not None


def test_log_signal_never_raises_on_invalid(tmp_path):
    assert signal_log.log_signal({"ticker": "X"}, root=tmp_path) == ""
    assert signal_log.log_signal("not a dict", root=tmp_path) == ""
    assert signal_log.log_signal(None, root=tmp_path) == ""
    bad = _rec(_iso(10, 0), playbook="P99")
    assert signal_log.log_signal(bad, root=tmp_path) == ""

    # Unwritable destination (a file where the signals dir should be) -> "".
    blocker = tmp_path / "blocker"
    blocker.write_text("i am a file", encoding="utf-8")
    good = signal_log.make_signal("P1", "X", features={"a": 1})
    assert signal_log.log_signal(good, root=blocker) == ""


def test_numbers_are_json_safe(tmp_path):
    rec = signal_log.make_signal(
        "P1",
        "X",
        features={
            "nan": float("nan"),
            "inf": float("inf"),
            "ninf": float("-inf"),
            "nested": [float("nan"), 1.5],
            "ok": 2.0,
        },
    )
    assert signal_log.log_signal(rec, root=tmp_path)
    # log_signal stamps ``ts`` with the wall clock, so read the day it wrote
    # (the archive is dated by ts, not by the DAY fixture constant).
    written = sorted(f.stem for f in tmp_path.glob("*.jsonl"))
    assert written, "expected a signal file to be written"
    back = signal_log.read_signals(written[-1], root=tmp_path)[0]
    assert back["features"] == {
        "nan": None,
        "inf": None,
        "ninf": None,
        "nested": [None, 1.5],
        "ok": 2.0,
    }
    # The on-disk line itself must be strict JSON (no NaN/Infinity tokens).
    raw = (tmp_path / f"{written[-1]}.jsonl").read_text(encoding="utf-8").strip()
    assert "NaN" not in raw and "Infinity" not in raw
    assert json.loads(raw)["features"]["nan"] is None


def test_read_signals_skips_malformed_and_sorts(tmp_path):
    path = tmp_path / f"{DAY}.jsonl"
    path.write_text(
        "\n".join(
            [
                "{not json at all",
                json.dumps(_rec(_iso(10, 0))),
                json.dumps(["a", "list", "is", "not", "a", "signal"]),
                json.dumps({"ticker": "NIFTY"}),  # dict but incomplete
                json.dumps(_rec(_iso(9, 30))),
                "",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    out = signal_log.read_signals(DAY, root=tmp_path)
    assert [r["ts"] for r in out] == [_iso(9, 30), _iso(10, 0)]
    # Missing day and missing root are empty, never raise.
    assert signal_log.read_signals("2026-09-27", root=tmp_path) == []
    assert signal_log.read_signals(DAY, root=tmp_path / "nope") == []


# ---------------------------------------------------------------------------
# date-range reads
# ---------------------------------------------------------------------------


def test_read_range_is_inclusive_and_ordered(tmp_path):
    signal_log.log_signal(_rec(_iso(10, 0, day="2026-09-27")), root=tmp_path)
    signal_log.log_signal(_rec(_iso(11, 0, day="2026-09-28")), root=tmp_path)
    signal_log.log_signal(_rec(_iso(9, 0, day="2026-09-29")), root=tmp_path)

    out = signal_log.read_range("2026-09-28", "2026-09-29", root=tmp_path)
    assert [r["ts"] for r in out] == [
        _iso(11, 0, day="2026-09-28"),
        _iso(9, 0, day="2026-09-29"),
    ]
    # Reversed / invalid ranges are empty, never raise.
    assert signal_log.read_range("2026-09-29", "2026-09-28", root=tmp_path) == []
    assert signal_log.read_range("nope", "2026-09-29", root=tmp_path) == []


# ---------------------------------------------------------------------------
# retention
# ---------------------------------------------------------------------------


def test_prune_removes_older_than_keep_days(tmp_path):
    old_day = (DAY_D - timedelta(days=31)).isoformat()
    keep_day = (DAY_D - timedelta(days=30)).isoformat()
    for day in (old_day, keep_day, DAY):
        (tmp_path / f"{day}.jsonl").write_text("{}\n", encoding="utf-8")

    removed = signal_log.prune_signals(root=tmp_path, keep_days=30, today=DAY_D)

    assert removed == 1
    assert not (tmp_path / f"{old_day}.jsonl").exists()
    assert (tmp_path / f"{keep_day}.jsonl").exists()
    assert (tmp_path / f"{DAY}.jsonl").exists()
    # Best-effort: a missing root never raises.
    assert signal_log.prune_signals(root=tmp_path / "nope", keep_days=30, today=DAY_D) == 0


def test_keep_days_default_is_400():
    assert signal_log.KEEP_DAYS == 400
