"""Structural-shift detector: the 'why' behind the tape's raw numbers."""

from __future__ import annotations

from api.reports_api.nifty_structure import detect_structure_shifts


def _row(t, spot, *, ce=0, pe=0, pcr=1.0, mp=22700, cw=23000, pw=22700,
         cwoi=10_000_000, pwoi=12_000_000, strikes=None):
    return {
        "t": f"2026-10-14T{t}:00+05:30", "spot": spot,
        "ce_vol": ce, "pe_vol": pe, "pcr_oi": pcr, "max_pain": mp,
        "walls": {"calls": [{"strike": cw, "oi": cwoi}],
                  "puts": [{"strike": pw, "oi": pwoi}]},
        "strikes_top": strikes or [],
    }


class TestWallFlip:
    def test_support_becoming_resistance_is_critical(self):
        rows = [_row("12:48", 22718.7, pcr=1.13, pw=22700, cw=23000),
                _row("13:06", 22700.0, pcr=1.13, pw=22450, cw=22700)]
        flips = [e for e in detect_structure_shifts(rows) if e["kind"] == "wall_flip"]
        assert len(flips) == 1
        assert flips[0]["severity"] == "critical"
        assert flips[0]["level"] == 22700
        assert "support became resistance" in flips[0]["detail"]

    def test_a_stock_shift_survives_a_recorder_gap(self):
        # The real 2026-10-14 case: the flips happened across an 18-min outage.
        rows = [_row("12:48", 22718.7, pw=22700, cw=23000),
                _row("13:06", 22700.0, pw=22450, cw=22700)]
        assert [e for e in detect_structure_shifts(rows) if e["kind"] == "wall_flip"]

    def test_same_level_can_flip_again_after_the_dedupe_window(self):
        # Each comparison must stay inside the 30-min stock-gap limit, while
        # the two flips sit further apart than the 45-min dedupe window.
        rows = [_row("09:15", 22700.0, pw=22700, cw=23000),
                _row("09:20", 22700.0, pw=22450, cw=22700),   # flip #1
                _row("11:00", 22700.0, pw=22700, cw=23000),
                _row("11:05", 22700.0, pw=22450, cw=22700)]   # flip #2
        flips = [e for e in detect_structure_shifts(rows) if e["kind"] == "wall_flip"]
        # two support->resistance flips, plus the intervening reversal
        assert len(flips) == 2
        assert all("support became resistance" in e["detail"] for e in flips)


class TestFlowVsStock:
    def test_volume_spike_is_not_read_across_a_gap(self):
        rows = [_row("12:48", 22700.0, ce=1_000_000, pe=1_000_000)]
        rows += [_row(f"{12 + (i // 60)}:{48 + i % 60:02d}", 22700.0,
                      ce=1_000_000 + i * 100_000, pe=1_000_000)
                 for i in range(1, 8)]
        rows.append(_row("13:06", 22700.0, ce=99_000_000, pe=5_000_000))  # 18-min gap
        spikes = [e for e in detect_structure_shifts(rows) if e["kind"] == "volume_spike"]
        assert all("13:06" not in e["t"] for e in spikes)

    def test_volume_spike_fires_on_a_real_adjacent_jump(self):
        rows = [_row(f"10:{i:02d}", 22700.0, ce=1_000_000, pe=1_000_000) for i in range(10)]
        rows.append(_row("10:10", 22700.0, ce=9_000_000, pe=1_000_000))
        spikes = [e for e in detect_structure_shifts(rows) if e["kind"] == "volume_spike"]
        assert any(e["side"] == "call" for e in spikes)


class TestDespike:
    def test_one_corrupt_pcr_snapshot_does_not_become_the_baseline(self):
        # Real sequence: 1.13 -> (corrupt) 1.75 -> 0.94. The event must read
        # 1.13 -> 0.94, not 1.75 -> 0.94.
        rows = [_row("12:48", 22700.0, pcr=1.13),
                _row("13:06", 22700.0, pcr=1.75),
                _row("13:08", 22700.0, pcr=0.94, pw=22450, cw=22700),
                _row("13:09", 22700.0, pcr=0.94, pw=22450, cw=22700)]
        shifts = [e for e in detect_structure_shifts(rows) if e["kind"] == "pcr_shift"]
        assert shifts and "1.13" in shifts[0]["detail"]
        assert not any("1.75" in e["detail"] for e in shifts)


class TestRobustness:
    def test_empty_and_tiny_inputs(self):
        assert detect_structure_shifts([]) == []
        assert detect_structure_shifts(None) == []
        assert detect_structure_shifts([_row("09:15", 22700.0)]) == []

    def test_ignores_corrupt_spots(self):
        rows = [_row("12:48", 22718.7), _row("12:53", 22363.3),
                _row("12:54", 22363.3), _row("12:55", 22696.5)]
        assert all("broken" not in e["detail"] for e in detect_structure_shifts(rows))

    def test_events_are_chronological(self):
        rows = [_row("09:15", 22700.0, pw=22500, cw=23000),
                _row("09:30", 22700.0, pw=22550, cw=23000),
                _row("09:45", 22700.0, pw=22600, cw=23100)]
        times = [e["t"] for e in detect_structure_shifts(rows)]
        assert times == sorted(times)
