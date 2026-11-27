"""Opt-in Upstox active-contract history for backdated option replay.

Every upstream call is faked. The suite covers the adapter's seams, the error
contract, the composite's source ordering and the real callables' use of the
repo's existing Upstox helpers (no second HTTP client, no hardcoded token).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

os.environ.setdefault("CI_MODE", "1")

import config  # noqa: E402
from api.options_paper import service  # noqa: E402
from api.options_paper.service import OrderError  # noqa: E402
from options_paper.replay_data import (  # noqa: E402
    UPSTOX_HISTORY_FLAG,
    ChainQuote,
    CompositeChainProvider,
    FileChainProvider,
    SnapshotChainProvider,
    UpstoxChainProvider,
    upstox_fetch_candles,
    upstox_history_enabled,
    upstox_resolve_key,
)

IST = config.IST
UNDERLYING = "BHARTIARTL"
EXPIRY = "2026-11-23"
STRIKE = 900.0
ENTRY = datetime(2026, 11, 16, 9, 15, tzinfo=IST)
END = datetime(2026, 11, 16, 15, 30, tzinfo=IST)
KEY = "NSE_FO|900CE"


def _provider(resolve=None, fetch=None, enabled=True):
    return UpstoxChainProvider(
        resolve_key=resolve if resolve is not None else (lambda *a: KEY),
        fetch_candles=fetch if fetch is not None else (lambda *a: []),
        enabled=enabled,
    )


@pytest.fixture(autouse=True)
def _lot_size(monkeypatch):
    """Keep lot sizing independent of the real instruments master."""
    monkeypatch.setattr(service, "get_lot", lambda symbol: 1000)


def _series():
    return _provider(fetch=lambda *a: [
        (ENTRY + timedelta(minutes=1), 10.0),
    ]).premium_series(UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END)


# ---------------------------------------------------------------------------
# Flag / wiring
# ---------------------------------------------------------------------------
def test_flag_is_off_by_default_and_only_explicit_truthy_values_enable(monkeypatch):
    monkeypatch.delenv(UPSTOX_HISTORY_FLAG, raising=False)
    assert upstox_history_enabled() is False
    for value in ("", "0", "false", "garbage"):
        monkeypatch.setenv(UPSTOX_HISTORY_FLAG, value)
        assert upstox_history_enabled() is False
    for value in ("1", "true", "YES", " on "):
        monkeypatch.setenv(UPSTOX_HISTORY_FLAG, value)
        assert upstox_history_enabled() is True


def test_make_provider_order_and_disabled_by_default(monkeypatch):
    monkeypatch.delenv(UPSTOX_HISTORY_FLAG, raising=False)
    composite = service.make_provider(object())
    assert [type(p) for p in composite.providers] == [
        SnapshotChainProvider, FileChainProvider, UpstoxChainProvider,
    ]
    assert composite.providers[2].enabled is False

    monkeypatch.setenv(UPSTOX_HISTORY_FLAG, "1")
    assert service.make_provider(object()).providers[2].enabled is True


def test_disabled_adapter_never_calls_either_seam():
    called = []

    def resolve(*args):
        called.append("resolve")
        return KEY

    def fetch(*args):
        called.append("fetch")
        return []

    provider = _provider(resolve=resolve, fetch=fetch, enabled=False)
    with pytest.raises(NotImplementedError):
        provider.premium_series(UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END)
    with pytest.raises(NotImplementedError):
        provider.chain_at(UNDERLYING, EXPIRY, ENTRY)
    assert called == []


def test_enabled_adapter_returns_ist_priced_points():
    def fetch(key, lo, hi):
        assert key == KEY
        return [(lo + timedelta(minutes=i), 100.0 + i) for i in range(3)]

    series = _provider(fetch=fetch).premium_series(
        UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END)
    assert [round(px, 2) for _, px, _ in series] == [100.0, 101.0, 102.0]
    assert all(t.tzinfo is not None for t, _, _ in series)
    assert all(priced for _, _, priced in series)


# ---------------------------------------------------------------------------
# Resolution / window / series hygiene
# ---------------------------------------------------------------------------
def test_resolve_key_receives_canonical_leg_identity():
    seen = []

    def resolve(underlying, expiry, strike, opt):
        seen.append((underlying, expiry, strike, opt))
        return KEY

    _provider(resolve=resolve).premium_series(
        UNDERLYING, EXPIRY, STRIKE, "ce", ENTRY, END)
    assert seen == [(UNDERLYING, EXPIRY, STRIKE, "CE")]


def test_window_is_clamped_to_31_days():
    seen = {}

    def fetch(key, lo, hi):
        seen.update(lo=lo, hi=hi)
        return []

    old = END - timedelta(days=120)
    _provider(fetch=fetch).premium_series(
        UNDERLYING, EXPIRY, STRIKE, "CE", old, END)
    assert seen["hi"] == END
    assert seen["lo"] == END - timedelta(days=31)
    assert seen["lo"] > old


def test_series_sorts_dedupes_and_drops_bad_and_out_of_window_prices():
    rows = [
        (ENTRY + timedelta(minutes=2), 12.0),
        (ENTRY + timedelta(minutes=1), 11.0),
        (ENTRY + timedelta(minutes=1), 11.5),  # later print wins the minute
        (ENTRY + timedelta(minutes=3), 0.0),
        (ENTRY + timedelta(minutes=4), float("nan")),
        (ENTRY + timedelta(minutes=5), -3.0),
        (ENTRY - timedelta(minutes=1), 99.0),  # before the window
        (ENTRY + timedelta(days=2), 99.0),     # after the window
    ]
    series = _provider(fetch=lambda *a: rows).premium_series(
        UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END)
    assert [t for t, _, _ in series] == [
        ENTRY + timedelta(minutes=1), ENTRY + timedelta(minutes=2),
    ]
    assert [px for _, px, _ in series] == [11.5, 12.0]
    assert all(priced for _, _, priced in series)


# ---------------------------------------------------------------------------
# Failures are 400s, never a silent empty or a 500
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("status, needle", [
    (401, "token"),
    (429, "429"),
    (503, "503"),
])
@pytest.mark.parametrize("seam", ["resolve", "fetch"])
def test_upstream_failures_become_order_errors_naming_underlying(seam, status, needle):
    def boom(*args):
        raise HTTPException(status_code=status, detail="upstream said no")

    kwargs = {seam: boom}
    with pytest.raises(OrderError) as exc:
        _provider(**kwargs).premium_series(
            UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END)
    assert UNDERLYING in str(exc.value)
    assert needle in str(exc.value)


def test_missing_contract_key_is_an_order_error_not_an_empty_series():
    with pytest.raises(OrderError, match=UNDERLYING):
        _provider(resolve=lambda *a: None).premium_series(
            UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END)


def test_timeout_from_fetch_is_an_order_error():
    def boom(*args):
        raise TimeoutError("upstream timed out")

    with pytest.raises(OrderError) as exc:
        _provider(fetch=boom).premium_series(
            UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END)
    assert UNDERLYING in str(exc.value)
    assert "TimeoutError" in str(exc.value)


# ---------------------------------------------------------------------------
# Local sources always win
# ---------------------------------------------------------------------------
class _LocalProvider:
    source = "snapshot"

    def chain_at(self, underlying, expiry, ts):
        return ChainQuote(
            t=ts, spot=100.0, expiry=expiry, ladder=(STRIKE,),
            premiums={(STRIKE, "CE"): 5.0}, source=self.source, gaps=0,
        )

    def premium_series(self, *args):
        return [(ENTRY, 5.0, True)]


def test_composite_uses_local_snapshot_without_touching_upstox():
    def forbidden(*args):
        raise AssertionError("Upstox seam must not run when local data exists")

    composite = CompositeChainProvider([
        _LocalProvider(), _provider(resolve=forbidden, fetch=forbidden),
    ])
    assert composite.chain_at(UNDERLYING, EXPIRY, ENTRY).source == "snapshot"
    assert composite.premium_series(
        UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END) == [(ENTRY, 5.0, True)]


def test_composite_falls_through_to_upstox_only_when_local_is_empty():
    class Empty:
        source = "snapshot"

        def chain_at(self, *args):
            return None

        def premium_series(self, *args):
            return []

    composite = CompositeChainProvider([
        Empty(), _provider(fetch=lambda *a: [(ENTRY, 7.0)]),
    ])
    assert composite.premium_series(
        UNDERLYING, EXPIRY, STRIKE, "CE", ENTRY, END) == [(ENTRY, 7.0, True)]
    assert composite.last_sources["premium_series"] == "upstox"


# ---------------------------------------------------------------------------
# Real seams call the repo's existing helpers (all I/O mocked)
# ---------------------------------------------------------------------------
def test_real_resolve_key_reuses_option_contract_endpoint(monkeypatch):
    calls = []

    async def fake_fetch(endpoint, params=None, base=None):
        calls.append((endpoint, params))
        return {"status": "success", "data": [
            {"instrument_key": KEY, "expiry": EXPIRY,
             "instrument_type": "CE", "strike_price": STRIKE},
            {"instrument_key": "NSE_FO|900PE", "expiry": EXPIRY,
             "instrument_type": "PE", "strike_price": STRIKE},
        ]}

    monkeypatch.setattr("api.options.fetch_upstox", fake_fetch)
    monkeypatch.setattr(
        "api.options_underlying._resolve_instrument",
        lambda symbol: ("NSE_EQ|BHARTIARTL", "NSE"),
    )
    assert upstox_resolve_key()(UNDERLYING, EXPIRY, STRIKE, "CE") == KEY
    assert calls == [("/option/contract", {
        "instrument_key": "NSE_EQ|BHARTIARTL", "expiry_date": EXPIRY,
    })]


def test_real_resolve_key_returns_none_for_unlisted_strike(monkeypatch):
    async def fake_fetch(endpoint, params=None, base=None):
        return {"status": "success", "data": [
            {"instrument_key": KEY, "expiry": EXPIRY,
             "instrument_type": "CE", "strike_price": 950.0},
        ]}

    monkeypatch.setattr("api.options.fetch_upstox", fake_fetch)
    monkeypatch.setattr(
        "api.options_underlying._resolve_instrument",
        lambda symbol: ("NSE_EQ|BHARTIARTL", "NSE"),
    )
    assert upstox_resolve_key()(UNDERLYING, EXPIRY, STRIKE, "CE") is None


def test_real_fetch_candles_reuses_v3_historical_helper(monkeypatch):
    urls = []

    async def fake_fetch(url):
        urls.append(url)
        return [
            ["2026-11-16T09:16:00+05:30", 1, 2, 0.5, 10.5, 100, 0],
            ["2026-11-16T09:15:00+05:30", 1, 2, 0.5, 10.0, 100, 0],
            ["2026-11-16T09:17:00+05:30", 1, 2, 0.5, -1.0, 100, 0],
        ]

    monkeypatch.setattr("api.options_contract_chart._fetch_candles", fake_fetch)
    rows = upstox_fetch_candles()(KEY, ENTRY, END)
    assert urls == [
        "https://api.upstox.com/v3/historical-candle/"
        "NSE_FO%7C900CE/minutes/1/2026-11-16/2026-11-16"
    ]
    assert rows == [
        (datetime(2026, 11, 16, 9, 15, tzinfo=IST), 10.0),
        (datetime(2026, 11, 16, 9, 16, tzinfo=IST), 10.5),
    ]


def test_async_bridge_refuses_to_block_a_running_loop():
    from options_paper import replay_data

    async def coro():
        return None

    async def call_from_loop():
        return replay_data._call_async(coro)

    with pytest.raises(RuntimeError, match="running event loop"):
        asyncio.run(call_from_loop())


def test_replay_order_uses_upstox_when_local_leg_history_is_absent(
    auth_client, db, monkeypatch,
):
    from db.models.option_snapshot import OptionChainSnapshot

    # One spot-only row gives the chain its ladder/spot but no CE/PE series, so
    # both local premium_series providers return [] and the Upstox seam runs.
    db.add(OptionChainSnapshot(
        ts=ENTRY.replace(tzinfo=None), underlying=UNDERLYING, expiry=EXPIRY,
        strike=STRIKE, side="UND", ltp=None, iv=18.0, oi=0, volume=0,
        spot=100.0, session_date="2026-11-16", quotes_live=False,
        iv_source="upstox",
    ))
    db.commit()

    calls = []

    async def fake_fetch(endpoint, params=None, base=None):
        calls.append(endpoint)
        return {"status": "success", "data": [
            {"instrument_key": KEY, "expiry": EXPIRY,
             "instrument_type": "CE", "strike_price": STRIKE},
        ]}

    async def fake_candles(url):
        calls.append(url)
        return [
            [f"2026-11-16T09:{minute:02d}:00+05:30", 10, 11, 9, 10.5, 100, 0]
            for minute in (15, 16, 17, 18, 19)
        ]

    monkeypatch.setattr("api.options.fetch_upstox", fake_fetch)
    monkeypatch.setattr(
        "api.options_underlying._resolve_instrument",
        lambda symbol: ("NSE_EQ|BHARTIARTL", "NSE"),
    )
    monkeypatch.setattr("api.options_contract_chart._fetch_candles", fake_candles)
    monkeypatch.setenv(UPSTOX_HISTORY_FLAG, "1")

    response = auth_client.post("/api/options-paper/orders", json={
        "underlying": UNDERLYING, "expiry": EXPIRY, "source": "replay",
        "entryTs": ENTRY.isoformat(),
        "legs": [{"action": "BUY", "opt": "CE", "strike": STRIKE, "lots": 1}],
        "dryRun": True,
    })
    assert response.status_code == 200, response.text
    replay = response.json()["replay"]
    assert "/option/contract" in calls
    assert any("/v3/historical-candle/" in url for url in calls)
    assert replay["skipped"] is None
    assert len(replay["frames"]) >= 2
    assert replay["summary"]["costs"] > 0


def test_upstox_401_surfaces_as_a_400_naming_the_underlying(
    auth_client, db, monkeypatch,
):
    from db.models.option_snapshot import OptionChainSnapshot

    db.add(OptionChainSnapshot(
        ts=ENTRY.replace(tzinfo=None), underlying=UNDERLYING, expiry=EXPIRY,
        strike=STRIKE, side="UND", ltp=None, iv=18.0, oi=0, volume=0,
        spot=100.0, session_date="2026-11-16", quotes_live=False,
        iv_source="upstox",
    ))
    db.commit()

    async def reject(*args, **kwargs):
        raise HTTPException(status_code=401, detail="token expired")

    monkeypatch.setattr("api.options.fetch_upstox", reject)
    monkeypatch.setattr(
        "api.options_underlying._resolve_instrument",
        lambda symbol: ("NSE_EQ|BHARTIARTL", "NSE"),
    )
    monkeypatch.setenv(UPSTOX_HISTORY_FLAG, "1")

    response = auth_client.post("/api/options-paper/orders", json={
        "underlying": UNDERLYING, "expiry": EXPIRY, "source": "replay",
        "entryTs": ENTRY.isoformat(),
        "legs": [{"action": "BUY", "opt": "CE", "strike": STRIKE, "lots": 1}],
        "dryRun": True,
    })
    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert UNDERLYING in detail
    assert "token" in detail
