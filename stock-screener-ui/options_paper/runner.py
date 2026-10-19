#!/usr/bin/env python3
"""Options paper-trading runner (NIFTY + stock options).

Typical use
-----------
    # 1. one-time: create the dedicated paper account in the DB (additive)
    python -m options_paper.runner setup

    # 2. after the close, replay the day's real tape into trades
    python -m options_paper.runner run --date 2026-10-16

    # 3. daily learning note
    python -m options_paper.runner eod --date 2026-10-16

    # account + zero-lookahead checks
    python -m options_paper.runner account
    python -m options_paper.runner dates

Every ``run`` is a **no-lookahead replay** of the day's recorded tape: a signal
fires on a completed minute and is filled at the *next* minute's recorded
premium. Run it as often as you like — the DB insert de-duplicates on
(strategy, symbol, entry_time).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from options_paper import book, spec, tape  # noqa: E402
from options_paper.strategies import REGISTRY, STRATEGY_LABELS, build  # noqa: E402

try:
    from rich.console import Console
    from rich.table import Table
    _con = Console()
except Exception:  # pragma: no cover
    _con = None


def _say(*parts) -> None:
    msg = " ".join(str(p) for p in parts)
    if _con:
        _con.print(msg)
    else:
        print(msg)


def _table(title: str, headers: list[str], rows: list[list]) -> None:
    if _con:
        t = Table(title=title)
        for h in headers:
            t.add_column(h, overflow="fold")
        for r in rows:
            t.add_row(*[str(x) for x in r])
        _con.print(t)
    else:  # pragma: no cover
        print(title)
        print(" | ".join(headers))
        for r in rows:
            print(" | ".join(str(x) for x in r))


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------
def cmd_setup(args) -> int:
    res = book.ensure_account(capital=args.capital, dry_run=args.dry_run)
    _say(f"[bold]{'DRY RUN — ' if args.dry_run else ''}Options paper account[/bold]")
    _say(f"  user    : {res['email']} (id={res['user_id']}, capital=₹{res['capital']:,.0f})")
    _say(f"  created : user={res['created']['user']} "
         f"strategies={len(res['created']['strategies'])} bots={len(res['created']['bots'])}")
    if args.dry_run:
        _say("  (rolled back — nothing written)")
    else:
        _say(f"  password: {book.PASSWORD}")
    return 0


def cmd_account(args) -> int:
    snap = book.account_snapshot()
    _say(f"[bold]{snap['email']}[/bold]  equity ₹{snap['equity']:,.0f} "
         f"(capital ₹{snap['initial_capital']:,.0f} + realized ₹{snap['realized_pnl']:,.0f})")
    rows = []
    for name, s in sorted(snap["by_strategy"].items()):
        wr = (s["wins"] / s["n"] * 100) if s["n"] else 0.0
        rows.append([STRATEGY_LABELS.get(name, name), s["n"], f"{wr:.0f}%", f"₹{s['net']:,.0f}"])
    _table("by strategy", ["strategy", "trades", "win%", "net"], rows or [["(none)", 0, "-", "₹0"]])
    return 0


def cmd_dates(args) -> int:
    dates = tape.available_dates()
    _say(f"{len(dates)} tape day(s): {', '.join(dates) if dates else '(none)'}")
    return 0


def _select(names: str | None) -> list[str]:
    if not names or names == "all":
        return list(REGISTRY)
    out = []
    for n in names.split(","):
        n = n.strip()
        if n and n in REGISTRY:
            out.append(n)
        elif n:
            _say(f"[yellow]skipping unknown strategy {n!r}[/yellow]")
    return out


def cmd_run(args) -> int:
    date = args.date or (tape.available_dates() or [""])[-1]
    if not date:
        _say("[red]no tape available — nothing to run[/red]")
        return 2
    ticks = tape.load_tape(date)
    if not ticks:
        info = tape.probe(date)
        if not info["file"]:
            _say(f"[red]no tape file for {date}[/red] "
                 f"(the recorder runs during market hours via ./start.sh)")
        elif info["priced"] == 0:
            _say(f"[red]{date}: tape has {info['rows']} rows but none carry "
                 f"atm_ce_ltp/atm_pe_ltp[/red] — an early tape format that "
                 f"cannot be priced.")
        else:
            _say(f"[red]no usable ticks for {date}[/red]")
        return 2
    if args.asof:
        hh, mm = (int(x) for x in args.asof.split(":")[:2])
        ticks = [t for t in ticks if (t.t.hour, t.t.minute) <= (hh, mm)]
    if not ticks:
        _say("[red]no ticks left after --asof[/red]")
        return 2

    prev_close = tape.prev_session_close(date)
    ctx = {
        "date": date,
        "prev_close": prev_close,
        "capital": book.INITIAL_CAPITAL,
        "capital_per_strategy": book.INITIAL_CAPITAL / max(len(REGISTRY), 1),
    }
    _say(f"[bold]Replay {date}[/bold]  ticks={len(ticks)} "
         f"first={ticks[0].t.time()} last={ticks[-1].t.time()} "
         f"expiry={ticks[0].expiry} prev_close={prev_close}")

    all_trades = []
    for name in _select(args.strategies):
        strat = build(name, lots=args.lots)
        if strat.underlying != "NIFTY":
            _say(f"[yellow]skipping {name} ({strat.underlying}): needs a live chain, "
                 f"not on the NIFTY tape[/yellow]")
            continue
        try:
            trades = strat.run(ticks, ctx.copy())
        except Exception as e:  # never let one strategy kill the run
            _say(f"[red]{name} failed: {e!r}[/red]")
            continue
        all_trades.extend(trades)

    rows = []
    for t in all_trades:
        rows.append([
            STRATEGY_LABELS.get(t.strategy, t.strategy), t.opt, t.direction,
            f"{t.entry_premium:.1f}→{t.exit_premium:.1f}", t.exit_reason,
            f"{t.points:+.2f}", f"₹{t.net_pnl:,.0f}", f"₹{t.costs:,.0f}",
        ])
    _table(f"trades — {date}", ["strategy", "opt", "dir", "prem", "exit",
                                "pts", "net", "costs"], rows or [["(no trades)"]])

    net = sum(t.net_pnl for t in all_trades)
    _say(f"total: {len(all_trades)} trades  net ₹{net:,.0f}  "
         f"({'PROFIT' if net > 0 else 'LOSS' if net < 0 else 'FLAT'})")

    if args.dry_run or args.no_db:
        if all_trades:
            p = book.write_journal(date, [t.as_row() for t in all_trades])
            _say(f"[yellow]journal only (no DB): {p}[/yellow]")
        return 0

    if not all_trades:
        return 0
    res = book.record_trades(all_trades, journal_date=date)
    _say(f"DB: inserted={res['inserted']} skipped(already booked)={res['skipped']}")
    return 0


def cmd_sim(args) -> int:
    """Replay a whole week on the recorded 1-minute option panel + write the screen."""
    import datetime as _dt
    from options_paper import sim
    if args.week:
        days = sim.week_of(_dt.date.fromisoformat(args.week), max_dte=args.max_dte)
    else:
        days = sim.choose_week(seed=args.seed, max_dte=args.max_dte)
    if not days:
        _say("[red]no priced sessions in the panel for that week[/red]")
        return 2
    names = sorted(sim.NAKED_BUYERS) if args.naked_only else None
    scope = ("intraday naked buying (one long leg, no hedge, no overnight)"
             if args.naked_only else "all strategies")
    _say(f"[bold]Week replay[/bold] {days[0]} -> {days[-1]}  ({len(days)} sessions, "
         f"{args.lots} lot, nearest expiry {sim.panel.nearest_expiry(days[0])} "
         f"= {sim._dte(days[0])} DTE, scope={scope})")
    runs = sim.run_week(days, strategies=names, lots=args.lots)
    screen = sim.build_screen(runs, lots=args.lots, scope=scope)
    out = sim.write_screen(screen, outdir=None if not args.outdir else Path(args.outdir))
    t = screen["totals"]
    rows = [[STRATEGY_LABELS.get(s["strategy"], s["strategy"]), s["n_trades"],
             f"{s['win_rate']*100:.0f}%", f"₹{s['net_pnl']:,.0f}", f"₹{s['costs']:,.0f}"]
            for s in screen["by_strategy"]]
    _table("per strategy", ["strategy", "trades", "win%", "net", "costs"],
           rows or [["(no trades)"]])
    _say(f"total: {t['n_trades']} trades  gross ₹{t['gross_pnl']:,.0f}  "
         f"costs ₹{t['costs']:,.0f}  net ₹{t['net_pnl']:,.0f}  "
         f"(cost drag {t['cost_drag_pct']*100:.0f}% of gross)")
    _say(f"[bold]screen → {out['html']}[/bold]")
    if out.get("template") is None:
        _say("[yellow]template missing — wrote the minimal fallback[/yellow]")
    return 0


def cmd_eod(args) -> int:
    from options_paper import eod
    date = args.date
    if not date:
        dates = [p.stem for p in book.JOURNAL_DIR.glob("*.jsonl")] if book.JOURNAL_DIR.exists() else []
        date = sorted(dates)[-1] if dates else None
    if not date:
        _say("[red]no journal to report on[/red]")
        return 2
    out = eod.build(date)
    _say(f"[bold]EOD report → {out}[/bold]")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="options_paper.runner",
                                description="Options paper-trading runner")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("setup", help="create the DB paper account (additive)")
    s.add_argument("--capital", type=float, default=book.INITIAL_CAPITAL)
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(func=cmd_setup)

    r = sub.add_parser("run", help="replay a day's tape into trades")
    r.add_argument("--date", help="YYYY-MM-DD (default: latest tape)")
    r.add_argument("--strategies", default="all", help="comma list or 'all'")
    r.add_argument("--lots", type=int, default=1)
    r.add_argument("--asof", help="stop at HH:MM (intraday preview)")
    r.add_argument("--dry-run", action="store_true", help="journal only, no DB")
    r.add_argument("--no-db", action="store_true")
    r.set_defaults(func=cmd_run)

    e = sub.add_parser("eod", help="write the daily learning report")
    e.add_argument("--date", help="YYYY-MM-DD (default: latest journal)")
    e.set_defaults(func=cmd_eod)

    sm = sub.add_parser("sim", help="replay a week on the recorded option panel + write the HTML screen")
    sm.add_argument("--week", help="any date in the week (YYYY-MM-DD); default = random week")
    sm.add_argument("--seed", type=int, help="seed for the random week (reproducible)")
    sm.add_argument("--lots", type=int, default=1)
    sm.add_argument("--max-dte", type=int, default=15,
                    help="only trade sessions whose nearest available expiry is within N days "
                         "(default 15; the panel has no expired contracts, so early sessions "
                         "can only trade a 30-140 DTE monthly — set 0/omit for no filter)")
    sm.add_argument("--naked-only", action="store_true",
                    help="intraday naked buying only: one long leg, no hedge, "
                         "no overnight (excludes the short-straddle seller)")
    sm.add_argument("--outdir", help="override output directory")
    sm.set_defaults(func=cmd_sim)

    a = sub.add_parser("account", help="show account equity + per-strategy P&L")
    a.set_defaults(func=cmd_account)

    d = sub.add_parser("dates", help="list tape days")
    d.set_defaults(func=cmd_dates)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
