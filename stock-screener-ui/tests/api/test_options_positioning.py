"""Unit tests for the pure api/options_positioning.py engine.

No HTTP, no DB, no auth — the engine is a pure shaping function over chain
rows, so these tests pin the wire contract directly with hand-computable chains.
"""

import pytest

from api.options_positioning import positioning_block


def _leg(oi=None, prev_oi=None, volume=None, ltp=100.0):
    """A present quote (carries LTP) with only the supplied LTP-side fields."""
    md = {"ltp": ltp}
    if oi is not None:
        md["oi"] = oi
    if prev_oi is not None:
        md["prev_oi"] = prev_oi
    if volume is not None:
        md["volume"] = volume
    return {"market_data": md}


def _row(strike, ce=None, pe=None):
    return {"strike": strike, "ce": ce, "pe": pe}


def _known_chain():
    """Three strikes with distinct walls, known PCR and a known max-pain level.

    ce oi  = [40, 10,  5]  (call wall @ 90)
    pe oi  = [ 5, 30, 15]  (put wall @ 100)
    ce vol = [100, 50, 10]  (total 160)
    pe vol = [ 20,200, 80]  (total 300)
    payouts: 90->600, 100->550, 110->900  => max pain @ 100
    """
    return [
        _row(90, ce=_leg(oi=40, prev_oi=10, volume=100), pe=_leg(oi=5, prev_oi=1, volume=20)),
        _row(100, ce=_leg(oi=10, prev_oi=12, volume=50), pe=_leg(oi=30, prev_oi=20, volume=200)),
        _row(110, ce=_leg(oi=5, prev_oi=5, volume=10), pe=_leg(oi=15, prev_oi=10, volume=80)),
    ]



class TestPositioningBlock:
    def test_exact_block_shape(self):
        out = positioning_block(_known_chain(), 95.0)
        assert set(out) == {
            "strikes", "ceOi", "peOi", "ceOiChange", "peOiChange",
            "ceVolume", "peVolume", "pcrByStrike", "pcr",
            "pcrVolumeByStrike", "pcrVolume",
            "maxPainCurve", "maxPain", "walls", "totals", "warnings",
        }
        assert set(out["walls"]) == {"callWall", "putWall"}
        assert set(out["totals"]) == {"ceOi", "peOi", "ceVolume", "peVolume"}

    def test_parallel_oi_volume_and_delta_arrays(self):
        out = positioning_block(_known_chain(), 95.0)
        assert out["strikes"] == [90.0, 100.0, 110.0]
        assert out["ceOi"] == [40.0, 10.0, 5.0]
        assert out["peOi"] == [5.0, 30.0, 15.0]
        # ΔOI = oi - prev_oi, including the negative unwind at 100 CE.
        assert out["ceOiChange"] == [30.0, -2.0, 0.0]
        assert out["peOiChange"] == [4.0, 10.0, 5.0]
        assert out["ceVolume"] == [100.0, 50.0, 10.0]
        assert out["peVolume"] == [20.0, 200.0, 80.0]
        for key in ("ceOi", "peOi", "ceOiChange", "peOiChange", "ceVolume", "peVolume",
                    "pcrByStrike", "pcrVolumeByStrike"):
            assert len(out[key]) == len(out["strikes"])

    def test_pcr_curve_and_headline_are_pe_over_ce(self):
        out = positioning_block(_known_chain(), 95.0)
        assert out["pcrByStrike"][0] == pytest.approx(5 / 40)
        assert out["pcrByStrike"][1] == pytest.approx(30 / 10)
        assert out["pcrByStrike"][2] == pytest.approx(15 / 5)
        # Headline is the same ratio over the leg totals: sum(pe)/sum(ce).
        assert out["totals"]["ceOi"] == 55.0
        assert out["totals"]["peOi"] == 50.0
        assert out["pcr"] == pytest.approx(50 / 55)

    def test_volume_pcr_curve_and_headline_are_pe_over_ce(self):
        out = positioning_block(_known_chain(), 95.0)
        assert out["pcrVolumeByStrike"] == [
            pytest.approx(20 / 100),
            pytest.approx(200 / 50),
            pytest.approx(80 / 10),
        ]
        assert out["totals"]["ceVolume"] == 160.0
        assert out["totals"]["peVolume"] == 300.0
        assert out["pcrVolume"] == pytest.approx(300 / 160)

    def test_max_pain_curve_comes_from_shared_formula(self):
        from api.options_levels import _payouts, compute_max_pain, normalize_strikes

        chain = _known_chain()
        out = positioning_block(chain, 95.0)
        norm = normalize_strikes([
            {"strike": r["strike"],
             "ce_oi": (r["ce"] or {}).get("market_data", {}).get("oi", 0),
             "pe_oi": (r["pe"] or {}).get("market_data", {}).get("oi", 0)}
            for r in chain
        ])
        assert out["maxPainCurve"] == [
            {"strike": s, "payout": round(p, 2)} for s, p in _payouts(norm)
        ]
        assert out["maxPainCurve"] == [
            {"strike": 90.0, "payout": 600.0},
            {"strike": 100.0, "payout": 550.0},
            {"strike": 110.0, "payout": 900.0},
        ]
        assert out["maxPain"] == compute_max_pain(norm) == 100.0

    def test_walls_are_the_heaviest_oi_strike_per_leg(self):
        out = positioning_block(_known_chain(), 95.0)
        call, put = out["walls"]["callWall"], out["walls"]["putWall"]
        assert call["strike"] == 90.0 and call["oi"] == 40.0
        assert call["side"] == "below"
        assert put["strike"] == 100.0 and put["oi"] == 30.0
        assert put["side"] == "above"
        assert set(call) == {"strike", "side", "strength", "oi"}

    def test_clean_chain_has_no_warnings(self):
        assert positioning_block(_known_chain(), 95.0)["warnings"] == []

    def test_rows_are_sorted_by_strike(self):
        chain = list(reversed(_known_chain()))
        assert positioning_block(chain, 95.0)["strikes"] == [90.0, 100.0, 110.0]



class TestNullsAndWarnings:
    def test_zero_oi_is_a_real_quote_none_is_missing(self):
        rows = [
            _row(90, ce=_leg(oi=0, volume=0)),      # real, untraded quote
            _row(100, ce=_leg(oi=None, volume=None)),  # quote present, fields absent
            _row(110, ce=None),                     # no quote at all
        ]
        out = positioning_block(rows, 100.0)
        assert out["ceOi"] == [0.0, None, None]
        assert out["ceVolume"] == [0.0, None, None]
        # ΔOI needs a baseline; absent prev_oi -> None, no fabricated 0.
        assert out["ceOiChange"] == [None, None, None]
        assert "missing_quotes" in out["warnings"]

    def test_no_0_fill_for_missing_quote_other_side_survives(self):
        rows = [_row(100, ce=None, pe=_leg(oi=30, prev_oi=10, volume=200))]
        out = positioning_block(rows, 100.0)
        assert out["ceOi"] == [None]
        assert out["ceVolume"] == [None]
        assert out["ceOiChange"] == [None]
        assert out["peOi"] == [30.0]
        assert out["peOiChange"] == [20.0]
        assert out["totals"]["ceOi"] is None
        assert out["totals"]["peOi"] == 30.0
        # A missing CE leg leaves the put/call denominator absent: neither the
        # OI nor the volume ratio may be fabricated from the surviving PE leg.
        assert out["pcrByStrike"] == [None] and out["pcr"] is None
        assert out["pcrVolumeByStrike"] == [None] and out["pcrVolume"] is None
        # Missing CE OI contributes no call pain; a one-sided put book still
        # resolves max pain, and there is no call wall.
        assert out["maxPain"] == 100.0
        assert out["walls"]["callWall"] is None
        assert out["walls"]["putWall"]["strike"] == 100.0

    def test_missing_prev_oi_nulls_delta_and_warns(self):
        rows = [
            _row(90, ce=_leg(oi=40, prev_oi=None, volume=100), pe=_leg(oi=5, prev_oi=1, volume=20)),
            _row(100, ce=_leg(oi=10, prev_oi=12, volume=50), pe=_leg(oi=30, prev_oi=20, volume=200)),
        ]
        out = positioning_block(rows, 95.0)
        assert out["ceOiChange"][0] is None
        assert out["ceOiChange"][1] == -2.0
        assert "missing_prev_oi" in out["warnings"]
        # OI itself is intact — a missing baseline must not erase the level.
        assert out["ceOi"][0] == 40.0

    def test_zero_and_none_oi_have_no_max_pain_or_walls(self):
        rows = [
            _row(90, ce=_leg(oi=0, prev_oi=0), pe=_leg(oi=0, prev_oi=0)),
            _row(100, ce=_leg(oi=None), pe=_leg(oi=None)),
        ]
        out = positioning_block(rows, 95.0)
        assert out["maxPain"] is None
        assert out["maxPainCurve"] == [
            {"strike": 90.0, "payout": 0.0}, {"strike": 100.0, "payout": 0.0}
        ]
        assert out["walls"] == {"callWall": None, "putWall": None}
        assert "no_oi" in out["warnings"]

    def test_pcr_curve_null_when_ce_denominator_is_zero_or_missing(self):
        rows = [
            _row(90, ce=_leg(oi=0, volume=0), pe=_leg(oi=40, volume=50)),
            _row(100, ce=_leg(oi=None, volume=None), pe=_leg(oi=10, volume=20)),
            _row(110, ce=_leg(oi=15, volume=10), pe=_leg(oi=5, volume=8)),
        ]
        out = positioning_block(rows, 95.0)
        assert out["pcrByStrike"] == [None, None, pytest.approx(5 / 15)]
        # totals sum only the present values: ce = 0 + 15 = 15, pe = 55.
        assert out["pcr"] == pytest.approx(55 / 15)

    def test_volume_pcr_null_when_ce_volume_zero_or_missing(self):
        rows = [
            _row(90, ce=_leg(oi=10, volume=0), pe=_leg(oi=40, volume=50)),
            _row(100, ce=_leg(oi=10, volume=None), pe=_leg(oi=20, volume=20)),
            _row(110, ce=_leg(oi=10, volume=10), pe=_leg(oi=5, volume=8)),
        ]
        out = positioning_block(rows, 95.0)
        assert out["pcrVolumeByStrike"] == [None, None, pytest.approx(8 / 10)]
        # ceVolume total = 0 + 10 = 10, peVolume total = 78.
        assert out["pcrVolume"] == pytest.approx(78 / 10)
        # Volume OI is independent: the OI PCR here is still computed normally.
        assert out["pcrByStrike"][2] == pytest.approx(5 / 10)

    def test_non_finite_oi_is_null_not_a_number(self):
        rows = [
            _row(90, ce=_leg(oi=float("nan")), pe=_leg(oi=5)),
            _row(100, ce=_leg(oi=float("inf")), pe=_leg(oi=30)),
        ]
        out = positioning_block(rows, 95.0)
        assert out["ceOi"][0] is None
        assert out["ceOi"][1] is None
        assert out["ceOiChange"][0] is None



class TestEmptyAndMalformed:
    def test_empty_chain(self):
        out = positioning_block([], 95.0)
        assert out["warnings"] == ["empty_chain"]
        for key in ("strikes", "ceOi", "peOi", "ceOiChange", "peOiChange",
                    "ceVolume", "peVolume", "pcrByStrike", "pcrVolumeByStrike",
                    "maxPainCurve"):
            assert out[key] == []
        assert out["pcr"] is None and out["pcrVolume"] is None and out["maxPain"] is None
        assert out["walls"] == {"callWall": None, "putWall": None}
        assert out["totals"] == {"ceOi": None, "peOi": None,
                                 "ceVolume": None, "peVolume": None}

    def test_none_rows(self):
        assert positioning_block(None, 95.0)["warnings"] == ["empty_chain"]

    def test_all_rows_invalid(self):
        rows = [None, "junk", {"strike": "bad"}, {}, {"no_strike": 1}]
        out = positioning_block(rows, 95.0)
        assert out["warnings"] == ["empty_chain"]
        assert out["strikes"] == []

    def test_invalid_rows_are_skipped_valid_ones_kept(self):
        rows = [None, "junk", {"strike": "bad"}, _row(100, ce=_leg(oi=10, prev_oi=5), pe=_leg(oi=20, prev_oi=8))]
        out = positioning_block(rows, 100.0)
        assert out["strikes"] == [100.0]
        assert out["ceOi"] == [10.0]
        assert out["warnings"] == []

    def test_flat_leg_shape_is_supported(self):
        rows = [{"strike": 100.0,
                 "ce": {"oi": 10, "prev_oi": 5, "volume": 50},
                 "pe": {"oi": 20, "prev_oi": 8, "volume": 80}}]
        out = positioning_block(rows, 100.0)
        assert out["ceOi"] == [10.0]
        assert out["ceOiChange"] == [5.0]
        assert out["peVolume"] == [80.0]

    def test_invalid_spot_warns_but_does_not_crash(self):
        out = positioning_block(_known_chain(), 0.0)
        assert "invalid_spot" in out["warnings"]
        # Without a usable spot the wall's side is unknown, not invented.
        assert out["walls"]["callWall"]["side"] is None
        assert out["maxPain"] == 100.0
