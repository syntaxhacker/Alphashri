"""Tests for GET /api/reports/follow-through (mocked candles + tmp fixture report)."""
import json

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.reports_api import breakouts as br
import api.reports_api.followthrough as ft


DATE = "2026-10-01"


def _frame(dates, opens, highs, lows, closes, vol=1000.0):
    idx = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC") for d in dates])
    n = len(dates)
    vols = [vol] * n if not isinstance(vol, list) else vol
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": vols},
        index=idx,
    )


def _write_report(path, up_rows, down_rows):
    payload = {
        "date": DATE, "universe": "tu", "as_of": "x", "cached": False,
        "scanned": len(up_rows) + len(down_rows),
        "breakouts": {"count": len(up_rows), "by_type": {}, "rows": up_rows},
        "breakdowns": {"count": len(down_rows), "by_type": {}, "rows": down_rows},
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def _up_row(sym="AAA", close=110.0, level=100.0, typ="52w_high"):
    return {"symbol": sym, "name": sym, "type": typ, "level": level, "close": close}


def _down_row(sym="ZZZ", close=90.0, level=100.0, typ="52w_low"):
    return {"symbol": sym, "name": sym, "type": typ, "level": level, "close": close}


@pytest.fixture
def wired(monkeypatch, tmp_path):
    br_dir = tmp_path / "breakouts"
    ft_dir = tmp_path / "follow"
    br_dir.mkdir()
    ft_dir.mkdir()
    monkeypatch.setattr(br, "REPORT_DIR", br_dir)
    monkeypatch.setattr(ft, "REPORT_DIR", ft_dir)
    app = FastAPI()
    app.include_router(ft.router)
    with TestClient(app) as c:
        yield c, br_dir, ft_dir


def _fake_fetch(monkeypatch, frames, calls=None):
    def _fetch(symbol, *a, **k):
        if calls is not None:
            calls.append(str(symbol).upper())
        out = frames.get(str(symbol).upper())
        if isinstance(out, Exception):
            raise out
        return out
    monkeypatch.setattr(ft, "fetch_for_timeframe", _fetch)


class TestEvaluateRow:
    def test_breakout_math(self, monkeypatch):
        # ref 100 -> last 110 (+10%); high 115 (fav +15%); low 98 (adv -2%);
        # one since-close 99 < level 100 -> held False.
        df = _frame(
            [f"{DATE}", "2026-10-02", "2026-10-03"],
            [100.0, 108.0, 109.0], [101.0, 115.0, 111.0],
            [99.0, 98.0, 98.0], [100.0, 99.0, 110.0],
        )
        monkeypatch.setattr(ft, "fetch_for_timeframe", lambda s, *a, **k: df)
        row = ft.evaluate_row("AAA", name="AAA", type="52w_high", level=100.0,
                              ref_close=100.0, side="up", date_str=DATE)
        assert row["ret_pct"] == pytest.approx(10.0)
        assert row["max_fav_pct"] == pytest.approx(15.0)
        assert row["max_adv_pct"] == pytest.approx(-2.0)
        assert row["held"] is False
        assert row["last_close"] == pytest.approx(110.0)
        assert row["ref_close"] == pytest.approx(100.0)

    def test_breakout_held(self, monkeypatch):
        df = _frame(
            [f"{DATE}", "2026-10-02"],
            [100.0, 105.0], [101.0, 107.0], [99.0, 102.0], [100.0, 106.0],
        )
        monkeypatch.setattr(ft, "fetch_for_timeframe", lambda s, *a, **k: df)
        row = ft.evaluate_row("AAA", name="AAA", type="base_20", level=100.0,
                              ref_close=100.0, side="up", date_str=DATE)
        assert row["held"] is True
        assert row["max_adv_pct"] == pytest.approx(2.0)

    def test_breakdown_mirror(self, monkeypatch):
        # short ref 100 -> last 90 (-10% wins); low 85 (fav +15%);
        # high 102 (adv -2%); since-closes never above 100 -> held True.
        df = _frame(
            [f"{DATE}", "2026-10-02", "2026-10-03"],
            [100.0, 95.0, 91.0], [101.0, 96.0, 102.0],
            [99.0, 85.0, 89.0], [100.0, 92.0, 90.0],
        )
        monkeypatch.setattr(ft, "fetch_for_timeframe", lambda s, *a, **k: df)
        row = ft.evaluate_row("ZZZ", name="ZZZ", type="52w_low", level=100.0,
                              ref_close=100.0, side="down", date_str=DATE)
        assert row["ret_pct"] == pytest.approx(-10.0)
        assert row["max_fav_pct"] == pytest.approx(15.0)
        assert row["max_adv_pct"] == pytest.approx(-2.0)
        assert row["held"] is True

    def test_breakdown_broken(self, monkeypatch):
        df = _frame(
            [f"{DATE}", "2026-10-02"],
            [100.0, 101.0], [101.0, 103.0], [99.0, 100.5], [100.0, 101.0],
        )
        monkeypatch.setattr(ft, "fetch_for_timeframe", lambda s, *a, **k: df)
        row = ft.evaluate_row("ZZZ", name="ZZZ", type="52w_low", level=100.0,
                              ref_close=100.0, side="down", date_str=DATE)
        assert row["held"] is False

    def test_no_since_bars(self, monkeypatch):
        df = _frame([f"{DATE}"], [100.0], [101.0], [99.0], [100.0])
        monkeypatch.setattr(ft, "fetch_for_timeframe", lambda s, *a, **k: df)
        row = ft.evaluate_row("AAA", name="AAA", type="x", level=99.0,
                              ref_close=100.0, side="up", date_str=DATE)
        assert row["ret_pct"] == pytest.approx(0.0)
        assert row["max_fav_pct"] == pytest.approx(0.0)
        assert row["max_adv_pct"] == pytest.approx(0.0)
        assert row["held"] is True

    def test_unusable_frame_none(self, monkeypatch):
        monkeypatch.setattr(ft, "fetch_for_timeframe", lambda s, *a, **k: None)
        assert ft.evaluate_row("AAA", level=1.0, ref_close=1.0, date_str=DATE) is None


class TestEndpoint:
    def test_sections_sorting_winners(self, wired, monkeypatch):
        client, br_dir, _ = wired
        _write_report(br_dir / f"{DATE}_tu.json",
                      [_up_row("AAA", close=100.0), _up_row("BBB", close=100.0)],
                      [_down_row("ZZZ", close=100.0), _down_row("YYY", close=100.0)])
        frames = {
            "AAA": _frame([DATE, "2026-10-02"], [100, 112], [101, 113], [99, 111], [100, 112]),
            "BBB": _frame([DATE, "2026-10-02"], [100, 104], [101, 105], [99, 103], [100, 104]),
            "ZZZ": _frame([DATE, "2026-10-02"], [100, 92], [101, 93], [99, 91], [100, 92]),
            "YYY": _frame([DATE, "2026-10-02"], [100, 108], [101, 109], [99, 107], [100, 108]),
        }
        _fake_fetch(monkeypatch, frames)
        p = client.get(f"/api/reports/follow-through?date={DATE}&universe=tu").json()
        assert p["date"] == DATE and p["universe"] == "tu"
        assert p["partial"] is False
        up = p["breakouts"]
        assert up["count"] == 2 and up["winners"] == 2 and up["losers"] == 0
        assert [r["symbol"] for r in up["rows"]] == ["AAA", "BBB"]  # ret desc
        assert up["avg_ret"] == pytest.approx(8.0)
        dn = p["breakdowns"]
        assert dn["count"] == 2 and dn["winners"] == 1 and dn["losers"] == 1
        assert [r["symbol"] for r in dn["rows"]] == ["ZZZ", "YYY"]  # ret asc
        assert set(up["rows"][0]) == {"symbol", "name", "type", "level",
                                      "ref_close", "last_close", "ret_pct",
                                      "max_fav_pct", "max_adv_pct", "held"}

    def test_disk_cache_read_through(self, wired, monkeypatch):
        client, br_dir, ft_dir = wired
        _write_report(br_dir / f"{DATE}_tu.json", [_up_row()], [])
        df = _frame([DATE, "2026-10-02"], [100, 105], [101, 106], [99, 104], [100, 105])
        calls: list = []
        _fake_fetch(monkeypatch, {"AAA": df}, calls)
        url = f"/api/reports/follow-through?date={DATE}&universe=tu"
        first = client.get(url).json()
        assert first["cached"] is False
        assert (ft_dir / f"{DATE}_tu.json").exists()
        n = len(calls)
        second = client.get(url).json()
        assert second["cached"] is True
        assert len(calls) == n
        assert second["breakouts"]["count"] == 1

    def test_missing_report_compute_fallback(self, wired, monkeypatch):
        client, br_dir, _ = wired
        assert not (br_dir / f"{DATE}_tu.json").exists()
        seen = {}

        def _compute(date_str, universe):
            seen["args"] = (date_str, universe)
            return {"date": date_str, "universe": universe,
                    "breakouts": {"count": 1, "by_type": {},
                                  "rows": [_up_row("AAA", close=100.0)]},
                    "breakdowns": {"count": 0, "by_type": {}, "rows": []}}

        monkeypatch.setattr(br, "compute_report", _compute)
        df = _frame([DATE, "2026-10-02"], [100, 105], [101, 106], [99, 104], [100, 105])
        _fake_fetch(monkeypatch, {"AAA": df})
        p = client.get(f"/api/reports/follow-through?date={DATE}&universe=tu").json()
        assert seen["args"] == (DATE, "tu")
        assert p["breakouts"]["count"] == 1
        assert p["breakouts"]["rows"][0]["ret_pct"] == pytest.approx(5.0)

    def test_fail_soft_symbol_error(self, wired, monkeypatch):
        client, br_dir, _ = wired
        _write_report(br_dir / f"{DATE}_tu.json",
                      [_up_row("OK", close=100.0), _up_row("BAD", close=100.0)], [])
        ok = _frame([DATE, "2026-10-02"], [100, 105], [101, 106], [99, 104], [100, 105])
        _fake_fetch(monkeypatch, {"OK": ok, "BAD": RuntimeError("boom")})
        r = client.get(f"/api/reports/follow-through?date={DATE}&universe=tu")
        assert r.status_code == 200
        p = r.json()
        assert p["breakouts"]["count"] == 1
        assert p["breakouts"]["rows"][0]["symbol"] == "OK"

    def test_fail_soft_bad_date(self, wired):
        client, _, _ = wired
        r = client.get("/api/reports/follow-through?date=not-a-date")
        assert r.status_code == 200
        p = r.json()
        assert p["breakouts"]["count"] == 0 and p["breakdowns"]["count"] == 0
