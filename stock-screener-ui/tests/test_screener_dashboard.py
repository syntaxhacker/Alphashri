"""Tests for api/screener_api/dashboard.py (mocked TV + mocked candles)."""
import json

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.screener_api import dashboard
from api.screener_api.dashboard import normalize_spark

COLS = [
    "name", "close", "change", "volume", "average_volume_10d_calc",
    "relative_volume_10d_calc", "market_cap_basic", "logoid", "gap",
    "price_52_week_high", "price_52_week_low", "ATR", "RSI", "VWAP",
    "high", "low", "Value.Traded",
    "sector", "industry",
]

UNIVERSE = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"]


def _row(name, **kw):
    base = dict.fromkeys(COLS)
    base.update(
        name=name, sector="S", industry="I",
        market_cap_basic=6e9,  # 600 Cr — above the 500 Cr default floor
        RSI=55.0, VWAP=None,
    )
    base.update(kw)
    return base


def _frame():
    return pd.DataFrame(
        [
            _row("AAA", close=100.0, change=9.5, volume=1e6,
                 average_volume_10d_calc=2e5, relative_volume_10d_calc=5.0,
                 logoid="aaa-corp", gap=9.3, price_52_week_high=105.0,
                 price_52_week_low=60.0,
                 ATR=2.0, RSI=62.0, VWAP=99.0,
                 high=102.0, low=100.0, **{"Value.Traded": 500.0}),
            _row("BBB", close=200.0, change=3.0, volume=5e6,
                 average_volume_10d_calc=5e6, relative_volume_10d_calc=1.0,
                 logoid="", gap=0.1, price_52_week_high=200.5,
                 price_52_week_low=199.5,
                 ATR=5.0, RSI=55.0, VWAP=201.0,
                 high=205.0, low=200.0, **{"Value.Traded": 3.2e10}),
            _row("CCC", close=50.0, change=-8.0, volume=2e6,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=135.5,
                 logoid="0", gap=-4.2, price_52_week_high=100.0,
                 price_52_week_low=49.0,
                 ATR=1.0, RSI=40.0, VWAP=51.0,
                 high=55.0, low=51.0, **{"Value.Traded": 100.0}),
            _row("DDD", close=300.0, change=1.0, volume=1e5,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=2.0,
                 logoid="weird slug!", gap=3.5, price_52_week_high=400.0,
                 price_52_week_low=290.0,
                 ATR=0.0, RSI=50.0, VWAP=299.0,
                 high=301.0, low=299.0, **{"Value.Traded": 10.0}),
            _row("EEE", close=150.0, change=float("nan"), volume=9e6,
                 average_volume_10d_calc=float("nan"),
                 relative_volume_10d_calc=1.0,
                 logoid=None, gap=0.0, price_52_week_high=500.0,
                 price_52_week_low=100.0,
                 ATR=3.0, RSI=48.0, VWAP=150.5,
                 high=152.0, low=148.0, **{"Value.Traded": 50.0}),
            _row("FFF", close=80.0, change=0.5, volume=1e5,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=1.0,
                 logoid="fff-ltd", gap=-3.0, price_52_week_high=82.0,
                 price_52_week_low=78.0,
                 ATR=2.0, RSI=52.0, VWAP=80.2,
                 high=81.0, low=80.0, **{"Value.Traded": 5.0}),
            _row("GGG", close=90.0, change=2.0, volume=3e5,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=3.0,
                 logoid="ggg", gap=0.5, price_52_week_high=95.0,
                 price_52_week_low=88.0,
                 ATR=1.0, RSI=58.0, VWAP=89.5,
                 high=91.0, low=90.0, **{"Value.Traded": 8.0}),
            _row("HHH", close=120.0, change=4.0, volume=4e5,
                 average_volume_10d_calc=2e5, relative_volume_10d_calc=1.5,
                 logoid="hhh", gap=3.0, price_52_week_high=130.0,
                 price_52_week_low=119.0,
                 ATR=4.0, RSI=60.0, VWAP=119.0,
                 high=124.0, low=120.0, **{"Value.Traded": 12.0}),
            # Not in the universe — must never appear.
            _row("ZZZ", close=10.0, change=99.0, volume=9e9,
                 average_volume_10d_calc=1.0, relative_volume_10d_calc=999.0,
                 logoid="zzz", gap=50.0, price_52_week_high=10.1,
                 price_52_week_low=9.0,
                 ATR=0.1, RSI=70.0, VWAP=10.0,
                 high=20.0, low=1.0, **{"Value.Traded": 9e9}),
        ],
        columns=COLS,
    )


class _FakeQuery:
    frame = None
    boom = False

    def __init__(self, *a, **k):
        pass

    def select(self, *a):
        return self

    def set_markets(self, *a):
        return self

    def limit(self, *a):
        return self

    def get_scanner_data(self):
        if _FakeQuery.boom:
            raise RuntimeError("TV down")
        return 0, _FakeQuery.frame


def _candles(symbol, timeframe="1m", **kw):
    if symbol == "CCC":
        raise RuntimeError("no candles")
    closes = list(range(1, 41))  # 40 bars -> last 30 kept
    return pd.DataFrame({"close": closes})


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    import tradingview_screener
    import chart_patterns.candles as candles
    import chart_patterns.universes as universes

    dashboard.clear_cache()
    _FakeQuery.frame = _frame()
    _FakeQuery.boom = False
    monkeypatch.setattr(tradingview_screener, "Query", _FakeQuery)
    monkeypatch.setattr(candles, "fetch_for_timeframe", _candles)
    monkeypatch.setattr(universes, "get_universe", lambda uid: list(UNIVERSE))
    yield
    dashboard.clear_cache()


def _client():
    app = FastAPI()
    app.include_router(dashboard.router)
    return TestClient(app)


def _panels(resp, section_id):
    for s in resp["sections"]:
        if s["id"] == section_id:
            return {p["id"]: p for p in s["panels"]}
    raise AssertionError(f"missing section {section_id}")


def test_contract_shape():
    r = _client().get("/api/screener/dashboard?universe=nifty500")
    assert r.status_code == 200
    body = r.json()
    assert body["universe"] == "nifty500"
    assert body["as_of"]
    assert body["total"] == 8
    assert body["cached"] is False
    assert body["age_sec"] == 0.0
    assert [s["id"] for s in body["sections"]] == ["movers", "unusual"]
    assert [p["id"] for p in body["sections"][0]["panels"]] == [
        "gainers", "losers", "near_52w_high", "near_52w_low",
        "most_active", "turnover",
    ]
    for s in body["sections"]:
        for p in s["panels"]:
            assert set(p) == {"id", "title", "metric_label", "qualify", "rows"}
            for row in p["rows"]:
                assert set(row) == {
                    "symbol", "name", "close", "change", "logo",
                    "sub_label", "sub_value", "spark",
                    "rsi", "vwap", "atr", "price_52_week_high", "market_cap",
                }


def test_panel_selection_and_ordering():
    body = _client().get("/api/screener/dashboard").json()
    movers = _panels(body, "movers")
    unusual = _panels(body, "unusual")

    assert [r["symbol"] for r in movers["gainers"]["rows"]][:3] == ["AAA", "HHH", "BBB"]
    assert [r["symbol"] for r in movers["losers"]["rows"]][:3] == ["CCC", "FFF", "DDD"]
    near = [r["symbol"] for r in movers["near_52w_high"]["rows"]]
    assert near == ["BBB", "FFF", "AAA"]  # nearest to the high first
    assert "CCC" not in near  # 50% away
    assert "GGG" not in near  # 5.3% below — outside the 5% band
    low = [r["symbol"] for r in movers["near_52w_low"]["rows"]]
    assert low[0] == "BBB"  # nearest to the low first
    assert set(low) >= {"BBB", "HHH", "CCC", "FFF"}
    assert "AAA" not in low  # far above its low
    assert movers["most_active"]["rows"][0]["symbol"] == "EEE"
    assert movers["turnover"]["rows"][0]["symbol"] == "BBB"

    assert [r["symbol"] for r in unusual["volume_surge"]["rows"]] == ["CCC", "AAA", "GGG"]
    assert unusual["volume_surge"]["qualify"] == 3
    assert [r["symbol"] for r in unusual["gap_up"]["rows"]] == ["AAA", "DDD", "HHH"]
    assert [r["symbol"] for r in unusual["gap_down"]["rows"]] == ["CCC", "FFF"]
    assert unusual["range_expansion"]["rows"][0]["symbol"] == "CCC"
    assert unusual["gap_up"]["qualify"] == 3
    assert unusual["gap_down"]["qualify"] == 2


def test_above_52w_high_excluded(monkeypatch):
    """Regression: names trading ABOVE their 52W high are not 'near' it."""
    import chart_patterns.universes as universes

    frame = pd.DataFrame(
        [
            _row("IVY", close=108.0, change=6.0, volume=1e6,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=2.0,
                 logoid="ivy", gap=0.0, price_52_week_high=100.0,  # +8% above
                 price_52_week_low=50.0, ATR=1.0, high=109.0, low=107.0,
                 **{"Value.Traded": 10.0}),
            _row("HAIR", close=100.4, change=1.0, volume=1e6,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=2.0,
                 logoid="hair", gap=0.0, price_52_week_high=100.0,  # +0.4% above
                 price_52_week_low=50.0, ATR=1.0, high=101.0, low=100.0,
                 **{"Value.Traded": 10.0}),
        ],
        columns=COLS,
    )
    _FakeQuery.frame = frame
    monkeypatch.setattr(universes, "get_universe", lambda uid: ["IVY", "HAIR"])
    movers = _panels(_client().get("/api/screener/dashboard").json(), "movers")
    near = [r["symbol"] for r in movers["near_52w_high"]["rows"]]
    assert "IVY" not in near  # +8% above the high must be excluded
    assert "HAIR" in near  # hair above (within +0.5%) still counts


def test_losers_biggest_first():
    body = _client().get("/api/screener/dashboard").json()
    losers = _panels(body, "movers")["losers"]["rows"]
    changes = [r["change"] for r in losers]
    assert changes == sorted(changes)  # ascending: biggest losers first
    assert losers[0]["symbol"] == "CCC"


def test_limit_param_caps_rows():
    default = _client().get("/api/screener/dashboard").json()
    movers = _panels(default, "movers")
    assert len(movers["gainers"]["rows"]) == 7  # 7 with non-null change
    capped = _client().get("/api/screener/dashboard?limit=4").json()
    for s in capped["sections"]:
        for p in s["panels"]:
            assert len(p["rows"]) <= 4
    assert len(_panels(capped, "movers")["gainers"]["rows"]) == 4


def test_limit_validation():
    assert _client().get("/api/screener/dashboard?limit=2").status_code == 422
    assert _client().get("/api/screener/dashboard?limit=31").status_code == 422


def test_market_cap_floor(monkeypatch):
    """Default 500 Cr floor drops small-caps; min_market_cap_cr=0 keeps them."""
    import chart_patterns.universes as universes

    frame = pd.DataFrame(
        [
            _row("BIG", close=100.0, change=5.0, volume=1e6,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=1.0,
                 market_cap_basic=6e9, logoid="big", gap=0.0,
                 price_52_week_high=110.0, price_52_week_low=90.0,
                 ATR=1.0, high=101.0, low=99.0, **{"Value.Traded": 10.0}),
            _row("SMALL", close=10.0, change=9.0, volume=1e6,
                 average_volume_10d_calc=1e5, relative_volume_10d_calc=1.0,
                 market_cap_basic=1e9,  # 100 Cr — below the floor
                 logoid="small", gap=0.0,
                 price_52_week_high=11.0, price_52_week_low=9.0,
                 ATR=0.5, high=10.5, low=9.5, **{"Value.Traded": 10.0}),
        ],
        columns=COLS,
    )
    _FakeQuery.frame = frame
    monkeypatch.setattr(universes, "get_universe", lambda uid: ["BIG", "SMALL"])
    client = _client()
    body = client.get("/api/screener/dashboard").json()
    assert body["total"] == 1
    assert "SMALL" not in json.dumps(body)
    body_all = client.get("/api/screener/dashboard?min_market_cap_cr=0").json()
    assert body_all["total"] == 2
    assert "SMALL" in json.dumps(body_all)


def test_extra_row_fields():
    body = _client().get("/api/screener/dashboard").json()
    gain = {
        r["symbol"]: r for r in _panels(body, "movers")["gainers"]["rows"]
    }
    aaa = gain["AAA"]
    assert aaa["rsi"] == 62.0
    assert aaa["vwap"] == 99.0
    assert aaa["atr"] == 2.0
    assert aaa["price_52_week_high"] == 105.0
    assert aaa["market_cap"] == 6e9


def test_cached_flag_on_second_hit():
    client = _client()
    first = client.get("/api/screener/dashboard").json()
    assert first["cached"] is False
    second = client.get("/api/screener/dashboard").json()
    assert second["cached"] is True
    assert second["age_sec"] >= 0.0
    assert second["as_of"] == first["as_of"]


def test_metric_formatting():
    body = _client().get("/api/screener/dashboard").json()
    movers = _panels(body, "movers")
    unusual = _panels(body, "unusual")

    near = {r["symbol"]: r for r in movers["near_52w_high"]["rows"]}
    assert near["BBB"]["sub_value"] == "at level"
    assert near["AAA"]["sub_value"] == "-4.8% to high"

    low = {r["symbol"]: r for r in movers["near_52w_low"]["rows"]}
    assert low["BBB"]["sub_value"] == "at level"
    assert low["CCC"]["sub_value"] == "2.0% above low"

    gain = {r["symbol"]: r for r in movers["gainers"]["rows"]}
    assert gain["AAA"]["sub_value"] == "5.0x avg"

    active = {r["symbol"]: r for r in movers["most_active"]["rows"]}
    assert active["AAA"]["sub_value"] == "₹10.0 Cr · 5.0x avg"

    turn = {r["symbol"]: r for r in movers["turnover"]["rows"]}
    assert turn["BBB"]["sub_value"] == "₹3.2k Cr"

    surge = {r["symbol"]: r for r in unusual["volume_surge"]["rows"]}
    assert surge["CCC"]["sub_value"] == "135.5x rel. volume"

    gap = {r["symbol"]: r for r in unusual["gap_up"]["rows"]}
    assert gap["AAA"]["sub_value"] == "+9.3% gap at open"

    rng = {r["symbol"]: r for r in unusual["range_expansion"]["rows"]}
    assert rng["CCC"]["sub_value"] == "4.0x range ÷ ATR"


def test_logo_url_vs_null():
    body = _client().get("/api/screener/dashboard").json()
    movers = _panels(body, "movers")
    gain = {r["symbol"]: r for r in movers["gainers"]["rows"]}
    assert gain["AAA"]["logo"] == "https://s3-symbol-logo.tradingview.com/aaa-corp.svg"
    assert gain["BBB"]["logo"] is None  # empty slug
    unusual = _panels(body, "unusual")
    surge = {r["symbol"]: r for r in unusual["volume_surge"]["rows"]}
    assert surge["CCC"]["logo"] is None  # logoid "0"
    gap = {r["symbol"]: r for r in unusual["gap_up"]["rows"]}
    assert gap["DDD"]["logo"] is None  # illegal chars
    assert gain["HHH"]["logo"] == "https://s3-symbol-logo.tradingview.com/hhh.svg"


def test_spark_normalization_and_fail_soft():
    body = _client().get("/api/screener/dashboard").json()
    movers = _panels(body, "movers")
    gain = {r["symbol"]: r for r in movers["gainers"]["rows"]}
    spark = gain["AAA"]["spark"]
    assert len(spark) == 30
    assert min(spark) == 0.0 and max(spark) == 1.0
    assert spark == sorted(spark)
    unusual = _panels(body, "unusual")
    surge = {r["symbol"]: r for r in unusual["volume_surge"]["rows"]}
    assert surge["CCC"]["spark"] == []  # candle fetch raised


def test_normalize_spark_flat_and_empty():
    assert normalize_spark([5.0, 5.0, 5.0]) == [0.5, 0.5, 0.5]
    assert normalize_spark([]) == []
    assert normalize_spark([float("nan")]) == []


def test_empty_frame_gives_empty_sections():
    _FakeQuery.frame = pd.DataFrame(columns=COLS)
    body = _client().get("/api/screener/dashboard").json()
    assert body["total"] == 0
    assert body["sections"] == []


def test_universe_filtering():
    body = _client().get("/api/screener/dashboard").json()
    text = json.dumps(body)
    assert "ZZZ" not in text


def test_nan_to_null():
    body = _client().get("/api/screener/dashboard").json()
    json.dumps(body)  # must be JSON-serializable
    movers = _panels(body, "movers")
    active = {r["symbol"]: r for r in movers["most_active"]["rows"]}
    assert active["EEE"]["change"] is None
    assert "nan" not in json.dumps(body).lower()


def test_tv_error_is_fail_soft():
    _FakeQuery.boom = True
    r = _client().get("/api/screener/dashboard")
    assert r.status_code == 200
    assert r.json()["sections"] == []


def test_unknown_universe_is_fail_soft(monkeypatch):
    import chart_patterns.universes as universes

    def _raise(uid):
        raise ValueError(f"Unknown universe {uid!r}")

    monkeypatch.setattr(universes, "get_universe", _raise)
    r = _client().get("/api/screener/dashboard?universe=bogus")
    assert r.status_code == 200
    assert r.json()["sections"] == []
