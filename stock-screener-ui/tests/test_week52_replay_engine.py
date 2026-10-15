"""Tests for the week52-chaser replay engine (NSE daily swing).

Offline: the engine's ``fetch_candles`` data source is patched, so no network.
"""

from unittest.mock import patch

import pandas as pd
import pytest

import api.poc_nq as poc_nq
from api.poc_nq import get_replay
from trading.replay import registry
from trading.replay.contract import ReplayContext

PATCH_TARGET = "trading.replay.engines.week52.fetch_candles"
REPLAY_DATE = "2025-02-04"
N_BARS = 400


class _FakeRequest:
    """Minimal Request stand-in exposing ``query_params`` as a plain dict."""

    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture(autouse=True)
def _clear_cache():
    poc_nq._cache.clear()
    yield
    poc_nq._cache.clear()


def _make_daily_df(n: int = N_BARS) -> pd.DataFrame:
    """~400 daily bars: long ramp to a 52W high, flat basing, then a breakout.

    Bar ``n-10`` closes ~0.9% above the prior 52W high (inside the chaser's
    min_breakout/entry_threshold band); the next bar trades down through the
    stop (the prior 52W high) so the trade closes as SL.
    """
    idx = pd.date_range("2024-01-01", periods=n, freq="D", tz="UTC")
    rows = []
    for i in range(n):
        if i < 300:
            close = 100.0 + i * 0.33
            high = close + 1.0
            low = close - 1.0
        elif i < n - 10:
            close = 190.0
            high = 192.0
            low = 188.0
        elif i == n - 10:
            close = 201.5
            high = 202.0
            low = 200.0
        elif i == n - 9:
            close = 200.5
            high = 202.0
            low = 199.0
        else:
            close = 190.0
            high = 192.0
            low = 188.0
        rows.append({
            "open": close, "high": high, "low": low, "close": close,
            "volume": 100_000, "oi": 0,
        })
    return pd.DataFrame(rows, index=idx)


def _load_ctx(params=None):
    engine = registry.get("week52-chaser")
    merged = {p.name: p.default for p in engine.params}
    merged.update(params or {})
    return engine.load(REPLAY_DATE, merged)


# ---------------- load / registry ----------------

class TestLoadAndRegistry:

    def test_engine_is_registered(self):
        engine = registry.get("week52-chaser")
        assert engine is not None
        assert engine.label == "52W High Chaser"

    def test_load_returns_daily_bars(self):
        df = _make_daily_df()
        with patch(PATCH_TARGET, return_value=df):
            ctx = _load_ctx({"symbol": "NETWEB"})
        assert isinstance(ctx, ReplayContext)
        assert ctx.symbol == "NETWEB"
        assert ctx.ticks == []
        assert len(ctx.bars) == N_BARS
        assert ctx.hist_bars is None
        assert ctx.basis is None
        bar = ctx.bars[0]
        assert set(bar) == {"time", "open", "high", "low", "close", "volume"}
        assert bar["time"] == int(df.index[0].timestamp())
        assert isinstance(bar["time"], int)

    def test_load_with_empty_frame_returns_no_bars(self):
        with patch(PATCH_TARGET, return_value=pd.DataFrame()):
            ctx = _load_ctx()
        assert ctx.bars == []


# ---------------- run ----------------

class TestRun:

    def test_produces_closed_trade_with_contract_shape(self):
        df = _make_daily_df()
        with patch(PATCH_TARGET, return_value=df):
            ctx = _load_ctx()
        result = registry.get("week52-chaser").run(ctx)
        assert len(result.trades) >= 1

        tr = result.trades[0]
        assert set(tr) >= {"time", "exit_time", "side", "kind", "entry", "sl",
                           "tp", "exit", "result", "pnl", "rr", "meta"}
        assert tr["side"] == "LONG"
        assert tr["kind"] == "52w-chaser"
        assert tr["result"] == "SL"
        assert tr["entry"] == pytest.approx(201.5)
        assert tr["exit"] == pytest.approx(tr["sl"])
        assert tr["pnl"] == pytest.approx(tr["exit"] - tr["entry"])
        assert tr["rr"] == pytest.approx(tr["pnl"] / (tr["entry"] - tr["sl"]))
        assert set(tr["meta"]) == {"entry_reason", "exit_reason"}

    def test_no_lookahead_entry_before_exit(self):
        df = _make_daily_df()
        with patch(PATCH_TARGET, return_value=df):
            ctx = _load_ctx()
        result = registry.get("week52-chaser").run(ctx)
        for tr in result.trades:
            assert tr["time"] <= tr["exit_time"]
            assert tr["time"] < tr["exit_time"]

    def test_extras_and_kpis(self):
        df = _make_daily_df()
        with patch(PATCH_TARGET, return_value=df):
            ctx = _load_ctx()
        result = registry.get("week52-chaser").run(ctx)
        assert result.extras["bars"] is ctx.bars
        assert result.levels == []
        assert result.kpis["trades"] == len(result.trades)
        assert result.kpis["net"] == round(sum(t["pnl"] for t in result.trades), 2)
        assert result.kpis["wins"] == sum(1 for t in result.trades if t["pnl"] > 0)


# ---------------- generic endpoint uses engine load ----------------

class TestGenericEndpointUsesLoad:

    def test_endpoint_calls_engine_load_and_returns_envelope(self):
        bars = _load_ctx_with_patch()
        calls = {}

        def fake_load(self, date, params):
            calls["date"] = date
            calls["params"] = params
            return ReplayContext(date=date, symbol=params.get("symbol", "NETWEB"),
                                 params=params, ticks=[], bars=bars)

        with patch.object(registry.get("week52-chaser").__class__, "load", fake_load):
            res = get_replay("week52-chaser", _FakeRequest({"date": REPLAY_DATE, "symbol": "NETWEB"}))

        assert calls["date"] == REPLAY_DATE
        assert calls["params"]["symbol"] == "NETWEB"
        assert "error" not in res
        assert res["strategy_id"] == "week52-chaser"
        assert res["symbol"] == "NETWEB"
        assert isinstance(res["trades"], list)
        assert res["bars"] == bars
        assert res["count"] == len(res["trades"])


def _load_ctx_with_patch():
    df = _make_daily_df()
    with patch(PATCH_TARGET, return_value=df):
        ctx = _load_ctx()
    return ctx.bars
