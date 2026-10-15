"""Chronological cached-tick benchmark for the chart's LRL+iFVG strategy."""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

EXPERIMENTS_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = EXPERIMENTS_DIR / "data" / "duka_cache"
if str(EXPERIMENTS_DIR) not in sys.path:
    sys.path.insert(0, str(EXPERIMENTS_DIR))

from lrl_liquidity_reversion import (  # noqa: E402
    LRLLiquidityConfig,
    run_lrl_liquidity_strategy,
)


VARIANTS: dict[str, LRLLiquidityConfig] = {
    "image_lrl_retest": LRLLiquidityConfig(),
    "image_lrl_no_retest": LRLLiquidityConfig(require_fvg_retest=False),
    "highest_3m_retest": LRLLiquidityConfig(
        lrl_min_touches=4,
        fvg_timeframes_seconds=(180,),
        fvg_gap_points=(4.0,),
        max_inversion_age_bars=12,
    ),
    "image_retest_risk_control": LRLLiquidityConfig(
        max_trades=3,
        cooldown_minutes=30.0,
        max_consecutive_losses=2,
    ),
}


def _paths(start: str, end: str) -> list[Path]:
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    result = []
    for path in sorted(CACHE_DIR.glob("usatechidxusd_*.json")):
        day = date.fromisoformat(path.stem.rsplit("_", 1)[-1])
        if start_date <= day <= end_date and path.stat().st_size > 1000:
            result.append(path)
    return result


def _metrics(trades: list[dict[str, Any]], sessions: int) -> dict[str, Any]:
    wins = sum(trade["result"] == "TP" for trade in trades)
    losses = sum(trade["result"] == "SL" for trade in trades)
    pnls = [float(trade["pnl"]) for trade in trades]
    gross_profit = sum(pnl for pnl in pnls if pnl > 0)
    gross_loss = -sum(pnl for pnl in pnls if pnl < 0)
    rr = sum(float(trade["rr"]) for trade in trades)
    return {
        "sessions": sessions,
        "days_with_trades": len({trade["day"] for trade in trades}),
        "trades": len(trades),
        "wins": wins,
        "losses": losses,
        "time_or_eod": len(trades) - wins - losses,
        "rr": round(rr, 4),
        "points": round(sum(pnls), 4),
        "gross_profit_points": round(gross_profit, 4),
        "gross_loss_points": round(gross_loss, 4),
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss else 0.0,
        "expectancy_r": round(rr / len(trades), 4) if trades else 0.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2026-03-02")
    parser.add_argument("--end", default="2026-09-14")
    parser.add_argument("--variant", choices=["all", *VARIANTS], default="all")
    parser.add_argument("--output", default="research/nq_lrl_liquidity/lrl_benchmark.json")
    args = parser.parse_args()
    paths = _paths(args.start, args.end)
    if not paths:
        raise SystemExit("No cached sessions matched the requested range")
    variants = VARIANTS if args.variant == "all" else {args.variant: VARIANTS[args.variant]}

    all_trades: dict[str, list[dict[str, Any]]] = defaultdict(list)
    daily: dict[str, dict[str, dict[str, Any]]] = {}
    for index, path in enumerate(paths, 1):
        day = path.stem.rsplit("_", 1)[-1]
        ticks = json.loads(path.read_text())
        daily[day] = {}
        for name, config in variants.items():
            trades = run_lrl_liquidity_strategy(ticks, config)
            for trade in trades:
                trade["day"] = day
            all_trades[name].extend(trades)
            daily[day][name] = _metrics(trades, 1)
        if index % 10 == 0 or index == len(paths):
            print(f"processed {index}/{len(paths)} {day}", flush=True)

    monthly: dict[str, dict[str, dict[str, Any]]] = {}
    for month in sorted({day[:7] for day in daily}):
        month_days = [day for day in daily if day.startswith(month)]
        monthly[month] = {}
        for name, trades in all_trades.items():
            monthly[month][name] = _metrics(
                [trade for trade in trades if trade["day"] in month_days], len(month_days)
            )

    output = {
        "start": args.start,
        "end": args.end,
        "sessions": len(paths),
        "variants": {
            name: _metrics(trades, len(paths)) for name, trades in all_trades.items()
        },
        "monthly": monthly,
        "daily": daily,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    for name, metrics in output["variants"].items():
        print(
            f"{name}: trades={metrics['trades']} W/L={metrics['wins']}/{metrics['losses']} "
            f"time/eod={metrics['time_or_eod']} R={metrics['rr']:+.2f} "
            f"points={metrics['points']:+.2f} PF={metrics['profit_factor']:.2f}"
        )
    print(f"wrote {output_path}")


if __name__ == "__main__":
    main()
