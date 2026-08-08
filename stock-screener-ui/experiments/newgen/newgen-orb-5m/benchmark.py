"""NEWGEN ORB benchmark (5-min candles) — newgen-orb-5m autoresearch session.

Reads params from env vars and runs the ORB sim via common.simulate_orb, then
prints METRIC key=value lines via common.print_metrics. Single stock, cached
data — each run completes in <5s.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from experiments.newgen.common import (
    load_newgen,
    simulate_orb,
    compute_metrics,
    print_metrics,
)


def _f(name, default):
    return float(os.environ.get(name, str(default)))


def _i(name, default):
    return int(os.environ.get(name, str(default)))


def main():
    df = load_newgen(5)

    or_min = _i("NEWGEN_OR_MIN", 15)
    sl_pct = _f("NEWGEN_SL", 1.0)
    tp_pct = _f("NEWGEN_TP", 1.5)
    buffer_pct = _f("NEWGEN_BUFFER", 0.3)
    cooldown_bars = _i("NEWGEN_COOLDOWN_BARS", 1)
    shorts = os.environ.get("NEWGEN_SHORTS", "0") == "1"
    eod_exit_minutes = _i("NEWGEN_EOD_EXIT", 900)
    trade_size = _i("NEWGEN_TRADE_SIZE", 100)
    include_costs = os.environ.get("NEWGEN_COSTS", "1") == "1"
    min_or_range_pct = _f("NEWGEN_MIN_OR_RANGE", 0.3)
    max_or_range_pct = _f("NEWGEN_MAX_OR_RANGE", 5.0)
    min_entry_minutes = _i("NEWGEN_MIN_ENTRY_MIN", 0)
    max_per_day = _i("NEWGEN_MAX_PER_DAY", 0)

    trades = simulate_orb(
        df,
        or_minutes=or_min,
        sl_pct=sl_pct,
        tp_pct=tp_pct,
        buffer_pct=buffer_pct,
        cooldown_bars=cooldown_bars,
        shorts=shorts,
        trade_size=trade_size,
        eod_exit_minutes=eod_exit_minutes,
        min_entry_minutes=min_entry_minutes,
        max_per_day=max_per_day,
        include_costs=include_costs,
        min_or_range_pct=min_or_range_pct,
        max_or_range_pct=max_or_range_pct,
    )
    m = compute_metrics(trades)
    print_metrics(m)


if __name__ == "__main__":
    main()
