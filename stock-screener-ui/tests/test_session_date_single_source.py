"""Guard: IST clock and session-date helpers have one implementation each.

The reports API clock lives in ``api/reports_api/_time.py`` (``now_ist``,
``now_iso``, ``today_str``); timestamp/index -> IST session dates live in
``chart_patterns/_ist_date.py``. Forks keep their historical private names as
aliases or thin wrappers, never a second ``datetime.now``, ``tz_convert`` or
hardcoded zone string.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[1]

FORKS: dict[str, tuple[str, ...]] = {
    "api/reports_api/fyers_ws.py": ("_now_iso",),
    "api/reports_api/chain10s.py": ("_now_ist", "_today_ist"),
    "api/reports_api/ticks.py": ("_today_ist",),
    "api/reports_api/sim.py": ("_today",),
    "api/reports_api/breadth.py": ("_now_ist",),
    "api/reports_api/options_history.py": ("_today",),
    "api/levels_api/service.py": ("_ist_date",),
    "api/chart_patterns.py": ("_ist_session_dates",),
    "chart_patterns/tail_refresh.py": (
        "_now_ist",
        "_completed_daily_only",
        "_provider_start_date",
    ),
    "trading/runner_core.py": ("_ist_now",),
}

# Calls that would re-implement a clock, a zone conversion or a date render.
LOCAL_CLOCK_CALLS = frozenset(
    {"now", "tz_convert", "tz_localize", "astimezone", "isoformat", "strftime"}
)


def _forks():
    for rel, names in FORKS.items():
        for name in names:
            yield pytest.param(rel, name, id=f"{rel}::{name}")


@pytest.mark.parametrize("rel,name", _forks())
def test_no_local_ist_clock_or_zone_in_forks(rel: str, name: str) -> None:
    tree = ast.parse((REPO / rel).read_text(encoding="utf-8"), filename=rel)
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name != name:
            continue
        for child in ast.walk(node):
            if isinstance(child, ast.Constant) and child.value == "Asia/Kolkata":
                pytest.fail(f"{rel}:{child.lineno} hardcodes the IST zone in {name}")
            if (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Attribute)
                and child.func.attr in LOCAL_CLOCK_CALLS
            ):
                pytest.fail(
                    f"{rel}:{child.lineno} re-implements {child.func.attr} in {name}"
                )


_DAILY_BAR_1830Z = pd.Timestamp("2026-01-29 18:30", tz="UTC")


def test_1830z_daily_bar_pins_to_next_ist_session() -> None:
    """18:30Z on 29 Jan is 00:00 IST on 30 Jan, not a 29 Jan session bar."""
    from api.chart_patterns import _ist_session_dates
    from api.levels_api.service import _ist_date
    from chart_patterns._ist_date import ist_session_date, ist_session_dates
    from chart_patterns.candles import frame_last_date

    assert ist_session_date(_DAILY_BAR_1830Z) == "2026-01-30"
    assert ist_session_dates(pd.DatetimeIndex([_DAILY_BAR_1830Z])) == ["2026-01-30"]
    assert _ist_session_dates(pd.DatetimeIndex([_DAILY_BAR_1830Z])) == ["2026-01-30"]
    assert _ist_date(_DAILY_BAR_1830Z) == "2026-01-30"
    frame = pd.DataFrame({"close": [1.0]}, index=pd.DatetimeIndex([_DAILY_BAR_1830Z]))
    assert frame_last_date(frame) == "2026-01-30"


def test_reports_api_forks_alias_the_canonical_clock() -> None:
    from api.reports_api import _time, breadth, chain10s, fyers_ws, options_history, sim, ticks

    assert fyers_ws._now_iso is _time.now_iso
    assert chain10s._now_ist is _time.now_ist
    assert chain10s._today_ist is _time.today_str
    assert ticks._today_ist is _time.today_str
    assert breadth._now_ist is _time.now_ist
    assert sim._today is _time.today_str
    assert options_history._today is _time.today_str
