"""Agent discretionary trades — open-position ledger + booking on exit.

The agent (not the coded strategies) decides these. ``enter`` records an open
position with an explicit stop/target; ``status`` marks it against the newest
tape row; ``exit`` books the completed round-trip under the agent identity
(``agent_intraday``) and removes it from the ledger.

Why a ledger: an open position must survive between checks. ``trades`` only
holds completed round-trips, and ``positions`` belongs to the equity runner.

Usage
-----
    python -m options_paper.manual enter --opt CE --strike 23000 \
        --premium 54.5 --stop 41 --target 71 --reason "bounce off 23000 PE wall"
    python -m options_paper.manual status
    python -m options_paper.manual exit --premium 63.0 --reason "target"
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from options_paper import book, costs, spec, tape  # noqa: E402
from options_paper.strategies import Trade  # noqa: E402

LEDGER = book.JOURNAL_DIR / "agent_positions.json"


def _load() -> list:
    if not LEDGER.exists():
        return []
    try:
        return json.loads(LEDGER.read_text()).get("positions", [])
    except Exception:
        return []


def _save(positions: list) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps({"updated_at": datetime.now().isoformat(timespec="seconds"),
                                  "positions": positions}, indent=2))


def _last_tick():
    ticks = tape.load_tape(datetime.now().strftime("%Y-%m-%d"))
    return ticks[-1] if ticks else None


def _mark(pos: dict, tk) -> float:
    """Current premium of the held structure (chain first, ATM fallback)."""
    row = (tk.chain or {}).get(int(pos["strike"])) if tk else None
    if row:
        if pos["opt"] == "STRADDLE":
            if row[0] and row[1]:
                return float(row[0]) + float(row[1])
        else:
            v = row[0] if pos["opt"] == "CE" else row[1]
            if v and v > 0:
                return float(v)
    if tk is None:
        return float(pos["entry_premium"])
    if pos["opt"] == "STRADDLE":
        return float(tk.ce_ltp) + float(tk.pe_ltp)
    return float(tk.ce_ltp if pos["opt"] == "CE" else tk.pe_ltp)


def _close_position(p: dict, tk, px: float, reason: str) -> dict:
    """Book one completed discretionary round-trip (long or short)."""
    is_short = (p.get("direction") or "LONG").upper() == "SHORT"
    rc = costs.option_round_trip_cost(p["entry_premium"], px, p["qty"], is_short)
    tag = p.get("tag") or ""
    tr = Trade(
        strategy="agent_discretionary", underlying="NIFTY",
        symbol=f"NIFTY {p['expiry']} {p['strike']:.0f}{p['opt']}",
        opt=p["opt"], direction="SHORT" if is_short else "LONG",
        lots=p["lots"], lot=p["qty"] // p["lots"],
        qty=p["qty"], expiry=p["expiry"], entry_time=p["entry_time"],
        entry_premium=p["entry_premium"], entry_spot=p["entry_spot"],
        exit_time=(tk.t.isoformat() if tk else datetime.now().isoformat()),
        exit_premium=px, exit_spot=(tk.spot if tk else p["entry_spot"]),
        exit_reason=reason, hold_min=0.0,
        gross_pnl=rc["gross_pnl"], costs=rc["costs"], net_pnl=rc["net_pnl"],
        points=round(rc["net_pnl"] / p["qty"], 3),
        reason=(f"[{tag}] " if tag else "") + str(p["reason"]),
        strike=p["strike"], sl_pct=0.0, tp_pct=0.0,
    )
    res = book.record_trades([tr], run_as="agent")
    return {"net": rc["net_pnl"], "booked": res["inserted"], "premium": px}


def _load_triggers() -> list:
    if not LEDGER.exists():
        return []
    try:
        return json.loads(LEDGER.read_text()).get("triggers", [])
    except Exception:
        return []


def _save_triggers(triggers: list) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    try:
        state = json.loads(LEDGER.read_text()) if LEDGER.exists() else {}
    except Exception:
        state = {}
    state["triggers"] = triggers
    state["updated_at"] = datetime.now().isoformat(timespec="seconds")
    LEDGER.write_text(json.dumps(state, indent=2))


def cmd_trigger(args) -> int:
    """Arm a conditional order the live loop will execute when price hits."""
    tk = _last_tick()
    if tk is None:
        print("no tape yet — cannot arm a trigger"); return 2
    tr = {"id": datetime.now().strftime("%H%M%S"), "opt": args.opt.upper(),
          "strike": float(args.strike), "side": args.side,
          "level": float(args.level), "stop_pct": args.stop_pct,
          "target_pct": args.target_pct, "lots": args.lots,
          "reason": args.reason or "agent trigger",
          "expiry": tk.expiry, "created": tk.t.isoformat()}
    ts = _load_triggers(); ts.append(tr); _save_triggers(ts)
    print(f"ARMED {tr['side']} {tr['level']:.1f} -> BUY {tr['opt']} {tr['strike']:.0f} "
          f"(stop -{tr['stop_pct']*100:.0f}%, target +{tr['target_pct']*100:.0f}%) "
          f"| spot {tk.spot:.1f}")
    return 0


def auto_manage(tk):
    """Fire pending triggers, then mark/exit open positions.

    Returns ``(fired, closed)``. Called by the live loop every minute, so a
    conditional order is executed even if nobody is watching.
    """
    fired: list = []
    if tk is not None:
        ts = _load_triggers()
        keep = []
        for tr in ts:
            hit = ((tr["side"] == "below" and tk.spot <= tr["level"])
                   or (tr["side"] == "above" and tk.spot >= tr["level"]))
            if not hit:
                keep.append(tr)
                continue
            px = _mark({"opt": tr["opt"], "strike": tr["strike"]}, tk)
            if not px or px <= 0:
                keep.append(tr)
                continue
            pos = {
                "id": datetime.now().strftime("%H%M%S"),
                "strategy": "agent_discretionary",
                "opt": tr["opt"], "strike": tr["strike"], "direction": "LONG",
                "lots": tr["lots"], "qty": tr["lots"] * spec.get_lot("NIFTY"),
                "entry_premium": px, "entry_time": tk.t.isoformat(),
                "entry_spot": tk.spot, "expiry": tr["expiry"],
                "stop": round(px * (1 - tr["stop_pct"]), 2),
                "target": round(px * (1 + tr["target_pct"]), 2),
                "reason": tr["reason"],
            }
            ps = _load(); ps.append(pos); _save(ps)
            fired.append((tr, px))
        if len(keep) != len(ts):
            _save_triggers(keep)

    ps = _load()
    if not ps or tk is None:
        return fired, []
    keep, closed = [], []
    for p in ps:
        now = _mark(p, tk)
        short = (p.get("direction") or "LONG").upper() == "SHORT"
        if (short and now >= p["stop"]) or ((not short) and now <= p["stop"]):
            closed.append((p, now, "STOP", _close_position(p, tk, now, "STOP")))
        elif (short and now <= p["target"]) or ((not short) and now >= p["target"]):
            closed.append((p, now, "TARGET", _close_position(p, tk, now, "TARGET")))
        else:
            keep.append(p)
    if closed:
        _save(keep)
    return fired, closed


def describe(tk) -> str:
    """One-line MTM of the open discretionary positions (for the loop heartbeat)."""
    ps = _load()
    if not ps:
        return "-"
    return "; ".join(
        f"{p['opt']} K{p['strike']:.0f} @{p['entry_premium']:.2f}"
        f"→{_mark(p, tk):.2f} (stop {p['stop']:.2f}/tgt {p['target']:.2f})"
        for p in ps)


def cmd_enter(args) -> int:
    tk = _last_tick()
    if tk is None:
        print("no tape yet — cannot enter"); return 2
    qty = args.lots * spec.get_lot("NIFTY")
    direction = (getattr(args, "direction", None) or "LONG").upper()
    pos = {
        "id": datetime.now().strftime("%H%M%S"),
        "strategy": "agent_discretionary",
        "opt": args.opt.upper(),
        "strike": float(args.strike),
        "direction": direction,
        "lots": args.lots, "qty": qty,
        "premium": float(args.premium),          # alias used below
        "entry_premium": float(args.premium),
        "entry_time": tk.t.isoformat(),
        "entry_spot": tk.spot,
        "expiry": tk.expiry,
        "stop": float(args.stop), "target": float(args.target),
        "tag": getattr(args, "tag", "") or "",
        "reason": args.reason or "agent discretionary",
    }
    ps = _load()
    ps.append(pos)
    _save(ps)
    print(f"OPENED {direction} {pos['opt']} {pos['strike']:.0f} @ {pos['entry_premium']:.2f} "
          f"x{qty} | stop {pos['stop']:.2f} target {pos['target']:.2f} "
          f"| spot {tk.spot:.1f} at {tk.t:%H:%M}")
    return 0


def cmd_status(args) -> int:
    ps = _load()
    if not ps:
        print("no open agent positions"); return 0
    tk = _last_tick()
    for p in ps:
        now = _mark(p, tk)
        pts = now - p["entry_premium"]
        pnl = (pts * p["qty"] * (-1 if (p.get("direction") or "LONG").upper() == "SHORT" else 1))
        short = (p.get("direction") or "LONG").upper() == "SHORT"
        state = ("STOP HIT" if (now >= p["stop"] if short else now <= p["stop"]) else
                 "TARGET HIT" if (now <= p["target"] if short else now >= p["target"]) else "open")
        print(f"{(p.get('direction') or 'LONG')} {p['opt']} {p['strike']:.0f} "
              f"@ {p['entry_premium']:.2f} -> {now:.2f} (₹{pnl:+,.0f}) | "
              f"stop {p['stop']:.2f} target {p['target']:.2f} | {state} | {p['reason']}")
    return 0


def cmd_exit(args) -> int:
    ps = _load()
    if not ps:
        print("no open agent positions"); return 2
    p = ps[0]
    tk = _last_tick()
    px = float(args.premium) if args.premium else _mark(p, tk)
    r = _close_position(p, tk, px, args.reason or "AGENT_EXIT")
    _save(ps[1:])
    print(f"CLOSED {p['opt']} {p['strike']:.0f} @ {px:.2f} | net ₹{r['net']:+,.0f} "
          f"| booked={r['booked']} | {args.reason or 'agent exit'}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="options_paper.manual")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("enter")
    e.add_argument("--opt", required=True,
                   choices=["CE", "PE", "STRADDLE", "ce", "pe", "straddle"])
    e.add_argument("--strike", type=float, required=True)
    e.add_argument("--premium", type=float, required=True)
    e.add_argument("--stop", type=float, required=True)
    e.add_argument("--target", type=float, required=True)
    e.add_argument("--lots", type=int, default=1)
    e.add_argument("--direction", choices=["LONG", "SHORT", "long", "short"],
                   default="LONG")
    e.add_argument("--tag", default="", help="regime tag for the learning loop")
    e.add_argument("--reason", default="")
    e.set_defaults(func=cmd_enter)
    s = sub.add_parser("status"); s.set_defaults(func=cmd_status)
    t = sub.add_parser("trigger")
    t.add_argument("--opt", required=True, choices=["CE", "PE", "ce", "pe"])
    t.add_argument("--strike", type=float, required=True)
    t.add_argument("--side", required=True, choices=["below", "above"])
    t.add_argument("--level", type=float, required=True)
    t.add_argument("--stop-pct", type=float, default=0.25)
    t.add_argument("--target-pct", type=float, default=0.45)
    t.add_argument("--lots", type=int, default=1)
    t.add_argument("--reason", default="")
    t.set_defaults(func=cmd_trigger)
    x = sub.add_parser("exit")
    x.add_argument("--premium", type=float, default=0.0)
    x.add_argument("--reason", default="")
    x.set_defaults(func=cmd_exit)
    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
