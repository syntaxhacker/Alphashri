"""Tests for api/options_screener.py.

Everything here is pure or monkeypatched — no Upstox token, no network, no
43 MB instrument file read.
"""

import time
from datetime import date, datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import options_screener as mod


# ---------------------------------------------------------------------------
# Fixtures / builders
# ---------------------------------------------------------------------------

def _ms(year: int, month: int, day: int) -> int:
    return int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)


def _contract(symbol, strike, expiry="2026-11-23", lot=1000, key="NSE_EQ|TEST"):
    return {
        "symbol": symbol,
        "underlying_key": key,
        "expiry": expiry,
        "lot_size": lot,
        "strike": strike,
        "instrument_type": "CE",
    }


CONTRACTS = [
    _contract("IRFC", 85.0),
    _contract("IRFC", 90.0),
    _contract("IRFC", 95.0),
    _contract("WEAKCO", 105.0, key="NSE_EQ|WEAK"),
    # A later expiry must never leak into the near-expiry universe.
    _contract("IRFC", 90.0, expiry="2026-12-29"),
]

CALL_IRFC_90 = {
    "strike": 90.0, "ltp": 0.67, "bid": 0.66, "ask": 0.68,
    "oi": 6_526_275.0, "volume": 17_132_150.0,
    "delta": 0.204, "gamma": 0.044, "theta": -0.065, "vega": 0.047,
    "iv": 39.1, "pop": 15.8,
}

CHAINS = {
    "IRFC": {
        "spot": 83.5,
        "calls": [
            {"strike": 85.0, "ltp": 1.5, "bid": 1.49, "ask": 1.51,
             "oi": 500_000.0, "volume": 50_000.0, "delta": 0.45,
             "gamma": 0.05, "theta": -0.05, "vega": 0.04, "iv": 40.0,
             "pop": 40.0},
            CALL_IRFC_90,
            {"strike": 95.0, "ltp": 0.2, "bid": 0.199, "ask": 0.201,
             "oi": 500_000.0, "volume": 50_000.0, "delta": 0.1,
             "gamma": 0.02, "theta": -0.02, "vega": 0.02, "iv": 42.0,
             "pop": 10.0},
        ],
    },
    "WEAKCO": {
        "spot": 100.0,
        "calls": [
            {"strike": 105.0, "ltp": 1.0, "bid": 0.98, "ask": 1.02,
             "oi": 200_000.0, "volume": 50_000.0, "delta": 0.3,
             "gamma": 0.02, "theta": -0.03, "vega": 0.03, "iv": 45.0,
             "pop": 10.0},
        ],
    },
}

MOMENTUM = {
    "IRFC": {
        "last": 83.5, "d1": 3.8, "d5": 10.4, "hi20": 84.0,
        "sma20": 77.5, "avg_volume": 8_000_000.0, "vol_ratio": 2.03,
        "above20": 7.8, "setup": "BREAKOUT",
    },
    "WEAKCO": {
        "last": 100.0, "d1": -2.0, "d5": -5.0, "hi20": 110.0,
        "sma20": 106.0, "avg_volume": 1_000_000.0, "vol_ratio": 0.8,
        "above20": -6.0, "setup": "WEAK",
    },
}


def internal_row(**overrides):
    base = {
        "symbol": "X", "spot": 100.0, "d1": 2.0, "d5": 6.0,
        "vol_ratio": 1.5, "above20": 5.0, "setup": "BREAKOUT",
        "call": "105 CE", "strike": 105.0, "otm_pct": 5.0,
        "premium": 1.0, "cost_lot": 1000, "breakeven": 106.0,
        "pop": 15.0, "delta": 0.3, "gamma": 0.02, "theta": -0.02,
        "vega": 0.03, "iv": 35.0, "oi": 100_000, "volume": 20_000,
        "spread_pct": 2.0, "move_2pct_est": 50.0, "_hi20": 105.0,
    }
    base.update(overrides)
    return base


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(mod, "_today", lambda: date(2026, 11, 10))
    monkeypatch.setattr(mod, "load_contracts", lambda: CONTRACTS)

    async def fake_chain(symbol, instrument_key, expiry, *, force, sem):
        return CHAINS[symbol]

    async def fake_momentum(symbol, instrument_key, *, force, sem):
        return MOMENTUM[symbol]

    monkeypatch.setattr(mod, "_get_chain", fake_chain)
    monkeypatch.setattr(mod, "_get_momentum", fake_momentum)

    mod._SNAPSHOT_CACHE.clear()
    mod._CHAIN_CACHE.clear()
    mod._MOMENTUM_CACHE.clear()

    app = FastAPI()
    app.include_router(mod.router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Instruments parsing
# ---------------------------------------------------------------------------

def test_parse_instruments_keeps_only_nse_fo_equity_calls():
    raw = [
        {"segment": "NSE_FO", "asset_type": "EQUITY", "instrument_type": "CE",
         "expiry": _ms(2026, 11, 23), "underlying_symbol": "IRFC",
         "underlying_key": "NSE_EQ|INE053F01010", "lot_size": 1200,
         "strike_price": 90.0},
        # wrong segment
        {"segment": "NSE_EQ", "asset_type": "EQUITY", "instrument_type": "CE",
         "expiry": _ms(2026, 11, 23), "underlying_symbol": "X", "lot_size": 1},
        # put leg
        {"segment": "NSE_FO", "asset_type": "EQUITY", "instrument_type": "PE",
         "expiry": _ms(2026, 11, 23), "underlying_symbol": "Y", "lot_size": 1},
        # index leg
        {"segment": "NSE_FO", "asset_type": "INDEX", "instrument_type": "CE",
         "expiry": _ms(2026, 11, 23), "underlying_symbol": "NIFTY", "lot_size": 65},
    ]
    parsed = mod.parse_instruments(raw)
    assert len(parsed) == 1
    assert parsed[0]["symbol"] == "IRFC"
    assert parsed[0]["expiry"] == "2026-11-23"
    assert parsed[0]["lot_size"] == 1200
    assert parsed[0]["underlying_key"] == "NSE_EQ|INE053F01010"


def test_list_expiries_filters_past_and_sorts():
    contracts = [
        _contract("A", 100.0, expiry="2026-12-29"),
        _contract("A", 100.0, expiry="2026-11-23"),
        _contract("A", 100.0, expiry="2026-01-01"),
    ]
    assert mod.list_expiries(contracts, date(2026, 11, 10)) == [
        "2026-11-23", "2026-12-29",
    ]


def test_universe_for_expiry_dedupes_and_keeps_lot():
    universe = mod.universe_for_expiry(CONTRACTS, "2026-11-23")
    assert set(universe) == {"IRFC", "WEAKCO"}
    assert universe["IRFC"]["lot_size"] == 1000
    assert universe["IRFC"]["underlying_key"] == "NSE_EQ|TEST"
    assert universe["WEAKCO"]["underlying_key"] == "NSE_EQ|WEAK"


# ---------------------------------------------------------------------------
# Momentum / setup
# ---------------------------------------------------------------------------

def _series(closes, volumes=None):
    volumes = volumes or [1000.0] * len(closes)
    return [
        [f"2026-10-{i + 1:02d}", c, c, c, c, v, 0]
        for i, (c, v) in enumerate(zip(closes, volumes))
    ]


def test_momentum_from_candles_breakout():
    closes = [100.0] * 24 + [110.0]
    volumes = [1000.0] * 24 + [2000.0]
    mom = mod.momentum_from_candles(_series(closes, volumes))

    assert mom["last"] == 110.0
    assert mom["d1"] == pytest.approx(10.0)
    assert mom["d5"] == pytest.approx(10.0)
    assert mom["hi20"] == 110.0
    assert mom["vol_ratio"] == pytest.approx(2.0)
    assert mom["above20"] == pytest.approx((110 / 100.5 - 1) * 100)
    assert mom["setup"] == "BREAKOUT"


def test_momentum_from_candles_weak():
    closes = [float(100 - i) for i in range(25)]  # 100 .. 76
    mom = mod.momentum_from_candles(_series(closes))
    assert mom["d1"] < 0 and mom["d5"] < 0
    assert mom["setup"] == "WEAK"


def test_momentum_from_candles_rejects_short_series():
    assert mod.momentum_from_candles([[0, 1, 1, 1, 100, 10, 0]]) is None


@pytest.mark.parametrize(
    "kwargs,expected",
    [
        (dict(last=99.5, hi20=100, vol_ratio=1.1, d5=5, above20=5), "BREAKOUT"),
        (dict(last=98.5, hi20=100, vol_ratio=1.0, d5=5, above20=5), "NEAR HIGH"),
        (dict(last=90, hi20=100, vol_ratio=1.0, d5=13, above20=5), "EXTENDED"),
        (dict(last=100, hi20=110, vol_ratio=0.8, d5=2, above20=1), "BASE"),
        (dict(last=90, hi20=100, vol_ratio=0.8, d5=-5, above20=-10, d1=-1),
         "WEAK"),
        (dict(last=95, hi20=100, vol_ratio=1.0, d5=2, above20=5, d1=1), "WATCH"),
    ],
)
def test_classify_setup(kwargs, expected):
    assert mod.classify_setup(**kwargs) == expected


# ---------------------------------------------------------------------------
# Option math
# ---------------------------------------------------------------------------

def test_move_2pct_est_matches_reference_number():
    # The documented IRFC example: delta .204, gamma .044, spot 83.5, prem .67
    assert mod.move_2pct_est(0.204, 0.044, 83.5, 0.67) == pytest.approx(60.0, abs=0.1)


def test_move_2pct_est_clamps_and_guards():
    assert mod.move_2pct_est(100.0, 100.0, 100.0, 0.01) == 500.0
    assert mod.move_2pct_est(0.2, 0.04, 100.0, 0.0) == 0.0


def test_spread_pct_and_missing_quote():
    assert mod.spread_pct(0.66, 0.68) == pytest.approx(2.985, abs=0.01)
    assert mod.spread_pct(0.0, 0.0) is None


def test_parse_chain_flattens_market_and_greeks():
    payload = {
        "underlying_spot_price": 83.5,
        "data": [
            {"strike_price": 90.0, "call_options": {
                "market_data": {"ltp": 0.67, "bid_price": 0.66,
                                "ask_price": 0.68, "oi": 6_500_000,
                                "volume": 17_000_000},
                "option_greeks": {"delta": 0.204, "gamma": 0.044,
                                  "theta": -0.065, "vega": 0.047,
                                  "iv": 39.1, "pop": 15.8},
            }},
        ],
    }
    chain = mod.parse_chain(payload)
    assert chain["spot"] == 83.5
    assert len(chain["calls"]) == 1
    call = chain["calls"][0]
    assert call["strike"] == 90.0
    assert call["ltp"] == 0.67
    assert call["pop"] == 15.8


# ---------------------------------------------------------------------------
# Candidate building / presets
# ---------------------------------------------------------------------------

def test_build_candidates_inclusion_gates():
    rows = mod.build_candidates("IRFC", MOMENTUM["IRFC"], CHAINS["IRFC"], 1000)
    # 85 CE is 1.8% OTM (<2) and 95 CE is 13.8% OTM (>10); only 90 CE survives.
    assert len(rows) == 1
    row = rows[0]
    assert row["call"] == "90 CE"
    assert row["otm_pct"] == pytest.approx(7.78, abs=0.01)
    assert row["cost_lot"] == 670
    assert row["breakeven"] == pytest.approx(90.67)
    assert row["spread_pct"] == pytest.approx(3.0, abs=0.1)
    assert row["move_2pct_est"] == pytest.approx(60.0, abs=0.2)
    assert "90" in row["call"]


def test_build_candidates_rejects_late_otm_and_cheap_premium():
    chain = {"spot": 100.0, "calls": [
        dict(CALL_IRFC_90, strike=120.0),          # 20% OTM
        dict(CALL_IRFC_90, strike=105.0, ltp=0.01),  # premium too small
    ]}
    assert mod.build_candidates("X", MOMENTUM["IRFC"], chain, 1000) == []


def test_apply_preset_cheap_momentum_and_weak_exclusion():
    rows = [
        internal_row(symbol="PASS"),
        internal_row(symbol="EXPENSIVE", cost_lot=3500),
        internal_row(symbol="WEAK", setup="WEAK"),
        internal_row(symbol="SLOW", d5=2.0),
        internal_row(symbol="FLAT", d1=-1.0),
    ]
    kept = mod.apply_preset(rows, "cheap_momentum")
    assert [r["symbol"] for r in kept] == ["PASS"]


def test_apply_preset_sorts_each_preset():
    rows = [
        internal_row(symbol="A", cost_lot=4500, pop=6, d1=0.5, d5=0.5,
                     move_2pct_est=40),
        internal_row(symbol="B", cost_lot=4500, pop=6, d1=0.5, d5=0.5,
                     move_2pct_est=90),
    ]
    assert [r["symbol"] for r in mod.apply_preset(rows, "max_torque")] == ["B", "A"]

    balanced = [
        internal_row(symbol="LOWPOP", cost_lot=9000, pop=13, move_2pct_est=99),
        internal_row(symbol="HIGHPOP", cost_lot=9000, pop=18, move_2pct_est=1),
    ]
    assert [r["symbol"] for r in mod.apply_preset(balanced, "balanced")] == [
        "HIGHPOP", "LOWPOP",
    ]

    breakout = [
        internal_row(symbol="NEAR", spot=99, _hi20=100, vol_ratio=1.2),
        internal_row(symbol="FAR", spot=97, _hi20=100, vol_ratio=1.2),
    ]
    assert [r["symbol"] for r in mod.apply_preset(breakout, "breakout")] == ["NEAR"]


def test_user_overrides_replace_preset_defaults():
    rows = [internal_row(symbol="MID", cost_lot=3500, pop=10)]
    assert mod.apply_preset(rows, "cheap_momentum") == []
    assert [r["symbol"] for r in mod.apply_preset(
        rows, "cheap_momentum", max_cost=4000
    )] == ["MID"]

    rows = [internal_row(symbol="LOWVOL", volume=5_000)]
    assert len(mod.apply_preset(rows, "max_torque")) == 1
    # min_volume adds a filter on top of the preset
    assert mod.apply_preset(rows, "max_torque", min_volume=10_000) == []


def test_public_row_strips_internal_keys():
    public = mod.public_row(internal_row())
    assert "_hi20" not in public
    assert public["symbol"] == "X"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

def test_endpoint_returns_ranked_rows(client):
    resp = client.get("/api/options/screener")
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "ok"
    assert body["expiry"] == "2026-11-23"
    assert body["preset"] == "cheap_momentum"
    assert body["scanned"] == 2          # IRFC + WEAKCO
    assert body["matched"] == 1          # WEAKCO fails cheap_momentum
    assert body["stale"] is False
    assert body["expiries"] == [
        {"date": "2026-11-23", "days_to_expiry": 13},
        {"date": "2026-12-29", "days_to_expiry": 49},
    ]

    row = body["rows"][0]
    assert row["symbol"] == "IRFC"
    assert row["setup"] == "BREAKOUT"
    assert row["call"] == "90 CE"
    assert row["strike"] == 90.0
    assert row["otm_pct"] == pytest.approx(7.78, abs=0.01)
    assert row["premium"] == 0.67
    assert row["cost_lot"] == 670
    assert row["breakeven"] == pytest.approx(90.67)
    assert row["pop"] == 15.8
    assert row["delta"] == 0.204
    assert row["oi"] == 6_526_275
    assert row["volume"] == 17_132_150
    assert row["spread_pct"] == pytest.approx(3.0, abs=0.1)
    assert row["move_2pct_est"] == pytest.approx(60.0, abs=0.2)
    assert "_hi20" not in row


def test_endpoint_respects_limit_and_preset(client):
    body = client.get("/api/options/screener?preset=high_pop&limit=1").json()
    assert body["preset"] == "high_pop"
    assert len(body["rows"]) <= 1


def test_endpoint_otm_bounds_apply_without_rebuild(client):
    default = client.get("/api/options/screener").json()
    assert [r["strike"] for r in default["rows"]] == [90.0]

    widened = client.get("/api/options/screener?otm_max=20").json()
    assert sorted(r["strike"] for r in widened["rows"]) == [90.0, 95.0]
    # Same snapshot, different per-request filter.
    assert widened["matched"] == 2


def test_endpoint_rejects_bad_preset(client):
    resp = client.get("/api/options/screener?preset=nope")
    assert resp.status_code == 400
    assert "unknown preset" in resp.json()["detail"]


def test_endpoint_rejects_bad_expiry(client):
    assert client.get("/api/options/screener?expiry=07-03-2026").status_code == 400
    assert client.get("/api/options/screener?expiry=2026-12-31").status_code == 400


def test_endpoint_rejects_inverted_otm_bounds(client):
    resp = client.get("/api/options/screener?otm_min=10&otm_max=2")
    assert resp.status_code == 400


def test_endpoint_serves_stale_snapshot_on_refresh_failure(client, monkeypatch):
    snapshot = {
        "as_of": "2026-11-10T09:15:00+05:30",
        "scanned": 1,
        "rows": [internal_row(symbol="CACHED")],
        "errors": [],
        "warnings": [],
    }
    mod._SNAPSHOT_CACHE["2026-11-23"] = (time.monotonic(), snapshot)

    async def broken(*args, **kwargs):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(mod, "_build_snapshot", broken)

    resp = client.get("/api/options/screener?refresh=true")
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is True
    assert body["rows"][0]["symbol"] == "CACHED"
    assert any("refresh failed" in w for w in body["warnings"])


def test_endpoint_empty_when_instruments_missing(client, monkeypatch):
    def missing():
        raise FileNotFoundError("nse_instruments.json")

    monkeypatch.setattr(mod, "load_contracts", missing)
    body = client.get("/api/options/screener").json()
    assert body["status"] == "ok"
    assert body["rows"] == []
    assert body["errors"][0]["stage"] == "instruments"
