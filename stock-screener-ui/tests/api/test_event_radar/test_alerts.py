"""Alert tests — formatting, the 20-line cap, suppression, and swallowed failures.

Telegram is always faked: ``send_alert`` is imported lazily inside the alert
functions, so patching the attribute on ``trading.telegram_notifier`` is enough
and nothing here can reach the network.
"""

from __future__ import annotations

import datetime as dt

import pytest

from api.event_radar.alerts import (
    MAX_DIGEST_LINES,
    format_anomaly,
    format_event_line,
    send_anomaly,
    send_daily_digest,
)
from api.event_radar.contract import Anomaly, Event

TODAY = dt.date(2026, 10, 28)


class Recorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def __call__(self, text, cooldown_key=None):
        self.calls.append({"text": text, "cooldown_key": cooldown_key})

    @property
    def last_text(self) -> str:
        return self.calls[-1]["text"]


@pytest.fixture
def telegram(monkeypatch) -> Recorder:
    recorder = Recorder()
    monkeypatch.setattr("trading.telegram_notifier.send_alert", recorder)
    return recorder


def _ev(
    *,
    symbol: str = "ORCL",
    event_date: str = "2026-10-31",
    source: str = "edgar",
    title: str = "Oracle Investor Day",
    announced_at: str | None = "2026-10-23",
) -> Event:
    return Event(
        id=f"{source}:{symbol.lower()}-{event_date}",
        symbol=symbol,
        event_type="investor_day",
        title=title,
        event_date=event_date,
        source=source,  # type: ignore[arg-type]
        announced_at=announced_at,
        confidence=0.6,
    )


def _an(**kwargs) -> Anomaly:
    payload = {
        "symbol": "ORCL",
        "ts": "2026-10-28T14:19:00-04:00",
        "price": 131.27,
        "ret_pct": 1.23,
        "ret_sigma": 24.49,
        "vol_ratio": 56.55,
        "has_known_event": False,
        "suspected": "volume 56.6x, 24.5 sigma",
    }
    payload.update(kwargs)
    return Anomaly(**payload)


class TestFormatEventLine:
    def test_future_event(self):
        line = format_event_line(_ev(), TODAY)
        assert line == (
            "📅 Oracle Investor Day in 3d (2026-10-31) · edgar · announced 2026-10-23"
        )

    def test_today_and_past(self):
        assert "today (2026-10-28)" in format_event_line(
            _ev(event_date="2026-10-28"), TODAY
        )
        assert "2d ago (2026-10-26)" in format_event_line(
            _ev(event_date="2026-10-26"), TODAY
        )

    def test_missing_announced_at_is_omitted(self):
        assert "announced" not in format_event_line(_ev(announced_at=None), TODAY)

    def test_defaults_to_the_real_clock(self):
        line = format_event_line(_ev(event_date="2026-10-31"))
        assert line.startswith("📅 Oracle Investor Day")


class TestDigest:
    def test_empty_calendar_sends_nothing(self, telegram):
        assert send_daily_digest([], TODAY) == 0
        assert telegram.calls == []

    def test_one_message_with_the_cooldown_key(self, telegram):
        included = send_daily_digest([_ev()], TODAY)

        assert included == 1
        assert len(telegram.calls) == 1
        assert telegram.calls[0]["cooldown_key"] == "event-radar-digest"
        text = telegram.last_text
        assert text.splitlines()[0] == "📅 Event Radar — 2026-10-28"
        assert "Oracle Investor Day in 3d" in text

    def test_twenty_line_cap_with_a_tail(self, telegram):
        events = [_ev(symbol=f"S{index:02d}", event_date="2026-10-31") for index in range(25)]

        included = send_daily_digest(events, TODAY)
        lines = telegram.last_text.splitlines()

        assert len(lines) == MAX_DIGEST_LINES
        assert included == 18  # 1 header + 18 events + 1 tail = 20 lines
        assert lines[-1] == "+7 more"
        assert len(lines[1:-1]) == included

    def test_exactly_at_the_cap_has_no_tail(self, telegram):
        events = [_ev(symbol=f"S{index:02d}") for index in range(MAX_DIGEST_LINES - 1)]
        assert send_daily_digest(events, TODAY) == MAX_DIGEST_LINES - 1
        assert "more" not in telegram.last_text

    def test_caller_sequence_is_not_mutated(self, telegram):
        events = [_ev(event_date="2026-10-30"), _ev(symbol="MSFT", event_date="2026-10-31")]
        snapshot = list(events)
        send_daily_digest(events, TODAY)
        assert events == snapshot

    def test_delivery_failure_returns_zero(self, monkeypatch):
        def boom(text, cooldown_key=None):
            raise RuntimeError("telegram down")

        monkeypatch.setattr("trading.telegram_notifier.send_alert", boom)
        assert send_daily_digest([_ev()], TODAY) == 0

    def test_missing_telegram_module_is_swallowed(self, monkeypatch):
        import builtins

        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "trading.telegram_notifier":
                raise ImportError("no notifier")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", fake_import)
        assert send_daily_digest([_ev()], TODAY) == 0


class TestAnomalyAlert:
    def test_sends_when_unexplained(self, telegram):
        assert send_anomaly(_an()) is True
        assert len(telegram.calls) == 1
        assert telegram.calls[0]["cooldown_key"] == "event-radar-anomaly-ORCL"
        text = telegram.last_text
        assert "⚡ ORCL +1.23% in 1m" in text
        assert "24.5σ" in text
        assert "56.5x vol" in text
        assert "14:19:00-04:00" in text

    def test_suppressed_when_the_calendar_explains_it(self, telegram):
        assert send_anomaly(_an(has_known_event=True)) is False
        assert telegram.calls == []

    def test_failure_is_swallowed(self, monkeypatch):
        def boom(text, cooldown_key=None):
            raise RuntimeError("telegram down")

        monkeypatch.setattr("trading.telegram_notifier.send_alert", boom)
        assert send_anomaly(_an()) is False

    def test_format_anomaly_without_a_hint(self):
        text = format_anomaly(_an(suspected=None))
        assert text.splitlines() == [
            "⚡ ORCL +1.23% in 1m (+24.5σ, 56.5x vol)",
            "2026-10-28T14:19:00-04:00 @ 131.27",
        ]
