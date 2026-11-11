"""Parity: SENSEX / RELIANCE EOD frames must carry the NIFTY analytics blocks.

Target contract (the fix for the recorder/replay enrichment may still be in
flight — these tests pin the contract, not the current behaviour):

* live ``GET /api/reports/options/{SYM}/live?candles=1`` carries
  ``vix`` / ``control`` / ``regime`` / ``strength`` / ``pivots`` /
  ``reference`` (previously ``—`` / ``RV —`` / ``IV —`` / ``VIX —`` /
  ``day/score —`` / ``RSI —`` / ``INDIA VIX`` empty on SENSEX/RELIANCE EOD
  frames while NIFTY had them);
* ``/{SYM}/snapshot`` and ``/{SYM}/replay`` enrich a stored frame whose
  report has the analytics keys REMOVED (legacy-frame fix);
* the recorder snapshot written after one tick contains the analytics;
* NIFTY ``/live`` and replay still carry the blocks, and no ``nifty_*``
  state is read for generic symbols.

All upstreams are mocked — no network, no DB, no real ``experiments/data``.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta

import pandas as pd
import pytest

import config
from api.reports_api import nifty_verdicts as nv
from api.reports_api import options_history as oh
from api.reports_api import options_report as opr
from api.reports_api import options_recorder as rec

EXPIRY = "2026-11-26"
SYMBOLS = ["SENSEX", "RELIANCE"]
SPOTS = {"SENSEX": 84000.0, "RELIANCE": 1400.0}
STEPS = {"SENSEX": 100.0, "RELIANCE": 20.0}

ANALYTICS_KEYS = ("vix", "control", "regime", "strength", "pivots",
                  "reference", "structure", "market", "timeline")


def _today() -> str:
    return datetime.now(config.IST).strftime("%Y-%m-%d")


def _leg(ltp: float, oi: int, prev_oi: int, volume: int) -> dict:
    return {
        "market_data": {"ltp": ltp, "close_price": ltp, "oi": oi,
                        "prev_oi": prev_oi, "volume": volume},
        "option_greeks": {"delta": 0.5, "gamma": 0.0012, "theta": -1.0,
                          "vega": 1.0, "iv": 22.5},
    }


def _chain(symbol: str) -> list[dict]:
    spot = SPOTS[symbol]
    step = STEPS[symbol]
    rows = []
    for i, (ce_oi, pe_oi) in enumerate(
            [(100, 800), (900, 1200), (500, 200), (300, 50), (150, 900)]):
        strike = spot + (i - 2) * step
        rows.append({
            "strike": strike,
            "ce": _leg(30.0, ce_oi, ce_oi - 10, 10 * (i + 1)),
            "pe": _leg(25.0, pe_oi, pe_oi + 10, 5 * (i + 1)),
        })
    return rows


def _intraday_df(symbol: str, n: int = 60) -> pd.DataFrame:
    spot = SPOTS[symbol]
    start = pd.Timestamp(_today() + " 03:46", tz="UTC")
    idx = pd.date_range(start, periods=n, freq="1min")
    closes = [round(spot * (1 + 0.00002 * i) + (i % 7 - 3) * spot * 1e-5, 2)
              for i in range(n)]
    return pd.DataFrame(
        {"open": [c - 1 for c in closes],
         "high": [c + 2 for c in closes],
         "low": [c - 2 for c in closes],
         "close": closes,
         "volume": [100] * n},
        index=idx,
    )


def _daily_df() -> pd.DataFrame:
    today = datetime.now(config.IST).date()
    days = [today - timedelta(days=2), today - timedelta(days=1)]
    idx = pd.DatetimeIndex([pd.Timestamp(d, tz="UTC") for d in days])
    return pd.DataFrame(
        {"open": [1000.0, 1000.0], "high": [1010.0, 1050.0],
         "low": [990.0, 1020.0], "close": [1000.0, 1040.0],
         "volume": [1000, 1000]},
        index=idx,
    )


def _tape_row(symbol: str) -> dict:
    return {
        "t": f"{_today()}T09:20:00+05:30",
        "spot": SPOTS[symbol],
        "atm_strike": SPOTS[symbol],
        "atm_ce_ltp": 40.0,
        "atm_pe_ltp": 30.0,
    }


# ---------------------------------------------------------------- fixtures
@pytest.fixture(autouse=True)
def _offline_env(monkeypatch, tmp_path):
    """Fresh caches, no rate limiter, offline VIX, file roots under tmp."""
    opr.clear_cache()
    nv.clear_caches()
    monkeypatch.setattr(opr, "_rate_limiter", lambda: None)
    monkeypatch.setattr(opr, "TAPE_ROOT", tmp_path / "options_tape")
    monkeypatch.setattr(oh, "DATA_ROOT", tmp_path)
    oh._SLIM_CACHE.clear()

    async def fake_vix():
        return {"ltp": 12.5, "prev_close": 12.0, "change_pct": 4.17,
                "day_high": 12.8, "day_low": 11.9}

    monkeypatch.setattr(nv, "get_vix_block", fake_vix)
    yield
    opr.clear_cache()
    nv.clear_caches()
    oh._SLIM_CACHE.clear()


@pytest.fixture()
def mocked_live(monkeypatch):
    """Mock chain/expiry/candles for the generic live handler (per symbol)."""
    async def fake_expiries(symbol):
        return {"underlying": symbol, "expiries": [
            {"date": EXPIRY, "weekly": False, "days_to_expiry": 28}]}

    async def fake_chain(symbol, expiry):
        return {"status": "ok", "underlying": symbol, "expiry": expiry,
                "spot": SPOTS[symbol.upper()], "chain": _chain(symbol.upper()),
                "summary": {}}

    def fake_candles(symbol, timeframe="1m", **kwargs):
        if timeframe in ("1d", "1D"):
            return _daily_df()
        return _intraday_df(symbol.upper())

    monkeypatch.setattr(opr, "get_expiries", fake_expiries)
    monkeypatch.setattr(opr, "get_option_chain", fake_chain)
    monkeypatch.setattr(opr, "fetch_candles_for_timeframe", fake_candles)

    # The symbol tape the reference/structure blocks read.
    for symbol in SYMBOLS:
        path = opr.tape_path(symbol, _today())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(_tape_row(symbol)) + "\n")
    return True


def _live(symbol: str):
    return asyncio.run(
        opr.get_live_option_report(symbol, expiry=EXPIRY, candles=True))


# ------------------------------------------------- 1. live parity blocks
@pytest.mark.parametrize("symbol", SYMBOLS)
def test_live_carries_session_analytics(symbol, mocked_live):
    report = _live(symbol)

    vix = report["vix"]
    assert vix["source"] == "INDIA_VIX"
    assert isinstance(vix["ltp"], (int, float)) and vix["ltp"] > 0
    assert isinstance(vix["change_pct"], (int, float))

    assert isinstance(report["control"]["verdict"], str)
    assert report["control"]["verdict"]

    regime = report["regime"]
    assert isinstance(regime["verdict"], str) and regime["verdict"]
    for key in ("rv", "iv", "rv_iv_ratio"):
        assert key in regime, key
    assert isinstance(regime["rv"], (int, float))
    assert isinstance(regime["iv"], (int, float))
    assert isinstance(regime["rv_iv_ratio"], (int, float))

    strength = report["strength"]
    assert isinstance(strength["verdict"], str) and strength["verdict"]
    assert isinstance(strength["score"], (int, float))
    assert "rsi" in strength
    assert isinstance(strength["rsi"], (int, float))

    assert isinstance(report["pivots"]["pp"], (int, float))
    assert report["pivots"]["pp"] > 0

    ref = report["reference"]
    assert isinstance(ref["strike"], (int, float)) and ref["strike"] > 0
    assert isinstance(ref["ce_ltp"], (int, float))
    assert isinstance(ref["pe_ltp"], (int, float))

    ohlc = report["ohlc"]
    for key in ("open", "high", "low", "close"):
        assert isinstance(ohlc[key], (int, float)) and ohlc[key] != 0, key

    assert isinstance(report["market"]["is_open"], bool)
    assert isinstance(report["timeline"], list) and report["timeline"]
    assert isinstance(report["gex"]["net_total"], (int, float))
    assert isinstance(report["positioning"]["verdict"], str)
    assert isinstance(report["max_pain"], (int, float)) and report["max_pain"] > 0
    assert isinstance(report["pcr_oi"], (int, float))
    assert isinstance(report["structure"], list)  # `structure` may be `[]`


# --------------------------------- 2. legacy stored frames are enriched
def _strip_analytics(report: dict) -> dict:
    legacy = {k: v for k, v in report.items() if k not in ANALYTICS_KEYS}
    legacy.pop("baseline_range_pct", None)
    legacy.pop("emas", None)
    assert not any(k in legacy for k in ANALYTICS_KEYS)
    return legacy


def _seed_legacy_day(symbol: str, legacy: dict) -> str:
    """Write snapshot .json + one .jsonl frame with analytics keys removed."""
    date = _today()
    snap_dir = oh.DATA_ROOT / oh.SNAPSHOTS_DIR / symbol
    snap_dir.mkdir(parents=True, exist_ok=True)
    (snap_dir / f"{date}.json").write_text(json.dumps(legacy))
    t = legacy.get("fetched_at") or f"{date}T10:00:00+05:30"
    with open(snap_dir / f"{date}.jsonl", "w") as fh:
        fh.write(json.dumps({"t": t, "fetched_at": t, "report": legacy,
                              "sensex": None}) + "\n")
    return t


def _assert_enriched(report: dict, symbol: str):
    assert report["vix"]["source"] == "INDIA_VIX"
    assert isinstance(report["vix"]["ltp"], (int, float))
    assert isinstance(report["vix"]["change_pct"], (int, float))
    assert isinstance(report["control"]["verdict"], str)
    for key in ("rv", "iv", "rv_iv_ratio"):
        assert key in report["regime"], key
    assert isinstance(report["strength"]["verdict"], str)
    assert isinstance(report["strength"]["score"], (int, float))
    assert "rsi" in report["strength"]
    assert isinstance(report["pivots"]["pp"], (int, float))
    assert isinstance(report["reference"]["strike"], (int, float))
    assert isinstance(report["reference"]["ce_ltp"], (int, float))
    assert isinstance(report["reference"]["pe_ltp"], (int, float))
    assert isinstance(report["market"]["is_open"], bool)
    assert isinstance(report["timeline"], list) and report["timeline"]
    # The enriched report is still the symbol's own frame.
    assert report["underlying"] == symbol
    assert isinstance(report["max_pain"], (int, float))
    assert isinstance(report["pcr_oi"], (int, float))


@pytest.mark.parametrize("symbol", SYMBOLS)
def test_snapshot_enriches_legacy_frame(symbol, mocked_live, monkeypatch):
    legacy = _strip_analytics(_live(symbol))
    _seed_legacy_day(symbol, legacy)
    served = asyncio.run(oh.get_options_snapshot(symbol, _today()))
    _assert_enriched(served, symbol)


@pytest.mark.parametrize("symbol", SYMBOLS)
def test_replay_enriches_legacy_frame(symbol, mocked_live):
    legacy = _strip_analytics(_live(symbol))
    t = _seed_legacy_day(symbol, legacy)
    # The `t=` single frame is enriched on read; the full-day list is
    # deliberately served as stored (see `get_options_replay` docstring).
    day = asyncio.run(oh.get_options_replay(symbol, date=_today()))
    assert day["count"] == 1

    single = asyncio.run(oh.get_options_replay(symbol, date=_today(), t=t))
    assert single["snapshot"] is not None
    _assert_enriched(single["snapshot"]["report"], symbol)


# --------------------------------------- 3. recorder snapshot analytics
@pytest.mark.parametrize("symbol", SYMBOLS)
def test_recorder_snapshot_contains_analytics(symbol, mocked_live, monkeypatch,
                                             tmp_path):
    monkeypatch.setattr(rec, "DATA_ROOT", tmp_path)
    # The recorder owns its limiter (5 s blocking acquire on the shared Redis
    # slice) — fail-open it so the test never depends on the live budget.
    monkeypatch.setattr(rec, "_rate_limiter", lambda: None)

    async def fake_expiries(sym):
        return {"underlying": sym, "expiries": [{"date": EXPIRY}]}

    async def fake_chain(sym, expiry):
        return {"status": "ok", "underlying": sym, "expiry": expiry,
                "spot": SPOTS[sym], "chain": _chain(sym)}

    monkeypatch.setattr(rec, "get_expiries", fake_expiries, raising=False)
    monkeypatch.setattr(rec, "get_option_chain", fake_chain, raising=False)
    monkeypatch.setattr(
        rec, "fetch_candles_for_timeframe",
        lambda s, timeframe="1m", **k: _daily_df()
        if timeframe in ("1d", "1D") else _intraday_df(s),
        raising=False)
    monkeypatch.setattr(rec, "_intraday_cache", {}, raising=False)
    rec._reset_state()
    # `_reset_state` does not clear the per-symbol minute gate: a previous
    # test in this file may have recorded this symbol in the same wall-clock
    # minute, which would skip the snapshot write under the new tmp root.
    rec._LAST_MINUTE.clear()

    now = datetime.now(config.IST).replace(microsecond=0)
    outcome = asyncio.run(rec.record_tick(now=now))
    assert outcome["symbols"][symbol] in ("ok", "skipped")

    stored = json.loads(
        (tmp_path / rec.SNAPSHOT_DIRNAME / symbol
         / f"{now.strftime('%Y-%m-%d')}.json").read_text())
    report = stored.get("report", stored)
    for key in ANALYTICS_KEYS:
        assert key in report, key
    assert report["vix"]["source"] == "INDIA_VIX"
    assert isinstance(report["control"]["verdict"], str)
    assert isinstance(report["regime"]["verdict"], str)
    assert isinstance(report["strength"]["score"], (int, float))
    assert isinstance(report["market"]["is_open"], bool)
    rec._reset_state()


# ----------------------------------------- 4. NIFTY still has the blocks
def _nifty_strikes() -> tuple[list[dict], float]:
    spot = 26000.0
    rows = []
    for i, (ce_oi, pe_oi) in enumerate(
            [(1000, 8000), (9000, 12000), (5000, 2000), (3000, 500)]):
        strike = spot + (i - 2) * 50.0
        rows.append({
            "strike": strike,
            "ce": _leg(30.0, ce_oi, ce_oi - 10, 100),
            "pe": _leg(25.0, pe_oi, pe_oi + 10, 50),
        })
    return opr.build_strikes(rows), spot


def _nifty_candles(n: int = 60) -> list[dict]:
    closes = [26000.0 + i * 0.5 + (i % 5 - 2) for i in range(n)]
    return [{"time": f"2026-10-29T09:{16 + i // 60:02d}:{i % 60:02d}+05:30",
             "open": c - 1, "high": c + 2, "low": c - 2, "close": c,
             "volume": 100} for i, c in enumerate(closes)]


def test_nifty_live_still_carries_the_blocks(monkeypatch, tmp_path):
    import api.reports_api.nifty as nifty

    nifty._live_cache.clear()
    rows, spot = _nifty_strikes()
    report = nifty.build_report(EXPIRY, spot, rows, "live",
                                candles=_nifty_candles())
    # A resolved pivots block spares the Upstox pivot fetch inside the attach.
    report["pivots"] = {"pp": 25950.0, "prev": {"close": 25900.0,
                                                "date": "2026-10-28"}}

    async def fake_baseline(today):
        return 50.0

    async def no_intraday(today):
        return None

    monkeypatch.setattr(nifty, "read_tape", lambda date: [])
    monkeypatch.setattr(nifty, "_today_str", lambda: "2026-10-29")
    monkeypatch.setattr(nv, "get_baseline_range", fake_baseline)
    monkeypatch.setattr(nv, "get_intraday_candles", no_intraday)

    asyncio.run(nifty._attach_verdicts(report, rows, spot, "2026-10-29"))

    assert isinstance(report["control"]["verdict"], str)
    assert isinstance(report["regime"]["verdict"], str)
    assert isinstance(report["strength"]["verdict"], str)
    assert isinstance(report["vix"]["ltp"], (int, float))
    assert isinstance(report["positioning"]["verdict"], str)
    assert isinstance(report["gex"]["net_total"], (int, float))


def test_nifty_replay_still_carries_the_blocks(monkeypatch, tmp_path):
    import api.reports_api.nifty as nifty

    rows, spot = _nifty_strikes()
    report = nifty.build_report(EXPIRY, spot, rows, "live")
    report.update({
        "control": {"verdict": "call writers active"},
        "regime": {"verdict": "trend", "rv": 10.0, "iv": 12.5,
                   "rv_iv_ratio": 0.8},
        "vix": {"ltp": 12.5, "prev_close": 12.0, "change_pct": 4.17},
        "strength": {"verdict": "neutral", "score": 50, "rsi": 55.0},
        "pivots": {"pp": 25950.0},
        "reference": {"strike": spot, "ce_ltp": 30.0, "pe_ltp": 25.0},
        "market": {"is_open": False},
        "timeline": [{"time": "t", "event": "snapshot", "detail": "d"}],
    })
    date = "2026-10-28"
    monkeypatch.setattr(nifty, "SNAPSHOT_LOG_DIR", tmp_path)
    nifty._SLIM_CACHE.update(key=None, rows=None)
    t = f"{date}T10:00:00+05:30"
    with open(tmp_path / f"{date}.jsonl", "w") as fh:
        fh.write(json.dumps({"t": t, "fetched_at": t, "report": report}) + "\n")

    served = nifty.get_nifty_replay(date)
    assert served["count"] == 1
    got = served["snapshots"][0]["report"]
    for key in ("control", "regime", "vix", "strength", "pivots",
                "reference", "market", "timeline"):
        assert key in got, key

    single = nifty.get_nifty_replay(date, t=t)
    assert single["snapshot"]["report"]["control"]["verdict"]


@pytest.mark.parametrize("symbol", SYMBOLS)
def test_generic_symbol_never_reads_nifty_state(symbol, mocked_live,
                                               tmp_path, monkeypatch):
    """Poison every NIFTY-owned store; the generic report must not notice."""
    import api.reports_api.nifty as nifty

    nifty._live_cache.clear()
    nifty._live_cache["default"] = {"ts": 9999999999.0,
                                    "data": {"spot": -1.0}}
    monkeypatch.setattr(nifty, "TAPE_DIR", tmp_path / "nifty_tape")
    nifty.tape_path("2026-10-29").parent.mkdir(parents=True, exist_ok=True)
    nifty.tape_path("2026-10-29").write_text(json.dumps({
        "t": f"{_today()}T09:20:00+05:30", "atm_strike": SPOTS[symbol],
        "atm_ce_ltp": 999.0, "atm_pe_ltp": 999.0,
    }) + "\n")
    if hasattr(nifty, "_PIVOTS_CACHE"):
        try:
            nifty._PIVOTS_CACHE.update(date=None, value=None)
        except Exception:
            pass

    report = _live(symbol)

    assert nifty._live_cache["default"]["data"]["spot"] == -1.0  # untouched
    # The poisoned NIFTY tape (999s) never leaks into the symbol frame.
    assert report["reference"]["ce_ltp"] != 999.0
    assert report["spot"] == SPOTS[symbol]
    assert report["vix"]["source"] == "INDIA_VIX"
    assert isinstance(report["control"]["verdict"], str)
    assert isinstance(report["regime"]["verdict"], str)
