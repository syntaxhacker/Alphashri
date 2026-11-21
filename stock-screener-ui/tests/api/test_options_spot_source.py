"""SPOT source selection: V3 default, V2 legacy, REST fallback.

``NIFTY_SPOT_SOURCE`` exists because the 1 Hz report poll through
``/v2/market-quote/ohlc`` was ~1800 calls per 30 min against a 2000/30 min
budget — 90% of the allowance for one number. V3 is the current endpoint; V2
is kept as an explicit opt-in / fallback so a V3 outage cannot blank the
ticker.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from api import options as options_module


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv(options_module.SPOT_SOURCE_ENV, raising=False)
    monkeypatch.setattr(options_module, "_spot_source_logged", None)
    yield


def _payload(last: float) -> dict:
    return {
        "status": "success",
        "data": {"NSE_INDEX:Nifty 50": {"last_price": last, "ohlc": {"close": last}}},
    }


def test_spot_source_defaults_to_v3():
    assert options_module.spot_source() == "v3"
    assert options_module.spot_request("v3") == (
        options_module.UPSTOX_BASE_V3,
        "/v3/market-quote/ohlc",
    )


@pytest.mark.parametrize("value", ["ws", "V3", " v2 "])
def test_spot_source_accepts_documented_values(monkeypatch, value):
    monkeypatch.setenv(options_module.SPOT_SOURCE_ENV, value)
    assert options_module.spot_source() == value.strip().lower()


def test_spot_source_unknown_value_warns_and_defaults(monkeypatch, caplog):
    monkeypatch.setenv(options_module.SPOT_SOURCE_ENV, "soap")
    assert options_module.spot_source() == "v3"
    assert "NIFTY_SPOT_SOURCE='soap'" in caplog.text


async def test_get_spot_price_uses_v3_by_default(monkeypatch):
    seen: list[tuple[str, str]] = []

    async def _fake(endpoint, params=None, base=None):
        seen.append((base, endpoint))
        return _payload(22_712.5)

    monkeypatch.setattr(options_module, "fetch_upstox", _fake)
    out = await options_module.get_spot_price("NIFTY")

    assert seen == [(options_module.UPSTOX_BASE_V3, "/v3/market-quote/ohlc")]
    assert out == {"status": "ok", "underlying": "NIFTY", "spot": 22_712.5, "source": "v3"}


async def test_get_spot_price_uses_v2_when_configured(monkeypatch):
    seen: list[tuple[str, str]] = []

    async def _fake(endpoint, params=None, base=None):
        seen.append((base, endpoint))
        return _payload(22_700.0)

    monkeypatch.setattr(options_module, "fetch_upstox", _fake)
    monkeypatch.setenv(options_module.SPOT_SOURCE_ENV, "v2")
    out = await options_module.get_spot_price("NIFTY")

    assert seen == [(options_module.UPSTOX_BASE, "/market-quote/ohlc")]
    assert out["source"] == "v2"


async def test_get_spot_price_falls_back_to_v2_when_v3_fails(monkeypatch):
    seen: list[str] = []

    async def _fake(endpoint, params=None, base=None):
        seen.append(endpoint)
        if base == options_module.UPSTOX_BASE_V3:
            raise RuntimeError("v3 503")
        return _payload(22_701.0)

    monkeypatch.setattr(options_module, "fetch_upstox", _fake)
    out = await options_module.get_spot_price("NIFTY")

    assert seen == ["/v3/market-quote/ohlc", "/market-quote/ohlc"]
    assert out["source"] == "v2"
    assert out["spot"] == 22_701.0


async def test_get_spot_price_does_not_retry_on_expired_token(monkeypatch):
    calls: list[str] = []

    async def _fake(endpoint, params=None, base=None):
        calls.append(endpoint)
        raise HTTPException(status_code=401, detail="token expired")

    monkeypatch.setattr(options_module, "fetch_upstox", _fake)
    with pytest.raises(HTTPException) as exc:
        await options_module.get_spot_price("NIFTY")
    assert exc.value.status_code == 401
    assert calls == ["/v3/market-quote/ohlc"]


async def test_get_spot_price_reports_both_failures(monkeypatch):
    async def _fake(endpoint, params=None, base=None):
        raise RuntimeError(f"{base} down")

    monkeypatch.setattr(options_module, "fetch_upstox", _fake)
    with pytest.raises(HTTPException) as exc:
        await options_module.get_spot_price("NIFTY")
    assert exc.value.status_code == 500
