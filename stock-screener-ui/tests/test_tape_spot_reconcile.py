"""Tape spot reconciliation + NIFTY lot size.

Both were uncovered by live data on 2026-10-14:
  * the tape persisted spot 22,363 while the real market was ~22,690 (~1.5% off)
  * every real exchange print was an exact multiple of 65, not our hardcoded 75
"""

from __future__ import annotations

import pytest

from api.reports_api.nifty import reconcile_spot
from api.reports_api.nifty_bursts import NIFTY_LOT_SIZE


class TestReconcileSpot:
    def test_trusts_chain_when_it_agrees_with_index(self):
        assert reconcile_spot(22700.0, 22698.0, 22695.0) == 22700.0

    def test_index_quote_wins_on_material_disagreement(self):
        # The real 2026-10-14 failure.
        assert reconcile_spot(22363.3, 22690.0, 22718.7) == 22690.0

    def test_drops_row_when_no_quote_and_jump_is_impossible(self):
        assert reconcile_spot(22363.3, None, 22718.7) is None

    def test_keeps_ordinary_move_without_a_quote(self):
        assert reconcile_spot(22700.0, None, 22690.0) == 22700.0

    def test_allows_a_real_gap_confirmed_by_the_index(self):
        # A genuine fast move: both sources jumped together, so the chain value
        # is kept rather than the row being dropped as corrupted.
        assert reconcile_spot(22400.0, 22405.0, 22720.0) == 22400.0

    def test_first_row_of_the_day_is_kept(self):
        assert reconcile_spot(22700.0, None, None) == 22700.0

    def test_missing_chain_spot_falls_back_to_the_index(self):
        assert reconcile_spot(0.0, 22700.0, None) == 22700.0

    @pytest.mark.parametrize("chain,index,last", [(None, None, 22700.0), (0, 0, None)])
    def test_no_usable_spot_is_dropped(self, chain, index, last):
        assert reconcile_spot(chain, index, last) is None


class TestNiftyLotSize:
    def test_lot_size_is_65(self):
        assert NIFTY_LOT_SIZE == 65

    def test_derived_qty_is_a_tradeable_multiple(self):
        # 23 consecutive real prints were all exact multiples of the lot size.
        real_prints = [455, 4225, 650, 195, 845, 130, 2145, 325, 260, 780,
                       1365, 390, 585, 520, 65]
        assert all(p % NIFTY_LOT_SIZE == 0 for p in real_prints)

    def test_qty_never_lands_on_a_fractional_lot(self):
        for units in (65, 100, 250, 1000, 4999):
            qty = (units // NIFTY_LOT_SIZE) * NIFTY_LOT_SIZE
            assert qty % NIFTY_LOT_SIZE == 0
            assert qty <= units


class TestDropImplausibleSpots:
    def test_drops_the_real_2026_10_14_pair(self):
        from api.reports_api.nifty import drop_implausible_spots
        rows = [
            {"t": "12:48", "spot": 22718.7},
            {"t": "12:53", "spot": 22363.3},   # bogus
            {"t": "12:54", "spot": 22363.3},   # bogus repeat
            {"t": "12:55", "spot": 22696.5},
        ]
        kept = drop_implausible_spots(rows)
        assert [r["t"] for r in kept] == ["12:48", "12:55"]

    def test_keeps_normal_drift_and_ignores_junk(self):
        from api.reports_api.nifty import drop_implausible_spots
        rows = [{"t": "09:15", "spot": 22700.0}, {"t": "09:16", "spot": 22650.0},
                {"t": "09:17", "spot": None}, {"t": "09:18", "spot": "bad"}]
        assert len(drop_implausible_spots(rows)) == 4


class TestDropEmptyChainRows:
    def test_drops_the_real_2026_10_14_empty_snapshots(self):
        from api.reports_api.nifty import drop_empty_chain_rows
        rows = [
            {"t": "10:06", "ce_oi": 120_000_000, "pe_oi": 145_000_000,
             "strikes_top": [{"strike": 22700}]},
            {"t": "10:08", "ce_oi": 0, "pe_oi": 0, "strikes_top": [], "pcr_oi": 0.0},
            {"t": "10:09", "ce_oi": 121_300_000, "pe_oi": 146_900_000,
             "strikes_top": [{"strike": 22700}]},
        ]
        assert [r["t"] for r in drop_empty_chain_rows(rows)] == ["10:06", "10:09"]

    def test_keeps_a_row_that_only_lacks_strikes(self):
        from api.reports_api.nifty import drop_empty_chain_rows
        rows = [{"t": "10:06", "ce_oi": 120_000_000, "pe_oi": 1, "strikes_top": []}]
        assert len(drop_empty_chain_rows(rows)) == 1
