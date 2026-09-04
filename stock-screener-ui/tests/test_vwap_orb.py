"""Unit tests for the VWAP+ORB engine — synthetic bars/ticks, no network."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trading.vwap_orb import VWAPORBEngine, compute_or_window


def bar(t, o, h, l, c):
    return {"time": t, "open": o, "high": h, "low": l, "close": c}


def tick(ts_ms, bid, ask=None, vol=1.0):
    ask = ask if ask is not None else bid + 1.0
    return {"timestamp": ts_ms, "bidPrice": bid, "askPrice": ask, "bidVolume": vol, "askVolume": vol}


def test_long_breakout_above_or_and_vwap():
    eng = VWAPORBEngine(or_bars=3)
    bars = [bar(0, 100, 101, 99, 100), bar(60, 100, 101, 99, 100), bar(120, 100, 101, 99, 100),
            bar(180, 100, 103, 100, 102.5),   # close 102.5 > OR high 101, above VWAP ~100
            bar(240, 102.5, 103, 102, 102.5)]
    ticks = [tick(180_000 + i * 500, 100.0) for i in range(4)] + \
            [tick(240_000, 102.0), tick(240_500, 111.0)]   # fill 103 ask, then ask 109 hits TP
    trades = eng.run(bars, ticks)
    assert len(trades) == 1
    assert trades[0]["side"] == "LONG"
    assert trades[0]["result"] == "TP"


def test_short_breakout_below_or_and_vwap():
    eng = VWAPORBEngine(or_bars=3)
    bars = [bar(0, 100, 101, 99, 100), bar(60, 100, 101, 99, 100), bar(120, 100, 101, 99, 100),
            bar(180, 100, 100, 97, 97.5),    # close 97.5 < OR low 99, below VWAP
            bar(240, 97.5, 98, 97, 97.5)]
    ticks = [tick(180_000 + i * 500, 100.0) for i in range(4)] +             [tick(240_000, 98.0, 99.0), tick(240_500, 90.0, 91.0)]  # fill 98 bid, bid 90 hits TP
    trades = eng.run(bars, ticks)
    assert len(trades) == 1
    assert trades[0]["side"] == "SHORT"
    assert trades[0]["result"] == "TP"


def test_no_signal_inside_range():
    eng = VWAPORBEngine(or_bars=3)
    bars = [bar(i * 60, 100, 101, 99, 100) for i in range(8)]  # chop inside OR
    ticks = [tick(60_000 + i * 1000, 100.0) for i in range(60)]
    assert eng.run(bars, ticks) == []


def test_compute_or_window_levels_and_end():
    bars = [bar(0, 100, 102, 99, 101), bar(60, 101, 103, 100, 102), bar(120, 102, 102.5, 98, 99)]
    hi, lo, end = compute_or_window(bars, 3)
    assert hi == 103
    assert lo == 98
    assert end == 180   # first second AFTER the 3rd 1m bar — levels unknown before this


def test_compute_or_window_short_session():
    assert compute_or_window([bar(0, 100, 101, 99, 100)], 15) == (0.0, 0.0, 0)


def test_struct_tp_nearest_untouched():
    eng = VWAPORBEngine()
    bars = [bar(i * 60, 100, 100.5, 99.5, 100) for i in range(20)]
    bars[5] = bar(5 * 60, 100, 104, 100, 100)    # pivot high 104
    bars[9] = bar(9 * 60, 100, 102, 100, 100)    # nearer pivot high 102, untouched
    assert eng._struct_tp(bars, 15, "LONG", 100) == 102


def test_struct_tp_skips_touched():
    eng = VWAPORBEngine()
    bars = [bar(i * 60, 100, 100.5, 99.5, 100) for i in range(20)]
    bars[5] = bar(5 * 60, 100, 104, 100, 100)
    bars[9] = bar(9 * 60, 100, 102, 100, 100)
    bars[12] = bar(12 * 60, 100, 105, 100, 100)  # trades through 102 -> touched
    assert eng._struct_tp(bars, 15, "LONG", 100) == 105
