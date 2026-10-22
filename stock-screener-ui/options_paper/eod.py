"""End-of-day reconciliation + daily learning note.

Reads the day's journal (and the whole account's booked trades) and writes a
self-contained report under ``reports/OPTIONS_PAPER_DAILY/<date>/``:

    trades.csv      one row per trade
    summary.json    machine-readable roll-up
    equity.png      cumulative net-P&L curve
    eod.md          the human learning note

Every number in ``eod.md`` is computed from the day's trades — nothing is
recalled or hard-coded.

ONE SOURCE OF TRUTH: the account block and the equity curve are both built
from the JOURNAL. The DB account and the journal genuinely disagree (the
agent book is booked under a different user, and a trade was deleted by hand
on 2026-10-20), so the note shows the journal's own numbers and reports the
DB divergence as a reconciliation instead of pretending the two agree.
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

#: The discretionary (agent) book — everything else in the journal is coded.
MANUAL_STRATEGY = "agent_discretionary"
BOOK_MANUAL = "manual"
BOOK_CODED = "coded"

#: NSE Closing Auction Session (since 3 Aug 2026): continuous F&O-stock
#: trading ends at 15:15 IST, the index print is frozen 15:15–15:30 (no
#: continuous matching), and the official close is the CAS print (~15:30).
CAS_START_MIN = 15 * 60 + 15
CAS_END_MIN = 15 * 60 + 30  # exclusive
NIFTY_INDEX_KEY = "NSE_INDEX|Nifty 50"


def is_cas_window(now=None) -> bool:
    """True when ``now`` (IST) falls in the 15:15–15:30 CAS freeze window.

    Naive datetimes are assumed IST; aware ones are converted. Never raises.
    """
    try:
        import config
        ts = now or datetime.now(config.IST)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=config.IST)
        else:
            ts = ts.astimezone(config.IST)
        mins = ts.hour * 60 + ts.minute
        return CAS_START_MIN <= mins < CAS_END_MIN
    except Exception:
        return False


def is_cas_tape_time(t_iso) -> bool:
    """True when a tape row's ``t`` ISO timestamp is in the CAS window."""
    try:
        ts = datetime.fromisoformat(str(t_iso))
        return is_cas_window(ts)
    except Exception:
        return False


def last_tape_row(date: str) -> dict | None:
    """The day's last recorded tape row (raw dict), or None. Never raises."""
    try:
        from . import tape as _tape
        p = _tape.tape_path(date)
        if not p.exists():
            return None
        last = None
        with p.open() as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(row, dict) and row.get("t"):
                    last = row
        return last
    except Exception:
        return None


def fetch_official_nifty_close(date: str | None = None, timeout: float = 15.0) -> float | None:
    """Official NIFTY close for ``date`` (CAS-aware).

    The close is DATE-AWARE: re-running an old EOD must not write TODAY's
    close into an old report (re-running 2026-10-16 used to stamp 22,811 —
    today's close — over a day that closed at 23,146).

    * a past session → the Upstox V3 daily candle for that date;
    * today (or no date) → the live daily OHLC quote.

    Returns None (never raises) when there is no token or the call fails —
    the caller falls back to the tape value.
    """
    try:
        return tape.official_nifty_close(date, timeout=timeout)
    except Exception:
        return None


def resolve_day_close(date: str) -> dict:
    """Day-close benchmark for ``date`` — always DATE-AWARE.

    A past session's official close is the V3 daily candle for THAT date
    (never today's quote): re-running 2026-10-16 used to stamp 22,811 — the
    10-21 close — over a day that closed at 23,146.

    The official close is preferred for a past session and whenever the tape's
    last row sits in the 15:15–15:30 CAS window (the index print is frozen
    there). When it cannot be fetched the tape's last spot is used and the
    report says so. Trade P&L is untouched — only these benchmark/day-close
    fields change.
    """
    last = last_tape_row(date) or {}
    tape_last = None
    try:
        tape_last = float(last.get("spot") or 0) or None
    except (TypeError, ValueError):
        tape_last = None
    in_cas = bool(last.get("cas")) or is_cas_tape_time(last.get("t"))
    past_session = not tape._is_today(date)
    official = fetch_official_nifty_close(date) if (in_cas or past_session) else None
    if official:
        day_close = official
        cas_line = (f"CAS close used: {official:,.2f} "
                    f"(tape frozen at {tape_last:,.2f})." if in_cas else "")
    elif tape_last:
        day_close = tape_last
        if in_cas:
            cas_line = (f"CAS window tape but official close unavailable — "
                        f"using tape last {tape_last:,.2f}.")
        elif past_session:
            cas_line = (f"Official close for {date} unavailable — "
                        f"using tape last {tape_last:,.2f}.")
        else:
            cas_line = ""
    else:
        day_close = tape_last
        cas_line = ""
    return {
        "tape_last": tape_last,
        "tape_t": last.get("t"),
        "in_cas": in_cas,
        "official_close": official,
        "day_close": day_close,
        "cas_line": cas_line,
    }


def _book_stats(rows) -> dict:
    """n / wins / net / gross / costs for one book (manual or coded)."""
    rows = list(rows or [])
    net = _net_of(rows)
    wins = sum(1 for r in rows if float(r.get("net_pnl") or 0) > 0)
    losses = sum(1 for r in rows if float(r.get("net_pnl") or 0) < 0)
    gross = 0.0
    costs = 0.0
    for r in rows:
        try:
            gross += float(r.get("gross_pnl") or 0)
            costs += float(r.get("costs") or 0)
        except (TypeError, ValueError):
            continue
    return {
        "n": len(rows),
        "wins": wins,
        "losses": losses,
        "net": round(net, 2),
        "gross": round(gross, 2),
        "costs": round(costs, 2),
    }


def _day_trades(date: str) -> list[dict]:
    return [r for r in book.read_journal(date)]


def _journal_days() -> list[str]:
    """Every journalled session date (ascending)."""
    if not book.JOURNAL_DIR.exists():
        return []
    return sorted(p.stem for p in book.JOURNAL_DIR.glob("*.jsonl")
                  if p.stem[:2] == "20")


def _equity_curve(through: str | None = None) -> list[tuple[str, float]]:
    """Cumulative net P&L by day, across every journal day UP TO ``through``.

    The curve is a "through" curve: a report for 2026-10-16 must not include
    2026-10-21's P&L, otherwise the picture on the note is a future one.
    """
    if not book.JOURNAL_DIR.exists():
        return []
    days = [d for d in _journal_days() if through is None or d <= through]
    cum, out = 0.0, []
    for d in days:
        net = sum(float(r.get("net_pnl", 0.0)) for r in book.read_journal(d))
        cum += net
        out.append((d, round(cum, 2)))
    return out


def _net_of(rows) -> float:
    total = 0.0
    for r in rows or []:
        try:
            total += float(r.get("net_pnl") or 0.0)
        except (TypeError, ValueError):
            continue
    return total


def journal_account_snapshot(through: str | None = None) -> dict:
    """The account as the JOURNAL sees it (the equity curve's own source).

    Capital + the cumulative net P&L of every journalled day up to
    ``through``. The DB account is reported separately (:func:`db_account`)
    because the two genuinely disagree — showing the DB's ₹0 realized while
    the curve says −₹1,695 was the bug this replaces.
    """
    days = [d for d in _journal_days() if through is None or d <= through]
    realized = 0.0
    manual_net = 0.0
    n_trades = 0
    for d in days:
        rows = book.read_journal(d)
        realized += _net_of(rows)
        manual_net += _net_of([r for r in rows
                               if str(r.get("strategy") or "") == MANUAL_STRATEGY])
        n_trades += len(rows)
    capital = float(book.INITIAL_CAPITAL)
    return {
        "source": "journal",
        "initial_capital": capital,
        "realized_pnl": round(realized, 2),
        # Never ₹0: the account exists as soon as the journal does.
        "equity": round(capital + realized, 2),
        "days": len(days),
        "trades": n_trades,
        "by_book": {
            BOOK_MANUAL: {"net": round(manual_net, 2)},
            BOOK_CODED: {"net": round(realized - manual_net, 2)},
        },
    }


def db_account() -> dict:
    """The DB account snapshot (read-only, never raises)."""
    try:
        snap = book.account_snapshot()
    except Exception as exc:  # noqa: BLE001
        return {"exists": False, "error": f"{type(exc).__name__}: {exc}"}
    if not isinstance(snap, dict):
        return {"exists": False}
    return snap


def _trade_key(record: dict) -> str:
    """``symbol|entry_time`` — the identity of a trade across journal and DB."""
    symbol = str(record.get("symbol") or "")
    entry = str(record.get("entry_time") or "")
    return f"{symbol}|{entry[:19]}"


def _db_options_trades(date: str) -> list[dict]:
    """The day's options-paper trades from the DB (read-only, never raises)."""
    try:
        from db.database import SessionLocal
        from db.models import Trade as TradeModel
    except Exception:
        return []
    try:
        db = SessionLocal()
    except Exception:
        return []
    try:
        rows = db.query(TradeModel).filter(
            TradeModel.source.like("options_paper%")).all()
    except Exception:
        return []
    finally:
        try:
            db.close()
        except Exception:
            pass
    out: list[dict] = []
    for t in rows:
        entry = getattr(t, "entry_time", None)
        if entry is None:
            continue
        try:
            if entry.strftime("%Y-%m-%d") != date:
                continue
        except (AttributeError, ValueError):
            continue
        out.append({
            "id": getattr(t, "id", None),
            "symbol": getattr(t, "symbol", ""),
            "entry_time": entry.isoformat(),
            "strategy_name": getattr(t, "strategy_name", ""),
            "source": getattr(t, "source", ""),
            "net_pnl": float(getattr(t, "net_pnl", 0.0) or 0.0),
        })
    return out


def reconcile_journal_vs_db(date: str) -> dict:
    """Which of the day's trades are in one ledger but not the other.

    The journal and the DB are written by the same call, but a trade was
    deleted from the DB by hand on 2026-10-20 and one row was inserted twice
    (a different user), so the two ledgers drifted. The report names the
    missing keys instead of quietly showing one book's numbers.
    """
    journal = book.read_journal(date)
    jrows: dict[str, dict] = {}
    for r in journal:
        jrows.setdefault(_trade_key(r), r)
    db_rows = _db_options_trades(date)
    drows: dict[str, list[dict]] = defaultdict(list)
    for t in db_rows:
        drows[_trade_key(t)].append(t)

    missing_in_db = [
        {"symbol": r.get("symbol"), "entry_time": r.get("entry_time"),
         "strategy": r.get("strategy"), "net_pnl": float(r.get("net_pnl") or 0.0)}
        for key, r in jrows.items() if key not in drows
    ]
    missing_in_journal = [
        {"id": rows[0].get("id"), "symbol": rows[0].get("symbol"),
         "entry_time": rows[0].get("entry_time"),
         "strategy_name": rows[0].get("strategy_name"),
         "net_pnl": sum(float(x.get("net_pnl") or 0.0) for x in rows)}
        for key, rows in drows.items() if key not in jrows
    ]
    duplicates = [
        {"symbol": rows[0].get("symbol"), "entry_time": rows[0].get("entry_time"),
         "n": len(rows),
         "net_pnl": sum(float(x.get("net_pnl") or 0.0) for x in rows)}
        for key, rows in drows.items() if len(rows) > 1
    ]
    journal_net = round(_net_of(journal), 2)
    db_net = round(sum(float(t.get("net_pnl") or 0.0) for t in db_rows), 2)
    return {
        "date": date,
        "journal_n": len(journal),
        "db_n": sum(len(v) for v in drows.values()),
        "journal_net": journal_net,
        "db_net": db_net,
        "delta": round(db_net - journal_net, 2),
        "missing_in_db": missing_in_db,
        "missing_in_journal": missing_in_journal,
        "duplicates": duplicates,
        "in_sync": not missing_in_db and not missing_in_journal and not duplicates,
    }


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

    # The account and the equity curve come from the SAME source (the
    # journal): the DB account books the agent book under another user and
    # one row was deleted by hand, so the two ledgers disagree. The note
    # shows the journal's numbers and reports the divergence.
    snap = journal_account_snapshot(date)
    db_snap = db_account()
    recon = reconcile_journal_vs_db(date)
    curve = _equity_curve(date)

    # manual vs coded for the DAY
    manual_rows = [r for r in rows if str(r.get("strategy") or "") == MANUAL_STRATEGY]
    coded_rows = [r for r in rows if str(r.get("strategy") or "") != MANUAL_STRATEGY]
    by_book = {
        BOOK_MANUAL: _book_stats(manual_rows),
        BOOK_CODED: _book_stats(coded_rows),
    }

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
    cas = resolve_day_close(date)
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
        "by_book": by_book,
        "account": snap,
        "db_account": db_snap,
        "reconciliation": recon,
        "equity_curve": curve,
        "day_close": cas["day_close"],
        "tape_last": cas["tape_last"],
        "official_close": cas["official_close"],
        "cas": cas["in_cas"],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

    # ---- learning note ------------------------------------------------ #
    L = []
    L.append(f"# Options paper — EOD note — {date}\n")
    L.append(f"_generated {summary['generated_at']}_\n")
    L.append("## Account\n")
    L.append(f"- Equity: **₹{snap['equity']:,.0f}** "
             f"(capital ₹{snap['initial_capital']:,.0f}, realized ₹{snap['realized_pnl']:,.0f})"
             f" — from the **journal** (same source as the equity curve)")
    L.append(f"- Manual book: **₹{by_book[BOOK_MANUAL]['net']:+,.0f}** "
             f"({by_book[BOOK_MANUAL]['n']} trades) · "
             f"coded book: **₹{by_book[BOOK_CODED]['net']:+,.0f}** "
             f"({by_book[BOOK_CODED]['n']} trades)")
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

    L.append("## Manual vs coded (today)\n")
    L.append("| book | trades | win% | net ₹ | gross ₹ | costs ₹ |")
    L.append("|---|---|---|---|---|---|")
    for label in (BOOK_MANUAL, BOOK_CODED):
        b = by_book[label]
        wr = (b["wins"] / b["n"] * 100) if b["n"] else 0.0
        L.append(f"| {label} | {b['n']} | {wr:.0f}% | {b['net']:,.0f} | "
                 f"{b['gross']:,.0f} | {b['costs']:,.0f} |")
    L.append("")

    L.append("## Journal vs DB reconciliation\n")
    if recon["in_sync"]:
        L.append(f"- Journal and DB agree: {recon['journal_n']} trades, "
                 f"net ₹{recon['journal_net']:,.0f}.")
    else:
        L.append(f"- ⚠ Journal {recon['journal_n']} trades / net ₹{recon['journal_net']:,.0f} "
                 f"vs DB {recon['db_n']} trades / net ₹{recon['db_net']:,.0f} "
                 f"(delta ₹{recon['delta']:+,.0f})")
        for miss in recon["missing_in_db"]:
            L.append(f"  - **missing in DB**: {miss['symbol']} @ "
                     f"{str(miss['entry_time'])[:19]} (journal ₹{miss['net_pnl']:+,.0f})")
        for miss in recon["missing_in_journal"]:
            L.append(f"  - **missing in journal**: {miss['symbol']} @ "
                     f"{str(miss['entry_time'])[:19]} (db ₹{miss['net_pnl']:+,.0f})")
        for dup in recon["duplicates"]:
            L.append(f"  - **duplicate in DB**: {dup['symbol']} @ "
                     f"{str(dup['entry_time'])[:19]} ×{dup['n']} "
                     f"(₹{dup['net_pnl']:+,.0f})")
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
    if cas["cas_line"]:
        L.append(f"- {cas['cas_line']}")
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
