"""CAS (Closing Auction Session) close handling — no network, no DB writes."""
import pytest

from scripts.desk_check import CAS_WARNING, is_cas_window as desk_is_cas, render as desk_render
from tests.test_desk_check import _minimal_payload
from options_paper import eod
from api.reports_api import nifty as nifty_mod

pytestmark = pytest.mark.unit


def _ist(hh_mm: str):
    from datetime import datetime
    import config
    dt = datetime.strptime(f"2026-10-21T{hh_mm}:00", "%Y-%m-%dT%H:%M:%S")
    return dt.replace(tzinfo=config.IST)


@pytest.mark.parametrize("mod", [desk_is_cas, eod.is_cas_window, nifty_mod.is_cas_window])
@pytest.mark.parametrize(
    "hh_mm, expected",
    [("15:14", False), ("15:15", True), ("15:29", True), ("15:30", False)],
)
def test_is_cas_window_boundaries(mod, hh_mm, expected):
    assert mod(_ist(hh_mm)) is expected


def test_is_cas_window_naive_assumed_ist():
    from datetime import datetime
    assert desk_is_cas(datetime(2026, 10, 21, 15, 20)) is True
    assert desk_is_cas(datetime(2026, 10, 21, 14, 0)) is False


def test_is_cas_window_converts_tz():
    from datetime import datetime, timezone
    # 09:55 UTC == 15:25 IST -> inside; 10:05 UTC == 15:35 IST -> outside
    assert desk_is_cas(datetime(2026, 10, 21, 9, 55, tzinfo=timezone.utc)) is True
    assert desk_is_cas(datetime(2026, 10, 21, 10, 5, tzinfo=timezone.utc)) is False


def test_desk_render_warns_in_cas_window():
    payload = _minimal_payload()
    out = desk_render(payload, now=_ist("15:20"))
    assert CAS_WARNING in out
    assert "CAS: index print frozen (15:15–15:30); official close from OHLC" in out
    plain = desk_render(payload, now=_ist("14:00"))
    assert CAS_WARNING not in plain


def test_eod_uses_official_close_when_tape_frozen(monkeypatch):
    monkeypatch.setattr(eod, "last_tape_row", lambda date: {
        "t": "2026-10-21T15:29:16+05:30", "spot": 22738.45})
    seen = []

    def fake_close(date=None, timeout=15.0):
        seen.append(date)
        return 22811.35

    monkeypatch.setattr(eod, "fetch_official_nifty_close", fake_close)
    res = eod.resolve_day_close("2026-10-21")
    assert res["in_cas"] is True
    assert res["day_close"] == pytest.approx(22811.35)
    assert res["official_close"] == pytest.approx(22811.35)
    assert res["cas_line"] == "CAS close used: 22,811.35 (tape frozen at 22,738.45)."
    assert seen == ["2026-10-21"]  # the DATE is forwarded, never today


def test_eod_falls_back_when_official_unavailable(monkeypatch):
    monkeypatch.setattr(eod, "last_tape_row", lambda date: {
        "t": "2026-10-21T15:29:16+05:30", "spot": 22738.45})
    monkeypatch.setattr(eod, "fetch_official_nifty_close",
                        lambda date=None, timeout=15.0: None)
    res = eod.resolve_day_close("2026-10-21")
    assert res["in_cas"] is True
    assert res["day_close"] == pytest.approx(22738.45)
    assert "official close unavailable" in res["cas_line"]


def test_eod_past_session_uses_that_dates_close_outside_cas(monkeypatch):
    # Re-running 2026-10-16 must not stamp 2026-10-21's close over it.
    monkeypatch.setattr(eod, "last_tape_row", lambda date: {
        "t": "2026-10-16T15:14:00+05:30", "spot": 23120.0})
    seen = []

    def fake_close(date=None, timeout=15.0):
        seen.append(date)
        return 23146.30

    monkeypatch.setattr(eod, "fetch_official_nifty_close", fake_close)
    res = eod.resolve_day_close("2026-10-16")
    assert res["in_cas"] is False
    assert res["day_close"] == pytest.approx(23146.30)
    assert res["cas_line"] == ""
    assert seen == ["2026-10-16"]  # date-aware, not today's quote


def test_eod_past_session_falls_back_to_tape_with_a_warning(monkeypatch):
    monkeypatch.setattr(eod, "last_tape_row", lambda date: {
        "t": "2026-10-16T15:14:00+05:30", "spot": 23120.0})
    monkeypatch.setattr(eod, "fetch_official_nifty_close",
                        lambda date=None, timeout=15.0: None)
    res = eod.resolve_day_close("2026-10-16")
    assert res["day_close"] == pytest.approx(23120.0)
    assert "Official close for 2026-10-16 unavailable" in res["cas_line"]
    assert "tape last 23,120.00" in res["cas_line"]


def _fake_report():
    strikes = [{
        "strike": 22750,
        "ce": {"ltp": 50.0, "oi": 1000, "volume": 10},
        "pe": {"ltp": 60.0, "oi": 1000, "volume": 10},
    }]
    return {
        "spot": 22738.45, "strikes": strikes, "pcr_oi": 0.69, "pcr_vol": 1.13,
        "max_pain": 22900.0, "gex": {"zero_cross": 23200.0, "net_total": 45.0},
        "walls": {"calls": [], "puts": []}, "expiry": "2026-10-29",
    }


async def _record_at(monkeypatch, hh_mm):
    captured = {}

    async def _fake_compute(*a, **k):
        return _fake_report()

    async def _fake_minute_snapshot(*a, **k):
        return None

    monkeypatch.setattr(nifty_mod, "_compute_live", _fake_compute)
    monkeypatch.setattr(nifty_mod, "_peek_last_tape_row", lambda path, minute: (None, False))
    monkeypatch.setattr(nifty_mod, "_append_tape_line",
                        lambda path, row: captured.update(row=row))
    monkeypatch.setattr(nifty_mod, "write_snapshot", lambda *a, **k: None)
    monkeypatch.setattr(nifty_mod, "_append_minute_snapshot", _fake_minute_snapshot)
    row = await nifty_mod.record_nifty_tape_tick(now=_ist(hh_mm))
    assert row is not None
    return captured["row"]


async def test_tape_row_flagged_in_cas_window(monkeypatch, tmp_path):
    monkeypatch.setattr(nifty_mod, "tape_path", lambda date_str: tmp_path / f"{date_str}.jsonl")
    row = await _record_at(monkeypatch, "15:20")
    assert row.get("cas") is True


async def test_tape_row_unflagged_outside_window(monkeypatch, tmp_path):
    monkeypatch.setattr(nifty_mod, "tape_path", lambda date_str: tmp_path / f"{date_str}.jsonl")
    row = await _record_at(monkeypatch, "14:00")
    assert "cas" not in row
