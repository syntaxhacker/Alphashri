"""Unit tests for the SMC iFVG engine (trading/smc_ifvg.py) — synthetic bars, no network."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trading.smc_ifvg import SMCIFVGEngine


def bar(t, o, h, l, c):
    return {"time": t, "open": o, "high": h, "low": l, "close": c}


def flat_bars(n, price=100.0, start=0):
    return [bar(start + i * 60, price, price + 0.5, price - 0.5, price) for i in range(n)]


def tick(ts_ms, bid, ask):
    return {"timestamp": ts_ms, "bidPrice": bid, "askPrice": ask}


class TestFractalPivots:
    def test_fractal_high_confirms_trail_ref(self):
        eng = SMCIFVGEngine()
        bars = flat_bars(4)
        bars.append(bar(4 * 60, 100, 105, 99, 104))   # pivot candidate
        bars.append(bar(5 * 60, 104, 103, 98, 102))
        bars.append(bar(6 * 60, 102, 101, 97, 101))
        eng.on_close(bars, 6)                          # confirms pivot at i-2=4
        assert eng.trail_hi == 105
        assert eng.piv_high == 105
        assert eng.piv_high_broken is False

    def test_no_fractal_in_straight_trend(self):
        eng = SMCIFVGEngine()
        bars = [bar(i * 60, 100 + i, 101 + i, 99.5 + i, 100.8 + i) for i in range(20)]
        eng.on_close(bars, 19)
        assert eng.trail_hi is None   # every high exceeds the next bar's high — no strict fractal


class TestBOS:
    def test_bos_up_on_close_above_pivot(self):
        eng = SMCIFVGEngine()
        bars = flat_bars(6)
        bars[3] = bar(3 * 60, 100, 106, 99.5, 100)    # pivot high 106, confirmed at i=5
        eng.on_close(bars, 5)
        assert eng.piv_high == 106
        bars.append(bar(6 * 60, 100, 107, 100, 106.5))  # close 106.5 > 106
        eng.on_close(bars, 6)
        assert eng.bos_dir == 1
        assert eng.piv_high_broken is True


class TestFVG:
    def test_bear_fvg_detected(self):
        eng = SMCIFVGEngine()
        bars = flat_bars(6)
        bars[5] = bar(5 * 60, 100, 96, 95, 95.5)      # c.high 96 < a.low 99.5, gap 3.5 > 2
        eng.on_close(bars, 5)
        assert len(eng.fvgs) == 1
        assert eng.fvgs[0]["type"] == "bear"
        assert eng.fvgs[0]["top"] == 99.5
        assert eng.fvgs[0]["bot"] == 96

    def test_gap_below_min_ignored(self):
        eng = SMCIFVGEngine()
        bars = flat_bars(6)
        bars[5] = bar(5 * 60, 100, 99.2, 99, 99.2)    # gap only 0.3
        eng.on_close(bars, 5)
        assert len(eng.fvgs) == 0


class TestInversionArming:
    def test_bull_fvg_inverted_down_arms_short_when_bos_down(self):
        eng = SMCIFVGEngine()
        bars = flat_bars(4)                            # 0..3 flat (H 100.5, L 99.5)
        bars.append(bar(4 * 60, 100, 104, 99.5, 103))
        bars.append(bar(5 * 60, 103, 105, 103, 104))   # low 103 > bars[3].high 100.5 + 2 -> bull FVG
        eng.on_close(bars, 5)
        assert any(f["type"] == "bull" and f["bot"] == 100.5 and f["top"] == 103 for f in eng.fvgs)
        bars.append(bar(6 * 60, 104, 104.5, 103, 103.5))
        bars.append(bar(7 * 60, 103.5, 103.8, 98, 100.6))   # pivot low 98, close holds above FVG bot
        bars.append(bar(8 * 60, 100.6, 101, 98.2, 100.8))
        bars.append(bar(9 * 60, 100.8, 101.2, 98.3, 101))   # confirms pivot low 98 at i=7
        eng.on_close(bars, 9)
        assert eng.piv_low == 98
        assert eng.pending is None   # inversion must not fire before BOS alignment
        bars.append(bar(10 * 60, 99, 99.4, 97.5, 97.8))    # close 97.8 < 98 -> BOS down
        eng.on_close(bars, 10)
        assert eng.bos_dir == -1
        bars.append(bar(11 * 60, 97.8, 98, 96, 96.2))      # close < bull FVG bot 100.5 -> inversion
        eng.on_close(bars, 11)
        assert eng.pending is not None
        assert eng.pending["kind"] == "inv"
        assert eng.pending["side"] == "SHORT"
        assert eng.pending["sl_ref"] == 103                # min(trail_hi 105, zone top 103)

    def test_no_arm_when_position_open(self):
        eng = SMCIFVGEngine()
        eng.pos = {"side": "LONG", "entry": 100, "sl": 95, "tp": None}
        bars = flat_bars(6)
        bars[5] = bar(5 * 60, 100, 96, 95, 95.5)
        eng.on_close(bars, 5)
        assert eng.pending is None   # blocked while in position


class TestFindTP:
    def _session(self):
        bars = flat_bars(20)
        bars[5] = bar(5 * 60, 100, 100.5, 92, 100)    # pivot low 92 (2 flat bars each side)
        return bars

    def test_rr_gate_filters_far_targets(self):
        eng = SMCIFVGEngine(min_rr=2.0)
        bars = self._session()
        eng.on_close(bars, 7)                          # pivot low 92 confirmed
        # SHORT entry 100, risk 10 -> TP 92 only 0.8R -> filtered
        assert eng.find_tp(bars, 15, "SHORT", 100, 10) is None
        # risk 2 -> 4R -> passes
        assert eng.find_tp(bars, 15, "SHORT", 100, 2) == 92

    def test_target_must_be_untouched(self):
        eng = SMCIFVGEngine(min_rr=2.0)
        bars = self._session()
        bars[9] = bar(9 * 60, 100, 100.5, 91, 100)    # dip through 92...
        bars[10] = bar(10 * 60, 100, 100.5, 91, 100)  # ...two equal lows -> no new strict fractal
        eng.on_close(bars, 10)
        # pivot 92 was violated (lows 91 < 92) and no new valid pivot exists -> no target
        assert eng.find_tp(bars, 15, "SHORT", 100, 2) is None


class TestTickFills:
    def test_sl_wins_on_ambiguous_tick(self):
        eng = SMCIFVGEngine(min_risk=0.1)
        eng.pos = {"side": "SHORT", "entry": 100, "sl": 104, "tp": 90, "i": 0, "kind": "inv", "ts": 0}
        bars = [bar(0, 100, 100.5, 99.5, 100), bar(60, 100, 100.5, 99.5, 100)]
        # same tick breaches BOTH: bid 89 <= tp 90 and ask 104.5 >= sl 104
        ticks = [tick(60_000, 99.0, 100.0), tick(90_000, 89.0, 104.5)]
        trades = eng.run(bars, ticks)
        assert len(trades) == 1
        assert trades[0]["result"] == "SL"             # conservative: SL checked first
        assert trades[0]["pnl"] == -4.0

    def test_long_exit_at_bid(self):
        eng = SMCIFVGEngine(min_risk=0.1)
        eng.pos = {"side": "LONG", "entry": 100, "sl": 99, "tp": 105, "i": 0, "kind": "inv", "ts": 0}
        bars = [bar(0, 100, 100.5, 99.5, 100), bar(60, 100, 100.5, 99.5, 100)]
        ticks = [tick(60_000, 104.0, 105.2)]           # ask >= tp -> exit at tp
        trades = eng.run(bars, ticks)
        assert trades[0]["result"] == "TP"
        assert trades[0]["exit"] == 105


class TestDivideAndTPFixes:
    def test_dedupe_skips_sibling_entry(self):
        shared = {"fills": [(120_000, "LONG")]}        # sibling stack filled LONG at t=120s
        eng = SMCIFVGEngine(min_risk=0.1, shared=shared)
        eng.pending = {"kind": "inv", "side": "LONG", "sl_ref": 95, "sig_i": 0,
                       "zone": {"top": 106, "bot": 100}, "trigger": None}
        bars = [bar(0, 100, 100.5, 99.5, 100), bar(60, 100, 100.5, 99.5, 100), bar(120, 100, 100.5, 99.5, 100)]
        trades = eng.run(bars, [tick(120_000, 99.0, 100.0)])   # fill tick inside dup window
        assert trades == [] and eng.pos is None

    def test_no_dedupe_after_window(self):
        shared = {"fills": [(0, "LONG")]}              # 10 min old -> outside 5-min window
        eng = SMCIFVGEngine(min_risk=0.1, shared=shared)
        eng.pending = {"kind": "inv", "side": "LONG", "sl_ref": 95, "sig_i": 0,
                       "zone": {"top": 106, "bot": 100}, "trigger": None}
        bars = [bar(0, 100, 100.5, 99.5, 100), bar(600, 100, 100.5, 99.5, 100)]
        trades = eng.run(bars, [tick(600_000, 99.0, 100.0)])
        assert len(trades) == 0 and eng.pos is not None   # fills (pending converted to open position)

    def test_tp_near_vs_far(self):
        bars = flat_bars(20)
        bars[5] = bar(5 * 60, 100, 130, 100, 100)      # wide target first
        bars[8] = bar(8 * 60, 100, 118, 100, 100)      # nearer target, untouched -> RR 3.6
        assert SMCIFVGEngine(min_rr=2.0, tp_mode="near").find_tp(bars, 15, "LONG", 100, 5) == 118
        assert SMCIFVGEngine(min_rr=2.0, tp_mode="far").find_tp(bars, 15, "LONG", 100, 5) == 130

    def test_partials_bank_1r_and_breakeven(self):
        eng = SMCIFVGEngine(min_risk=0.1, partials=True)
        eng.pos = {"side": "LONG", "entry": 100, "sl": 95, "tp": 115, "i": 0, "kind": "inv", "ts": 0,
                   "risk": 5, "partial": False}
        bars = [bar(0, 100, 100.5, 99.5, 100), bar(60, 100, 100.5, 99.5, 100)]
        trades = eng.run(bars, [tick(60_000, 105.5, 106.0),   # +1R -> bank half, stop to BE
                                tick(90_000, 99.8, 100.2)])   # back to entry -> BE exit
        assert len(trades) == 1
        assert trades[0]["pnl"] == 2.5                    # 0.5*5 + 0.5*0


class TestInvFlip:
    def test_strong_inversion_flips_bias_and_arms(self):
        eng = SMCIFVGEngine(inv_flip_margin=3.0)
        eng.bos_dir = -1  # trend short...
        eng.fvgs.append({"type": "bear", "top": 100.0, "bot": 98.0, "form": 5, "inv": False, "used": False})
        eng.trail_lo = 96.0
        bars = flat_bars(8)
        bars[7] = bar(7 * 60, 99, 105, 99, 104)   # close 104 clears zone top 100 by 4 >= 3
        eng.on_close(bars, 7)
        assert eng.bos_dir == 1                    # bias flipped by the inversion itself
        assert eng.pending is not None             # ...and armed, not consumed
        assert eng.pending["side"] == "LONG"

    def test_weak_inversion_does_not_flip(self):
        eng = SMCIFVGEngine(inv_flip_margin=3.0)
        eng.bos_dir = -1
        eng.fvgs.append({"type": "bear", "top": 100.0, "bot": 98.0, "form": 5, "inv": False, "used": False})
        eng.trail_lo = 96.0
        bars = flat_bars(8)
        bars[7] = bar(7 * 60, 99, 101.5, 99, 101)  # clears by only 1 < 3
        eng.on_close(bars, 7)
        assert eng.bos_dir == -1
        assert eng.pending is None


class TestRevExit:
    def test_opposite_fill_closes_position_without_flip(self):
        eng = SMCIFVGEngine(rev_exit=True, min_risk=0.1)
        eng.pos = {"side": "SHORT", "entry": 100, "sl": 104, "tp": 90, "i": 0, "kind": "inv", "ts": 0,
                   "risk": 4, "partial": False}
        eng.pending = {"kind": "inv", "side": "LONG", "sl_ref": 96, "sig_i": 0,
                       "zone": {"top": 103, "bot": 101}, "trigger": None}
        bars = [bar(0, 100, 100.5, 99.5, 100), bar(60, 100, 100.5, 99.5, 100), bar(120, 100, 100.5, 99.5, 100)]
        trades = eng.run(bars, [tick(120_000, 97.0, 98.0)])    # LONG fill at ask 98 -> short leg +2
        assert len(trades) == 1
        assert trades[0]["result"] == "REV"
        assert trades[0]["exit"] == 98
        assert trades[0]["pnl"] == 2.0
        assert eng.pos is None          # exit only — no reversal position opened
        assert eng.pending is None

    def test_opposite_fill_at_loss_holds_position(self):
        eng = SMCIFVGEngine(rev_exit=True, min_risk=0.1)
        eng.pos = {"side": "SHORT", "entry": 100, "sl": 104, "tp": 90, "i": 0, "kind": "inv", "ts": 0,
                   "risk": 4, "partial": False}
        eng.pending = {"kind": "inv", "side": "LONG", "sl_ref": 96, "sig_i": 0,
                       "zone": {"top": 103, "bot": 101}, "trigger": None}
        bars = [bar(0, 100, 100.5, 99.5, 100), bar(60, 100, 100.5, 99.5, 100), bar(120, 100, 100.5, 99.5, 100)]
        trades = eng.run(bars, [tick(120_000, 99.0, 101.0)])   # LONG fill at ask 101 -> short leg -1
        assert trades == []             # no profit to take -> hold to SL/TP
        assert eng.pos is not None
        assert eng.pending is None      # signal consumed

    def test_same_side_add_blocked_with_rev_exit(self):
        eng = SMCIFVGEngine(rev_exit=True)
        eng.pos = {"side": "LONG", "entry": 100, "sl": 95, "tp": 110, "i": 0, "kind": "inv", "ts": 0,
                   "risk": 5, "partial": False}
        bars = flat_bars(8)
        bars[7] = bar(7 * 60, 100, 112, 109, 111)   # would arm LONG (bull zone... no FVG -> no arm anyway)
        eng.on_close(bars, 7)
        assert eng.pending is None
