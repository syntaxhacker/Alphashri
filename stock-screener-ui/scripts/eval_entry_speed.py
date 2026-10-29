#!/usr/bin/env python3
"""One-off, read-only: did entry SPEED predict today's manual fills?

For each MANUAL entry (journal rows whose ``strategy`` is
``agent_discretionary``) the SPEED as of ``entry_time`` is computed from the
recorded nifty tape (spot-only, so ATR comes from ``|Δspot|`` and RVOL is
unavailable -> ATR-only verdict). Prints one row per entry plus a
SLOW / NORMAL / FAST summary and the skip-SLOW counterfactual.

"Manual" is the STRATEGY, not the symbol shape: coded straddles are booked
with a spaced symbol (``NIFTY 2026-10-19 22850STRADDLE``), so "symbol
contains a space" used to sweep coded trades into the manual book.

Read-only: never touches strategy code, the journal, or the DB.

Usage:
    .venv/bin/python scripts/eval_entry_speed.py
    .venv/bin/python scripts/eval_entry_speed.py --date 2026-10-21
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.desk_check import load_tape_spots, speed_from_candles  # noqa: E402

JOURNAL_DIR = ROOT / "options_paper" / "journal"
OPEN_PATH = JOURNAL_DIR / "agent_positions.json"

#: The strategy name the discretionary (agent) book is booked under.
MANUAL_STRATEGY = "agent_discretionary"


# ---------------------------------------------------------------------------
# pure helpers (unit-tested)
# ---------------------------------------------------------------------------
def is_manual_trade(record) -> bool:
    """True when a journal/position record belongs to the MANUAL book.

    The manual book is ``strategy == "agent_discretionary"``. Symbol shape is
    NOT a signal: coded straddles are journalled with a spaced symbol too.
    """
    if not isinstance(record, dict):
        return False
    strategy = str(record.get("strategy") or "").strip().lower()
    return strategy == MANUAL_STRATEGY


def parse_ts(raw):
    """ISO timestamp or None — never raises."""
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def speed_at_entry(spots, entry_ts: dt.datetime) -> dict:
    """SPEED from tape rows at/before ``entry_ts`` (no lookahead).

    ``spots`` is ``[{time, close}, ...]`` ascending. Returns the
    ``speed_from_candles`` dict plus ``bars`` (rows available at entry).
    """
    rows = [r for r in spots or [] if (parse_ts(r.get("time")) or entry_ts) <= entry_ts]
    speed = speed_from_candles(rows)
    speed["bars"] = len(rows)
    return speed


def summarize(rows: list[dict]) -> dict:
    """Per-verdict {n, total, avg} over closed rows + skip-SLOW counterfactual.

    Rows with verdict ``"n/a"`` or ``net_pnl`` None (open positions) are
    counted separately and excluded from the averages.
    """
    groups: dict[str, dict] = {}
    skipped = 0
    for row in rows or []:
        verdict, pnl = row.get("verdict"), row.get("net_pnl")
        if verdict == "n/a" or pnl is None:
            skipped += 1
            continue
        try:
            pnl_f = float(pnl)
        except (TypeError, ValueError):
            skipped += 1
            continue
        bucket = groups.setdefault(str(verdict), {"n": 0, "total": 0.0})
        bucket["n"] += 1
        bucket["total"] += pnl_f
    for bucket in groups.values():
        bucket["avg"] = bucket["total"] / bucket["n"] if bucket["n"] else 0.0
    total_all = sum(b["total"] for b in groups.values())
    total_ex_slow = total_all - groups.get("SLOW", {}).get("total", 0.0)
    return {"groups": groups, "total_all": total_all,
            "total_ex_slow": total_ex_slow, "skipped": skipped}


# ---------------------------------------------------------------------------
# loading (read-only)
# ---------------------------------------------------------------------------
def load_journal(date_str: str) -> list[dict]:
    path = JOURNAL_DIR / f"{date_str}.jsonl"
    if not path.exists():
        return []
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_open() -> list[dict]:
    if not OPEN_PATH.exists():
        return []
    try:
        return json.loads(OPEN_PATH.read_text()).get("positions") or []
    except (json.JSONDecodeError, OSError, AttributeError):
        return []


# ---------------------------------------------------------------------------
# cli
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="eval_entry_speed",
                                 description="Read-only SPEED-vs-PnL eval for today's manual entries.")
    ap.add_argument("--date", default=None)
    args = ap.parse_args(argv)
    date_str = args.date or dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d")

    spots = load_tape_spots(date_str)
    if not spots:
        print(f"no tape for {date_str} — nothing to score")
        return 1

    rows: list[dict] = []
    for trade in load_journal(date_str):
        if not is_manual_trade(trade):
            continue  # coded entries excluded (by strategy, not by symbol)
        entry_ts = parse_ts(trade.get("entry_time"))
        speed = speed_at_entry(spots, entry_ts) if entry_ts else speed_from_candles([])
        rows.append({
            "time": str(trade.get("entry_time") or "")[11:19],
            "symbol": trade.get("symbol"),
            "side": f"{trade.get('direction', '')} {trade.get('opt', '')}".strip(),
            "entry": trade.get("entry_premium"),
            "verdict": speed["verdict"],
            "roc5_atr": speed.get("roc5_atr"),
            "net_pnl": trade.get("net_pnl"),
            "state": "closed",
        })
    for pos in load_open():
        if not is_manual_trade(pos):
            continue  # open book here is discretionary-only; keep coded out
        entry_ts = parse_ts(pos.get("entry_time"))
        speed = speed_at_entry(spots, entry_ts) if entry_ts else speed_from_candles([])
        strike = pos.get("strike")
        try:
            strike_txt = f"{float(strike):.0f}"
        except (TypeError, ValueError):
            strike_txt = str(strike)
        rows.append({
            "time": str(pos.get("entry_time") or "")[11:19],
            "symbol": f"NIFTY {pos.get('expiry', '')} {strike_txt}{pos.get('opt', '')}",
            "side": f"{pos.get('direction', '')} {pos.get('opt', '')}".strip(),
            "entry": pos.get("entry_premium"),
            "verdict": speed["verdict"],
            "roc5_atr": speed.get("roc5_atr"),
            "net_pnl": None,
            "state": "OPEN",
        })

    closed = [r for r in rows if r["state"] == "closed"]
    print(f"ENTRY SPEED EVAL  {date_str}  (tape spots, ATR-only, no vol)")
    print(f"  {'TIME':>8}  {'SYMBOL':<26} {'SIDE':<9} {'ENTRY':>7}  {'SPEED':<6} {'5m/ATR':>7}  {'NET':>9}")
    for r in closed + [x for x in rows if x["state"] == "OPEN"]:
        roc = f"{r['roc5_atr']:+.1f}" if r["roc5_atr"] is not None else "n/a"
        pnl = f"{r['net_pnl']:+.0f}" if r["net_pnl"] is not None else r["state"]
        entry = f"{r['entry']:.1f}" if isinstance(r["entry"], (int, float)) else "—"
        print(f"  {r['time']:>8}  {str(r['symbol']):<26} {r['side']:<9} {entry:>7}  "
              f"{r['verdict']:<6} {roc:>7}  {pnl:>9}")

    summary = summarize(closed)
    print("")
    print(f"SUMMARY (closed manual, n={len(closed) - summary['skipped']}, "
          f"skipped n/a={summary['skipped']})")
    for verdict in ("SLOW", "NORMAL", "FAST"):
        bucket = summary["groups"].get(verdict, {"n": 0, "total": 0.0, "avg": 0.0})
        print(f"  {verdict:<6} n={bucket['n']:>2}  total {bucket['total']:+.0f}  avg {bucket['avg']:+.0f}")
    print(f"  TOTAL all={summary['total_all']:+.0f}  ex-SLOW={summary['total_ex_slow']:+.0f}  "
          f"(delta {summary['total_ex_slow'] - summary['total_all']:+.0f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
