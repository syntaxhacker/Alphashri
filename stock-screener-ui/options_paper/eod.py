"""End-of-day reconciliation + daily learning note.

Reads the day's journal (and the whole account's booked trades) and writes a
self-contained report under ``reports/OPTIONS_PAPER_DAILY/<date>/``:

    trades.csv      one row per trade
    summary.json    machine-readable roll-up
    equity.png      cumulative net-P&L curve
    eod.md          the human learning note

Every number in ``eod.md`` is computed from the day's trades — nothing is
recalled or hard-coded.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from . import book, tape

REPORT_DIR = book.REPO_ROOT / "reports" / "OPTIONS_PAPER_DAILY"

WIN = "#16A34A"
LOSS = "#DC2626"
INK = "#111827"
MUTED = "#6B7280"


def _day_trades(date: str) -> list[dict]:
    return [r for r in book.read_journal(date)]


def _equity_curve() -> list[tuple[str, float]]:
    """Cumulative net P&L by day, across every journal day."""
    if not book.JOURNAL_DIR.exists():
        return []
    days = sorted(p.stem for p in book.JOURNAL_DIR.glob("*.jsonl"))
    cum, out = 0.0, []
    for d in days:
        net = sum(float(r.get("net_pnl", 0.0)) for r in book.read_journal(d))
        cum += net
        out.append((d, round(cum, 2)))
    return out


def build(date: str) -> Path:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rows = _day_trades(date)
    out_dir = REPORT_DIR / date
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- CSV ---------------------------------------------------------- #
    if rows:
        keys = sorted({k for r in rows for k in r})
        with (out_dir / "trades.csv").open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=keys)
            w.writeheader()
            for r in rows:
                w.writerow(r)

    # ---- aggregates --------------------------------------------------- #
    by_strat: dict[str, dict] = defaultdict(lambda: {"n": 0, "wins": 0, "net": 0.0,
                                                     "gross": 0.0, "costs": 0.0,
                                                     "points": 0.0, "open": 0})
    for r in rows:
        s = by_strat[r["strategy"]]
        s["n"] += 1
        s["net"] += float(r.get("net_pnl", 0))
        s["gross"] += float(r.get("gross_pnl", 0))
        s["costs"] += float(r.get("costs", 0))
        s["points"] += float(r.get("points", 0))
        if float(r.get("net_pnl", 0)) > 0:
            s["wins"] += 1
        if r.get("exit_reason") == "MTM":
            s["open"] += 1

    net = sum(s["net"] for s in by_strat.values())
    gross = sum(s["gross"] for s in by_strat.values())
    costs = sum(s["costs"] for s in by_strat.values())
    points = sum(s["points"] for s in by_strat.values())
    settled = [r for r in rows if r.get("exit_reason") != "MTM"]
    open_mtm = [r for r in rows if r.get("exit_reason") == "MTM"]

    snap = book.account_snapshot()
    if not snap.get("exists"):
        snap = {**snap, "initial_capital": book.INITIAL_CAPITAL,
                "equity": book.INITIAL_CAPITAL + snap.get("realized_pnl", 0.0),
                "note": "DB account not created yet — run `python -m options_paper.runner setup`"}
    curve = _equity_curve()

    # ---- figure ------------------------------------------------------- #
    if curve:
        xs = [d for d, _ in curve]
        ys = [v for _, v in curve]
        fig, ax = plt.subplots(figsize=(9, 3.6), dpi=130)
        ax.axhline(0, color=MUTED, lw=0.8)
        ax.plot(range(len(ys)), ys, "-o", color="#2563EB", lw=1.8, ms=4)
        colors = [WIN if v >= 0 else LOSS for v in ys]
        ax.scatter(range(len(ys)), ys, c=colors, zorder=3, s=26)
        ax.set_xticks(range(len(xs)))
        ax.set_xticklabels(xs, rotation=45, ha="right", fontsize=7)
        ax.set_ylabel("cumulative net ₹")
        ax.set_title(f"Options paper — cumulative net P&L (through {date})",
                     fontsize=10, color=INK)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        ax.grid(axis="y", color="#E5E7EB", lw=0.6)
        fig.tight_layout()
        fig.savefig(out_dir / "equity.png")
        plt.close(fig)

    # ---- summary json ------------------------------------------------- #
    summary = {
        "date": date,
        "generated_at": datetime.now().isoformat(),
        "n_trades": len(rows),
        "n_settled": len(settled),
        "n_open_mtm": len(open_mtm),
        "net_pnl": round(net, 2),
        "gross_pnl": round(gross, 2),
        "costs": round(costs, 2),
        "cost_drag_pct_of_gross": round(costs / gross * 100, 1) if gross > 0 else None,
        "net_points": round(points, 3),
        "by_strategy": {k: {**v, "net": round(v["net"], 2), "points": round(v["points"], 3)}
                        for k, v in by_strat.items()},
        "account": snap,
        "equity_curve": curve,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    # ---- learning note ------------------------------------------------ #
    L = []
    L.append(f"# Options paper — EOD note — {date}\n")
    L.append(f"_generated {summary['generated_at']}_\n")
    L.append("## Account\n")
    L.append(f"- Equity: **₹{snap['equity']:,.0f}** "
             f"(capital ₹{snap['initial_capital']:,.0f}, realized ₹{snap['realized_pnl']:,.0f})")
    if snap.get("note"):
        L.append(f"  - _{snap['note']}_")
    L.append(f"- Trades booked today: **{len(settled)} settled**"
             + (f", {len(open_mtm)} still open (mark-to-market)" if open_mtm else ""))
    L.append(f"- Day net: **₹{net:,.0f}** ({points:+.2f} points) — "
             f"gross ₹{gross:,.0f}, costs ₹{costs:,.0f}")
    if gross > 0:
        L.append(f"- Cost drag: **{summary['cost_drag_pct_of_gross']}%** of gross"
                 + ("  ← costs ate the whole move" if costs > gross else ""))
    elif gross < 0:
        L.append(f"- The book lost ₹{abs(gross):,.0f} gross and paid ₹{costs:,.0f} more in charges.")
    L.append("")

    L.append("## By strategy\n")
    L.append("| strategy | trades | win% | net ₹ | points | gross ₹ | costs ₹ |")
    L.append("|---|---|---|---|---|---|---|")
    for name, s in sorted(by_strat.items(), key=lambda kv: kv[1]["net"], reverse=True):
        wr = s["wins"] / s["n"] * 100 if s["n"] else 0.0
        L.append(f"| {name} | {s['n']} | {wr:.0f}% | {s['net']:,.0f} | "
                 f"{s['points']:+.2f} | {s['gross']:,.0f} | {s['costs']:,.0f} |")
    if not by_strat:
        L.append("| _(no trades)_ | | | | | | |")
    L.append("")

    # ---- auto observations ------------------------------------------- #
    L.append("## What we learned\n")
    if not rows:
        L.append("- No trades fired today. Check whether the signal thresholds were "
                 "reachable, or whether the tape was collected at all.")
    else:
        ranked = sorted(by_strat.items(), key=lambda kv: kv[1]["net"], reverse=True)
        best, worst = ranked[0], ranked[-1]
        L.append(f"- Best: **{best[0]}** ({best[1]['net']:+,.0f}₹ / {best[1]['points']:+.2f}pts). "
                 f"Worst: **{worst[0]}** ({worst[1]['net']:+,.0f}₹ / {worst[1]['points']:+.2f}pts).")
        if costs > 0:
            L.append(f"- Costs were ₹{costs:,.0f} across {len(rows)} trades "
                     f"(₹{costs/len(rows):,.0f}/trade). For a buyer this is the first thing "
                     f"a signal must clear.")
        small = [n for n, s in by_strat.items() if s["n"] < 30]
        if small:
            L.append(f"- ⚠ Sample too small for a verdict (n<30): {', '.join(sorted(small))}. "
                     f"One day is a data point, not evidence.")
        losers = [n for n, s in by_strat.items() if s["net"] < 0]
        if losers:
            L.append(f"- Negative on the day: {', '.join(sorted(losers))}. "
                     f"Watch for a repeat before changing parameters.")
    L.append(f"- Regime context: expiry day = "
             f"{'yes' if rows and rows[0].get('expiry') == date else 'no'}; "
             f"prev close used = {tape.prev_session_close(date)}.")
    L.append("")

    L.append("## Tomorrow\n")
    L.append("- [ ] Reconnect the broker (Upstox token expires daily) if live stock-option data is wanted.")
    L.append("- [ ] `./start.sh` before 09:15 so the NIFTY tape collector runs.")
    L.append("- [ ] After 15:30: `python -m options_paper.runner run` then `... eod`.")
    L.append("- [ ] Compare each strategy's net points against a coin-flip baseline; "
             "do not promote anything before n≥30 and three regime buckets.")
    L.append("")
    L.append("---\n_Self-contained, generated by `options_paper/eod.py`. "
             "Figures recompute from the journal; no recalled numbers._")

    md = out_dir / "eod.md"
    md.write_text("\n".join(L))
    return out_dir
