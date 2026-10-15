"""Tests for the optional Telegram bridge (formatting + status; no send)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import notify  # noqa: E402


def test_money_formats():
    assert notify._money(250000) == "$+250K"
    assert notify._money(1250000) == "$+1.2M"
    assert notify._money(2000000000) == "$+2.00B"
    assert notify._money("bad") == "?"


def test_format_live_alert_fields():
    s = notify.format_live_alert(
        {"kind": "flow", "ticker": "NVDA", "type": "call", "strike": 200, "expiry": "2026-10-16",
         "premium": 1250000, "sweep": True, "side": "bullish", "rule": "RepeatedHits"}
    )
    assert "NVDA" in s
    assert "FLOW" in s
    assert "CALL" in s
    assert "200" in s
    assert "SWEEP" in s
    assert "RepeatedHits" in s


def test_format_darkpool_without_strike():
    s = notify.format_live_alert({"kind": "darkpool", "ticker": "META", "premium": 287163, "side": "ext"})
    assert "DARK POOL" in s and "META" in s


def test_status_shape_is_safe():
    st = notify.telegram_status()
    assert isinstance(st.get("configured"), bool)
    assert "error" in st
