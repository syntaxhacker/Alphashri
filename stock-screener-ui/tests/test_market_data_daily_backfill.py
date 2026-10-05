"""Tests for the 1D completed-session backfill (mocked, no network).

Root cause (live-verified 2026-10-06): the official Upstox daily endpoint
lags the minute tape by >= 1 session — a raw ``days/1`` fetch for RELIANCE
ended 2026-10-01 while the ``minutes/1`` tape had the completed Oct 5 session
through 15:29. ``_synthetic_today_bar`` only covers the *current* session
(and adds nothing pre-market), so every 1D scan/watch ran on stale data.

``fetch_candles_for_timeframe("1D")`` must therefore top up missing
*completed* sessions from the recent 1-minute tape — on the default
(``include_partial_today=False``) scan path too — while today's in-progress
session stays opt-in.
"""

import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import config
from market_data.market_data import fetch_candles_for_timeframe

IST = config.IST


def _sane_frame(index: pd.DatetimeIndex, base: float = 100.0) -> pd.DataFrame:
    n = len(index)
    opens = [base + i * 0.1 for i in range(n)]
    closes = [o + 0.05 for o in opens]
    return pd.DataFrame(
        {
            "open": opens,
            "high": [max(o, c) + 0.1 for o, c in zip(opens, closes)],
            "low": [min(o, c) - 0.1 for o, c in zip(opens, closes)],
            "close": closes,
            "volume": [1000.0 + i for i in range(n)],
            "oi": [0.0] * n,
        },
        index=index,
    )


def _recent_business_days(count: int) -> list[str]:
    """Last ``count`` business-day dates strictly before today (IST)."""
    today = datetime.now(IST).date()
    biz = pd.bdate_range(end=today.isoformat(), periods=count + 8)
    past = [d.date().isoformat() for d in biz if d.date() < today]
    return past[-count:]


def _daily_history(end_exclusive: str, periods: int = 30) -> pd.DataFrame:
    """Official-style daily bars (IST midnight index) before ``end_exclusive``."""
    end = pd.bdate_range(end=end_exclusive, periods=1)[0] - pd.offsets.BDay(1)
    idx = pd.bdate_range(end=end.date().isoformat(), periods=periods, tz="UTC")
    idx = idx.tz_convert("Asia/Kolkata").normalize().tz_convert("UTC")
    return _sane_frame(idx)


def _session_tape_1m(date_str: str, base: float = 200.0) -> pd.DataFrame:
    """One full NSE session (09:15-15:29 IST) of 1-minute bars."""
    idx = pd.date_range(f"{date_str} 09:15", periods=375, freq="1min",
                        tz="Asia/Kolkata")
    return _sane_frame(idx, base=base)


def _make_api(history: pd.DataFrame, tape_1m: pd.DataFrame,
              intraday=None) -> MagicMock:
    """Provider mock dispatching on the requested unit (days vs minutes)."""
    api = MagicMock(name="provider_client")

    def _hist(*args, **kwargs):
        if str(kwargs.get("unit", "")).startswith("min"):
            return tape_1m
        return history

    api.fetch_historical_data_v3.side_effect = _hist
    api.fetch_intraday_data_v3.return_value = intraday
    return api


def _ist_dates(df: pd.DataFrame) -> list[str]:
    return sorted(
        set(df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d"))
    )


class TestBackfillsMissingCompletedSessions:
    def test_scan_path_returns_completed_bar_without_flag(self):
        """The whole point: flag off, completed session still present."""
        missing = _recent_business_days(2)
        history = _daily_history(missing[0])
        tape = pd.concat([_session_tape_1m(d, base=200.0 + 10 * i)
                          for i, d in enumerate(missing)])
        api = _make_api(history, tape, intraday=pd.DataFrame())

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60, api_client=api,
        )

        assert df is not None
        assert len(df) == len(history) + len(missing)
        assert _ist_dates(df)[-len(missing):] == missing
        # Backfilled bars are ordinary completed bars, never partial.
        assert not getattr(df, "attrs", {}).get("partial_today", False)
        # OHLCV aggregation of the session tape.
        first = tape[tape.index.tz_convert("Asia/Kolkata")
                     .strftime("%Y-%m-%d") == missing[0]]
        last_bar = df[df.index.tz_convert("Asia/Kolkata")
                      .strftime("%Y-%m-%d") == missing[0]].iloc[0]
        assert last_bar["open"] == pytest.approx(float(first["open"].iloc[0]))
        assert last_bar["high"] == pytest.approx(float(first["high"].max()))
        assert last_bar["low"] == pytest.approx(float(first["low"].min()))
        assert last_bar["close"] == pytest.approx(float(first["close"].iloc[-1]))
        assert last_bar["volume"] == pytest.approx(float(first["volume"].sum()))
        assert df.index.is_monotonic_increasing
        assert not df.index.has_duplicates

    def test_official_bar_wins_no_duplicate(self):
        missing = _recent_business_days(2)
        history = _daily_history(missing[0])
        # Official frame already caught up through the first missing session.
        official_idx = (pd.Timestamp(missing[0]).tz_localize("Asia/Kolkata")
                        .normalize().tz_convert("UTC"))
        official = _sane_frame(pd.DatetimeIndex([official_idx]), base=999.0)
        history = pd.concat([history, official]).sort_index()
        tape = pd.concat([_session_tape_1m(d) for d in missing])
        api = _make_api(history, tape, intraday=pd.DataFrame())

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60, api_client=api,
        )

        assert df is not None
        # Only the still-missing session is added; the official bar is kept.
        assert len(df) == len(history) + 1
        kept = df[df.index.tz_convert("Asia/Kolkata")
                  .strftime("%Y-%m-%d") == missing[0]].iloc[0]
        assert kept["open"] == pytest.approx(999.0)

    def test_historical_pin_never_consults_minutes_tape(self):
        missing = _recent_business_days(2)
        history = _daily_history(missing[0])
        tape = pd.concat([_session_tape_1m(d) for d in missing])
        api = _make_api(history, tape, intraday=pd.DataFrame())

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", from_date="2026-01-05", to_date="2026-03-06",
            api_client=api,
        )

        assert df is not None
        assert len(df) == len(history)
        for _, kwargs in api.fetch_historical_data_v3.call_args_list:
            assert not str(kwargs.get("unit", "")).startswith("min")

    def test_stale_tape_sessions_are_ignored(self):
        """A tape from months ago must not synthesize history (guards mocks)."""
        history = _daily_history("2026-04-10", periods=30)
        tape = _session_tape_1m("2026-04-09")  # months before real today
        api = _make_api(history, tape, intraday=pd.DataFrame())

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60, api_client=api,
        )

        assert df is not None
        assert len(df) == len(history)


class TestTodaySessionStaysOptIn:
    def _today_tapes(self):
        missing = _recent_business_days(2)
        today = datetime.now(IST).strftime("%Y-%m-%d")
        history = _daily_history(missing[0])
        tape_hist = pd.concat([_session_tape_1m(d) for d in missing])
        # Today's in-progress tape lives on both legs (as in a live session).
        tape_today = _session_tape_1m(today, base=300.0).iloc[:60]
        tape_hist = pd.concat([tape_hist, tape_today]).sort_index()
        return missing, today, history, tape_hist, tape_today

    def test_today_absent_without_flag(self):
        missing, today, history, tape_hist, _ = self._today_tapes()
        api = _make_api(history, tape_hist,
                        intraday=pd.DataFrame())  # pre-market: no tape

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60, api_client=api,
        )

        assert df is not None
        assert today not in _ist_dates(df)
        assert _ist_dates(df)[-len(missing):] == missing

    def test_today_present_with_flag(self):
        missing, today, history, tape_hist, tape_today = self._today_tapes()
        api = _make_api(history, tape_hist, intraday=tape_today)

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60,
            include_partial_today=True, api_client=api,
        )

        assert df is not None
        assert _ist_dates(df)[-1] == today
        assert _ist_dates(df)[-len(missing) - 1:-1] == missing
        last = df.iloc[-1]
        assert last["close"] == pytest.approx(float(tape_today["close"].iloc[-1]))


class TestScanPathEndToEnd:
    def test_fetch_for_timeframe_caches_backfilled_bar(self, tmp_path,
                                                        monkeypatch):
        """Scan path (no flag): completed bar returned AND cached."""
        from chart_patterns import candles as candles_mod

        monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
        missing = _recent_business_days(2)
        history = _daily_history(missing[0])
        tape = pd.concat([_session_tape_1m(d) for d in missing])
        api = _make_api(history, tape, intraday=pd.DataFrame())

        got = candles_mod.fetch_for_timeframe("AAA", "1D", api_client=api)

        assert got is not None
        assert _ist_dates(got)[-len(missing):] == missing
        assert not getattr(got, "attrs", {}).get("partial_today", False)
        reread = candles_mod._read_cached(
            candles_mod._cache_path("1D", "AAA"), is_today=True
        )
        assert reread is not None
        assert _ist_dates(reread)[-len(missing):] == missing
