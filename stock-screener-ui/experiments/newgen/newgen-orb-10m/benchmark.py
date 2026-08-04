"""ORB benchmark for NEWGEN on 10-min candles (autoresearch session newgen-orb-10m).

Reads params from env vars, runs ORB sim via common.simulate_orb, prints METRIC lines.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from experiments.newgen.common import (
    load_newgen, simulate_orb, compute_metrics, print_metrics,
)

def fenv(key: str, default: float) -> float:
    return float(os.environ.get(key, default))

def ienv(key: str, default: int) -> int:
    return int(os.environ.get(key, default))

def main() -> int:
    df = load_newgen(10)
    or_minutes = ienv("NEWGEN_OR_MIN", 15)
    sl_pct = fenv("NEWGEN_SL", 1.0)
    tp_pct = fenv("NEWGEN_TP", 1.5)
    buffer_pct = fenv("NEWGEN_BUFFER", 0.3)
    cooldown_bars = ienv("NEWGEN_COOLDOWN_BARS", 1)
    shorts = ienv("NEWGEN_SHORTS", 0) == 1
    eod_exit_minutes = ienv("NEWGEN_EOD_EXIT", 900)
    trade_size = ienv("NEWGEN_TRADE_SIZE", 100)
    min_or_range_pct = fenv("NEWGEN_MIN_OR_RANGE", 0.3)
    max_or_range_pct = fenv("NEWGEN_MAX_OR_RANGE", 5.0)

    trades = simulate_orb(
        df,
        or_minutes=or_minutes,
        sl_pct=sl_pct,
        tp_pct=tp_pct,
        buffer_pct=buffer_pct,
        cooldown_bars=cooldown_bars,
        shorts=shorts,
        trade_size=trade_size,
        eod_exit_minutes=eod_exit_minutes,
        include_costs=True,
        min_or_range_pct=min_or_range_pct,
        max_or_range_pct=max_or_range_pct,
    )
    m = compute_metrics(trades)
    print(f"INFO or_min={or_minutes} sl={sl_pct} tp={tp_pct} buffer={buffer_pct} "
          f"cooldown={cooldown_bars} shorts={shorts} eod={eod_exit_minutes} "
          f"min_or_range={min_or_range_pct} max_or_range={max_or_range_pct}", file=sys.stderr)
    print_metrics(m)
    return 0

if __name__ == "__main__":
    sys.exit(main())
