"""Bounded cached-data benchmark for the five-minute iFVG strategy."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

EXPERIMENTS_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = EXPERIMENTS_DIR / "data" / "duka_cache"
if str(EXPERIMENTS_DIR) not in sys.path:
    sys.path.insert(0, str(EXPERIMENTS_DIR))

from ifvg_reversion import IFVGConfig, aggregate_bars, run_ifvg_reversion
from scripts.smc_tick_eval import build_1m_bars


VARIANTS: dict[str, dict[str, Any]] = {
    "baseline": {},
    "short_only": {"allow_longs": False},
    "strict_sweep3_stop25": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "sweep_lookback": 3,
        "min_stop_points": 25,
        "min_gap_points": 1,
    },
    "strict_sweep6_stop25_gap5": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "sweep_lookback": 6,
        "min_stop_points": 25,
        "min_gap_points": 5,
    },
    "htf15": {"htf_timeframe_minutes": 15, "require_htf_alignment": True},
    "htf15_min15": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "min_stop_points": 15,
    },
    "htf15_min15_sweep3": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "min_stop_points": 15,
        "sweep_lookback": 3,
    },
    "htf15_min15_sweep6": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "min_stop_points": 15,
        "sweep_lookback": 6,
    },
    "htf15_min15_cd30_loss2": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "min_stop_points": 15,
        "cooldown_minutes": 30,
        "max_consecutive_losses": 2,
    },
    "htf15_min15_sweep3_cd30_loss2": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "min_stop_points": 15,
        "sweep_lookback": 3,
        "cooldown_minutes": 30,
        "max_consecutive_losses": 2,
    },
    "htf15_min15_gap5": {
        "htf_timeframe_minutes": 15,
        "require_htf_alignment": True,
        "min_stop_points": 15,
        "min_gap_points": 5,
    },
}


def _days(start: str, end: str) -> list[str]:
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    return sorted(
        path.stem.rsplit("_", 1)[-1]
        for path in CACHE_DIR.glob("usatechidxusd_*.json")
        if start_date <= date.fromisoformat(path.stem.rsplit("_", 1)[-1]) <= end_date
    )


def _block(day: str) -> str:
    if day < "2026-06-01":
        return "train"
    if day < "2026-08-01":
        return "validation"
    return "holdout"


def _empty_result() -> dict[str, Any]:
    return {
        "trades": 0,
        "wins": 0,
        "losses": 0,
        "points": 0.0,
        "rr": 0.0,
        "days_with_trades": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2026-03-02")
    parser.add_argument("--end", default="2026-09-14")
    parser.add_argument(
        "--ledger",
        default="research/nq_ifvg_reversion/ifvg_benchmark_results.json",
    )
    args = parser.parse_args()

    days = _days(args.start, args.end)
    results = {
        name: {block: _empty_result() for block in ("train", "validation", "holdout", "all")}
        for name in VARIANTS
    }
    history: list[dict[str, Any]] = []

    for index, day in enumerate(days, 1):
        cache_path = CACHE_DIR / f"usatechidxusd_{day}.json"
        ticks = json.loads(cache_path.read_text())
        bars = build_1m_bars(ticks)
        htf_context = aggregate_bars(history + bars, 15)
        block = _block(day)

        for name, variant in VARIANTS.items():
            config_values: dict[str, Any] = {
                "entry_start": "09:30",
                "entry_end": "16:00",
                "target_r": 1.5,
                "max_stop_points": 40,
                "min_gap_points": 1,
                "contracts": 2,
                "point_value": 20,
            }
            config_values.update(variant)
            config = IFVGConfig(**config_values)
            trades = run_ifvg_reversion(
                bars,
                ticks,
                config=config,
                htf_context_bars=htf_context if config.htf_timeframe_minutes else None,
            )
            for result_block in (block, "all"):
                result = results[name][result_block]
                result["trades"] += len(trades)
                result["wins"] += sum(trade["result"] == "TP" for trade in trades)
                result["losses"] += sum(trade["result"] == "SL" for trade in trades)
                result["points"] += sum(float(trade["pnl"]) for trade in trades)
                result["rr"] += sum(float(trade["rr"]) for trade in trades)
                result["days_with_trades"] += bool(trades)
        history.extend(bars)
        if index % 10 == 0 or index == len(days):
            print(f"processed {index}/{len(days)} {day}", flush=True)

    output = {
        "start": args.start,
        "end": args.end,
        "sessions": len(days),
        "variants": results,
    }
    ledger_path = Path(args.ledger)
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(f"wrote {ledger_path}")
    for name, blocks in results.items():
        result = blocks["all"]
        print(
            f"{name}: trades={result['trades']} "
            f"W/L={result['wins']}/{result['losses']} "
            f"points={result['points']:+.2f} R={result['rr']:+.2f}"
        )


if __name__ == "__main__":
    main()
