"""Tests for api.value_scan.scoring — pure engine, no network, deterministic."""

from api.value_scan.scoring import ScoreConfig, peer_medians, score_row, sector_bucket


def make_row(**overrides):
    """A healthy mid-cap row that passes the SERIOUS gates."""
    row = {
        "name": "NSE:TEST",
        "description": "Test Co",
        "sector": "Technology",
        "close": 100.0,
        "SMA200": 90.0,
        "price_52_week_high": 120.0,
        "volume": 1_000_000.0,
        "market_cap_basic": 20e9,
        "price_earnings_ttm": 10.0,
        "price_sales_ratio": 1.0,
        "price_book_fq": 2.0,
        "return_on_equity_fq": 20.0,
        "gross_margin_ttm": 45.0,
        "operating_margin_ttm": 20.0,
        "debt_to_equity_fq": 0.3,
        "current_ratio": 2.0,
        "free_cash_flow_ttm": 2e9,
        "total_revenue_yoy_growth_ttm": 12.0,
        "earnings_per_share_diluted_yoy_growth_ttm": 10.0,
        "earnings_per_share_diluted_ttm": 5.0,
        "dividends_yield_current": 2.5,
        "RSI": 55.0,
        "Perf.3M": 5.0,
        "Perf.1M": 3.0,
        "Recommend.All": 0.5,
    }
    row.update(overrides)
    return row


def test_sector_bucket_normalises():
    assert sector_bucket("Technology") == "Technology"
    assert sector_bucket(" banks ") == "Banks"
    assert sector_bucket("INSURANCE") == "Insurance"
    assert sector_bucket(None) == "Other"
    assert sector_bucket("  ") == "Other"


def test_score_row_structure_and_invariants():
    peers = peer_medians([make_row()])
    out = score_row(make_row(), peers)
    assert set(out["subscores"]) == {"value", "quality", "growth", "health"}
    for key, val in out["subscores"].items():
        assert isinstance(val, int), key
        assert 0 <= val <= 25, key
    assert isinstance(out["score"], int)
    assert out["score"] == sum(out["subscores"].values())
    assert 0 <= out["score"] <= 100
    assert isinstance(out["flags"], list)
    assert out["derived"]["net_cash"] is None
    assert out["derived"]["fcf_yield"] == 10.0
    assert out["derived"]["earnings_yield"] == 10.0
    assert out["derived"]["distorted_pe"] is False
    assert out["peer"]["bucket"] == "Technology"
    # input row untouched
    row = make_row()
    score_row(row, peers)
    assert "subscores" not in row


def test_cheap_outscores_expensive_identical_other_data():
    peers = peer_medians([make_row(price_earnings_ttm=pe) for pe in (8.0, 12.0, 20.0)])
    cheap = score_row(make_row(price_earnings_ttm=8.0), peers)
    dear = score_row(make_row(price_earnings_ttm=40.0), peers)
    assert cheap["score"] > dear["score"]
    assert cheap["subscores"]["value"] > dear["subscores"]["value"]


def test_loss_making_scores_lower_same_multiples():
    peers = peer_medians([make_row()])
    good = score_row(make_row(earnings_per_share_diluted_ttm=5.0), peers)
    bad = score_row(make_row(earnings_per_share_diluted_ttm=-2.0), peers)
    assert "loss-making" in bad["flags"]
    assert "loss-making" not in good["flags"]
    assert bad["score"] < good["score"]


def test_missing_fundamentals_never_increase_score():
    # Absolute fallback (no peers): P/E 40 earns 0 ey points, so None must tie it.
    no_pe = score_row(make_row(price_earnings_ttm=None), {})
    pe40 = score_row(make_row(price_earnings_ttm=40.0), {})
    assert "no-earnings" in no_pe["flags"]
    assert no_pe["score"] <= pe40["score"]
    # A fully-blank row scores nothing and is flagged.
    blank = score_row({}, {})
    assert blank["score"] == 0
    assert "unknown-fundamentals" in blank["flags"]


def test_banks_ps_ignored_and_pb_carries_nine():
    median_frame = [make_row(sector="Banks", price_book_fq=2.0, price_sales_ratio=1.0) for _ in range(3)]
    peers = peer_medians(median_frame)
    assert peers["Banks"]["pb"] == 2.0
    low_ps = score_row(make_row(sector="Banks", price_sales_ratio=1.0), peers)
    huge_ps = score_row(make_row(sector="Banks", price_sales_ratio=500.0), peers)
    assert low_ps["subscores"]["value"] == huge_ps["subscores"]["value"]
    cheap_pb = score_row(make_row(sector="Banks", price_book_fq=0.5), peers)
    dear_pb = score_row(make_row(sector="Banks", price_book_fq=8.0), peers)
    assert cheap_pb["subscores"]["value"] - dear_pb["subscores"]["value"] == 9
    # Same exemption for Insurance.
    ins_peers = peer_medians([make_row(sector="Insurance") for _ in range(3)])
    a = score_row(make_row(sector="Insurance", price_sales_ratio=1.0), ins_peers)
    b = score_row(make_row(sector="Insurance", price_sales_ratio=500.0), ins_peers)
    assert a["subscores"]["value"] == b["subscores"]["value"]


def test_distorted_pe_flag_and_penalty():
    distorted = score_row(make_row(price_earnings_ttm=4.0, return_on_equity_fq=30.0), {})
    clean = score_row(make_row(price_earnings_ttm=9.0, return_on_equity_fq=30.0), {})
    assert "distorted-pe" in distorted["flags"]
    assert distorted["derived"]["distorted_pe"] is True
    assert "distorted-pe" not in clean["flags"]
    assert distorted["subscores"]["value"] < clean["subscores"]["value"]


def test_peer_medians_prefilter_frame():
    rows = [
        make_row(price_earnings_ttm=10.0),
        make_row(price_earnings_ttm=20.0),
        make_row(price_earnings_ttm=30.0),
    ]
    med = peer_medians(rows)
    assert med["Technology"]["pe"] == 20.0
    # Median ignores missing values instead of treating them as 0.
    med2 = peer_medians([make_row(price_earnings_ttm=10.0), make_row(price_earnings_ttm=None)])
    assert med2["Technology"]["pe"] == 10.0
    # NaN counts as missing too.
    med3 = peer_medians([make_row(price_earnings_ttm=float("nan")), make_row(price_earnings_ttm=14.0)])
    assert med3["Technology"]["pe"] == 14.0


def test_empty_frame_and_absolute_fallback():
    empty = peer_medians([])
    # the reserved __dist__ / __cov__ keys are always present
    assert set(empty) == {"__dist__", "__cov__"}
    assert empty["__dist__"] == {}
    assert empty["__cov__"] == {}
    out = score_row(make_row(), {})
    assert out["score"] == sum(out["subscores"].values())
    assert out["peer"] == {"bucket": "Technology", "pe_median": None, "roe_median": None, "fcf_yield_median": None}
    assert out["_pct"] == {}


def test_no_peer_relative_uses_absolute_bands():
    cfg = ScoreConfig(use_peer_relative=False)
    peers = peer_medians([make_row(price_earnings_ttm=50.0) for _ in range(3)])
    out = score_row(make_row(price_earnings_ttm=8.0), peers, cfg)
    assert out["score"] == sum(out["subscores"].values())
    assert out["subscores"]["value"] >= 10  # ey 0.125 clears the absolute 10-pt bar


def test_no_trend_redistributes_within_subscore():
    cfg = ScoreConfig(penalise_trend=False)
    peers = peer_medians([make_row()])
    out = score_row(make_row(), peers, cfg)
    for key, val in out["subscores"].items():
        assert isinstance(val, int), key
        assert 0 <= val <= 25, key
    assert out["score"] == sum(out["subscores"].values())
    # Trend-following inputs (hot momentum, overbought RSI) earn nothing extra.
    hot = score_row(make_row(**{"Perf.3M": 60.0, "Perf.1M": 40.0, "Recommend.All": 1.0, "RSI": 85.0}), peers, cfg)
    cold = score_row(make_row(**{"Perf.3M": -30.0, "Perf.1M": -20.0, "Recommend.All": -1.0, "RSI": 10.0}), peers, cfg)
    assert hot["subscores"]["growth"] == cold["subscores"]["growth"]
    assert hot["subscores"]["health"] == cold["subscores"]["health"]
    # With penalise_trend on, hot momentum outscores cold momentum on growth.
    on_hot = score_row(make_row(**{"Perf.3M": 60.0, "Perf.1M": 40.0, "Recommend.All": 1.0}), peers)
    on_cold = score_row(make_row(**{"Perf.3M": -30.0, "Perf.1M": -20.0, "Recommend.All": -1.0}), peers)
    assert on_hot["subscores"]["growth"] > on_cold["subscores"]["growth"]


def test_flags_vocabulary():
    out = score_row(
        make_row(debt_to_equity_fq=2.0, volume=10_000.0, free_cash_flow_ttm=-5.0, close=80.0),
        {},
    )
    assert "high-debt" in out["flags"]
    assert "thin-volume" in out["flags"]
    assert "negative-fcf" in out["flags"]
    assert "below-200dma" in out["flags"]
    assert "paying-dividend" in out["flags"]
    above = score_row(make_row(), {})
    assert "above-200dma" in above["flags"]
