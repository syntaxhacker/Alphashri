"""Pure-function tests for scripts/desk_check.py (no network, no DB)."""
import pytest

from scripts.desk_check import (
    atm_iv_value,
    atr,
    breadth_verdict,
    classify_symbol,
    fmt_iv_rv,
    iv_rv_ratio,
    leg_rows,
    load_tape_spots,
    mark_premium,
    new_walls,
    position_pnl,
    prev_close_from_candles,
    realised_split,
    render,
    render_speed,
    render_unusual,
    roc_atr,
    roc_points,
    rvol,
    sentiment_label,
    skew_25d,
    speed_from_candles,
    speed_verdict,
    top_oi_strikes,
    unusual_flags,
    unusual_summary,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# IV / RV formatting
# ---------------------------------------------------------------------------
def test_iv_rv_ratio_basic():
    assert iv_rv_ratio(15.43, 12.92) == pytest.approx(1.194, abs=1e-3)


@pytest.mark.parametrize(
    "iv, rv, expected",
    [
        (15.43, 12.92, "1.19x rich"),
        (10.0, 12.0, "0.83x cheap"),
        (10.0, 10.0, "1.00x fair"),
        (11.0, 10.0, "1.10x fair"),
        (11.5, 10.0, "1.15x rich"),
        (8.5, 10.0, "0.85x cheap"),
    ],
)
def test_fmt_iv_rv_thresholds(iv, rv, expected):
    assert fmt_iv_rv(iv, rv) == expected


@pytest.mark.parametrize(
    "iv, rv",
    [(None, 12.0), (12.0, None), (None, None), (0, 12.0), (12.0, 0), ("x", 12.0)],
)
def test_fmt_iv_rv_degrades_to_na(iv, rv):
    assert iv_rv_ratio(iv, rv) is None
    assert fmt_iv_rv(iv, rv) == "n/a"


# ---------------------------------------------------------------------------
# 25-delta skew selection
# ---------------------------------------------------------------------------
def _ladder():
    """A realistic ladder where delta is monotone with strike."""
    rows = []
    for strike, ce_delta, pe_delta, ce_iv, pe_iv in [
        (22400, 0.72, -0.08, 17.0, 20.0),
        (22500, 0.62, -0.15, 16.2, 19.4),
        (22600, 0.48, -0.28, 15.6, 18.9),
        (22700, 0.38, -0.40, 15.2, 17.8),
        (22800, 0.30, -0.55, 15.0, 16.9),
        (22900, 0.22, -0.68, 15.4, 16.2),
    ]:
        rows.append(
            {
                "strike": strike,
                "ce": {"delta": ce_delta, "iv": ce_iv},
                "pe": {"delta": pe_delta, "iv": pe_iv},
            }
        )
    return rows


def test_skew_25d_picks_nearest_in_band():
    # CE: 0.22 is |0.03| from 0.25 (nearest); PE: -0.28 is |0.03| from 0.25.
    assert skew_25d(_ladder()) == pytest.approx(18.9 - 15.4)


def test_skew_25d_is_put_minus_call():
    rows = [
        {"strike": 22700, "ce": {"delta": 0.25, "iv": 14.0}, "pe": {"delta": -0.25, "iv": 18.0}},
    ]
    assert skew_25d(rows) == pytest.approx(4.0)


def test_skew_25d_excludes_out_of_band_deltas():
    rows = [
        # 0.10 and 0.45 are outside 0.15–0.35, so there is no 25d wing.
        {"strike": 22700, "ce": {"delta": 0.10, "iv": 14.0}, "pe": {"delta": -0.45, "iv": 18.0}},
    ]
    assert skew_25d(rows) is None


def test_skew_25d_returns_none_when_one_wing_missing():
    rows = [
        {"strike": 22700, "ce": {"delta": 0.25, "iv": 14.0}, "pe": {"delta": None, "iv": None}},
    ]
    assert skew_25d(rows) is None
    assert skew_25d([]) is None


def test_skew_25d_ignores_zero_iv():
    rows = [
        {"strike": 22700, "ce": {"delta": 0.25, "iv": 0}, "pe": {"delta": -0.25, "iv": 18.0}},
    ]
    assert skew_25d(rows) is None


# ---------------------------------------------------------------------------
# breadth gradient verdict
# ---------------------------------------------------------------------------
def test_breadth_all_up_is_risk_on():
    verdict, detail = breadth_verdict(
        {"NIFTY": 0.8, "BANK": 0.6, "MIDCAP": 1.1, "SMALLCAP": 1.4, "BROAD": 0.9}
    )
    assert verdict == "risk-on"
    assert "5/5 up" in detail
    assert "leader SMALLCAP +1.4%" in detail


def test_breadth_all_down_is_risk_off():
    verdict, detail = breadth_verdict(
        {"NIFTY": -0.8, "BANK": -1.4, "MIDCAP": -1.9, "SMALLCAP": -2.7, "BROAD": -1.4}
    )
    assert verdict == "risk-off"
    assert "0/5 up" in detail
    assert "laggard SMALLCAP -2.7%" in detail


def test_breadth_large_caps_up_small_caps_down_is_mixed():
    verdict, _ = breadth_verdict(
        {"NIFTY": 0.4, "BANK": 0.2, "MIDCAP": -1.2, "SMALLCAP": -2.0, "BROAD": -0.3}
    )
    assert verdict == "mixed"


def test_breadth_narrow_rally_missing_smallcaps_is_mixed():
    # 3/5 up but mid/small average negative -> not a broad risk-on.
    verdict, _ = breadth_verdict(
        {"NIFTY": 0.5, "BANK": 0.4, "MIDCAP": -0.2, "SMALLCAP": -0.6, "BROAD": 0.3}
    )
    assert verdict == "mixed"


def test_breadth_majority_up_with_positive_core_is_risk_on():
    verdict, _ = breadth_verdict(
        {"NIFTY": 0.3, "BANK": 0.1, "MIDCAP": 0.2, "SMALLCAP": -0.1, "BROAD": 0.2}
    )
    assert verdict == "risk-on"


def test_breadth_ignores_missing_values():
    verdict, detail = breadth_verdict({"NIFTY": 0.6, "BANK": 0.5, "MIDCAP": None})
    assert verdict == "risk-on"  # 2/2 available and both up
    assert "2/2 up" in detail


def test_breadth_empty_is_unavailable():
    assert breadth_verdict({}) == ("unavailable", "no breadth data")
    assert breadth_verdict(None) == ("unavailable", "no breadth data")


# ---------------------------------------------------------------------------
# manual vs coded realised P&L split
# ---------------------------------------------------------------------------
def test_classify_symbol_by_space():
    assert classify_symbol("NIFTY 2026-10-27 22700PE") == "manual"
    assert classify_symbol("NIFTY26OCT22700PE") == "coded"
    assert classify_symbol("NIFTY 2026-10-27 STRADDLE") == "manual"
    assert classify_symbol("") == "coded"
    assert classify_symbol(None) == "coded"


def test_realised_split_manual_vs_coded():
    rows = [
        {"symbol": "NIFTY 2026-10-27 22700PE", "net_pnl": 2211.0},
        {"symbol": "NIFTY 2026-10-27 23300CE", "net_pnl": 1192.82},
        {"symbol": "NIFTY 2026-10-27 22700PE", "net_pnl": -20.35},
        {"symbol": "NIFTY26OCT22800PE", "net_pnl": 2015.83},
        {"symbol": "NIFTY26OCT23100CE", "net_pnl": -2531.58},
        {"symbol": "NIFTY26OCT22950PE", "net_pnl": 343.75},
    ]
    split = realised_split(rows)
    assert split["manual"] == pytest.approx(2211.0 + 1192.82 - 20.35)
    assert split["coded"] == pytest.approx(2015.83 - 2531.58 + 343.75)
    assert split["total"] == pytest.approx(split["manual"] + split["coded"])
    assert (split["manual_n"], split["coded_n"]) == (3, 3)


def test_realised_split_empty_and_none_pnl():
    empty = realised_split([])
    assert empty == {"manual": 0.0, "coded": 0.0, "total": 0.0, "manual_n": 0, "coded_n": 0}

    split = realised_split(
        [
            {"symbol": "NIFTY 2026-10-27 22700PE", "net_pnl": None},
            {"symbol": "NIFTY26OCT22800PE", "net_pnl": 100},
        ]
    )
    assert split["manual"] == 0.0
    assert split["coded"] == 100.0
    assert split["total"] == 100.0


# ---------------------------------------------------------------------------
# helpers used by the position / breadth blocks
# ---------------------------------------------------------------------------
def test_mark_premium_ce_pe_straddle():
    strikes = [
        {"strike": 22700.0, "ce": {"ltp": 196.3}, "pe": {"ltp": 169.6}},
    ]
    assert mark_premium({"opt": "CE", "strike": 22700}, strikes) == pytest.approx(196.3)
    assert mark_premium({"opt": "PE", "strike": 22700.0}, strikes) == pytest.approx(169.6)
    assert mark_premium({"opt": "STRADDLE", "strike": 22700}, strikes) == pytest.approx(365.9)
    assert mark_premium({"opt": "CE", "strike": 23000}, strikes) is None


def test_position_pnl_handles_direction():
    long_pos = {"entry_premium": 126.75, "qty": 65, "direction": "LONG"}
    short_pos = {"entry_premium": 64.5, "qty": 65, "direction": "SHORT"}
    assert position_pnl(long_pos, 170.45) == pytest.approx((170.45 - 126.75) * 65)
    assert position_pnl(short_pos, 50.0) == pytest.approx((64.5 - 50.0) * 65)
    assert position_pnl(long_pos, None) is None
    assert position_pnl({"entry_premium": 0, "qty": 65}, 10.0) is None


def test_prev_close_uses_last_completed_session():
    candles = [
        ["2026-10-16T00:00:00+05:30", 23000, 23100, 22900, 22950, 0, 0],
        ["2026-10-19T00:00:00+05:30", 23150, 23175, 22845, 22888.95, 0, 0],
        ["2026-10-21T00:00:00+05:30", 22700, 22750, 22600, 22650, 0, 0],  # forming today
    ]
    assert prev_close_from_candles(candles, "2026-10-21") == pytest.approx(22888.95)
    assert prev_close_from_candles([], "2026-10-21") is None


# ---------------------------------------------------------------------------
# unusual-activity scan
# ---------------------------------------------------------------------------
def _leg(oi=0, oi_change=None, prev_oi=None, volume=0, iv=None, label=None):
    leg = {"oi": oi, "volume": volume, "iv": iv}
    if oi_change is not None:
        leg["oi_change"] = oi_change
    if prev_oi is not None:
        leg["prev_oi"] = prev_oi
    if label is not None:
        leg["sentiment"] = {"type": label, "label": label}
    return leg


def _flag(flags, strike, side):
    return next((f for f in flags if f["strike"] == strike and f["side"] == side), None)


def _flat_chain(n=6, iv=15.0, oi=1_000_000, volume=100_000):
    """Liquid, boring chain: no OI build, no turnover spike, flat IV."""
    return [
        {
            "strike": 22500 + i * 100,
            "ce": _leg(oi=oi, oi_change=0, volume=volume, iv=iv),
            "pe": _leg(oi=oi, oi_change=0, volume=volume, iv=iv),
        }
        for i in range(n)
    ]


def test_leg_rows_derives_oi_change_and_tolerates_missing_fields():
    rows = leg_rows(
        [
            {"strike": 22700, "ce": {"oi": 1_200_000, "prev_oi": 1_000_000}, "pe": {"oi": 0}},
            {"strike": 22800},  # no legs at all
            {"strike": None, "ce": {"oi": 1}},
            "not-a-row",
        ]
    )
    ce = next(r for r in rows if r["strike"] == 22700 and r["side"] == "ce")
    pe = next(r for r in rows if r["strike"] == 22700 and r["side"] == "pe")
    assert ce["oi_change"] == pytest.approx(200_000)
    assert ce["label"] == ""
    assert pe["oi"] == 0 and pe["oi_change"] is None
    blank = next(r for r in rows if r["strike"] == 22800 and r["side"] == "ce")
    assert blank["oi"] is None and blank["iv"] is None and blank["ratio"] is None


def test_sentiment_label_normalises_full_names():
    assert sentiment_label({"sentiment": {"label": "SB"}}) == "SB"
    assert sentiment_label({"sentiment": {"type": "Long Buildup"}}) == "LB"
    assert sentiment_label({"sentiment": {"type": "short buildup"}}) == "SB"
    assert sentiment_label({}) == ""
    assert sentiment_label({"sentiment": None}) == ""


def test_oi_build_flags_absolute_two_million():
    chain = _flat_chain()
    chain[1]["ce"] = _leg(oi=5_000_000, oi_change=2_000_000, volume=100_000, iv=15.0)
    chain[2]["ce"] = _leg(oi=1_500_000, oi_change=1_999_999, volume=100_000, iv=15.0)

    flags = unusual_flags(chain, atm=22700)
    assert "OI build" in _flag(flags, 22600, "CE")["tags"]
    assert "OI build" not in (_flag(flags, 22700, "CE") or {"tags": []})["tags"]


def test_oi_build_flags_fifteen_percent_of_prior_oi():
    # prior OI 800k -> 15% = 120k; a 200k build qualifies while 100k does not.
    chain = _flat_chain()
    chain[1]["ce"] = _leg(oi=1_000_000, oi_change=200_000, volume=100_000, iv=15.0)
    chain[2]["ce"] = _leg(oi=1_000_000, oi_change=100_000, volume=100_000, iv=15.0)

    flags = unusual_flags(chain, atm=22700)
    assert "OI build" in _flag(flags, 22600, "CE")["tags"]
    assert "OI build" not in (_flag(flags, 22700, "CE") or {"tags": []})["tags"]


def test_turnover_flags_only_the_relative_outlier():
    chain = _flat_chain()
    chain[3]["pe"] = _leg(oi=1_000_000, oi_change=0, volume=1_000_000, iv=15.0)  # 1.0x vs ~0.1x

    flags = unusual_flags(chain, atm=22700)
    assert "turnover" in _flag(flags, 22800, "PE")["tags"]
    assert all("turnover" not in f["tags"] for f in flags if f["strike"] != 22800)


def test_iv_spike_above_one_and_a_half_times_atm():
    chain = _flat_chain()
    chain[3]["ce"] = _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=25.0)

    assert atm_iv_value(chain, spot=22500) == pytest.approx(15.0)
    flags = unusual_flags(chain, spot=22500)
    flagged = _flag(flags, 22800, "CE")
    assert "IV spike" in flagged["tags"]
    assert "IV jump" not in flagged["tags"]


def test_iv_jump_flags_neighbour_z_score():
    chain = [
        {"strike": 22600, "ce": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=15.0),
         "pe": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=15.0)},
        {"strike": 22700, "ce": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=14.0),
         "pe": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=15.0)},
        {"strike": 22800, "ce": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=19.0),
         "pe": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=15.0)},
        {"strike": 22900, "ce": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=16.0),
         "pe": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=15.0)},
        {"strike": 23000, "ce": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=15.0),
         "pe": _leg(oi=1_000_000, oi_change=0, volume=100_000, iv=15.0)},
    ]
    flags = unusual_flags(chain, spot=22600)
    flagged = _flag(flags, 22800, "CE")
    assert "IV jump" in flagged["tags"]
    assert "IV spike" not in flagged["tags"]


def test_new_walls_need_top_oi_and_positive_change():
    chain = [
        {"strike": 22600, "ce": _leg(oi=1_000_000, oi_change=900_000), "pe": _leg(oi=1_000_000, oi_change=1_000_000)},
        {"strike": 22700, "ce": _leg(oi=5_000_000, oi_change=500_000), "pe": _leg(oi=3_000_000, oi_change=50_000)},
        {"strike": 22800, "ce": _leg(oi=4_000_000, oi_change=100_000), "pe": _leg(oi=5_000_000, oi_change=200_000)},
        {"strike": 22900, "ce": _leg(oi=3_000_000, oi_change=-50_000), "pe": _leg(oi=4_000_000, oi_change=150_000)},
        {"strike": 23000, "ce": _leg(oi=2_000_000, oi_change=0), "pe": _leg(oi=2_000_000, oi_change=0)},
    ]
    legs = leg_rows(chain)
    assert top_oi_strikes(legs, "ce") == {22700, 22800, 22900}
    assert top_oi_strikes(legs, "pe") == {22800, 22900, 22700}

    walls = new_walls(chain)
    assert [(w["strike"], w["side"]) for w in walls[:2]] == [(22700, "CE"), (22800, "PE")]
    assert all(not (w["strike"] == 22600) for w in walls)  # big change, not a wall
    assert all(not (w["strike"] == 22900 and w["side"] == "CE") for w in walls)  # wall, but losing OI


def test_summary_sums_oi_change_by_sentiment_and_side():
    chain = [
        {"strike": 22700, "ce": _leg(oi=5_000_000, oi_change=500_000, label="SB"),
         "pe": _leg(oi=3_000_000, oi_change=300_000, label="SB")},
        {"strike": 22800, "ce": _leg(oi=4_000_000, oi_change=100_000, label="LB"),
         "pe": _leg(oi=5_000_000, oi_change=200_000, label="LB")},
        {"strike": 22900, "ce": _leg(oi=3_000_000, oi_change=-50_000, label="SC"),
         "pe": _leg(oi=4_000_000, oi_change=150_000, label="LU")},
    ]
    summary = unusual_summary(chain)
    assert summary["ce_writers"] == pytest.approx(500_000)
    assert summary["pe_writers"] == pytest.approx(300_000)
    assert summary["pe_buyers"] == pytest.approx(200_000)
    assert summary["ce_buyers"] == pytest.approx(100_000)
    assert summary["new_walls"][0] == {"strike": 22700, "side": "CE", "oi_change": 500_000}


def test_flags_sort_by_absolute_oi_change_and_cap_at_twelve():
    chain = _flat_chain(n=14, oi=20_000_000)
    for i, row in enumerate(chain):
        row["ce"] = _leg(oi=20_000_000, oi_change=3_000_000 + 100_000 * i, volume=100_000, iv=15.0)
    flags = unusual_flags(chain, atm=22700)
    assert len(flags) > 12
    scores = [f["score"] for f in flags]
    assert scores == sorted(scores, reverse=True)

    block = render_unusual({"flags": flags, "summary": unusual_summary(chain)})
    assert block[1] == "UNUSUAL (12 of %d)" % len(flags)
    assert sum(1 for line in block if "ΔOI" in line) == 12


def test_render_unusual_contains_flag_and_tag_and_walls():
    chain = [
        {"strike": 22700, "ce": _leg(oi=5_000_000, oi_change=500_000, volume=2_000_000, iv=15.0, label="SB"),
         "pe": _leg(oi=3_000_000, oi_change=300_000, volume=1_000_000, iv=15.0, label="SB")},
        {"strike": 22800, "ce": _leg(oi=4_000_000, oi_change=4_630_000, volume=1_000_000, iv=15.0, label="SB"),
         "pe": _leg(oi=5_000_000, oi_change=200_000, volume=1_000_000, iv=15.0, label="LB")},
    ]
    flags = unusual_flags(chain, atm=22700)
    block = render_unusual({"flags": flags, "summary": unusual_summary(chain)})
    text = "\n".join(block)
    assert block[1].startswith("UNUSUAL (4)")
    assert "22,800 CE" in text
    assert "CE-writers" in text
    assert "ΔOI" in text and "+4.63M" in text
    assert "CE writers +5.13M | PE writers +0.30M | PE buyers +0.20M | CE buyers +0.00M" in text
    assert "new walls: 22800CE +4.63M, 22700CE +0.50M, 22700PE +0.30M, 22800PE +0.20M" in text


def test_scan_survives_missing_fields():
    for chain in (
        [],
        None,
        [{}],
        [{"strike": 22700}],
        [{"strike": 22700, "ce": {"oi": 0, "volume": 0, "iv": 0}}],
        [{"strike": 22700, "ce": {"oi": None, "oi_change": None, "sentiment": None}}],
    ):
        flags = unusual_flags(chain, atm=None, spot=None)
        assert isinstance(flags, list)
        summary = unusual_summary(chain)
        assert summary["ce_writers"] == 0.0
        block = render_unusual({"flags": flags, "summary": summary})
        assert block[1].startswith("UNUSUAL (")
        assert "new walls:" in block[-1]


def _minimal_payload():
    return {
        "ts": "2026-10-21T12:00:00+05:30",
        "date": "2026-10-21",
        "expiry": "2026-10-27",
        "source": "live",
        "spot": 22700.0,
        "atm": 22700,
        "straddle": 300.0,
        "vix": {"ltp": 12.0, "prev_close": 12.5, "change_pct": -4.0},
        "vol": {
            "atm_ce_iv": 15.0,
            "atm_pe_iv": 15.0,
            "rv": 12.0,
            "iv": 15.0,
            "iv_rv": "1.25x rich",
            "skew_25d": 1.0,
            "skew_ctl": 1.0,
        },
        "gex": {
            "regime": "short",
            "flip": 22700,
            "resistance": 23000,
            "support": 22500,
            "fuel_down": 22500,
            "fuel_up": 23000,
        },
        "pcr_oi": 0.8,
        "pcr_vol": 1.0,
        "max_pain": 22800,
        "positioning": "neutral",
        "strikes": [{"strike": 22700, "ce": {}, "pe": {}, "found": True}],
        "breadth": {"verdict": "skipped", "detail": "--no-breadth", "rows": []},
        "positions": [],
        "pnl": {
            "realised_manual": None,
            "realised_coded": None,
            "realised_total": None,
            "realised_manual_n": 0,
            "realised_coded_n": 0,
            "open_manual": 0.0,
            "all_in": None,
        },
        "errors": [],
    }


def test_render_unchanged_without_unusual_and_appends_block_with_it():
    base = _minimal_payload()
    plain = render(base)
    assert "UNUSUAL" not in plain

    chain = [
        {"strike": 22800, "ce": _leg(oi=5_000_000, oi_change=4_630_000, volume=1_000_000, iv=15.0, label="SB"),
         "pe": _leg(oi=5_000_000, oi_change=0, volume=1_000_000, iv=15.0)},
    ]
    base["unusual"] = {"flags": unusual_flags(chain, atm=22700), "summary": unusual_summary(chain)}
    with_block = render(base)
    assert "UNUSUAL (1)" in with_block
    assert "22,800 CE" in with_block
    # everything from the old render is still there, intact
    assert plain in with_block



# ---------------------------------------------------------------------------
# momentum speed (ATR / ROC / RVOL / verdict)
# ---------------------------------------------------------------------------
def _min_candles(n=20, start=23000.0, step=2.0, volume=0.0):
    """1-minute dict candles from 09:15 IST, deterministic drift."""
    base = __import__("datetime").datetime.fromisoformat("2026-10-21T09:15:00+05:30")
    out = []
    px = start
    for i in range(n):
        px += step
        out.append(
            {
                "time": (base + __import__("datetime").timedelta(minutes=i)).isoformat(),
                "open": px - step,
                "high": px + 1.0,
                "low": px - 1.0,
                "close": px,
                "volume": volume,
            }
        )
    return out


def test_atr_small_fixture_simple_mean():
    # step +2 with high/low ±1: TR is max(2, |2|518-1...|) = 3 after the first
    # bar (|high - prev_close| = 3). Mean of the last 14 TRs = 3.0.
    candles = _min_candles(20)
    assert atr(candles) == pytest.approx(3.0)


def test_atr_spot_only_falls_back_to_abs_delta():
    spots = [
        {"time": f"2026-10-21T09:{15 + i:02d}:00+05:30", "close": 23000.0 + i * 5.0}
        for i in range(10)
    ]
    assert atr(spots) == pytest.approx(5.0)


def test_atr_needs_at_least_one_range():
    assert atr([]) is None
    assert atr([{"time": "2026-10-21T09:15:00+05:30", "close": 100.0}]) is None


def test_atr_accepts_list_rows():
    rows = [
        ["2026-10-21T09:15:00+05:30", 100, 102, 99, 101, 1000, 0],
        ["2026-10-21T09:16:00+05:30", 101, 103, 100, 102, 1000, 0],
    ]
    # TR = max(103-100, |103-101|, |100-101|) = 3
    assert atr(rows) == pytest.approx(3.0)


def test_roc_atr_sign_and_zero_guard():
    up = _min_candles(20, step=2.0)  # +10 pts over the last 5 min
    assert roc_atr(up, 5, 5.0) == pytest.approx(2.0)
    down = _min_candles(20, step=-2.0)
    assert roc_atr(down, 5, 5.0) == pytest.approx(-2.0)
    assert roc_atr(up, 5, 0.0) is None  # zero-ATR guard
    assert roc_atr(up, 5, None) is None
    assert roc_atr([], 5, 5.0) is None


def test_rvol_with_volume():
    vols = [10.0] * 10 + [20.0] * 5  # current 100 vs median baseline 50
    candles = _min_candles(15, volume=0.0)
    for c, v in zip(candles, vols):
        c["volume"] = v
    assert rvol(candles) == pytest.approx(2.0)


def test_rvol_without_volume_is_none():
    assert rvol(_min_candles(20, volume=0.0)) is None
    assert rvol(_min_candles(20)) is None  # volume key present but all zero
    no_vol = _min_candles(5)
    for c in no_vol:
        del c["volume"]
    assert rvol(no_vol) is None


def test_rvol_needs_baseline_windows():
    assert rvol(_min_candles(10, volume=100.0)) is None  # only 1 baseline


def test_speed_verdict_thresholds():
    assert speed_verdict(1.5, 1.5) == "FAST"
    assert speed_verdict(1.0, 1.2) == "FAST"  # boundary inclusive
    assert speed_verdict(1.5, None) == "FAST"  # ATR-only fallback
    assert speed_verdict(0.2, None) == "SLOW"
    assert speed_verdict(0.7, 0.5) == "SLOW"  # dead volume vetoes a fast ATR
    assert speed_verdict(2.0, 0.5) == "SLOW"  # OR condition: RVOL < 0.8
    assert speed_verdict(0.7, None) == "NORMAL"
    assert speed_verdict(0.7, 1.0) == "NORMAL"
    assert speed_verdict(None, None) == "n/a"


def test_speed_from_candles_end_to_end():
    speed = speed_from_candles(_min_candles(30, step=2.0))
    assert speed["atr14"] == pytest.approx(3.0)
    assert speed["roc5"] == pytest.approx(10.0)
    assert speed["roc5_atr"] == pytest.approx(10.0 / 3.0)
    assert speed["rvol5"] is None  # no volume on the feed
    assert speed["verdict"] == "FAST"


def test_missing_candles_fallback():
    assert load_tape_spots("1900-01-01") == []  # no tape file -> empty
    speed = speed_from_candles([])
    assert speed["verdict"] == "n/a"
    assert render_speed(speed) == "SPEED  n/a (no candles)"
    assert render_speed({}) == "SPEED  n/a (no candles)"


def test_render_speed_line_format():
    speed = {
        "roc5": 5.0, "roc5_atr": 0.4, "roc15": -12.0, "roc15_atr": -0.9,
        "rvol5": 0.8, "verdict": "SLOW",
    }
    assert render_speed(speed) == (
        "SPEED 5m +5.00 (0.4 ATR)  |  15m -12.00 (0.9 ATR)  |  RVOL 0.8x  |  SLOW"
    )
    no_vol = dict(speed, rvol5=None, verdict="NORMAL")
    assert render_speed(no_vol).endswith("NORMAL (no vol)")


def test_render_includes_speed_line():
    payload = _minimal_payload()
    payload["speed"] = {
        "roc5": 1.0, "roc5_atr": 0.4, "roc15": 2.0, "roc15_atr": 0.9,
        "rvol5": None, "verdict": "NORMAL",
    }
    assert "SPEED 5m +1.00 (0.4 ATR)" in render(payload)
