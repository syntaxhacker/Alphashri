"""Breadth endpoint: shape, % change, up-count, and graceful failure."""

from __future__ import annotations

import pytest

from api.reports_api import breadth


@pytest.fixture(autouse=True)
def _reset_cache():
    breadth._cache["payload"] = None
    breadth._cache["at"] = 0.0
    yield
    breadth._cache["payload"] = None
    breadth._cache["at"] = 0.0


def _quote(last: float, close: float) -> dict:
    return {"last_price": last, "ohlc": {"close": close}}


def test_breadth_computes_change_and_up_count(monkeypatch):
    data = {
        "NSE_INDEX|Nifty 50": _quote(22_600, 22_687),
        "NSE_INDEX|Nifty Bank": _quote(54_200, 54_300),
        "NSE_INDEX|NIFTY MIDCAP 150": _quote(19_800, 20_600),
        "NSE_INDEX|Nifty Smallcap 500": _quote(18_600, 19_300),
        "NSE_INDEX|Nifty 500": _quote(21_400, 21_600),
    }
    monkeypatch.setattr(
        "scripts.upstox_common.get",
        lambda *a, **k: {"data": data},
    )
    out = breadth.get_breadth()
    assert out["available"] is True
    assert out["count"] == 5
    assert out["up"] == 0
    small = next(r for r in out["rows"] if r["label"] == "SMALL")
    assert small["change_pct"] == pytest.approx(-3.63, abs=0.01)


def test_breadth_is_unavailable_without_quotes(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no Upstox token")

    monkeypatch.setattr("scripts.upstox_common.get", boom)
    out = breadth.get_breadth()
    assert out["available"] is False
    assert out["count"] == 0
    assert len(out["rows"]) == 5  # shape stays stable for the UI


def test_breadth_caches_for_a_minute(monkeypatch):
    calls = {"n": 0}

    def fake(*a, **k):
        calls["n"] += 1
        return {"data": {"NSE_INDEX|Nifty 50": _quote(22_600, 22_687)}}

    monkeypatch.setattr("scripts.upstox_common.get", fake)
    breadth.get_breadth()
    breadth.get_breadth()
    assert calls["n"] == 1




@pytest.fixture
def _isolated_files(tmp_path, monkeypatch):
    """Redirect the persisted breadth files and reset the per-minute state."""
    monkeypatch.setattr(breadth, "BREADTH_DIR", tmp_path)
    monkeypatch.setattr(breadth, "LAST_PATH", tmp_path / "last.json")
    monkeypatch.setattr(breadth, "HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(breadth, "_last_history_minute", None)
    return tmp_path


def _fixed_now(value: str):
    from datetime import datetime

    return lambda: datetime.fromisoformat(value)


def _rotation(adv=1151, dec=402, pct=74.1, stale=False, as_of="2026-11-18T10:00:00+05:30"):
    return {
        "advances_pct": pct,
        "advances": adv,
        "declines": dec,
        "total": adv + dec,
        "as_of": as_of,
        "stale": stale,
    }


def test_history_appends_full_block_and_updates_last_json(
    monkeypatch, _isolated_files
):
    import json

    monkeypatch.setattr(
        "scripts.upstox_common.get",
        lambda *a, **k: {"data": {"NSE_INDEX|Nifty 50": _quote(22_600, 22_687)}},
    )
    monkeypatch.setattr(breadth, "_rotation_state", lambda: _rotation())
    monkeypatch.setattr(breadth, "_now_ist", _fixed_now("2026-11-18T10:05:30+05:30"))

    breadth.get_breadth()

    path = _isolated_files / "history" / "2026-11-18.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    assert len(rows) == 1
    row = rows[0]
    assert row["t"] == "2026-11-18T10:05:30+05:30"
    assert row["advances"] == 1151 and row["declines"] == 402
    assert row["advances_pct"] == 74.1
    assert row["count"] == 1 and row["available"] is True
    assert row["rows"][0]["label"] == "NIFTY"

    last = json.loads((_isolated_files / "last.json").read_text())
    assert last["block"]["advances_pct"] == 74.1
    assert last["at"] > 0


def test_history_dedupes_within_the_same_minute(monkeypatch, _isolated_files):
    monkeypatch.setattr(
        "scripts.upstox_common.get",
        lambda *a, **k: {"data": {"NSE_INDEX|Nifty 50": _quote(22_600, 22_687)}},
    )
    monkeypatch.setattr(breadth, "_rotation_state", lambda: _rotation())
    monkeypatch.setattr(breadth, "_now_ist", _fixed_now("2026-11-18T10:05:30+05:30"))

    breadth.refresh(force=True)
    breadth.refresh(force=True)
    breadth.refresh(force=True)

    path = _isolated_files / "history" / "2026-11-18.jsonl"
    assert len(path.read_text().splitlines()) == 1


def test_history_does_not_duplicate_the_minute_written_before_a_restart(
    monkeypatch, _isolated_files
):
    """A cold process must read the file's last minute, not write it twice."""
    import json

    history = _isolated_files / "history"
    history.mkdir(parents=True)
    path = history / "2026-11-18.jsonl"
    path.write_text(json.dumps({"t": "2026-11-18T10:05:12+05:30", "advances": 1}) + "\n")

    monkeypatch.setattr(breadth, "_now_ist", _fixed_now("2026-11-18T10:05:59+05:30"))
    block = breadth._compose_block({"available": True, "rows": [], "up": 0, "count": 0}, None)
    assert breadth._append_history(block) is False
    assert len(path.read_text().splitlines()) == 1

    monkeypatch.setattr(breadth, "_now_ist", _fixed_now("2026-11-18T10:06:01+05:30"))
    assert breadth._append_history(block) is True
    assert len(path.read_text().splitlines()) == 2


def test_history_keeps_every_day(monkeypatch, _isolated_files):
    """Retention is deliberately none: past sessions are never pruned."""
    monkeypatch.setattr(breadth, "_now_ist", _fixed_now("2026-11-17T15:20:00+05:30"))
    block = breadth._compose_block({"available": True, "rows": [], "up": 0, "count": 0}, None)
    assert breadth._append_history(block) is True
    monkeypatch.setattr(breadth, "_last_history_minute", None)
    monkeypatch.setattr(breadth, "_now_ist", _fixed_now("2026-11-18T09:20:00+05:30"))
    assert breadth._append_history(block) is True

    history = _isolated_files / "history"
    assert sorted(p.name for p in history.glob("*.jsonl")) == [
        "2026-11-17.jsonl",
        "2026-11-18.jsonl",
    ]
    assert len(breadth.read_history("2026-11-17")) == 1
    assert len(breadth.read_history("2026-11-18")) == 1


def test_stale_rotation_does_not_overwrite_last_json(monkeypatch, _isolated_files):
    """A strip-only refresh must not erase the last real A/D reading."""
    monkeypatch.setattr(
        "scripts.upstox_common.get",
        lambda *a, **k: {"data": {"NSE_INDEX|Nifty 50": _quote(22_600, 22_687)}},
    )
    monkeypatch.setattr(breadth, "_rotation_state", lambda: None)
    monkeypatch.setattr(breadth, "_now_ist", _fixed_now("2026-11-18T10:05:30+05:30"))

    breadth.refresh(force=True)
    assert not (_isolated_files / "last.json").exists()

    path = _isolated_files / "history" / "2026-11-18.jsonl"
    assert len(path.read_text().splitlines()) == 1

