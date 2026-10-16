"""Unit tests for the pooled Nifty market-data feed (no network)."""

import asyncio
import time

import pytest

from api.reports_api import nifty_md


@pytest.fixture(autouse=True)
def _clean_state():
    nifty_md._reset_state_for_tests()
    yield
    nifty_md._reset_state_for_tests()
    nifty_md.stop_nifty_md_task()


def _chain_payload(strikes=(22600.0, 22700.0, 22800.0)):
    return {
        "underlying_spot_price": 22700.0,
        "data": [
            {"strike_price": s,
             "expiry": "2026-10-29",
             "call_options": {"instrument_key": f"NSE_FO|CE{s:g}"},
             "put_options": {"instrument_key": f"NSE_FO|PE{s:g}"}}
            for s in strikes
        ],
    }


# -- snapshot ---------------------------------------------------------------

def test_snapshot_defaults():
    assert nifty_md.snapshot() == {
        "ts": None,
        "connected": False,
        "spot": None,
        "vix": None,
        "sensex": None,
        "legs": {},
    }


def test_setters_update_snapshot():
    nifty_md._set_connected(True)
    nifty_md._set_spot(22700.5)
    nifty_md._set_vix(13.25)
    nifty_md._set_sensex(81400.0)
    nifty_md._set_leg(22700.0, "ce", oi=1000, iv=12.5, ltp=150.0,
                      volume=2000, delta=0.5, gamma=0.001)
    snap = nifty_md.snapshot()
    assert snap["connected"] is True
    assert snap["spot"] == 22700.5
    assert snap["vix"] == 13.25
    assert snap["sensex"] == 81400.0
    assert snap["ts"] is not None
    assert snap["legs"]["22700.0:ce"] == {
        "oi": 1000.0, "iv": 12.5, "ltp": 150.0,
        "volume": 2000.0, "delta": 0.5, "gamma": 0.001,
    }


def test_set_leg_normalises_case_and_put_alias():
    nifty_md._set_leg(22700, "CE", ltp=10.0)
    nifty_md._set_leg(22700, "put", ltp=20.0)
    legs = nifty_md.snapshot()["legs"]
    assert legs["22700.0:ce"]["ltp"] == 10.0
    assert legs["22700.0:pe"]["ltp"] == 20.0


def test_set_leg_ignores_bad_input():
    nifty_md._set_leg("nope", "ce", ltp=1.0)
    nifty_md._set_leg(22700.0, "bogus", ltp=1.0)
    assert nifty_md.snapshot()["legs"] == {}


# -- liveness ----------------------------------------------------------------

def test_is_live_never_and_stale():
    assert nifty_md.is_live() is False  # nothing ever recorded
    nifty_md._set_connected(True)
    assert nifty_md.is_live() is False  # connected but no tick yet


def test_is_live_true_on_fresh_tick_then_stale():
    nifty_md._set_connected(True)
    nifty_md._set_spot(22700.0)
    assert nifty_md.is_live() is True
    nifty_md._last_tick_ts = time.time() - (nifty_md.LIVE_TTL_SEC + 5)
    assert nifty_md.is_live() is False


def test_is_live_false_when_disconnected_despite_fresh_tick():
    nifty_md._set_spot(22700.0)  # fresh tick, but never connected
    assert nifty_md.is_live() is False


# -- key resolution -----------------------------------------------------------

def test_build_keys_includes_index_vix_sensex_and_all_legs():
    ltpc, greeks, mapping = nifty_md.build_subscription_keys(_chain_payload())
    from api.options import get_instrument_key

    assert get_instrument_key("NIFTY") in ltpc
    assert nifty_md.VIX_KEY in ltpc
    assert get_instrument_key("SENSEX") in ltpc
    for s in (22600.0, 22700.0, 22800.0):
        assert f"NSE_FO|CE{s:g}" in greeks
        assert f"NSE_FO|PE{s:g}" in greeks
    assert mapping[f"NSE_FO|CE22700"] == (22700.0, "ce")
    assert mapping[f"NSE_FO|PE22700"] == (22700.0, "pe")
    assert mapping[get_instrument_key("NIFTY")] == (0.0, "index")
    assert mapping[nifty_md.VIX_KEY] == (0.0, "vix")


def test_build_keys_skips_sensex_when_unresolvable(monkeypatch):
    from api import options as options_mod

    real = options_mod.get_instrument_key

    def _boom(underlying: str) -> str:
        if underlying == "SENSEX":
            raise RuntimeError("no key")
        return real(underlying)

    monkeypatch.setattr(options_mod, "get_instrument_key", _boom)
    ltpc, _greeks, mapping = nifty_md.build_subscription_keys(_chain_payload())
    assert all("SENSEX" not in k for k in ltpc)
    assert _greeks, "option legs must still resolve"


def test_build_keys_falls_back_to_atm_when_huge(monkeypatch):
    strikes = [20000.0 + 50.0 * i for i in range(800)]  # 1600 keys > cap
    monkeypatch.setattr(nifty_md, "MAX_CHAIN_KEYS", 1500)
    _ltpc, greeks, _mapping = nifty_md.build_subscription_keys(
        _chain_payload(strikes))
    # ATM +/-10 -> 21 strikes x 2 legs.
    assert len(greeks) == 2 * (2 * nifty_md.ATM_FALLBACK_N + 1)


# -- feed decoding --------------------------------------------------------------

def test_apply_feed_option_greeks_flat_and_nested():
    nifty_md._install_mapping({"K1": (22700.0, "ce"), "K2": (22700.0, "pe")})
    nifty_md._apply_feed("K1", {
        "oi": 1500, "iv": 11.0,
        "ltpc": {"ltp": 120.5},
        "optionGreeks": {"delta": 0.55, "gamma": 0.002},
    })
    nifty_md._apply_feed("K2", {
        "firstLevelWithGreeks": {"oi": 2500, "iv": 13.0},
        "ltpc": {"ltp": 90.0},
        "optionGreeks": {"delta": -0.4, "gamma": 0.003},
    })
    legs = nifty_md.snapshot()["legs"]
    assert legs["22700.0:ce"]["oi"] == 1500.0
    assert legs["22700.0:ce"]["delta"] == 0.55
    assert legs["22700.0:pe"]["oi"] == 2500.0
    assert legs["22700.0:pe"]["iv"] == 13.0


def test_apply_feed_ltpc_updates_spot_vix_sensex():
    nifty_md._install_mapping({
        "IDX": (0.0, "index"), "VIX": (0.0, "vix"), "SEN": (0.0, "sensex"),
    })
    nifty_md._set_connected(True)
    nifty_md._apply_feed("IDX", {"ltpc": {"ltp": 22710.0}})
    nifty_md._apply_feed("VIX", {"ltpc": {"ltp": 12.5}})
    nifty_md._apply_feed("SEN", {"ltpc": {"ltp": 81500.0}})
    snap = nifty_md.snapshot()
    assert (snap["spot"], snap["vix"], snap["sensex"]) == (22710.0, 12.5, 81500.0)
    assert nifty_md.is_live() is True


def test_install_mapping_prunes_stale_legs():
    nifty_md._set_leg(22700.0, "ce", ltp=1.0)
    nifty_md._set_leg(22800.0, "ce", ltp=2.0)
    nifty_md._install_mapping({"K": (22700.0, "ce")})
    assert set(nifty_md.snapshot()["legs"]) == {"22700.0:ce"}


# -- task lifecycle -------------------------------------------------------------

async def test_start_is_idempotent():
    first = nifty_md.start_nifty_md_task()
    second = nifty_md.start_nifty_md_task()
    try:
        assert first is second
        assert isinstance(first, asyncio.Task)
        assert not first.done()
    finally:
        nifty_md.stop_nifty_md_task()
        if first is not None and not first.done():
            try:
                await asyncio.wait_for(asyncio.shield(first), timeout=2)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass


def test_start_does_not_raise_without_running_loop():
    # Sync test => no running loop here; must return (None) rather than raise.
    assert nifty_md._md_task is None or nifty_md._md_task.done()
    assert nifty_md.start_nifty_md_task() is None
    nifty_md.stop_nifty_md_task()  # best-effort, never raises
