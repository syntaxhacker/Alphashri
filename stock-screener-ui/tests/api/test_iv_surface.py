"""Unit tests for the IV-surface block (pure functions, no network).

The fixture chain is deliberately hand-built so the expected picks are
obvious: spot sits on the 23,300 strike, the 25-delta call is exactly the
23,500 strike (|delta| 0.25) and the 25-delta put is the 23,100 strike
(|delta| 0.20, nearer 0.25 than 23,200's 0.32). Puts are priced richer than
calls throughout — a textbook put skew.
"""

import pytest

from api.reports_api.iv_surface import attach_iv_surface, iv_summary

#: strike -> (ce delta, ce iv, pe delta, pe iv)
CHAIN = {
    22_900.0: (0.95, 20.0, -0.05, 24.0),
    23_000.0: (0.88, 18.5, -0.12, 22.0),
    23_100.0: (0.75, 17.0, -0.20, 20.5),
    23_200.0: (0.60, 15.5, -0.32, 19.0),
    23_300.0: (0.50, 14.2, -0.48, 15.1),
    23_400.0: (0.38, 13.5, -0.62, 14.0),
    23_500.0: (0.25, 12.8, -0.75, 13.2),
    23_600.0: (0.15, 12.2, -0.88, 12.6),
    23_700.0: (0.08, 11.8, -0.95, 12.2),
}


def _leg(oi=1_000, iv=12.0, delta=0.5):
    return {"oi": oi, "iv": iv, "delta": delta}


def _rows(chain=None):
    chain = CHAIN if chain is None else chain
    return [
        {"strike": strike,
         "ce": _leg(iv=ce_iv, delta=ce_delta),
         "pe": _leg(iv=pe_iv, delta=pe_delta)}
        for strike, (ce_delta, ce_iv, pe_delta, pe_iv) in sorted(chain.items())
    ]


class TestPutSkew:
    def test_known_put_skew(self):
        surface = iv_summary(_rows(), spot=23_300.0)

        assert surface["degraded"] is False
        assert surface["skew"]["strike_ce25"] == 23_500.0
        assert surface["skew"]["strike_pe25"] == 23_100.0
        assert surface["skew"]["ce_25d_iv"] == pytest.approx(12.8)
        assert surface["skew"]["pe_25d_iv"] == pytest.approx(20.5)
        # put wing minus call wing
        assert surface["skew"]["skew_25d"] == pytest.approx(7.7)
        assert surface["skew"]["skew_25d"] > 0

    def test_atm_is_nearest_strike_to_spot(self):
        atm = iv_summary(_rows(), spot=23_347.0)["atm"]
        assert atm == {
            "strike": 23_300.0,
            "ce_iv": pytest.approx(14.2),
            "pe_iv": pytest.approx(15.1),
            "avg_iv": pytest.approx(14.65),
        }

    def test_atm_without_spot_uses_median_iv_strike(self):
        atm = iv_summary(_rows())["atm"]
        # 9 strikes -> median is the middle listed strike.
        assert atm["strike"] == 23_300.0
        assert atm["avg_iv"] == pytest.approx(14.65)

    def test_axis_sides_do_not_depend_on_put_delta_sign(self):
        # Puts arrive with negative deltas; |delta| must drive the pick.
        flipped = {strike: (ce_d, ce_iv, abs(pe_d), pe_iv)
                   for strike, (ce_d, ce_iv, pe_d, pe_iv) in CHAIN.items()}
        weirds = {strike: (ce_d, ce_iv, -abs(pe_d), pe_iv)
                  for strike, (ce_d, ce_iv, pe_d, pe_iv) in flipped.items()}
        surface = iv_summary(_rows(weirds), spot=23_300.0)
        assert surface["skew"]["strike_pe25"] == 23_100.0
        assert surface["skew"]["skew_25d"] == pytest.approx(7.7)


class TestMissingData:
    def test_missing_iv_on_25_delta_strike_degrades(self):
        chain = dict(CHAIN)
        # 23,500 is the 25-delta call; make its IV and every lower-delta
        # strike's IV missing, so there is no bracketing leg to interpolate
        # from and no silent substitution of a different wing.
        chain[23_500.0] = (0.25, None, -0.75, 13.2)
        chain[23_600.0] = (0.15, None, -0.88, 12.6)
        chain[23_700.0] = (0.08, None, -0.95, 12.2)

        surface = iv_summary(_rows(chain), spot=23_300.0)

        assert surface["degraded"] is True
        assert surface["skew"]["strike_ce25"] == 23_500.0
        assert surface["skew"]["ce_25d_iv"] is None
        assert surface["skew"]["skew_25d"] is None
        # The put wing is still reported.
        assert surface["skew"]["pe_25d_iv"] == pytest.approx(20.5)

    def test_interpolates_only_when_both_neighbours_have_iv(self):
        chain = dict(CHAIN)
        chain[23_500.0] = (0.25, None, -0.75, 13.2)
        surface = iv_summary(_rows(chain), spot=23_300.0)

        # Between |delta| 0.38 (13.5) and 0.15 (12.2) at the 0.25 wing.
        expected = 12.2 + (13.5 - 12.2) * (0.25 - 0.15) / (0.38 - 0.15)
        assert surface["degraded"] is False
        assert surface["skew"]["strike_ce25"] == 23_500.0
        assert surface["skew"]["ce_25d_iv"] == pytest.approx(expected, abs=1e-3)
        assert surface["skew"]["skew_25d"] == pytest.approx(20.5 - expected, abs=1e-3)

    def test_dead_legs_and_junk_rows_do_not_raise(self):
        rows = [
            {"strike": 23_300.0,
             "ce": {"oi": None, "iv": None, "delta": None},
             "pe": {"oi": 10, "iv": 0, "delta": -0.5}},
            {"strike": None, "ce": None, "pe": None},
            None,
            {"strike": 23_400.0, "ce": {"iv": "n/a", "delta": 0.25},
             "pe": {"oi": 50, "iv": 14.0, "delta": -0.7}},
        ]
        surface = iv_summary(rows, spot=23_300.0)

        assert surface["coverage"]["rows"] == 4
        assert surface["coverage"]["with_ce_iv"] == 0
        assert surface["coverage"]["with_pe_iv"] == 1
        assert surface["degraded"] is True
        # ATM strike is still named even though both of its IVs are dead.
        assert surface["atm"]["strike"] == 23_300.0
        assert surface["atm"]["avg_iv"] is None

    def test_empty_rows(self):
        surface = iv_summary([], spot=23_300.0)

        assert surface["degraded"] is True
        assert surface["atm"] == {
            "strike": None, "ce_iv": None, "pe_iv": None, "avg_iv": None,
        }
        assert surface["skew"] == {
            "strike_ce25": None, "ce_25d_iv": None,
            "strike_pe25": None, "pe_25d_iv": None,
            "skew_25d": None,
        }
        assert surface["term"] == []
        assert surface["coverage"] == {
            "rows": 0, "with_ce_iv": 0, "with_pe_iv": 0, "with_delta": 0,
        }

    def test_none_rows(self):
        assert iv_summary(None)["degraded"] is True


class TestTermStructure:
    def test_two_expiries(self):
        near = _rows()
        far_chain = dict(CHAIN)
        far_chain[23_300.0] = (0.50, 16.0, -0.48, 17.0)
        far = _rows(far_chain)
        report = {"spot": 23_300.0, "expiry": "2026-11-05"}

        surface = attach_iv_surface(
            report,
            near,
            expiries={"2026-11-12": far, "2026-11-05": near},
        )

        assert surface["term"] == [
            {"expiry": "2026-11-05", "atm_iv": pytest.approx(14.65)},
            {"expiry": "2026-11-12", "atm_iv": pytest.approx(16.5)},
        ]
        assert surface["atm"]["strike"] == 23_300.0

    def test_no_expiries_gives_empty_term(self):
        assert iv_summary(_rows(), spot=23_300.0)["term"] == []


class TestCoverage:
    def test_counts_match_input(self):
        rows = _rows()
        rows[0]["ce"]["iv"] = None      # 22,900 call dead
        rows[1]["pe"]["iv"] = None      # 23,000 put dead
        rows[2]["ce"]["delta"] = None   # 23,100 call has no greek
        rows[2]["pe"]["delta"] = None   # ... and neither does its put

        coverage = iv_summary(rows, spot=23_300.0)["coverage"]

        assert coverage == {
            "rows": 9,
            "with_ce_iv": 8,
            "with_pe_iv": 8,
            "with_delta": 8,
        }

    def test_attach_stores_surface_and_returns_it(self):
        report = {"spot": 23_300.0, "expiry": "2026-11-05", "mode": "live"}
        before = dict(report)

        surface = attach_iv_surface(report, _rows())

        assert surface["degraded"] is False
        assert report["iv_surface"] is surface
        assert set(report) == set(before) | {"iv_surface"}
        assert report["mode"] == "live"

    def test_attach_without_spot_still_works(self):
        surface = attach_iv_surface({}, _rows())
        assert surface["atm"]["strike"] == 23_300.0
        assert surface["degraded"] is False


# ---------------------------------------------------------------------------
# hard sanity gates (2026-11-03: 281.25% IV on a 0.0053-delta dead strike)
# ---------------------------------------------------------------------------

class TestSurfaceSanityGates:
    def test_no_leg_in_the_delta_band_means_no_wing(self):
        """The chain's nearest 25Δ call was a 0.0053-delta lottery ticket."""
        rows = [
            {"strike": 23_700.0,
             "ce": _leg(oi=1_000, iv=13.0, delta=0.60),
             "pe": _leg(oi=1_000, iv=15.0, delta=-0.25)},
            {"strike": 23_950.0,
             "ce": _leg(oi=10, iv=281.25, delta=0.0053),
             "pe": _leg(oi=1_000, iv=22.0, delta=-0.90)},
        ]
        surface = iv_summary(rows, spot=23_810.85)

        assert surface["skew"]["strike_ce25"] is None
        assert surface["skew"]["ce_25d_iv"] is None
        assert surface["skew"]["skew_25d"] is None
        assert surface["degraded"] is True
        # The 281% print never reaches the payload.
        assert surface["skew"]["ce_25d_iv"] != pytest.approx(281.25)

    def test_iv_above_100_is_dropped_even_on_a_valid_delta(self):
        rows = [{"strike": 23_500.0,
                 "ce": _leg(oi=1_000, iv=281.25, delta=0.25),
                 "pe": _leg(oi=1_000, iv=13.0, delta=-0.75)}]
        surface = iv_summary(rows, spot=23_500.0)

        assert surface["skew"]["strike_ce25"] == 23_500.0
        assert surface["skew"]["ce_25d_iv"] is None
        assert surface["skew"]["skew_25d"] is None
        assert surface["coverage"]["with_ce_iv"] == 0
        assert surface["degraded"] is True

    def test_iv_on_a_zero_oi_leg_is_not_tradeable(self):
        rows = [{"strike": 23_500.0,
                 "ce": _leg(oi=0, iv=12.8, delta=0.25),
                 "pe": _leg(oi=1_000, iv=13.2, delta=-0.75)}]
        surface = iv_summary(rows, spot=23_500.0)

        assert surface["coverage"]["with_ce_iv"] == 0
        assert surface["skew"]["ce_25d_iv"] is None
        assert surface["degraded"] is True

    def test_non_finite_iv_is_not_data(self):
        rows = [{"strike": 23_500.0,
                 "ce": _leg(oi=1_000, iv=float("nan"), delta=0.25),
                 "pe": _leg(oi=1_000, iv=float("inf"), delta=-0.75)}]
        surface = iv_summary(rows, spot=23_500.0)

        assert surface["coverage"]["with_ce_iv"] == 0
        assert surface["coverage"]["with_pe_iv"] == 0
        assert surface["degraded"] is True
