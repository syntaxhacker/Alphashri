"""Bounded autoresearch loop for the LRL+iFVG strategy.

The search uses fixed chronological splits:

* train: evenly spaced cached sessions from March through July 2026;
* validation: all cached August 2026 sessions;
* holdout: all cached September 2026 sessions.

No holdout result is used to select a candidate.  Every result is appended to
``autoresearch.jsonl`` with an atomic write so the run can be resumed safely.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lrl_liquidity_reversion import (
    LRLLiquidityConfig,
    measured_lrl_config,
    run_lrl_liquidity_strategy,
)


CACHE_DIR = ROOT / "data" / "duka_cache"
STATE_PATH = Path(__file__).with_name("autoresearch.jsonl")


def _cached_days() -> list[str]:
    days = []
    for path in sorted(CACHE_DIR.glob("usatechidxusd_*.json")):
        if path.stat().st_size <= 1000:
            continue
        days.append(path.stem.rsplit("_", 1)[-1])
    return days


def _splits(
    train_stride: int = 7,
    validation_stride: int = 1,
    holdout_stride: int = 1,
) -> tuple[list[str], list[str], list[str]]:
    days = _cached_days()
    train_pool = [day for day in days if "2026-03-01" <= day <= "2026-07-31"]
    validation = [day for day in days if "2026-08-01" <= day <= "2026-08-31"]
    holdout = [day for day in days if "2026-09-01" <= day <= "2026-09-30"]
    # Even spacing avoids accidentally training on only one regime while keeping
    # the bounded loop quick enough to run repeatedly.
    if train_stride < 1 or validation_stride < 1 or holdout_stride < 1:
        raise ValueError("split strides must be positive")
    train = train_pool[::train_stride]
    if train_pool and train[-1] != train_pool[-1]:
        train.append(train_pool[-1])
    return train, validation[::validation_stride], holdout[::holdout_stride]


def _candidate_specs() -> list[dict[str, Any]]:
    base = measured_lrl_config()
    specs: list[tuple[str, LRLLiquidityConfig]] = [("baseline_measured", base)]

    def add(name: str, **changes: Any) -> None:
        specs.append((name, replace(base, **changes)))

    add("gap_3", fvg_gap_points=(3.0,), fvg_timeframes_seconds=(180,))
    add("gap_5", fvg_gap_points=(5.0,), fvg_timeframes_seconds=(180,))
    add("gap_6", fvg_gap_points=(6.0,), fvg_timeframes_seconds=(180,))
    add("age_6", max_inversion_age_bars=6)
    add("age_18", max_inversion_age_bars=18)
    add("tolerance_04", lrl_tolerance_atr=0.4)
    add("tolerance_08", lrl_tolerance_atr=0.8)
    add("distance_3", lrl_max_distance_atr=3.0)
    add("distance_7", lrl_max_distance_atr=7.0)
    add("buffer_3", stop_buffer_points=3.0)
    add("buffer_9", stop_buffer_points=9.0)
    add("min_stop_8", min_stop_points=8.0)
    add("max_stop_45", max_stop_points=45.0)
    add("target_075", target_r=0.75)
    add("target_125", target_r=1.25)
    add("hold_60", max_hold_bars=60)
    add("hold_120", max_hold_bars=120)
    add("cooldown_15", cooldown_minutes=15.0)
    add("cooldown_30", cooldown_minutes=30.0)
    add("session_19_01", entry_start="19:00", entry_end="01:00")
    add("session_18_00", entry_start="18:00", entry_end="00:00")
    add(
        "htf_15m_ema_alignment",
        htf_bias_timeframe_seconds=900,
        htf_fast_ema_period=20,
        htf_slow_ema_period=50,
        require_htf_bias_alignment=True,
    )
    add(
        "htf_5m_ema_alignment",
        htf_bias_timeframe_seconds=300,
        htf_fast_ema_period=20,
        htf_slow_ema_period=50,
        require_htf_bias_alignment=True,
    )
    add(
        "htf_15m_fast_ema_alignment",
        htf_bias_timeframe_seconds=900,
        htf_fast_ema_period=10,
        htf_slow_ema_period=30,
        require_htf_bias_alignment=True,
    )
    add(
        "strict_gap_age",
        fvg_gap_points=(5.0,),
        fvg_timeframes_seconds=(180,),
        max_inversion_age_bars=6,
    )
    add(
        "tight_line_gap",
        lrl_tolerance_atr=0.4,
        lrl_max_distance_atr=3.0,
        fvg_gap_points=(5.0,),
        fvg_timeframes_seconds=(180,),
    )
    add(
        "quality_risk_control",
        fvg_gap_points=(5.0,),
        fvg_timeframes_seconds=(180,),
        max_inversion_age_bars=6,
        cooldown_minutes=30.0,
        max_consecutive_losses=2,
        max_trades=3,
    )
    return [{"name": name, "config": config.__dict__} for name, config in specs]


def _config(spec: dict[str, Any]) -> LRLLiquidityConfig:
    values = dict(spec["config"])
    values["fvg_timeframes_seconds"] = tuple(values["fvg_timeframes_seconds"])
    values["fvg_gap_points"] = tuple(values["fvg_gap_points"])
    return LRLLiquidityConfig(**values)


def _metrics(trades: list[dict[str, Any]], sessions: int) -> dict[str, Any]:
    pnls = [float(trade["pnl"]) for trade in trades]
    gross_profit = sum(value for value in pnls if value > 0)
    gross_loss = -sum(value for value in pnls if value < 0)
    equity = 0.0
    peak = 0.0
    max_drawdown = 0.0
    for value in pnls:
        equity += value
        peak = max(peak, equity)
        max_drawdown = min(max_drawdown, equity - peak)
    active_days = len({trade["day"] for trade in trades})
    a_plus = sum(
        int(trade["meta"]["lrl_touches"] >= 4 and trade["meta"]["fvg_timeframe_seconds"] >= 180)
        for trade in trades
    )
    profit_factor = gross_profit / gross_loss if gross_loss else (math.inf if gross_profit else 0.0)
    return {
        "sessions": sessions,
        "trades": len(trades),
        "wins": sum(trade["result"] == "TP" for trade in trades),
        "losses": sum(trade["result"] == "SL" for trade in trades),
        "time_or_eod": sum(trade["result"] not in {"TP", "SL"} for trade in trades),
        "active_days": active_days,
        "a_plus_setups": a_plus,
        "net_points": round(sum(pnls), 4),
        "gross_profit_points": round(gross_profit, 4),
        "gross_loss_points": round(gross_loss, 4),
        "profit_factor": round(profit_factor, 4) if math.isfinite(profit_factor) else 99.0,
        "max_drawdown_points": round(max_drawdown, 4),
        "expectancy_points": round(sum(pnls) / len(pnls), 4) if pnls else 0.0,
    }


def _evaluate(spec: dict[str, Any], days: list[str]) -> dict[str, Any]:
    config = _config(spec)
    trades: list[dict[str, Any]] = []
    for day in days:
        path = CACHE_DIR / f"usatechidxusd_{day}.json"
        ticks = json.loads(path.read_text())
        for trade in run_lrl_liquidity_strategy(ticks, config):
            trade["day"] = day
            trades.append(trade)
    return {"name": spec["name"], "metrics": _metrics(trades, len(days))}


def _quality_score(metrics: dict[str, Any]) -> float:
    """Prefer PF, but reject tiny samples and reward usable A+ frequency."""

    trades = metrics["trades"]
    if trades < 10 or metrics["active_days"] < 5:
        return -999.0 + trades
    sample_factor = min(1.0, trades / 20.0)
    a_plus_factor = min(1.0, metrics["a_plus_setups"] / 20.0)
    drawdown_penalty = min(0.5, abs(metrics["max_drawdown_points"]) / 1000.0)
    return metrics["profit_factor"] * sample_factor + 0.15 * a_plus_factor - drawdown_penalty


def _read_jsonl() -> list[dict[str, Any]]:
    if not STATE_PATH.exists():
        return []
    return [json.loads(line) for line in STATE_PATH.read_text().splitlines() if line.strip()]


def _append_jsonl(entry: dict[str, Any]) -> None:
    existing = STATE_PATH.read_text() if STATE_PATH.exists() else ""
    tmp = STATE_PATH.with_suffix(".jsonl.tmp")
    tmp.write_text(existing + json.dumps(entry, sort_keys=True) + "\n")
    json.loads(json.dumps(entry))
    tmp.replace(STATE_PATH)


def _ensure_header() -> None:
    if STATE_PATH.exists() and STATE_PATH.stat().st_size:
        return
    _append_jsonl(
        {
            "type": "config",
            "name": "lrl-ifvg-pf-and-a-plus",
            "metricName": "validation_profit_factor",
            "metricUnit": "ratio",
            "bestDirection": "higher",
        }
    )


def _run_stage(stage: str, specs: list[dict[str, Any]], days: list[str]) -> list[dict[str, Any]]:
    print(f"{stage}: {len(specs)} candidates x {len(days)} sessions", flush=True)
    with ProcessPoolExecutor(max_workers=min(4, len(specs))) as pool:
        results = list(pool.map(_evaluate, specs, [days] * len(specs)))
    for result in sorted(results, key=lambda item: _quality_score(item["metrics"]), reverse=True):
        metrics = result["metrics"]
        print(
            f"{stage:10} {result['name']:22} PF={metrics['profit_factor']:.2f} "
            f"trades={metrics['trades']:3} A+={metrics['a_plus_setups']:3} "
            f"net={metrics['net_points']:+8.2f} DD={metrics['max_drawdown_points']:+8.2f}",
            flush=True,
        )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-candidates", type=int, default=27)
    parser.add_argument("--top-validation", type=int, default=5)
    parser.add_argument("--train-stride", type=int, default=7)
    parser.add_argument("--validation-stride", type=int, default=1)
    parser.add_argument("--holdout-stride", type=int, default=1)
    parser.add_argument(
        "--candidate-names",
        help="comma-separated candidate names; defaults to the complete search set",
    )
    args = parser.parse_args()
    train, validation, holdout = _splits(
        args.train_stride, args.validation_stride, args.holdout_stride
    )
    specs = _candidate_specs()
    if args.candidate_names:
        wanted = {name.strip() for name in args.candidate_names.split(",") if name.strip()}
        specs = [spec for spec in specs if spec["name"] in wanted]
        missing = wanted - {spec["name"] for spec in specs}
        if missing:
            raise SystemExit(f"unknown candidate names: {', '.join(sorted(missing))}")
    specs = specs[: args.max_candidates]
    if not train or not validation or not holdout:
        raise SystemExit("cached train/validation/holdout split is incomplete")

    _ensure_header()
    run_number = sum(1 for entry in _read_jsonl() if "run" in entry)
    train_results = _run_stage("TRAIN", specs, train)
    train_results.sort(key=lambda item: _quality_score(item["metrics"]), reverse=True)
    finalists = [
        next(spec for spec in specs if spec["name"] == result["name"])
        for result in train_results[: args.top_validation]
    ]
    validation_results = _run_stage("VALIDATE", finalists, validation)
    validation_results.sort(key=lambda item: _quality_score(item["metrics"]), reverse=True)
    winner_name = validation_results[0]["name"]
    winner_spec = next(spec for spec in finalists if spec["name"] == winner_name)
    holdout_result = _evaluate(winner_spec, holdout)
    print("HOLDOUT", winner_name, holdout_result["metrics"], flush=True)

    for stage, results in (("train", train_results), ("validation", validation_results)):
        for result in results:
            run_number += 1
            metrics = result["metrics"]
            _append_jsonl(
                {
                    "run": run_number,
                    "commit": subprocess.run(
                        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True
                    ).stdout.strip(),
                    "metric": metrics["profit_factor"],
                    "metrics": {**metrics, "stage": stage, "quality_score": _quality_score(metrics)},
                    "status": "keep" if result["name"] == winner_name and stage == "validation" else "discard",
                    "description": result["name"],
                    "timestamp": int(time.time()),
                    "segment": 0,
                }
            )
    print(
        f"METRIC validation_profit_factor={validation_results[0]['metrics']['profit_factor']:.4f} "
        f"holdout_profit_factor={holdout_result['metrics']['profit_factor']:.4f} "
        f"holdout_trades={holdout_result['metrics']['trades']} "
        f"holdout_a_plus={holdout_result['metrics']['a_plus_setups']}",
        flush=True,
    )


if __name__ == "__main__":
    main()
