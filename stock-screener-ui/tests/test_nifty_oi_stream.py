"""Tests for the P1 WebSocket OI stream (`api/reports_api/nifty_oi_stream.py`).

Only the pure/stateful parts are covered — the WS session itself cannot be
exercised out of market hours, which is exactly why it ships disabled and
shadow-logged.
"""

from __future__ import annotations

import pytest

from api.reports_api import nifty_oi_stream as oi


class TestSafetyDefaults:
    def test_the_feed_is_off_and_shadowed_by_default(self):
        """An unvalidated live feed must never enable itself."""
        assert oi.ENABLED is False
        assert oi.SHADOW is True

    def test_window_is_shorter_than_the_tape(self):
        # The whole point: detect sooner than the 60s tape write.
        assert oi.DETECT_WINDOW_SEC < 60


class TestScaledFloor:
    def test_scales_a_per_minute_floor_to_the_window(self):
        assert oi.scaled_floor(2_000_000, 60) == 2_000_000
        assert oi.scaled_floor(2_000_000, 30) == 1_000_000
        assert oi.scaled_floor(2_000_000, 20) == pytest.approx(666_666.67, rel=1e-6)

    def test_never_returns_zero_for_a_positive_floor(self):
        assert oi.scaled_floor(2_000_000, 0.001) > 0


class TestSelectAtmContracts:
    @staticmethod
    def _chain():
        return [
            {"strike_price": 22500, "call_options": {"instrument_key": "ce22500"},
             "put_options": {"instrument_key": "pe22500"}},
            {"strike_price": 22550, "call_options": {"instrument_key": "ce22550"},
             "put_options": {"instrument_key": "pe22550"}},
            {"strike_price": 22600, "call_options": {"instrument_key": "ce22600"},
             "put_options": {"instrument_key": "pe22600"}},
            {"strike_price": 22900, "call_options": {"instrument_key": "ce22900"},
             "put_options": {"instrument_key": "pe22900"}},
        ]

    def test_picks_the_strikes_nearest_spot(self):
        out = oi.select_atm_contracts(self._chain(), 22570, n=1)
        strikes = [r["strike"] for r in out]
        assert 22550 in strikes and 22600 in strikes
        assert 22900 not in strikes

    def test_returns_ascending_strikes_with_both_legs(self):
        out = oi.select_atm_contracts(self._chain(), 22570, n=3)
        assert [r["strike"] for r in out] == sorted(r["strike"] for r in out)
        assert all(r["ce_key"] and r["pe_key"] for r in out)

    def test_is_bounded_to_2n_plus_1(self):
        assert len(oi.select_atm_contracts(self._chain(), 22570, n=1)) == 3

    def test_handles_empty_and_malformed_input(self):
        assert oi.select_atm_contracts([], 22570) == []
        assert oi.select_atm_contracts(None, 22570) == []
        assert oi.select_atm_contracts([{"strike_price": None}, "junk"], 22570) == []
        # a strike with a missing leg is skipped rather than subscribed blindly
        assert oi.select_atm_contracts(
            [{"strike_price": 22550, "call_options": {"instrument_key": "ce"}}], 22570) == []

    def test_none_contracts_do_not_raise(self):
        assert oi.select_atm_contracts([None, {"strike_price": 22550}], 22570) == []


class TestDetectOiTicks:
    @staticmethod
    def _series(points):
        return {(22550.0, "ce"): [(float(t), float(v)) for t, v in points]}

    @staticmethod
    def _flat_history(seconds=180, step=5):
        """A quiet series BEFORE the window, so a baseline exists."""
        return [(t, 0) for t in range(0, seconds + 1, step)]

    def test_a_fast_build_over_the_window_is_detected(self):
        pts = self._flat_history() + [(200, 3_000_000)]
        out = oi.detect_oi_ticks(self._series(pts), window_sec=20)
        assert len(out) == 1
        b = out[0]
        assert b["leg"] == "CE" and b["side"] == "call"
        assert b["strike"] == 22550.0
        assert b["delta"] == 3_000_000
        assert b["source"] == "ws"

    def test_a_move_under_the_scaled_floor_is_rejected(self):
        pts = self._flat_history() + [(200, 100_000)]   # < 666k floor
        assert oi.detect_oi_ticks(self._series(pts), window_sec=20) == []

    def test_warmup_is_required(self):
        assert oi.detect_oi_ticks(self._series([(200, 5_000_000)]), window_sec=20) == []

    def test_no_baseline_history_yields_nothing(self):
        """A spike with no prior spans cannot be scored against anything."""
        pts = [(180, 0), (200, 3_000_000)]
        assert oi.detect_oi_ticks(self._series(pts), window_sec=20) == []

    def test_put_leg_is_labelled_put(self):
        series = {(22600.0, "put"): self._flat_history() + [(200, 3_000_000)]}
        out = oi.detect_oi_ticks(series, window_sec=20)
        assert out and out[0]["side"] == "put" and out[0]["leg"] == "PE"

    def test_severity_ladder(self):
        # threshold = floor(666,667) x tier -> watch >= ~2.0M, critical >= ~5.3M
        weak = oi.detect_oi_ticks(self._series(self._flat_history() + [(200, 2_200_000)]),
                                  window_sec=20)
        crit = oi.detect_oi_ticks(self._series(self._flat_history() + [(200, 20_000_000)]),
                                  window_sec=20)
        assert weak and weak[0]["severity"] == "watch"
        assert crit and crit[0]["severity"] == "critical"

    def test_a_noisy_baseline_raises_the_bar(self):
        """A series that always moves 2M/20s must not alert on another 2M move."""
        noisy = [(t, (t // 5) * 2_000_000) for t in range(0, 181, 5)] + [(200, 75_000_000)]
        quiet = self._flat_history() + [(200, 2_500_000)]
        assert oi.detect_oi_ticks(self._series(quiet), window_sec=20) != []
        # same 2.5M move would clear the floor, but the noisy series scores ~1x
        mid = oi.detect_oi_ticks(self._series(noisy[:-1] + [(200, noisy[-2][1] + 2_500_000)]),
                                 window_sec=20)
        assert mid == []

    def test_empty_input_is_safe(self):
        assert oi.detect_oi_ticks({}, window_sec=20) == []
        assert oi.detect_oi_ticks(None, window_sec=20) == []


class TestRollingOi:
    def test_push_and_snapshot(self):
        r = oi.RollingOi()
        r.push(22550, "ce", 1.0, 100.0)
        r.push(22550, "ce", 2.0, 250.0)
        snap = r.snapshot()
        assert snap[(22550.0, "ce")] == [(1.0, 100.0), (2.0, 250.0)]

    def test_history_is_bounded(self):
        r = oi.RollingOi(max_samples=5)
        for i in range(20):
            r.push(22550, "ce", float(i), float(i))
        assert len(r.snapshot()[(22550.0, "ce")]) == 5

    def test_legs_and_strikes_are_kept_separate(self):
        r = oi.RollingOi()
        r.push(22550, "ce", 1.0, 10.0)
        r.push(22550, "pe", 1.0, 20.0)
        r.push(22600, "ce", 1.0, 30.0)
        assert len(r.snapshot()) == 3
        assert len(r.keys()) == 3

    def test_empty_rings_are_excluded_from_the_snapshot(self):
        r = oi.RollingOi()
        r._series[(1.0, "ce")] = []  # simulate a cleared ring
        assert r.snapshot() == {}
