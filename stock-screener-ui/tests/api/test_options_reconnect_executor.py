"""Regressions for two option-analytics review findings.

1. A broker reconnect must invalidate *every* cache derived from the old
   token's spot/IV (chain, analytics, analytics RV cone and RV daily series),
   not just the short-lived chain cache.
2. Cold RV builds run on a dedicated executor so same-symbol lock waiters
   cannot occupy asyncio's default executor and starve unrelated ``to_thread``
   work. Single-flight and cache semantics stay intact.
"""

import asyncio
import sys
import threading
import time
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import options as op  # noqa: E402
from api import options_analytics as oa  # noqa: E402
from api import options_rv as rv  # noqa: E402
from api import options_underlying as ou  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate():
    ou._cache.clear()
    oa._rv_cache.clear()
    rv.clear_rv_cache()
    yield
    ou._cache.clear()
    oa._rv_cache.clear()
    rv.clear_rv_cache()


def _install(monkeypatch, module_name, **funcs):
    module = types.ModuleType(module_name)
    for name, func in funcs.items():
        setattr(module, name, func)
    monkeypatch.setitem(sys.modules, module_name, module)
    return module


class TestReconnectClearsAllDerivedCaches:
    def test_reconnect_drops_analytics_rv_and_chain_together(self, monkeypatch):
        import api.upstox_token as ut

        monkeypatch.setattr(ut, "clear_upstox_token_cache", lambda: None)

        now = time.monotonic()
        chain_key = op._chain_cache_key("NIFTY", "2026-11-17", "open")
        analytics_key = f"{oa._ANALYTICS_KEY_PREFIX}NIFTY:1:open"
        ou._cache[chain_key] = {"ts": now, "ttl": 5, "data": {"chain": [1]}}
        ou._cache[analytics_key] = {"ts": now, "ttl": 45, "data": {}}
        oa._rv_cache["NIFTY"] = (now, {"cone": [[1, 12.0]]})
        rv._rv_cache[("NIFTY", 750)] = {"ts": now, "closes": (), "as_of": None}

        assert chain_key in ou._cache
        assert analytics_key in ou._cache
        assert "NIFTY" in oa._rv_cache
        assert ("NIFTY", 750) in rv._rv_cache

        op.clear_upstox_token_cache()

        assert chain_key not in ou._cache
        assert analytics_key not in ou._cache
        assert "NIFTY" not in oa._rv_cache
        assert ("NIFTY", 750) not in rv._rv_cache


class TestRvDedicatedExecutor:
    def _patch_load_analytics(self, monkeypatch):
        async def underlying(symbol):
            return {
                "fno": True,
                "quotes_live": True,
                "expiries": [{"date": "2026-11-17", "dte_days": 1}],
            }

        payload = {
            "chain": [{"strike": 25_000.0, "ce": None, "pe": None}],
            "spot": 25_000.0,
            "levels": {"step": 100.0, "gex": {}},
            "quotes_live": True,
            "session_date": "2026-11-16",
            "data_as_of": "2026-11-16T10:30:00+05:30",
        }

        async def fake_cached(key, loader, *args, **kwargs):
            return payload

        def fake_entry(expiry, chain_payload, view=None):
            return oa.ExpiryAnalytics(date=str(expiry.get("date") or ""))

        monkeypatch.setattr(oa, "_underlying_payload", underlying)
        monkeypatch.setattr(oa, "_cached", fake_cached)
        monkeypatch.setattr(oa, "_expiry_entry", fake_entry)
        monkeypatch.setattr(oa, "_warnings", lambda *a, **k: [])
        monkeypatch.setattr(oa, "_rnd_warnings", lambda *a, **k: [])

    def test_same_symbol_waiters_do_not_starve_default_executor(self, monkeypatch):
        gate = threading.Event()
        calls = {"n": 0}
        rv_threads: list[str] = []

        def cone(symbol):
            calls["n"] += 1
            rv_threads.append(threading.current_thread().name)
            gate.wait(5)  # hold the single-flight lock until the probe is checked
            return {"symbol": symbol, "warnings": [], "cone": [[30, 12.0]]}

        _install(
            monkeypatch,
            "api.options_rv",
            realized_vol_cone=cone,
            iv_vs_rv=lambda expiries, c: {"rows": len(expiries)},
        )
        self._patch_load_analytics(monkeypatch)

        async def scenario():
            loop = asyncio.get_running_loop()
            # A deliberately tiny default executor: if RV waiters land here they
            # fill it and starve the unrelated probe below.
            small = ThreadPoolExecutor(max_workers=1, thread_name_prefix="default-probe")
            loop.set_default_executor(small)
            probe_done = None
            try:
                tasks = [
                    asyncio.create_task(oa._load_analytics("NIFTY", 1, "open"))
                    for _ in range(3)
                ]
                probe = asyncio.create_task(asyncio.to_thread(lambda: "progress"))
                done, _ = await asyncio.wait([probe], timeout=1.0)
                probe_done = probe in done
                gate.set()
                results = await asyncio.gather(*tasks)
                return results, probe_done
            finally:
                small.shutdown(wait=False)

        results, probe_done = asyncio.run(scenario())

        assert probe_done, "unrelated to_thread was starved by RV lock waiters"
        assert calls["n"] == 1, "single-flight broken: more than one RV fetch"
        assert rv_threads and all(t.startswith("analytics-rv") for t in rv_threads), rv_threads
        assert all(body["rv"]["cone"]["symbol"] == "NIFTY" for body in results)
