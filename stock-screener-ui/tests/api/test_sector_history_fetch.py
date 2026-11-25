"""Sector-history data-fetch tests (api.market_history / sector_universe).

Covers canonical descriptor keys, client/instrument-map ordering, per-symbol
isolation, minimum rows + yfinance fallback, bounded concurrency, single-flight,
the 10Y window cap and explicit yfinance adjustment semantics.
"""

import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import api.market_history as market_history  # noqa: E402
from api.sector_universe import (  # noqa: E402
    BENCHMARK_BY_MARKET,
    NIFTY_SECTOR_INDICES,
    US_SECTOR_ETFS,
)
from config import IST  # noqa: E402


def _daily_frame(periods: int = 20, base: float = 100.0) -> pd.DataFrame:
    index = pd.date_range("2024-01-01", periods=periods, freq="B")
    close = np.linspace(base, base + periods, periods)
    return pd.DataFrame({"close": close}, index=index)


def _reset_memo():
    market_history.clear_market_history_memo()


# ===== Universe descriptors =====

class TestSectorUniverse:

    def test_benchmark_is_explicit_not_list_order(self):
        assert BENCHMARK_BY_MARKET["india"] == "NIFTY 50"
        assert BENCHMARK_BY_MARKET["america"] == "SPY"

    def test_canonical_upstox_keys_for_alias_names(self):
        keys = dict(NIFTY_SECTOR_INDICES)

        assert keys["NIFTY FIN_SERVICE"] == "NSE_INDEX|Nifty Fin Service"
        assert keys["NIFTY CONSUMPTION"] == "NSE_INDEX|Nifty Consumption"

    def test_legacy_tuple_shapes(self):
        assert all(len(pair) == 2 for pair in NIFTY_SECTOR_INDICES)
        assert all(len(pair) == 2 for pair in US_SECTOR_ETFS)
        assert US_SECTOR_ETFS[0] == ("SPY", "SPY")


# ===== Fetch orchestration =====

class TestMarketHistoryFetch:

    async def test_client_built_before_instrument_map(self, monkeypatch):
        order = []

        monkeypatch.setattr(
            market_history,
            "build_upstox_client",
            lambda: order.append("client") or object(),
        )
        monkeypatch.setattr(
            market_history,
            "_get_instrument_key_map",
            lambda: order.append("map") or {},
        )

        async def fake_upstox(api, key, start, end):
            return _daily_frame()

        async def fake_yfinance(symbol, start, end):
            return None

        monkeypatch.setattr(market_history, "_fetch_upstox_index_data", fake_upstox)
        monkeypatch.setattr(market_history, "_fetch_yfinance_history", fake_yfinance)
        _reset_memo()

        data = await market_history.fetch_market_history("india", 1, force=True)

        assert order == ["client", "map"]
        assert len(data) == len(NIFTY_SECTOR_INDICES)
        assert set(data.sources.values()) == {"upstox"}

    async def test_upstox_uses_to_from_order_and_parses_seventh_column(
        self, monkeypatch
    ):
        captured = {}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                rows = [
                    ["2024-01-01T00:00:00+05:30", 100, 101, 99, 100.5, 10, 0],
                    ["2024-01-02T00:00:00+05:30", 100, 102, 99, 101.5, 11, 0],
                ]
                return {"status": "success", "data": {"candles": rows}}

        def fake_get(url, headers, timeout):
            captured["url"] = url
            return FakeResponse()

        class FakeApi:
            def _get_headers(self):
                return {"Authorization": "Bearer test"}

        monkeypatch.setattr(market_history.requests, "get", fake_get)
        start = date(2015, 1, 1)
        end = date(2025, 1, 1)

        frame = await market_history._fetch_upstox_index_data(
            FakeApi(), "NSE_INDEX|Nifty 50", start, end
        )

        assert frame is not None
        assert frame["close"].tolist() == [100.5, 101.5]
        # V3 path order is .../<to_date>/<from_date>.
        assert captured["url"].endswith("/2025-01-01/2015-01-01")

    async def test_prefers_descriptor_key_and_yfinance_fallback(self, monkeypatch):
        seen_keys = []

        async def fake_upstox(api, key, start, end):
            seen_keys.append(key)
            # Simulate the old alias bug: only consumption works via Upstox.
            if key == "NSE_INDEX|Nifty Consumption":
                return _daily_frame()
            return None

        async def fake_yfinance(symbol, start, end):
            if symbol == "^CNXFIN":
                return _daily_frame()
            return None

        monkeypatch.setattr(
            market_history, "build_upstox_client", lambda: object()
        )
        monkeypatch.setattr(
            market_history,
            "_get_instrument_key_map",
            lambda: {
                # Legacy/wrong aliases must not override the descriptor key.
                "NIFTY FIN SERVICE": "NSE_INDEX|Nifty Financial Services",
                "NIFTY CONSUMPTION": "NSE_INDEX|Nifty Old Consumption",
            },
        )
        monkeypatch.setattr(market_history, "_fetch_upstox_index_data", fake_upstox)
        monkeypatch.setattr(market_history, "_fetch_yfinance_history", fake_yfinance)
        _reset_memo()

        data = await market_history.fetch_market_history("india", 1, force=True)

        assert "NSE_INDEX|Nifty Fin Service" in seen_keys
        assert "NSE_INDEX|Nifty Financial Services" not in seen_keys
        assert "NSE_INDEX|Nifty Consumption" in seen_keys
        assert data.sources["NIFTY CONSUMPTION"] == "upstox"
        assert data.sources["NIFTY FIN_SERVICE"] == "yfinance"

    async def test_india_short_upstox_rows_fall_back_to_yfinance(
        self, monkeypatch
    ):
        async def fake_upstox(api, key, start, end):
            return _daily_frame(periods=3)

        async def fake_yfinance(symbol, start, end):
            return _daily_frame(periods=20)

        monkeypatch.setattr(
            market_history, "build_upstox_client", lambda: object()
        )
        monkeypatch.setattr(
            market_history, "_get_instrument_key_map", lambda: {}
        )
        monkeypatch.setattr(market_history, "_fetch_upstox_index_data", fake_upstox)
        monkeypatch.setattr(market_history, "_fetch_yfinance_history", fake_yfinance)
        _reset_memo()

        data = await market_history.fetch_market_history("india", 1, force=True)

        assert len(data) == len(NIFTY_SECTOR_INDICES)
        assert set(data.sources.values()) == {"yfinance"}

    async def test_one_symbol_failure_does_not_abort_market(self, monkeypatch):
        async def fake_yfinance(symbol, start, end):
            if symbol == "XLF":
                raise RuntimeError("upstream down")
            if symbol == "XLK":
                return _daily_frame(periods=market_history.MIN_DAILY_ROWS - 1)
            return _daily_frame()

        monkeypatch.setattr(market_history, "_fetch_yfinance_history", fake_yfinance)
        _reset_memo()

        data = await market_history.fetch_market_history("america", 1, force=True)

        assert len(data) == len(US_SECTOR_ETFS) - 2
        assert "XLF" not in data
        assert "XLK" not in data
        assert "SPY" in data
        assert all(source == "yfinance" for source in data.sources.values())

    async def test_bounded_concurrency_for_eleven_calls(self, monkeypatch):
        active = 0
        peak = 0
        state_lock = asyncio.Lock()

        async def fake_yfinance(symbol, start, end):
            nonlocal active, peak
            async with state_lock:
                active += 1
                peak = max(peak, active)
            await asyncio.sleep(0.01)
            async with state_lock:
                active -= 1
            return _daily_frame()

        monkeypatch.setattr(market_history, "_fetch_yfinance_history", fake_yfinance)
        _reset_memo()

        data = await market_history.fetch_market_history("america", 1, force=True)

        assert len(data) == len(US_SECTOR_ETFS)
        assert peak <= market_history.MAX_FETCH_CONCURRENCY

    async def test_concurrent_cold_calls_single_flight(self, monkeypatch):
        calls = 0

        async def fake_yfinance(symbol, start, end):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)
            return _daily_frame()

        monkeypatch.setattr(market_history, "_fetch_yfinance_history", fake_yfinance)
        _reset_memo()

        first, second = await asyncio.gather(
            market_history.fetch_market_history("america", 2),
            market_history.fetch_market_history("america", 2),
        )

        assert len(first) == len(second) == len(US_SECTOR_ETFS)
        assert calls == len(US_SECTOR_ETFS)
        assert first is second

    async def test_window_cap_is_3650_days_and_computed_once(self, monkeypatch):
        spans = set()
        ends = []

        async def fake_yfinance(symbol, start, end):
            spans.add((end - start).days)
            ends.append(end)
            return _daily_frame()

        monkeypatch.setattr(market_history, "_fetch_yfinance_history", fake_yfinance)
        _reset_memo()

        before = datetime.now(IST).date()
        await market_history.fetch_market_history("america", 10, force=True)
        after = datetime.now(IST).date()

        assert spans == {3650}
        assert len(set(ends)) == 1
        assert before <= ends[0] <= after
        capped_start, capped_end = market_history.window_bounds(20)
        assert (capped_end - capped_start).days == 3650

    async def test_yfinance_sets_auto_adjust_explicitly(self, monkeypatch):
        captured = {}

        class FakeTicker:
            def __init__(self, symbol):
                captured["symbol"] = symbol

            def history(self, **kwargs):
                captured["history"] = kwargs
                index = pd.date_range("2024-01-01", periods=10, freq="B")
                return pd.DataFrame({"Close": np.arange(100.0, 110.0)}, index=index)

        monkeypatch.setattr("yfinance.Ticker", FakeTicker)
        start = datetime(2024, 1, 1).date()
        end = datetime(2024, 2, 1).date()

        frame = await market_history._fetch_yfinance_history("SPY", start, end)

        assert frame is not None and len(frame) == 10
        assert captured["symbol"] == "SPY"
        assert captured["history"]["interval"] == "1d"
        assert captured["history"]["auto_adjust"] is True
        assert captured["history"]["start"] == start.isoformat()
        assert captured["history"]["end"] == end.isoformat()
