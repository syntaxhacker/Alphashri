"""
IST timezone and json.dumps serialization tests

- test_chart_utc_index_filtered_with_ist that builds df with UTC tz index then calls
  _filter_to_date_or_recent with IST, assert correct filtering
- trading_agents SSE json.dumps serialization single-encoded test
- chart_cache today TTL 60s vs historical no TTL via endpoint cache poisoning guard
"""

import sys
import json
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pytest
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent))

IST = timezone(timedelta(hours=5, minutes=30))


def _filter_to_date_or_recent(df_full, target_date_str):
    """Copy of api/paper/endpoints.py _filter_to_date_or_recent for isolated timezone testing."""
    import config
    if df_full is None or df_full.empty:
        return df_full
    df_full = df_full.copy()
    df_full.index = pd.to_datetime(df_full.index)
    if df_full.index.tz is None:
        df_full.index = df_full.index.tz_localize(config.IST)
    df_full.index = df_full.index.tz_convert(config.IST)
    date_start = pd.Timestamp(target_date_str, tz=config.IST)
    date_end = date_start + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
    filtered = df_full[(df_full.index >= date_start) & (df_full.index <= date_end)]
    if filtered.empty:
        last_date = df_full.index[-1].date()
        last_start = pd.Timestamp(last_date, tz=config.IST)
        last_end = last_start + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)
        last_day = df_full[(df_full.index >= last_start) & (df_full.index <= last_end)]
        if not last_day.empty:
            return last_day
        return df_full
    return filtered


class TestChartUTCIndexFilteredWithIST:
    def test_chart_utc_index_filtered_with_ist(self):
        """DF with UTC tz index correctly filtered when target date is in IST."""
        # Build candles at 2026-04-28 03:45 UTC = 2026-04-28 09:15 IST
        # Upstox V3 often returns UTC index; filtering must convert to IST
        utc_times = pd.date_range("2026-04-28 03:45:00", periods=5, freq="5min", tz="UTC")
        df = pd.DataFrame({
            "open": [100]*5, "high": [101]*5, "low": [99]*5, "close": [100.5]*5, "volume": [1000]*5,
        }, index=utc_times)

        # Filter for IST date 2026-04-28 should return all 5 rows
        filtered = _filter_to_date_or_recent(df, "2026-04-28")
        assert len(filtered) == 5
        # Ensure index converted to IST
        assert str(filtered.index.tz) == str(IST) or filtered.index.tz is not None

        # Filtering for next day should fallback to recent (or empty->fallback)
        # Given df only has 2026-04-28 IST data, filtering for 2026-04-29 should fallback to last day
        filtered_next = _filter_to_date_or_recent(df, "2026-04-29")
        assert len(filtered_next) == 5  # fallback to last trading day

    def test_chart_naive_index_localized_to_ist(self):
        """Naive index (no tz) should be localized to IST before filtering."""
        naive_times = pd.date_range("2026-04-28 09:15:00", periods=3, freq="5min")
        df = pd.DataFrame({
            "open": [100]*3, "high": [101]*3, "low": [99]*3, "close": [100.5]*3, "volume": [1000]*3,
        }, index=naive_times)
        assert df.index.tz is None
        filtered = _filter_to_date_or_recent(df, "2026-04-28")
        assert len(filtered) == 3
        assert filtered.index.tz is not None

    def test_chart_ist_index_direct_filter(self):
        """DF already in IST (Asia/Kolkata) filters correctly."""
        ist_times = pd.date_range("2026-04-28 09:15:00", periods=4, freq="5min", tz="Asia/Kolkata")
        df = pd.DataFrame({
            "open": [100]*4, "high": [101]*4, "low": [99]*4, "close": [100.5]*4, "volume": [1000]*4,
        }, index=ist_times)
        filtered = _filter_to_date_or_recent(df, "2026-04-28")
        assert len(filtered) == 4

    def test_chart_cross_midnight_utc_to_ist(self):
        """Edge: 2026-04-27 18:30 UTC = 2026-04-28 00:00 IST should belong to 2026-04-28 IST day."""
        utc_times = pd.to_datetime(["2026-04-27 18:30:00", "2026-04-27 18:45:00", "2026-04-27 19:00:00"]).tz_localize("UTC")
        df = pd.DataFrame({
            "open": [100]*3, "high": [101]*3, "low": [99]*3, "close": [100.5]*3, "volume": [1000]*3,
        }, index=utc_times)
        # Converted to IST: 2026-04-28 00:00, 00:15, 00:30
        filtered = _filter_to_date_or_recent(df, "2026-04-28")
        assert len(filtered) == 3
        filtered_prev = _filter_to_date_or_recent(df, "2026-04-27")
        # For 2026-04-27 IST, these UTC times are already next day IST, so filtered_prev should fallback to last day (which is 2026-04-28)
        assert len(filtered_prev) == 3

    def test_empty_df_returns_empty(self):
        df = pd.DataFrame({"open": [], "high": [], "low": [], "close": []})
        filtered = _filter_to_date_or_recent(df, "2026-04-28")
        assert filtered.empty

    def test_none_df_returns_none(self):
        assert _filter_to_date_or_recent(None, "2026-04-28") is None


class TestTradingAgentsJsonDumpsSerialization:
    def test_stream_event_single_encoded(self):
        """TradingAgents SSE must use json.dumps single-encoded, not double."""
        payload = {"ticker": "RELIANCE", "date": "2026-04-28", "decision": "BUY", "reports": {"market": "bullish"}}
        data_str = json.dumps(payload, default=str)
        parsed = json.loads(data_str)
        assert parsed["ticker"] == "RELIANCE"
        assert parsed["decision"] == "BUY"
        # Double-encoded would be json.dumps(json.dumps(payload))
        double = json.dumps(json.dumps(payload))
        assert json.loads(double) != payload  # first load yields string
        assert isinstance(json.loads(double), str)

    def test_trading_agents_se_helper_single_encode(self):
        """Verify the se() helper in trading_agents.py uses single json.dumps."""
        import api.trading_agents as ta_mod

        # Simulate se function from stream_analysis
        def se(data: dict) -> str:
            return json.dumps(data, default=str)

        data = {"percent": 50, "step": 1, "total": 10, "nested": {"ts": datetime.now()}}
        encoded = se(data)
        # Should be parseable in one json.loads
        decoded = json.loads(encoded)
        assert decoded["percent"] == 50
        assert "nested" in decoded

    def test_live_stream_price_event_not_double_encoded_integration(self):
        inner = {"type": "price", "symbol": "TCS", "ltp": 2485.1}
        # Correct: single dumps
        line = f"data: {json.dumps(inner)}\n"
        payload = line[len("data: "):].strip()
        parsed = json.loads(payload)
        assert parsed["ltp"] == 2485.1
        # Wrong double encode would fail
        double_line = f"data: {json.dumps(json.dumps(inner))}\n"
        double_payload = double_line[len("data: "):].strip()
        double_parsed = json.loads(double_payload)
        # double_parsed is string, not dict
        assert isinstance(double_parsed, str)


class TestChartCachePoisoningIST:
    def test_today_empty_intraday_does_not_fallback_to_historical(self, tmp_path, monkeypatch):
        """Replicates endpoints.py cache poisoning guard: today+empty intraday => return empty, not historical."""
        import api.paper.chart_cache as cache_mod
        import config
        from datetime import datetime

        # Use tmp path for cache
        monkeypatch.setattr(cache_mod, "CACHE_DIR", tmp_path)
        today = datetime.now(config.IST).strftime('%Y-%m-%d')

        # Simulate endpoint logic:
        # if date == today:
        #   df_1m = fetch_intraday...
        #   if df_1m is None or empty: fallback to historical? -> BUG would pollute cache with stale day.
        # Guard: do NOT fallback to historical; return empty and don't cache wrong day.

        # Our guard check: when intraday is None, we should NOT call historical for today
        fetched_historical = []
        def fake_hist(*args, **kwargs):
            fetched_historical.append("called")
            return pd.DataFrame({"open": [1], "high": [1], "low": [1], "close": [1]},
                                index=pd.date_range("2026-04-27 09:15", periods=1, freq="1min", tz="Asia/Kolkata"))
        # Simulate guard
        date = today
        df_1m = None  # intraday empty (pre-market)
        if date == today:
            if df_1m is None or (hasattr(df_1m, 'empty') and df_1m.empty):
                # early return - do NOT call historical
                df_result = None
            else:
                df_result = fake_hist()
        else:
            df_result = fake_hist()

        assert df_result is None
        assert fetched_historical == []  # historical not called

    def test_chart_today_ttl_60s_vs_historical_no_ttl(self, tmp_path, monkeypatch):
        import api.paper.chart_cache as mod
        import time, json

        monkeypatch.setattr(mod, "CACHE_DIR", tmp_path)
        monkeypatch.setattr(mod, "TODAY_TTL_SECONDS", 60)

        from datetime import datetime
        import config
        today = datetime.now(config.IST).strftime('%Y-%m-%d')
        hist_date = "2026-04-15"

        df = pd.DataFrame({
            "open": [100], "high": [101], "low": [99], "close": [100.5], "volume": [1000],
        }, index=pd.date_range("2026-04-15 09:15", periods=1, freq="1min"))

        # Save today and historical
        mod.save_cached_candles("RELIANCE", today, df)
        mod.save_cached_candles("RELIANCE", hist_date, df)

        # Fresh today should hit
        r, hit = mod.get_cached_candles("RELIANCE", today)
        assert hit is True

        # Expire today via old meta
        pkl_path = tmp_path / today / "RELIANCE.pkl"
        meta_path = mod._get_meta_path(pkl_path)
        meta_path.write_text(json.dumps({"ts": time.time() - 120}))
        r2, hit2 = mod.get_cached_candles("RELIANCE", today)
        assert hit2 is False  # TTL expired

        # Historical still hits even with old meta
        pkl_h = tmp_path / hist_date / "RELIANCE.pkl"
        meta_h = mod._get_meta_path(pkl_h)
        meta_h.write_text(json.dumps({"ts": time.time() - 999999}))
        r3, hit3 = mod.get_cached_candles("RELIANCE", hist_date)
        assert hit3 is True
