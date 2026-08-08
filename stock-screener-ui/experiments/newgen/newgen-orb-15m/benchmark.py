"""NEWGEN ORB 15-min benchmark for autoresearch session newgen-orb-15m.

Loads the shared 15-min NEWGEN candle cache and runs the ORB simulator from
experiments/newgen/common.py with env-var driven parameters. Prints METRIC
key=value lines consumed by the autoresearch loop. Each run completes <5s.

Env vars:
  NEWGEN_OR_MIN       opening range duration in minutes (5/10/15/60)
  NEWGEN_SL           stop-loss pct (e.g. 1.0)
  NEWGEN_TP           take-profit pct (0 disables TP)
  NEWGEN_BUFFER       breakout buffer pct
  NEWGEN_COOLDOWN_BARS cooldown bars between trades
  NEWGEN_SHORTS       "1" enables short-side entries
  NEWGEN_EOD_EXIT     EOD exit minute-of-day (900 = 15:00)
  NEWGEN_TRADE_SIZE   shares per trade
  NEWGEN_MIN_OR_RANGE min OR range pct to trade
  NEWGEN_MAX_OR_RANGE max OR range pct to trade
  NEWGEN_MIN_ENTRY    min entry minute after open
  NEWGEN_MAX_PER_DAY  max trades per day (0 = unlimited)
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from experiments.newgen.common import (
    load_newgen,
    simulate_orb,
    compute_metrics,
    print_metrics,
)

TF = 15


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "")
    return float(raw) if raw else default


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    return int(raw) if raw else default


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "")
    return bool(int(raw)) if raw else default


def main():
    df = load_newgen(TF)

    or_minutes = env_int("NEWGEN_OR_MIN", 15)
    sl_pct = env_float("NEWGEN_SL", 1.0)
    tp_pct = env_float("NEWGEN_TP", 1.5)
    buffer_pct = env_float("NEWGEN_BUFFER", 0.3)
    cooldown_bars = env_int("NEWGEN_COOLDOWN_BARS", 1)
    shorts = env_bool("NEWGEN_SHORTS", False)
    eod_exit = env_int("NEWGEN_EOD_EXIT", 900)
    trade_size = env_int("NEWGEN_TRADE_SIZE", 100)
    min_or_range_pct = env_float("NEWGEN_MIN_OR_RANGE", 0.3)
    max_or_range_pct = env_float("NEWGEN_MAX_OR_RANGE", 5.0)
    min_entry = env_int("NEWGEN_MIN_ENTRY", 0)
    max_per_day = env_int("NEWGEN_MAX_PER_DAY", 0)

    trades = simulate_orb(
        df,
        or_minutes=or_minutes,
        sl_pct=sl_pct,
        tp_pct=tp_pct,
        buffer_pct=buffer_pct,
        cooldown_bars=cooldown_bars,
        shorts=shorts,
        trade_size=trade_size,
        eod_exit_minutes=eod_exit,
        min_entry_minutes=min_entry,
        max_per_day=max_per_day,
        include_costs=True,
        min_or_range_pct=min_or_range_pct,
        max_or_range_pct=max_or_range_pct,
    )

    metrics = compute_metrics(trades)

    print(f"METRIC pf={metrics['profit_factor']}")
    print(f"METRIC win_rate={metrics['win_rate']}")
    print(f"METRIC net_pnl={metrics['net_pnl']}")
    print(f"METRIC total_trades={metrics['total_trades']}")
    print(f"METRIC tp_exits={metrics['tp_exits']}")
    print(f"METRIC sl_exits={metrics['sl_exits']}")
    print(f"METRIC eod_exits={metrics['eod_exits']}")

    desc = (
        f"OR={or_minutes} SL={sl_pct} TP={tp_pct} BUFFER={buffer_pct} "
        f"COOLDOWN={cooldown_bars} SHORTS={int(shorts)} EOD={eod_exit} "
        f"MINOR={min_or_range_pct} MAXOR={max_or_range_pct} MINENTRY={min_entry} "
        f"MAXDAY={max_per_day}"
    )
    print(f"DESC {desc}")


if __name__ == "__main__":
    main()
