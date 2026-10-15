"""Week-42 new-pattern backtest runner: nifty500, 2026-10-05..09.

Usage:  source .venv/bin/activate && python experiments/run_new_patterns_week42.py
Writes: experiments/new_patterns_week42.json (+ per-variant signal lists)
"""
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backtest.engine import BacktestEngine
from chart_patterns.universes import get_universe

VARIANTS = [
    "accum_breakout", "accum_adx_gated", "gap_and_go", "high52w_vol",
    "failed_breakdown", "ema_stack", "ema_stack_nogate",
    "adx_breakout", "adx_breakout_nogate", "rsi_thrust",
    "base_20d", "base_52w",
]

# signal lists live here (symbol-level details per variant)
TRADE_DUMP: dict = {}


def main():
    engine = BacktestEngine()
    universe = get_universe("nifty500")
    print(f"universe nifty500: {len(universe)} symbols")
    out = {"window": ["2026-10-05", "2026-10-09"], "universe": "nifty500",
           "n_symbols": len(universe), "variants": {}}
    t0 = time.time()
    for vid in VARIANTS:
        t1 = time.time()
        res = engine.run(vid, universe, 30, {})
        dt = time.time() - t1
        tot = res["totals"]
        print(f"{vid:20s} trades={tot['trades']:4d} win={tot['win_rate']:5.1f}% "
              f"net={tot['net_pnl']:12.2f} pf={tot['pf']} exp={tot['expectancy']} "
              f"dd={tot['maxdd']} sig={tot['n_signals']} unfilled={tot['n_unfilled_friday']} "
              f"livefetch={tot['live_fetches']} ({dt:.0f}s)")
        out["variants"][vid] = tot
        # collect trade lists from chart_data
        trades = []
        for sym, cd in res.get("chart_data", {}).items():
            trades.extend(cd["trades"])
        TRADE_DUMP[vid] = sorted(trades, key=lambda t: (t["exit_date"], t["symbol"]))
    out["elapsed_sec"] = round(time.time() - t0, 1)
    Path("experiments/new_patterns_week42.json").write_text(json.dumps(out, indent=1))
    Path("experiments/new_patterns_week42_trades.json").write_text(
        json.dumps(TRADE_DUMP, indent=1))
    print(f"wrote experiments/new_patterns_week42.json in {out['elapsed_sec']}s")


if __name__ == "__main__":
    main()
