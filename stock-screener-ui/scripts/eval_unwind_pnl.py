"""What would following the critical OI-unwind alerts have made?

We missed the 2026-10-21 15:04 put unwind (+39-pt squeeze). This script
replays every ``experiments/data/nifty_tape/*.jsonl`` tape through the real
detectors (``detect_oi_bursts`` + ``detect_squeezes``, merged with
``coalesce_bursts``), takes every **critical** unwind event, and simulates
buying the opposite leg at the NEXT bar's premium (the engine's
next-bar fill honesty: enter at bar i+1, no lookahead).

DIRECTION comes from the event, not from a fixed "put -> CE" rule: a burst
classified by ``classify_flow`` is followed in its own direction (a put
unwind that is a *liquidation* is bearish -> the PE; a covering is bullish ->
the CE) and a squeeze is a momentum event (a put squeeze is a breakdown ->
the PE, a call squeeze a breakout -> the CE). Only an unclassified unwind
keeps the legacy reading (support removed -> CE, ceiling removed -> PE).

FIXED-STRIKE accounting (no ATM-drift artifact): the entry strike is the
ATM strike at the EVENT bar, and every quote — entry, horizon, EOD,
stop/target — is that same strike's premium from the row's per-strike
``chain`` (``chain["<strike>"][0]`` CE / ``[1]`` PE). The rolling
``atm_ce_ltp``/``atm_pe_ltp`` are never used: when spot drifts the ATM
rolls (22,700 -> 22,750) and the ATM series compares two different
contracts. If a row lacks the strike, the last known price carries
(never a strike switch). Tapes with no per-strike ``chain`` at all
(pre-2026-10-19) are skipped — there is nothing honest to price there.

A DEAD leg (no print after the fill) has no honest exit price: the exit is
the last quote STRICTLY AFTER the entry bar, and a leg that never printed
again is booked as *unpriced* (never the entry price) and left out of the
P&L totals.

Three exits per trade: fixed 15-minute horizon, EOD (last bar), and
premium stop -15% / target +25% (first touch, stop wins ties, else EOD).
Costs via ``option_round_trip_cost`` (qty 65, long). Events within
5 minutes of each other are deduplicated PER SIDE (a call unwind and a put
unwind a minute apart are two different events).

Usage:
  .venv/bin/python scripts/eval_unwind_pnl.py [--today-only] [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.reports_api.nifty import TAPE_DIR, derive_tape_rows, read_tape
from api.reports_api.nifty_bursts import (
    FLOW_BUYERS,
    FLOW_COVERING,
    FLOW_LIQUIDATION,
    FLOW_WRITERS,
    coalesce_bursts,
    detect_oi_bursts,
    detect_squeezes,
)
from options_paper.costs import option_round_trip_cost

QTY = 65  # 1 NIFTY lot
STOP_PCT = 15.0
TARGET_PCT = 25.0
HORIZON_MIN = 15
DEDUP_MIN = 5


# ---------------------------------------------------------------- pure helpers

def event_bearish(event: dict) -> bool | None:
    """The event's market direction, or None when it is not decidable.

    ``bearish`` comes straight from the detector's ``classify_flow`` (a put
    unwind with the premium DOWN is a liquidation -> bearish; a put unwind
    with the premium UP is a covering -> bullish). When only ``flow`` is
    present it is translated the same way.
    """
    if not isinstance(event, dict):
        return None
    raw = event.get("bearish")
    if isinstance(raw, bool):
        return raw
    flow = str(event.get("flow") or "").strip().lower()
    side = str(event.get("side") or "").strip().lower()
    if flow == FLOW_LIQUIDATION:
        return True
    if flow == FLOW_COVERING:
        return False
    if flow == FLOW_BUYERS:
        return side == "put"
    if flow == FLOW_WRITERS:
        return side == "call"
    return None


def event_to_action(event: dict) -> str | None:
    """Map a burst/squeeze event to the ATM leg to BUY, or None to skip.

    Only OI *unwinds* (delta < 0) trade. The DIRECTION comes from the event,
    never from a fixed "put -> CE" rule:

      * a classified burst (the detector ran ``classify_flow``) is followed in
        its own direction — a put unwind with ``bearish=True`` (a liquidation:
        long puts sold out) is a BEARISH event, so the trade is the PE; a put
        unwind with ``bearish=False`` (a covering) is bullish -> the CE;
      * a SQUEEZE is a momentum/breakdown event: a put squeeze is spot
        breaking BELOW the put wall (a breakdown) -> the PE, a call squeeze is
        an upside breakout -> the CE;
      * an unclassified put/call unwind (no premium to read) keeps the legacy
        reading: removing put support is upside fuel -> CE, removing the call
        ceiling is downside fuel -> PE.

    Builds, zero-delta and unknown sides return None.
    """
    side = str(event.get("side") or "").strip().lower()
    try:
        delta = float(event.get("delta"))
    except (TypeError, ValueError):
        return None
    if delta >= 0:
        return None
    if side not in ("put", "call"):
        return None
    bearish = event_bearish(event)
    if bearish is not None:
        return "PE" if bearish else "CE"
    if str(event.get("type") or "").strip().lower() == "squeeze":
        return "PE" if side == "put" else "CE"
    if side == "put":
        return "CE"
    return "PE"


def _strike_premium(row: dict, strike: float, leg: str) -> float | None:
    """One strike/leg premium from the row's per-strike ``chain``.

    ``chain`` maps ``"<strike>"`` -> ``[ce_ltp, pe_ltp, ...]`` (dead legs
    are ``None``). The rolling ``atm_*_ltp`` snapshot is deliberately NOT
    consulted: it re-anchors to whatever strike is ATM that minute, so an
    entry-to-exit comparison across it mixes two different contracts.
    Returns None when the row has no chain or the quote is dead/missing.
    """
    try:
        s = int(strike)
    except (TypeError, ValueError):
        return None
    if s <= 0:
        return None
    chain = row.get("chain")
    if not isinstance(chain, dict):
        return None
    series = chain.get(str(s))
    if not isinstance(series, (list, tuple)) or len(series) < 2:
        return None
    try:
        v = float(series[0] if leg == "CE" else series[1])
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _parse_t(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def next_bar_entry(rows: list[dict], idx: int, strike: float,
                   leg: str) -> tuple[int, float] | None:
    """(entry_index, premium) at the first bar AFTER ``idx`` quoting ``strike``.

    The signal fires on bar ``idx``; the fill is the next bar's SAME-strike
    premium (no lookahead — the entry bar's own move is never captured).
    None when no later bar quotes the strike (e.g. chain-less tapes).
    """
    for j in range(idx + 1, len(rows)):
        px = _strike_premium(rows[j], strike, leg)
        if px is not None:
            return j, px
    return None


def last_quote_after(rows: list[dict], entry_idx: int, strike: float,
                     leg: str) -> tuple[int, float] | None:
    """Last bar STRICTLY AFTER ``entry_idx`` quoting the entry strike.

    The entry bar's own print is the FILL, not an exit: using it as the exit
    price would book a dead leg as a flat trade (a fake 0 P&L). None means
    "unpriced" — the caller must not invent a price.
    """
    for j in range(len(rows) - 1, entry_idx, -1):
        px = _strike_premium(rows[j], strike, leg)
        if px is not None:
            return j, px
    return None


def find_bar_at_or_after(rows: list[dict], start: int, when: datetime,
                         strike: float, leg: str) -> tuple[int, float] | None:
    """First bar at/after ``when`` priced at the entry strike's last known.

    A bar at/after ``when`` that lacks the strike exits at the last known
    price for that strike (carried, never a strike switch). The carried price
    is the last quote STRICTLY AFTER the entry bar (``start``) — never the
    entry bar's own print, which is the fill price. If the leg never printed
    again the exit is unpriced (None) rather than the entry price.
    Past the last quoted bar this falls back to the last known quote (EOD-like).
    """
    last: tuple[int, float] | None = None
    for j in range(start + 1, len(rows)):
        q = _strike_premium(rows[j], strike, leg)
        if q is not None:
            last = (j, q)
            ts = _parse_t(rows[j].get("t"))
            if ts is not None and ts >= when:
                return j, q
        elif last is not None:
            ts = _parse_t(rows[j].get("t"))
            if ts is not None and ts >= when:
                return j, last[1]
    return last


def last_bar_exit(rows: list[dict], start: int, strike: float,
                  leg: str) -> tuple[int, float] | None:
    """EOD exit: last bar AFTER ``start`` quoting the entry strike."""
    return last_quote_after(rows, start, strike, leg)


def stop_target_exit(rows: list[dict], entry_idx: int, entry_px: float,
                     strike: float, leg: str, stop_pct: float = STOP_PCT,
                     target_pct: float = TARGET_PCT) -> tuple[int | None, float, str]:
    """First touch of -``stop_pct``% / +``target_pct``% after the entry bar.

    Only actual prints of the entry strike can trigger a touch — a row
    missing the strike is skipped, not carried into a fake touch. Scans
    bars strictly after the entry bar (the fill bar's own print is the
    fill, not a touch). Stop wins ties (conservative). Falls back to EOD.
    Returns (exit_index, premium, reason); ``(None, 0.0, "unpriced")`` when
    the leg printed nothing after the fill (no honest exit price exists).
    """
    stop_px = entry_px * (1 - stop_pct / 100.0)
    tgt_px = entry_px * (1 + target_pct / 100.0)
    for j in range(entry_idx + 1, len(rows)):
        px = _strike_premium(rows[j], strike, leg)
        if px is None:
            continue
        if px <= stop_px:
            return j, px, "stop"
        if px >= tgt_px:
            return j, px, "target"
    eod = last_bar_exit(rows, entry_idx, strike, leg)
    if eod is None:
        # The leg died right after the fill: there is no honest exit price.
        return None, 0.0, "unpriced"
    return eod[0], eod[1], "eod_fallback"


def apply_cost(entry_px: float, exit_px: float, qty: int = QTY) -> dict:
    """Gross/net P&L for one long leg incl. realistic round-trip costs."""
    r = option_round_trip_cost(entry_px, exit_px, qty, is_short=False)
    return {"gross": r["gross_pnl"], "costs": r["costs"], "net": r["net_pnl"]}


def dedupe_events(events: list[dict], minutes: float = DEDUP_MIN) -> list[dict]:
    """Keep events at least ``minutes`` apart PER SIDE (chronological, first wins).

    Dedupe is per side: a critical call unwind and a critical put unwind one
    minute apart are two different events (and often two opposite trades).
    A global 5-minute window used to silently drop one of them.
    """
    ordered = sorted(events, key=lambda e: str(e.get("t") or ""))
    last_by_side: dict[str, datetime] = {}
    kept: list[dict] = []
    for e in ordered:
        ts = _parse_t(e.get("t"))
        if ts is None:
            continue
        side = str(e.get("side") or "")
        last_t = last_by_side.get(side)
        if last_t is not None and (ts - last_t) < timedelta(minutes=minutes):
            continue
        kept.append(e)
        last_by_side[side] = ts
    return kept


def summarize(trades: list[dict]) -> dict:
    """n, win rate, total/avg/best/worst net P&L over simulated trades.

    Unpriced trades (the leg printed nothing after the fill) carry no P&L:
    they are counted in ``unpriced`` and excluded from every average.
    """
    nets = [t["net"] for t in trades if t.get("net") is not None]
    unpriced = sum(1 for t in trades if t.get("net") is None)
    if not nets:
        return {"n": 0, "win_rate": 0.0, "total": 0.0, "avg": 0.0,
                "best": 0.0, "worst": 0.0, "unpriced": unpriced}
    wins = sum(1 for v in nets if v > 0)
    return {
        "n": len(nets),
        "win_rate": round(100.0 * wins / len(nets), 1),
        "total": round(sum(nets), 2),
        "avg": round(sum(nets) / len(nets), 2),
        "best": round(max(nets), 2),
        "worst": round(min(nets), 2),
        "unpriced": unpriced,
    }


# ------------------------------------------------------------- tape evaluation

def _row_index(rows: list[dict]) -> dict[str, int]:
    """Map a row's ``t`` to its index in the chronologically sorted rows."""
    ordered = sorted(rows, key=lambda r: str(r.get("t") or ""))
    return {str(r.get("t")): i for i, r in enumerate(ordered)}


def critical_unwinds(rows: list[dict]) -> list[dict]:
    """Critical unwind events from the real detectors, deduped to 5 min."""
    raw = detect_oi_bursts(rows) + detect_squeezes(rows)
    merged = coalesce_bursts(raw)
    crit = [e for e in merged
            if e.get("severity") == "critical" and event_to_action(e)]
    return dedupe_events(crit)


def hold_minutes(rows: list[dict], a: int, b: int) -> float | None:
    ta, tb = _parse_t(rows[a].get("t")), _parse_t(rows[b].get("t"))
    if ta is None or tb is None:
        return None
    return round((tb - ta).total_seconds() / 60.0, 1)


def eval_day(date_str: str) -> list[dict]:
    """Simulate all three exits for every critical unwind on ``date_str``.

    Fixed-strike: the entry strike is the ATM at the event bar; a missing
    ``atm_strike`` or a strike with no chain quote after the event skips
    the event (chain-less tapes yield no trades).
    """
    rows = sorted(derive_tape_rows(read_tape(date_str)),
                  key=lambda r: str(r.get("t") or ""))
    if len(rows) < 3:
        return []
    idx = _row_index(rows)
    trades: list[dict] = []
    for e in critical_unwinds(rows):
        i = idx.get(str(e.get("t")))
        if i is None:
            continue
        leg = event_to_action(e)
        assert leg is not None
        try:
            strike = float(rows[i].get("atm_strike"))
        except (TypeError, ValueError):
            continue
        if strike <= 0:
            continue
        fill = next_bar_entry(rows, i, strike, leg)
        if fill is None:
            continue
        entry_idx, entry_px = fill
        entry_t = str(rows[entry_idx].get("t"))
        for rule in ("15m", "eod", "stop_target"):
            if rule == "15m":
                ts = _parse_t(entry_t)
                tgt = ts + timedelta(minutes=HORIZON_MIN) if ts else None
                found = (find_bar_at_or_after(rows, entry_idx, tgt, strike, leg)
                         if tgt else last_bar_exit(rows, entry_idx, strike, leg))
                reason = "horizon"
            elif rule == "eod":
                found = last_bar_exit(rows, entry_idx, strike, leg)
                reason = "eod"
            else:
                j, px, reason = stop_target_exit(rows, entry_idx, entry_px,
                                                 strike, leg)
                found = None if j is None else (j, px)
            if found is None:
                # The leg printed nothing after the fill: no honest exit
                # price. Recorded as unpriced (never the entry price) and
                # excluded from the P&L totals.
                trades.append({
                    "date": date_str,
                    "time": str(e.get("t") or "")[11:16],
                    "event_t": str(e.get("t") or ""),
                    "side": e.get("side"),
                    "action": f"BUY {int(strike)} {leg}",
                    "strike": int(strike),
                    "rule": rule,
                    "exit_reason": "unpriced",
                    "entry": round(entry_px, 2),
                    "exit": 0.0,
                    "net": None,
                    "gross": None,
                    "costs": None,
                    "unpriced": True,
                    "hold_min": None,
                })
                continue
            j, exit_px = found
            pnl = apply_cost(entry_px, exit_px)
            trades.append({
                "date": date_str,
                "time": str(e.get("t") or "")[11:16],
                "event_t": str(e.get("t") or ""),
                "side": e.get("side"),
                "action": f"BUY {int(strike)} {leg}",
                "strike": int(strike),
                "rule": rule,
                "exit_reason": reason,
                "entry": round(entry_px, 2),
                "exit": round(exit_px, 2),
                "net": pnl["net"],
                "gross": pnl["gross"],
                "costs": pnl["costs"],
                "unpriced": False,
                "hold_min": hold_minutes(rows, entry_idx, j),
            })
    return trades


def tape_has_chain(date_str: str) -> bool:
    """True when any raw row of the day's tape carries a per-strike chain."""
    try:
        return any(isinstance(r.get("chain"), dict) for r in read_tape(date_str))
    except OSError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--today-only", action="store_true",
                    help="only evaluate the latest tape date")
    ap.add_argument("--json", action="store_true", help="emit JSON, no tables")
    args = ap.parse_args()

    dates = sorted(p.stem for p in TAPE_DIR.glob("*.jsonl")
                   if not p.name.endswith(".gaps.jsonl"))
    if args.today_only and dates:
        dates = dates[-1:]
    today = dates[-1] if dates else None

    skipped = [d for d in dates if not tape_has_chain(d)]
    dates = [d for d in dates if d not in skipped]

    all_trades: list[dict] = []
    for d in dates:
        all_trades.extend(eval_day(d))

    by_rule: dict[str, list[dict]] = {}
    for t in all_trades:
        by_rule.setdefault(t["rule"], []).append(t)
    summary = {rule: summarize(ts) for rule, ts in sorted(by_rule.items())}
    today_trades = [t for t in all_trades if t["date"] == today]

    if args.json:
        print(json.dumps({"trades": all_trades, "summary": summary,
                          "today": today, "today_trades": today_trades},
                         indent=2))
        return 0

    print(f"critical-unwind follow-through, FIXED STRIKE  (qty {QTY}, stop -{STOP_PCT:.0f}% / "
          f"target +{TARGET_PCT:.0f}%, horizon {HORIZON_MIN}m, dedupe {DEDUP_MIN}m)")
    print(f"tapes: {', '.join(dates) or 'none'}")
    if skipped:
        print(f"skipped (no per-strike chain, nothing honest to price): "
              f"{', '.join(skipped)}")
    for rule in sorted(by_rule):
        print(f"\n--- exit: {rule} ---")
        print(f"{'date':<11}{'time':<6}{'side':<6}{'action':<14}"
              f"{'in':>8}{'out':>8}{'net ₹':>10}{'hold':>7}  reason")
        for t in sorted(by_rule[rule], key=lambda x: (x['date'], x['event_t'])):
            hold = f"{t['hold_min']:.0f}m" if t['hold_min'] is not None else "-"
            net = f"{t['net']:>10.2f}" if t.get("net") is not None else f"{'unpriced':>10}"
            print(f"{t['date']:<11}{t['time']:<6}{t['side']:<6}{t['action']:<14}"
                  f"{t['entry']:>8.2f}{t['exit']:>8.2f}{net}"
                  f"{hold:>7}  {t['exit_reason']}")
        s = summary[rule]
        print(f"n={s['n']} win={s['win_rate']}% total={s['total']:+.2f} "
              f"avg={s['avg']:+.2f} best={s['best']:+.2f} worst={s['worst']:+.2f}"
              + (f" unpriced={s.get('unpriced', 0)}" if s.get("unpriced") else ""))
    if today and today_trades:
        print(f"\n--- today ({today}) ---")
        for t in sorted(today_trades, key=lambda x: (x['event_t'], x['rule'])):
            net = f"{t['net']:+.2f}" if t.get("net") is not None else "unpriced"
            print(f"{t['time']} {t['side']:>4} unwind -> {t['action']} "
                  f"@{t['entry']:.2f} [{t['rule']}] exit {t['exit']:.2f} "
                  f"net {net} ({t['exit_reason']})")
    if not all_trades:
        print("\nno critical unwind events on any tape.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
