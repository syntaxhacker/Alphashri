"""ORB benchmark for NEWGEN on 1-HOUR candles (newgen-orb-1h session).

Reads all params from env vars (with baseline defaults), loads the shared
60-min NEWGEN cache, runs the ORB simulator, and prints METRIC lines.

Env vars:
  NEWGEN_OR_MIN        OR duration in minutes (default 15)
  NEWGEN_SL            SL %% (default 1.0)
  NEWGEN_TP            TP %% (default 1.5; 0 disables TP)
  NEWGEN_BUFFER        breakout buffer %% (default 0.3)
  NEWGEN_COOLDOWN_BARS cooldown after exit, in bars (default 1)
  NEWGEN_SHORTS        enable shorts 1/0 (default 0)
  NEWGEN_EOD_EXIT      EOD exit time in minutes-of-day (default 885)
  NEWGEN_MIN_ENTRY     min entry minutes after open (default 0)
  NEWGEN_TRADE_SIZE    shares per trade (default 100)
  NEWGEN_MIN_OR        min OR range %% (default 0.3)
  NEWGEN_MAX_OR        max OR range %% (default 5.0)
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "experiments"))

from experiments.newgen.common import (
    load_newgen, simulate_orb, compute_metrics, print_metrics,
)

TF = 60


def fenv(name, default):
    return float(os.environ.get(name, default))


def ienv(name, default):
    return int(os.environ.get(name, default))


def benv(name, default):
    v = os.environ.get(name, default)
    return str(v).lower() in ("1", "true", "yes", "on")


def main():
    or_minutes = ienv("NEWGEN_OR_MIN", 15)
    sl_pct = fenv("NEWGEN_SL", 1.0)
    tp_pct = fenv("NEWGEN_TP", 1.5)
    buffer_pct = fenv("NEWGEN_BUFFER", 0.3)
    cooldown_bars = ienv("NEWGEN_COOLDOWN_BARS", 1)
    shorts = benv("NEWGEN_SHORTS", 0)
    eod_exit_minutes = ienv("NEWGEN_EOD_EXIT", 885)
    min_entry_minutes = ienv("NEWGEN_MIN_ENTRY", 0)
    trade_size = ienv("NEWGEN_TRADE_SIZE", 100)
    min_or_range_pct = fenv("NEWGEN_MIN_OR", 0.3)
    max_or_range_pct = fenv("NEWGEN_MAX_OR", 5.0)

    df = load_newgen(TF)
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
        min_entry_minutes=min_entry_minutes,
        include_costs=True,
        min_or_range_pct=min_or_range_pct,
        max_or_range_pct=max_or_range_pct,
    )
    m = compute_metrics(trades)
    print(f"RUN params OR={or_minutes} SL={sl_pct} TP={tp_pct} buffer={buffer_pct} "
          f"cooldown={cooldown_bars} shorts={int(shorts)} EOD={eod_exit_minutes} "
          f"min_entry={min_entry_minutes} size={trade_size} minOR={min_or_range_pct} maxOR={max_or_range_pct}",
          file=sys.stderr)
    print_metrics(m)


if __name__ == "__main__":
    main()
