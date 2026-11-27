#!/usr/bin/env python3

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SKIP_ALEMBIC", "1")

from options_paper import tape  # noqa: E402
from options_paper.strategies import build  # noqa: E402

TAPE_DIR = Path(__file__).resolve().parent.parent / "experiments/data/nifty_tape"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

DETAIL_DATE = "2026-10-21"

BASELINES: dict[str, dict] = {
    "default (touches=3, sweep=15)": {},
    "min_touches=2": {"min_touches": 2},
    "min_touches=4": {"min_touches": 4},
    "sweep_max_pts=10": {"sweep_max_pts": 10},
    "sweep_max_pts=20": {"sweep_max_pts": 20},
}


def profit_factor(pnls: list[float]) -> float:
    wins = sum(p for p in pnls if p > 0)
    losses = sum(p for p in pnls if p < 0)
    if not pnls:
        return 0.0
    if losses == 0:
        return float("inf") if wins > 0 else 0.0
    return wins / abs(losses)


def max_drawdown(daily_nets: list[float]) -> float:
    peak = 0.0
    worst = 0.0
    cum = 0.0
    for d in daily_nets:
        cum += d
        peak = max(peak, cum)
        worst = max(worst, peak - cum)
    return worst


def aggregate_metrics(trades: list) -> dict:
    n = len(trades)
    wins = sum(1 for t in trades if t.net_pnl > 0)
    losses = sum(1 for t in trades if t.net_pnl < 0)
    net = round(sum(t.net_pnl for t in trades), 2)
    pf = profit_factor([t.net_pnl for t in trades])
    win_rate = (wins / n) if n else 0.0
    avg_hold = round(sum(t.hold_min for t in trades) / n, 1) if n else 0.0
    return {"n": n, "wins": wins, "losses": losses, "net": net,
            "win_rate": win_rate, "pf": pf, "avg_hold": avg_hold}


def tape_dates() -> list[str]:
    return sorted(p.stem for p in TAPE_DIR.glob("*.jsonl") if DATE_RE.match(p.stem))


def eval_day(date_str: str, **overrides) -> list:
    ticks = tape.load_tape(date_str)
    if len(ticks) < 3:
        return []
    ctx = {"prev_close": tape.prev_session_close(date_str)}
    strat = build("nifty_pin_reversal", **overrides)
    return strat.run(list(ticks), dict(ctx))


def describe_trade(t) -> str:
    return (f"{t.entry_time[11:16]} {t.opt} {t.direction} "
            f"{t.entry_premium:.2f}->{t.exit_premium:.2f} "
            f"spot {t.entry_spot:.0f}->{t.exit_spot:.0f} "
            f"K{int(t.strike)} {t.exit_time[11:16]} {t.exit_reason} "
            f"net {t.net_pnl:+.0f} hold {t.hold_min:.0f}m [{t.reason}]")


def main() -> int:
    dates = tape_dates()
    if not dates:
        print("no tape days found")
        return 1

    print("nifty_pin_reversal — per-day (default touches=3, sweep=15)")
    print(f"{'date':<12}{'n':>3}{'wins':>6}{'loss':>6}{'net':>10}{'PF':>8}")
    per_day_nets: list[float] = []
    all_trades: list = []
    for d in dates:
        trades = eval_day(d)
        m = aggregate_metrics(trades)
        per_day_nets.append(m["net"])
        all_trades.extend(trades)
        ticks_n = len(tape.load_tape(d))
        pf_s = f"{m['pf']:.2f}" if m["pf"] != float("inf") else "inf"
        flag = "" if ticks_n >= 3 else " (no priced tape)"
        print(f"{d:<12}{m['n']:>3}{m['wins']:>6}{m['losses']:>6}"
              f"{m['net']:>+10.0f}{pf_s:>8}{flag}")
        for t in trades:
            print(f"    {describe_trade(t)}")

    agg = aggregate_metrics(all_trades)
    dd = max_drawdown(per_day_nets)
    pf_s = f"{agg['pf']:.2f}" if agg["pf"] != float("inf") else "inf"
    print(f"\naggregate: n={agg['n']} wins={agg['wins']} losses={agg['losses']} "
          f"net={agg['net']:+.0f} win_rate={agg['win_rate']:.0%} PF={pf_s} "
          f"maxDD(daily)={dd:.0f} avg_hold={agg['avg_hold']:.1f}m")
    print(f"gate (net>0 and n>=5 and PF>=1.2): "
          f"{'PASS' if (agg['net'] > 0 and agg['n'] >= 5 and agg['pf'] >= 1.2) else 'FAIL'}")

    print("\nbaseline sensitivity (all tape days)")
    print(f"{'config':<34}{'n':>4}{'net':>10}{'PF':>8}{'win%':>7}")
    rows = []
    for name, ov in BASELINES.items():
        ts: list = []
        for d in dates:
            ts.extend(eval_day(d, **ov))
        m = aggregate_metrics(ts)
        rows.append((name, m))
        p = f"{m['pf']:.2f}" if m["pf"] != float("inf") else "inf"
        print(f"{name:<34}{m['n']:>4}{m['net']:>+10.0f}{p:>8}"
              f"{m['win_rate']:>7.0%}")
    nets = [m["net"] for _, m in rows]
    print(f"spread: net range [{min(nets):+.0f}, {max(nets):+.0f}] "
          f"across {len(rows)} configs")
    best = max(rows, key=lambda r: r[1]["net"])
    print(f"best by net: {best[0]} ({best[1]['net']:+.0f}, n={best[1]['n']}) — "
          f"shown for context, NOT selected (picking the max would overfit)")

    print(f"\n{DETAIL_DATE} trade detail (default params):")
    dtrades = eval_day(DETAIL_DATE)
    if not dtrades:
        print("  no trades")
    for t in dtrades:
        print(f"  entry {t.entry_time} {t.opt} {t.direction} "
              f"@{t.entry_premium:.2f} spot {t.entry_spot:.2f} "
              f"K{int(t.strike)} {t.symbol} lots={t.lots} qty={t.qty}")
        print(f"  exit  {t.exit_time} @{t.exit_premium:.2f} spot {t.exit_spot:.2f} "
              f"reason={t.exit_reason} hold={t.hold_min:.1f}m")
        print(f"  gross {t.gross_pnl:+.2f} costs {t.costs:.2f} "
              f"net {t.net_pnl:+.2f} pts {t.points:+.3f}")
        print(f"  entry reason: {t.reason}")
        print(f"  sl/tp: {t.sl_pct:.0%}/{t.tp_pct:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
