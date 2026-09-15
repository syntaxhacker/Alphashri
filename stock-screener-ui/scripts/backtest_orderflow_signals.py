#!/usr/bin/env python3
"""
Replay an order-flow journal and evaluate emitted signals.

Reads the tick journal written by ``api/orderflow_journal.py``, replays the
ticks through a fresh ``OrderFlowSignalEngine``, and measures the forward
return of every emitted signal over a fixed horizon.

Usage:
  source .venv/bin/activate
  python scripts/backtest_orderflow_signals.py --symbol RELIANCE
  python scripts/backtest_orderflow_signals.py --symbol RELIANCE --date 2026-09-15 --horizon 60
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config
from api.orderflow_signals import OrderFlowSignalEngine
from api import orderflow_journal

SIDES = ("BUY", "STRONG_BUY", "SELL", "STRONG_SELL")
_BUY_SIDES = ("BUY", "STRONG_BUY")


def _forward_price(prices: list[tuple[int, float]], target_ts: int) -> Optional[float]:
    for ts, ltp in prices:
        if ts >= target_ts:
            return ltp
    return None


def evaluate(ticks: Iterable[dict], horizon_sec: int = 60) -> dict:
    """Replay ticks and score emitted signals by direction-adjusted forward return."""
    engine = OrderFlowSignalEngine()
    prices: list[tuple[int, float]] = []
    emitted: list[tuple[dict, float]] = []

    for tick in ticks:
        if not isinstance(tick, dict):
            continue
        ltp = float(tick.get("ltp") or 0.0)
        ltt = int(tick.get("ltt") or 0)
        if ltp > 0 and ltt > 0:
            prices.append((ltt, ltp))
        signal = engine.update(tick)
        if signal:
            emitted.append((signal, ltp))

    stats = {side: {"count": 0, "wins": 0, "returns": []} for side in SIDES}
    evaluated = 0
    skipped = 0
    horizon_ms = int(horizon_sec) * 1000

    for signal, entry in emitted:
        side = signal.get("side")
        if side not in stats or entry <= 0:
            skipped += 1
            continue
        target_ts = int(signal.get("ts") or 0) + horizon_ms
        future = _forward_price(prices, target_ts)
        if future is None or future <= 0:
            skipped += 1
            continue

        if side in _BUY_SIDES:
            ret = (future - entry) / entry * 100.0
            win = future > entry
        else:
            ret = (entry - future) / entry * 100.0
            win = future < entry

        bucket = stats[side]
        bucket["count"] += 1
        bucket["returns"].append(ret)
        if win:
            bucket["wins"] += 1
        evaluated += 1

    side_report = {}
    for side in SIDES:
        bucket = stats[side]
        count = bucket["count"]
        side_report[side] = {
            "count": count,
            "win_rate": round(bucket["wins"] / count * 100.0, 2) if count else 0.0,
            "avg_return_pct": round(sum(bucket["returns"]) / count, 4) if count else 0.0,
        }

    all_returns = [r for bucket in stats.values() for r in bucket["returns"]]
    all_wins = sum(bucket["wins"] for bucket in stats.values())
    total = len(all_returns)
    return {
        "sides": side_report,
        "signal_count": len(emitted),
        "evaluated": evaluated,
        "skipped": skipped,
        "overall": {
            "count": total,
            "win_rate": round(all_wins / total * 100.0, 2) if total else 0.0,
            "avg_return_pct": round(sum(all_returns) / total, 4) if total else 0.0,
        },
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backtest order-flow signals from a journal")
    parser.add_argument("--symbol", required=True, help="Symbol whose journal to replay")
    parser.add_argument("--date", default=None, help="IST day (YYYY-MM-DD), defaults to today")
    parser.add_argument("--horizon", type=int, default=60, help="Forward horizon in seconds")
    parser.add_argument("--journal-dir", default=None, help="Override the journal directory")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.journal_dir:
        override = Path(args.journal_dir)
        orderflow_journal.journal_dir = lambda: override

    day = args.date or datetime.now(config.IST).strftime("%Y-%m-%d")
    symbol = args.symbol.strip().upper()

    entries = orderflow_journal.read(symbol, day=day, kind="tick")
    if not entries:
        print(f"No tick journal found for {symbol} on {day}.")
        return 0

    ticks = [entry.get("data") for entry in entries if isinstance(entry.get("data"), dict)]
    result = evaluate(ticks, horizon_sec=args.horizon)

    print(f"Order-flow signal backtest — {symbol} {day} (horizon {args.horizon}s)")
    print(f"Ticks: {len(ticks)} | Signals: {result['signal_count']} | "
          f"Evaluated: {result['evaluated']} | Skipped: {result['skipped']}")
    print(f"{'Side':<12}{'Count':>7}{'Win %':>9}{'Avg ret %':>12}")
    for side in SIDES:
        row = result["sides"][side]
        print(f"{side:<12}{row['count']:>7}{row['win_rate']:>9.2f}{row['avg_return_pct']:>12.4f}")
    overall = result["overall"]
    print(f"{'OVERALL':<12}{overall['count']:>7}{overall['win_rate']:>9.2f}{overall['avg_return_pct']:>12.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
