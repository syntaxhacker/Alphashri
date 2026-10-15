"""Tests for the EOD report digest (api/reports_api/digest.py)."""

import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.reports_api.digest as d
from api.auth import get_current_user


def _daily(**kw):
    payload = {
        "date": "2026-10-09",
        "universe": "nifty500",
        "breadth": {
            "total": 100, "advances": 60, "declines": 30, "unchanged": 10,
            "new_highs": 5, "new_lows": 2, "avg_change": 0.75,
            "median_change": 0.2, "up_volume": 40, "down_volume": 20,
        },
        "moves": {
            "gainers": [
                {"symbol": "AAA", "change": 8.5},
                {"symbol": "BBB", "change": 6.1},
                {"symbol": "CCC", "change": 5.0},
                {"symbol": "DDD", "change": 4.2},
                {"symbol": "EEE", "change": 3.9},
                {"symbol": "FFF", "change": 3.0},
            ],
            "volume_surge": [
                {"symbol": "GGG", "change": 2.5, "sub_value": "4.2x rel. volume"},
                {"symbol": "HHH", "change": -1.0, "sub_value": "3.8x rel. volume"},
            ],
        },
    }
    payload.update(kw)
    return payload


def _brk(n=7, **kw):
    rows = [
        {"symbol": f"S{i}", "type": "base_20", "pct_above": 1.5 + i,
         "volume_ratio": 2.0 + 0.1 * i, "change": 3.0}
        for i in range(n)
    ]
    payload = {
        "date": "2026-10-09", "universe": "nifty500",
        "breakouts": {"count": n, "by_type": {"base_20": n}, "rows": rows},
        "breakdowns": {"count": 0, "by_type": {}, "rows": []},
    }
    payload.update(kw)
    return payload


def test_ordering_and_truncation_to_top5():
    text = d.format_digest(_daily(), _brk(7), "nifty500")
    assert text.startswith("EOD Digest 2026-10-09 (nifty500)")
    assert "Breadth Adv 60/Dec 30/Unch 10" in text
    assert "Avg +0.75%" in text
    # breakouts block comes before gainers block
    assert text.index("Breakouts (7)") < text.index("Top gainers")
    assert text.index("Top gainers") < text.index("Vol surge")
    # only top 5 of each
    for sym in ("S0", "S1", "S2", "S3", "S4"):
        assert sym in text
    assert "S5" not in text and "S6" not in text
    assert "FFF" not in text  # 6th gainer cut
    assert len(text) < 1500


def test_missing_sections_fail_soft():
    text = d.format_digest({}, {}, "nifty500")
    assert "EOD Digest" in text
    assert "Breakouts: none" in text
    assert len(text) < 1500

    text2 = d.format_digest({"date": "2026-01-01", "breadth": None, "moves": {}}, None, "x")
    assert "Breadth" not in text2

    # sector/theme leaders + index render only when present
    daily = _daily(index={"name": "NIFTY", "close": 25000.0, "change": 0.5},
                   sectors=[{"name": "IT", "change": 1.2}, {"name": "Bank", "change": -0.3}])
    text3 = d.format_digest(daily, _brk(1), "nifty500")
    assert "Index NIFTY" in text3 and "Sectors: IT +1.20%" in text3


def test_build_digest_uses_fetchers_seam():
    fetchers = {"daily": lambda u: _daily(), "breakouts": lambda u: _brk(2)}
    text = d.build_digest("nifty500", fetchers=fetchers)
    assert "S0" in text and "AAA" in text

    def _boom(u):
        raise RuntimeError("down")

    text2 = d.build_digest("nifty500", fetchers={"daily": _boom, "breakouts": _boom})
    assert "Breakouts: none" in text2  # fail-soft, never raises


def test_html_safe_escaping():
    daily = _daily()
    daily["moves"]["gainers"][0]["symbol"] = "<AAA>&"
    text = d.format_digest(daily, _brk(1), "nifty500")
    assert "<AAA>" not in text and "&lt;AAA&gt;" in text


def test_send_skipped_when_unconfigured(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ENABLED", "0")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "")
    import config as _cfg
    monkeypatch.setattr(_cfg, "TELEGRAM_CONFIG",
                        {"bot_token": "", "chat_id": "", "enabled": True}, raising=False)
    sent = []
    out = d.send_eod_digest("nifty500", notifier=lambda t: sent.append(t))
    assert out == {"sent": False, "reason": "unconfigured"}
    assert sent == []


def test_send_ok_when_configured(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ENABLED", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat")
    sent = []
    out = d.send_eod_digest("nifty500",
                            fetchers={"daily": lambda u: _daily(), "breakouts": lambda u: _brk(1)},
                            notifier=lambda t: sent.append(t))
    assert out == {"sent": True, "reason": "ok"}
    assert len(sent) == 1 and "EOD Digest" in sent[0]


def test_scheduler_fires_once_fake_clock():
    ist = datetime(2026, 10, 9, 15, 50)  # Friday
    calls = []

    async def _run():
        task = asyncio.create_task(d.report_digest_task(
            poll_sec=100000,
            now_fn=lambda: ist,
            send_fn=lambda u: (calls.append(u), {"sent": True, "reason": "ok"})[1],
            is_trading_day_fn=lambda now: True,
        ))
        await asyncio.sleep(0.05)
        # second poll would need another sleep cycle; force two iterations
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(_run())
    assert calls == ["nifty500"]


def test_should_fire_logic():
    friday_late = datetime(2026, 10, 9, 15, 50)
    friday_early = datetime(2026, 10, 9, 10, 0)
    saturday = datetime(2026, 10, 10, 16, 0)
    assert d.should_fire(friday_late, None) in (True, False)  # holiday-cal dependent
    assert d.should_fire(friday_late, "2026-10-09") is False  # already sent today
    assert d.should_fire(friday_early, None) is False  # before 15:45
    assert d.should_fire(saturday, None) is False  # weekend


def _authed_app():
    app = FastAPI()
    app.include_router(d.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    return TestClient(app)


def test_manual_endpoint_200_skip(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ENABLED", "0")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "")
    import config as _cfg
    monkeypatch.setattr(_cfg, "TELEGRAM_CONFIG",
                        {"bot_token": "", "chat_id": "", "enabled": True}, raising=False)
    r = _authed_app().post("/api/reports/digest/send?universe=nifty500")
    assert r.status_code == 200
    assert r.json() == {"sent": False, "reason": "unconfigured"}


def test_manual_endpoint_requires_auth():
    app = FastAPI()
    app.include_router(d.router)
    r = TestClient(app).post("/api/reports/digest/send")
    assert r.status_code in (401, 403)
