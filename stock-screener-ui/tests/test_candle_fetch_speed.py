"""Speed/behavior guards for the 1D candle fetch (mocked, no network).

The Patterns screen hangs on the candle fetch, not detection. These tests
pin the two optimizations that keep the cold path cheap:

1. The disk cache (5-minute TTL while open, session pin when closed) means a
   repeat screen never re-hits the provider; ``force_refresh`` bypasses it.
2. The 1D live edge skips the extra 1-minute tape fetch entirely when the
   official daily frame already ends at the last completed session — while
   the 1D series must still end at that session in every case.
"""

import json
import sys
import time
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import config
from chart_patterns import candles as candles_mod
from market_data import market_data as market_data_mod
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


def _daily_history(end_exclusive: str, periods: int = 30) -> pd.DataFrame:
    end = pd.bdate_range(end=end_exclusive, periods=1)[0] - pd.offsets.BDay(1)
    idx = pd.bdate_range(end=end.date().isoformat(), periods=periods, tz="UTC")
    idx = idx.tz_convert("Asia/Kolkata").normalize().tz_convert("UTC")
    return _sane_frame(idx)


def _session_tape_1m(date_str: str, base: float = 200.0,
                     rows: int = 375) -> pd.DataFrame:
    idx = pd.date_range(f"{date_str} 09:15", periods=rows, freq="1min",
                        tz="Asia/Kolkata")
    return _sane_frame(idx, base=base)


def _make_api(history, tape_1m, intraday=None) -> MagicMock:
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


def _official_bar(date_str: str, base: float = 999.0) -> pd.DataFrame:
    idx = (pd.Timestamp(date_str).tz_localize("Asia/Kolkata")
           .normalize().tz_convert("UTC"))
    return _sane_frame(pd.DatetimeIndex([idx]), base=base)


class TestNoRefetchWithinTtl:
    def test_second_screen_hits_cache(self, tmp_path, monkeypatch):
        """Two back-to-back screens cost one provider fetch, not two."""
        monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
        monkeypatch.setattr("trading.utils.is_market_open",
                            lambda *a, **k: True)
        idx = pd.date_range("2026-09-01", periods=10, freq="D", tz="UTC")
        frame = _sane_frame(idx)
        calls: list = []

        def _fake(symbol, tf_id, **kwargs):
            calls.append((symbol, tf_id))
            return frame.copy()

        monkeypatch.setattr(market_data_mod, "fetch_candles_for_timeframe",
                            _fake)
        first = candles_mod.fetch_for_timeframe("AAA", "1D")
        second = candles_mod.fetch_for_timeframe("AAA", "1D")
        assert first is not None and second is not None
        assert len(calls) == 1
        pd.testing.assert_frame_equal(first, second)

    def test_force_refresh_bypasses_cache(self, tmp_path, monkeypatch):
        monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
        monkeypatch.setattr("trading.utils.is_market_open",
                            lambda *a, **k: True)
        idx = pd.date_range("2026-09-01", periods=10, freq="D", tz="UTC")
        calls: list = []

        def _fake(symbol, tf_id, **kwargs):
            calls.append((symbol, tf_id))
            return _sane_frame(idx)

        monkeypatch.setattr(market_data_mod, "fetch_candles_for_timeframe",
                            _fake)
        candles_mod.fetch_for_timeframe("AAA", "1D")
        candles_mod.fetch_for_timeframe("AAA", "1D", force_refresh=True)
        assert len(calls) == 2

    def test_expired_ttl_refetches(self, tmp_path, monkeypatch):
        monkeypatch.setattr(candles_mod, "CACHE_DIR", tmp_path)
        monkeypatch.setattr("trading.utils.is_market_open",
                            lambda *a, **k: True)
        idx = pd.date_range("2026-09-01", periods=10, freq="D", tz="UTC")
        calls: list = []

        def _fake(symbol, tf_id, **kwargs):
            calls.append((symbol, tf_id))
            return _sane_frame(idx)

        monkeypatch.setattr(market_data_mod, "fetch_candles_for_timeframe",
                            _fake)
        candles_mod.fetch_for_timeframe("AAA", "1D")
        path = candles_mod._cache_path("1D", "AAA")
        with open(path.with_suffix(".meta"), "w") as f:
            json.dump({"ts": time.time() - candles_mod.TODAY_TTL_SECONDS - 1,
                       "session": "2026-10-02"}, f)
        candles_mod.fetch_for_timeframe("AAA", "1D")
        assert len(calls) == 2


class TestLiveEdgeFetchesMinimalTape:
    def test_tape_skipped_when_daily_already_current(self):
        """No minutes-tape call when the frame ends at the last session."""
        last_done = candles_mod._last_completed_session().isoformat()
        history = pd.concat(
            [_daily_history(last_done), _official_bar(last_done)]
        ).sort_index()
        tape = _session_tape_1m(last_done)  # must never be consulted
        api = _make_api(history, tape, intraday=pd.DataFrame())

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60, api_client=api,
        )

        assert df is not None
        assert _ist_dates(df)[-1] == last_done
        for _, kwargs in api.fetch_historical_data_v3.call_args_list:
            assert not str(kwargs.get("unit", "")).startswith("min")

    def test_series_still_ends_at_last_completed_session(self):
        """With a real gap, the backfill closes it up to the last session."""
        last_done = candles_mod._last_completed_session()
        last_done_str = last_done.isoformat()
        today_str = datetime.now(IST).strftime("%Y-%m-%d")
        prev_biz = (pd.bdate_range(end=last_done_str, periods=3)[0]
                    .date().isoformat())
        history = _daily_history(last_done_str)
        tape = pd.concat([_session_tape_1m(prev_biz, base=200.0),
                          _session_tape_1m(last_done_str, base=210.0)])
        api = _make_api(history, tape, intraday=pd.DataFrame())

        kwargs: dict = {}
        if last_done_str == today_str:
            # After the close the last completed session IS today, which the
            # backfill leaves to the opt-in today bar — take it explicitly.
            kwargs["include_partial_today"] = True
        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60, api_client=api, **kwargs,
        )

        assert df is not None
        assert candles_mod.frame_last_date(df) == last_done_str
        assert not df.index.has_duplicates
        assert df.index.is_monotonic_increasing

    def test_today_rows_reused_from_backfill_tape(self):
        """The opt-in today bar needs no second fetch when the tape has it."""
        today = datetime.now(IST).strftime("%Y-%m-%d")
        last_done = candles_mod._last_completed_session().isoformat()
        history = _daily_history(last_done)
        tape_hist = _session_tape_1m(last_done, base=200.0)
        tape_today = _session_tape_1m(today, base=300.0).iloc[:60]
        tape = pd.concat([tape_hist, tape_today]).sort_index()
        api = _make_api(history, tape,
                        intraday=_session_tape_1m(today, base=999.0).iloc[:60])

        df = fetch_candles_for_timeframe(
            "RELIANCE", "1D", lookback_bars=60,
            include_partial_today=True, api_client=api,
        )

        assert df is not None
        assert _ist_dates(df)[-1] == today
        # Today's rows came from the shared backfill tape: the intraday
        # endpoint (base 999.0) was never consulted.
        api.fetch_intraday_data_v3.assert_not_called()
        last = df.iloc[-1]
        assert last["close"] == pytest.approx(float(tape_today["close"].iloc[-1]))
