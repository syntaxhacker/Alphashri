"""Forward-style validation for the fixed iFVG research profiles.

This script deliberately does not tune parameters.  It replays each cached
Dukascopy session in chronological order, carries only completed minute bars
forward for the HTF context, and joins daily NQ=F data from Yahoo for a
coarse trend/volatility regime check.

The Yahoo series is a regime label and cross-check, not the execution source:
entries and exits always come from the cached bid/ask ticks.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

EXPERIMENTS_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = EXPERIMENTS_DIR / "data" / "duka_cache"
if str(EXPERIMENTS_DIR) not in sys.path:
    sys.path.insert(0, str(EXPERIMENTS_DIR))

from ifvg_reversion import (  # noqa: E402
    IFVGConfig,
    aggregate_bars,
    run_ifvg_reversion,
    strict_ifvg_config,
)
from scripts.smc_tick_eval import build_1m_bars  # noqa: E402


PROFILES: dict[str, IFVGConfig] = {
    "baseline": IFVGConfig(),
    "strict": strict_ifvg_config(),
}
BLOCK_SIZE = 20
RANDOM_SEED = 42


def _date_from_path(path: Path) -> date:
    return date.fromisoformat(path.stem.rsplit("_", 1)[-1])


def _session_paths(start: str, end: str) -> list[Path]:
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    paths: list[Path] = []
    for path in sorted(CACHE_DIR.glob("usatechidxusd_*.json")):
        day = _date_from_path(path)
        if start_date <= day <= end_date and path.stat().st_size > 1000:
            paths.append(path)
    return paths


def _empty_metrics() -> dict[str, Any]:
    return {
        "sessions": 0,
        "days_with_trades": 0,
        "trades": 0,
        "wins": 0,
        "losses": 0,
        "eod": 0,
        "points": 0.0,
        "rr": 0.0,
        "win_rate": 0.0,
        "expectancy_r": 0.0,
        "profit_factor": None,
        "max_drawdown_r": 0.0,
    }


def _max_drawdown(values: list[float]) -> float:
    equity = peak = 0.0
    drawdown = 0.0
    for value in values:
        equity += value
        peak = max(peak, equity)
        drawdown = min(drawdown, equity - peak)
    return round(drawdown, 4)


def _finalize_metrics(metrics: dict[str, Any], trades: list[dict[str, Any]]) -> dict[str, Any]:
    metrics = dict(metrics)
    metrics["win_rate"] = round(
        metrics["wins"] / metrics["trades"] if metrics["trades"] else 0.0,
        4,
    )
    metrics["expectancy_r"] = round(
        metrics["rr"] / metrics["trades"] if metrics["trades"] else 0.0,
        4,
    )
    gross_wins = sum(float(trade["rr"]) for trade in trades if float(trade["rr"]) > 0)
    gross_losses = sum(float(trade["rr"]) for trade in trades if float(trade["rr"]) < 0)
    metrics["profit_factor"] = (
        round(gross_wins / abs(gross_losses), 4) if gross_losses else None
    )
    metrics["max_drawdown_r"] = _max_drawdown([float(trade["rr"]) for trade in trades])
    for key in ("points", "rr"):
        metrics[key] = round(float(metrics[key]), 4)
    return metrics


def _add_trades(metrics: dict[str, Any], trades: list[dict[str, Any]]) -> None:
    metrics["days_with_trades"] += bool(trades)
    metrics["trades"] += len(trades)
    metrics["wins"] += sum(trade["result"] == "TP" for trade in trades)
    metrics["losses"] += sum(trade["result"] == "SL" for trade in trades)
    metrics["eod"] += sum(trade["result"] == "EOD" for trade in trades)
    metrics["points"] += sum(float(trade["pnl"]) for trade in trades)
    metrics["rr"] += sum(float(trade["rr"]) for trade in trades)


def _flatten_daily(df: Any, ticker: str) -> dict[str, dict[str, float]]:
    """Flatten yfinance's one-ticker or MultiIndex daily frame."""

    if df is None or len(df) == 0:
        return {}
    result: dict[str, dict[str, float]] = {}
    for index, row in df.iterrows():
        day = index.date().isoformat() if hasattr(index, "date") else str(index)[:10]
        values: dict[str, float] = {}
        for field in ("Open", "High", "Low", "Close", "Volume"):
            try:
                value = row[field]
                if hasattr(value, "iloc"):
                    value = value.iloc[0]
                value = float(value)
            except (KeyError, TypeError, ValueError, IndexError):
                try:
                    value = float(row[(field, ticker)])
                except (KeyError, TypeError, ValueError, IndexError):
                    continue
            if math.isfinite(value):
                values[field.lower()] = value
        if "open" in values and "close" in values:
            values["return_pct"] = (values["close"] / values["open"] - 1.0) * 100.0
        if "high" in values and "low" in values and "open" in values:
            values["range_pct"] = (values["high"] - values["low"]) / values["open"] * 100.0
        result[day] = values
    return result


def _load_yahoo(start: str, end: str, ticker: str) -> dict[str, dict[str, float]]:
    try:
        import yfinance as yf
    except ImportError as exc:  # pragma: no cover - environment dependent
        print(f"Yahoo regime join unavailable: {exc}", file=sys.stderr)
        return {}
    end_exclusive = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
    frame = yf.download(
        ticker,
        start=start,
        end=end_exclusive,
        interval="1d",
        progress=False,
        auto_adjust=False,
        threads=False,
    )
    return _flatten_daily(frame, ticker)


def _tick_day_summary(ticks: list[dict[str, Any]]) -> dict[str, float]:
    mids = [
        (float(item["askPrice"]) + float(item["bidPrice"])) / 2.0
        for item in ticks
    ]
    return {
        "open": mids[0],
        "close": mids[-1],
        "high": max(mids),
        "low": min(mids),
        "return_pct": (mids[-1] / mids[0] - 1.0) * 100.0,
        "range_pct": (max(mids) - min(mids)) / mids[0] * 100.0,
    }


def _regime_name(row: dict[str, float], range_median: float) -> str:
    direction = "up" if row.get("return_pct", 0.0) >= 0 else "down"
    volatility = "high_vol" if row.get("range_pct", 0.0) >= range_median else "normal_vol"
    return f"{direction}_{volatility}"


def _metrics_for_trades(trades: list[dict[str, Any]], sessions: int) -> dict[str, Any]:
    metrics = _empty_metrics()
    metrics["sessions"] = sessions
    _add_trades(metrics, trades)
    session_keys = {trade.get("session") for trade in trades if trade.get("session")}
    metrics["days_with_trades"] = len(session_keys) if session_keys else int(bool(trades))
    return _finalize_metrics(metrics, trades)


def _cost_sensitivity(trades: list[dict[str, Any]]) -> dict[str, dict[str, float | int | None]]:
    result: dict[str, dict[str, float | int | None]] = {}
    for cost_points in (0.0, 0.25, 0.5, 1.0, 2.0):
        net_rr = sum(
            float(trade["rr"]) - cost_points / abs(float(trade["entry"]) - float(trade["sl"]))
            for trade in trades
        )
        net_points = sum(float(trade["pnl"]) - cost_points for trade in trades)
        result[str(cost_points)] = {
            "trades": len(trades),
            "cost_points_per_round_trip": cost_points,
            "net_points": round(net_points, 4),
            "net_rr": round(net_rr, 4),
            "net_usd_at_2_contracts": round(net_points * 2 * 20.0, 2),
        }
    return result


def _print_metrics(label: str, metrics: dict[str, Any]) -> None:
    print(
        f"{label:<26} sessions={metrics['sessions']:>3} "
        f"days={metrics['days_with_trades']:>3} trades={metrics['trades']:>3} "
        f"W/L={metrics['wins']}/{metrics['losses']} "
        f"R={metrics['rr']:+.2f} PF={metrics['profit_factor']} "
        f"DD={metrics['max_drawdown_r']:+.2f}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="2025-07-01")
    parser.add_argument("--end", default="2026-09-14")
    parser.add_argument("--ticker", default="NQ=F")
    parser.add_argument("--random-windows", type=int, default=10)
    parser.add_argument("--window-sessions", type=int, default=5)
    parser.add_argument(
        "--output", default="research/nq_ifvg_reversion/forward_validation.json"
    )
    args = parser.parse_args()

    paths = _session_paths(args.start, args.end)
    if not paths:
        raise SystemExit("No non-empty cached sessions matched the requested range")
    yahoo = _load_yahoo(args.start, args.end, args.ticker)

    daily: list[dict[str, Any]] = []
    profile_trades: dict[str, list[dict[str, Any]]] = defaultdict(list)
    history_bars: list[dict[str, Any]] = []
    previous_session: date | None = None
    for index, path in enumerate(paths, 1):
        day = _date_from_path(path).isoformat()
        session_date = _date_from_path(path)
        # Do not let a long data outage or an out-of-sample gap leak stale HTF
        # EMA state into the next independent sample.  Weekend/holiday gaps
        # remain continuous; a gap over one week starts a fresh context.
        if previous_session is not None and (session_date - previous_session).days > 7:
            history_bars = []
        ticks = json.loads(path.read_text())
        bars = build_1m_bars(ticks)
        htf_context = aggregate_bars(history_bars + bars, 15)
        session_result: dict[str, Any] = {"date": day, "tick": _tick_day_summary(ticks)}
        session_result["yahoo"] = yahoo.get(day)
        for name, config in PROFILES.items():
            trades = run_ifvg_reversion(
                bars,
                ticks,
                config=config,
                htf_context_bars=htf_context if config.htf_timeframe_minutes else None,
            )
            session_result[name] = _metrics_for_trades(trades, 1)
            for trade in trades:
                tagged = dict(trade)
                tagged["session"] = day
                profile_trades[name].append(tagged)
        daily.append(session_result)
        history_bars.extend(bars)
        previous_session = session_date
        if index % 10 == 0 or index == len(paths):
            print(f"replayed {index}/{len(paths)} {day}", flush=True)

    ranges = [row["tick"]["range_pct"] for row in daily]
    range_median = sorted(ranges)[len(ranges) // 2]
    for row in daily:
        row["regime"] = _regime_name(row["yahoo"] or row["tick"], range_median)

    aggregate: dict[str, Any] = {}
    monthly: dict[str, Any] = {}
    blocks: dict[str, Any] = {}
    regimes: dict[str, Any] = {}
    random_windows: dict[str, Any] = {}
    for name, trades in profile_trades.items():
        aggregate[name] = _metrics_for_trades(trades, len(paths))
        aggregate[name]["cost_sensitivity"] = _cost_sensitivity(trades)
        by_day = defaultdict(list)
        for trade in trades:
            by_day[trade["session"]].append(trade)
        for row in daily:
            key = row["date"][:7]
            monthly.setdefault(key, {}).setdefault(name, []).extend(
                by_day.get(row["date"], [])
            )
            regimes.setdefault(row["regime"], {}).setdefault(name, []).extend(
                by_day.get(row["date"], [])
            )
        for key, day_trades in list(monthly.items()):
            if name in day_trades and isinstance(day_trades[name], list):
                monthly[key][name] = _metrics_for_trades(
                    monthly[key][name], sum(row["date"].startswith(key) for row in daily)
                )
        for key, day_trades in list(regimes.items()):
            if name in day_trades and isinstance(day_trades[name], list):
                regimes[key][name] = _metrics_for_trades(
                    regimes[key][name], sum(row["regime"] == key for row in daily)
                )
        for block_index in range(0, len(paths), BLOCK_SIZE):
            block_rows = daily[block_index : block_index + BLOCK_SIZE]
            block_key = f"{block_rows[0]['date']}..{block_rows[-1]['date']}"
            block_days = {row["date"] for row in block_rows}
            blocks.setdefault(block_key, {})[name] = _metrics_for_trades(
                [trade for trade in trades if trade["session"] in block_days],
                len(block_rows),
            )
        if args.random_windows and len(paths) >= args.window_sessions:
            rng = random.Random(RANDOM_SEED)
            starts = list(range(len(paths) - args.window_sessions + 1))
            rng.shuffle(starts)
            selected = starts[: args.random_windows]
            for start_index in selected:
                window_rows = daily[start_index : start_index + args.window_sessions]
                window_days = {row["date"] for row in window_rows}
                key = f"{window_rows[0]['date']}..{window_rows[-1]['date']}"
                random_windows.setdefault(key, {})[name] = _metrics_for_trades(
                    [trade for trade in trades if trade["session"] in window_days],
                    len(window_rows),
                )

    yahoo_direction_checks = []
    for row in daily:
        if row["yahoo"] is None:
            continue
        tick_direction = row["tick"]["return_pct"] >= 0
        yahoo_direction = row["yahoo"].get("return_pct", 0.0) >= 0
        yahoo_direction_checks.append(tick_direction == yahoo_direction)

    output = {
        "start": args.start,
        "end": args.end,
        "sessions": len(paths),
        "profiles": {name: config.__dict__ for name, config in PROFILES.items()},
        "yahoo": {
            "ticker": args.ticker,
            "sessions_joined": sum(row["yahoo"] is not None for row in daily),
            "tick_vs_yahoo_direction_agreement": round(
                sum(yahoo_direction_checks) / len(yahoo_direction_checks), 4
            )
            if yahoo_direction_checks
            else None,
            "tick_range_median_pct": round(range_median, 4),
        },
        "aggregate": aggregate,
        "monthly": monthly,
        "chronological_blocks": blocks,
        "random_windows": random_windows,
        "regimes": {
            key: {name: value for name, value in profile.items()}
            for key, profile in regimes.items()
        },
        "daily": daily,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")

    print(f"\nYahoo joins={output['yahoo']['sessions_joined']} "
          f"direction agreement={output['yahoo']['tick_vs_yahoo_direction_agreement']}")
    for name, metrics in aggregate.items():
        _print_metrics(name, metrics)
        print("  cost sensitivity:")
        for cost, result in metrics["cost_sensitivity"].items():
            print(f"    {cost:>4} pt/trade -> R={result['net_rr']:+.2f} "
                  f"points={result['net_points']:+.2f}")
    print("\nChronological blocks (20 sessions):")
    for block, profiles in blocks.items():
        for name, metrics in profiles.items():
            _print_metrics(f"{block} {name}", metrics)
    print(f"\nwrote {output_path}")


if __name__ == "__main__":
    main()
