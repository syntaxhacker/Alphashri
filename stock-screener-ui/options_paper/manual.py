"""Agent discretionary trades — open-position ledger + booking on exit.

The agent (not the coded strategies) decides these. ``enter`` records an open
position with an explicit stop/target; ``status`` marks it against the newest
tape row; ``exit`` books the completed round-trip under the agent identity
(``agent_intraday``) and removes it from the ledger.

Why a ledger: an open position must survive between checks. ``trades`` only
holds completed round-trips, and ``positions`` belongs to the equity runner.

Marking rule
------------
A position is marked at **the contract it holds** — the chain price of its
strike — never at the current ATM. The ATM drifts as spot moves, so an ATM
mark silently prices a *different* contract. A dead leg or a strike that is
missing from the chain carries the **last known price for that strike**; a
strike that was never priced stays unpriced (never fabricated).

Expiry scope
------------
A position (or trigger) whose expiry is not the chain's expiry is never
marked against today's prices: the contract is gone, so the position is
settled at its last known price and flagged, never re-priced on a chain that
does not contain it.

Ledger safety
-------------
The 60 s live loop and the 10 s desk manager both rewrite the ledger. Every
write is **locked** (``fcntl``) and **atomic** (``os.replace``), and a ledger
that cannot be parsed is **quarantined** (``*.corrupt``) instead of being
overwritten.

Usage
-----
    python -m options_paper.manual enter --opt CE --strike 23000 \
        --premium 54.5 --stop 41 --target 71 --reason "bounce off 23000 PE wall"
    python -m options_paper.manual status
    python -m options_paper.manual exit --id 093205 --premium 63.0 --reason "target"
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from options_paper import book, costs, spec, tape  # noqa: E402
from options_paper.strategies import Trade, chain_px  # noqa: E402

LEDGER = book.JOURNAL_DIR / "agent_positions.json"

#: Ratchet defaults for a discretionary position: move to breakeven after a
#: +8% favourable move, then trail 20% of the profit. The 20% giveback cut a
#: winner on 2026-10-22 that then ran 40 more points, so both are settable
#: per position (``manual enter --trail-pct / --be-trigger``).
DEFAULT_BE_TRIGGER = 0.08
DEFAULT_TRAIL_PCT = 0.20
#: The trail may give back at most 90% of the profit (a 100% trail would give
#: back everything and stop out at breakeven).
MAX_TRAIL_PCT = 0.9


# --------------------------------------------------------------------------
# Ledger I/O — locked, atomic, quarantine-on-corrupt
# --------------------------------------------------------------------------
@contextmanager
def _ledger_lock():
    """Exclusive lock around a ledger read-modify-write.

    The 60 s live loop and the 10 s desk manager both rewrite the file; an
    interleaved write used to drop an armed trigger or an open position.
    """
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    lock_path = LEDGER.with_name(LEDGER.name + ".lock")
    with open(lock_path, "a+") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def _quarantine_corrupt() -> None:
    """Move an unparseable ledger aside — never overwrite it."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = LEDGER.with_name(f"{LEDGER.stem}.{stamp}.corrupt")
    try:
        os.replace(LEDGER, target)
        print(f"ledger was corrupt — quarantined at {target}", file=sys.stderr)
    except OSError as exc:  # pragma: no cover - defensive
        print(f"ledger corrupt and could not be quarantined: {exc}",
              file=sys.stderr)


def _read_state() -> dict:
    """The ledger as a dict. A corrupt file is quarantined, not overwritten."""
    if not LEDGER.exists():
        return {}
    try:
        data = json.loads(LEDGER.read_text())
    except Exception:
        _quarantine_corrupt()
        return {}
    return data if isinstance(data, dict) else {}


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file + ``os.replace`` (atomic on POSIX)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = (path.stat().st_mode & 0o777) if path.exists() else 0o644
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name,
                               suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)       # mkstemp creates 0600; keep the old mode
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _write_state(state: dict) -> None:
    state["updated_at"] = datetime.now().isoformat(timespec="seconds")
    _atomic_write(LEDGER, json.dumps(state, indent=2))


def _mutate(fn):
    """Run ``fn(state)`` under the ledger lock and persist the result."""
    with _ledger_lock():
        state = _read_state()
        result = fn(state)
        _write_state(state)
        return result


def _load() -> list:
    with _ledger_lock():
        return list(_read_state().get("positions", []) or [])


def _save(positions: list) -> None:
    """Replace the open positions.

    Any other key (triggers!) is preserved — a positions-only rewrite
    silently wiped an armed trigger on 2026-10-21.
    """
    def _apply(state: dict) -> None:
        state["positions"] = positions
    _mutate(_apply)


def _load_triggers() -> list:
    with _ledger_lock():
        return list(_read_state().get("triggers", []) or [])


def _save_triggers(triggers: list) -> None:
    def _apply(state: dict) -> None:
        state["triggers"] = triggers
    _mutate(_apply)


# --------------------------------------------------------------------------
# Marking
# --------------------------------------------------------------------------
def _last_tick():
    ticks = tape.load_tape(datetime.now().strftime("%Y-%m-%d"))
    return ticks[-1] if ticks else None


def _legs(opt: str) -> tuple:
    opt = str(opt or "").upper()
    return ("CE", "PE") if opt == "STRADDLE" else (opt,)


def _mark(pos: dict, tk) -> float:
    """Current premium of the held structure — never the current ATM.

    The chain price of the **held strike** is used. A dead leg (0/None) or a
    strike that is missing from the chain carries the last known price for
    that strike (``last_px``); a strike that was never priced stays
    **unpriced** (0.0) — the ATM is a different contract once the strike has
    drifted, so it is never used as a substitute.
    """
    if tk is None:
        return float(pos.get("entry_premium") or 0.0)
    # Expiry scope: a position whose expiry is not the chain's expiry cannot
    # be marked against today's prices — the contract is gone. Carry the last
    # known price for its own strike instead (never today's chain).
    pexp = str(pos.get("expiry") or "")
    if pexp and pexp != str(tk.expiry or ""):
        return _last_known(pos)
    strike = int(pos.get("strike") or 0)
    last = pos.setdefault("last_px", {})
    total = 0.0
    for leg in _legs(pos.get("opt")):
        px = chain_px(tk, strike, leg)
        if px > 0:
            last[leg] = px
            last["at"] = tk.t.isoformat()
        else:
            px = float(last.get(leg) or 0.0)
        total += px
    return total


def _last_known(pos: dict) -> float:
    """The last price seen for the held strike(s) (0.0 when never priced)."""
    last = pos.get("last_px") or {}
    total = 0.0
    for leg in _legs(pos.get("opt")):
        total += float(last.get(leg) or 0.0)
    return total


def _parse_dt(value):
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def _hold_min(entry_time, exit_dt) -> float:
    """Minutes held (0.0 when the times cannot be compared)."""
    e = _parse_dt(entry_time)
    if e is None or exit_dt is None:
        return 0.0
    if (e.tzinfo is None) != (exit_dt.tzinfo is None):
        try:
            from config import IST
        except Exception:
            return 0.0
        if e.tzinfo is None:
            e = e.replace(tzinfo=IST)
        else:
            exit_dt = exit_dt.replace(tzinfo=IST)
    return round((exit_dt - e).total_seconds() / 60.0, 1)


# --------------------------------------------------------------------------
# Booking
# --------------------------------------------------------------------------
def _close_position(p: dict, tk, px: float, reason: str) -> dict:
    """Book one completed discretionary round-trip (long or short)."""
    is_short = (p.get("direction") or "LONG").upper() == "SHORT"
    opt = str(p.get("opt") or "").upper()
    qty = int(p.get("qty") or spec.get_lot("NIFTY"))
    entry = float(p.get("entry_premium") or 0.0)
    if opt == "STRADDLE":
        # Two legs, **four** orders — priced leg by leg, exactly like
        # ``strategies._close``. Costing a straddle as a single leg halves
        # the charge (₹30 x 2 orders instead of ₹30 x 4).
        entry_ce = float(p.get("entry_ce") or entry * 0.5)
        entry_pe = float(p.get("entry_pe") or entry * 0.5)
        # Exit legs: the last mark for THIS strike is the truth (the combined
        # ``px`` may have been clamped to a target). Fall back to a 50/50 split
        # only when the leg prices are genuinely unknown.
        last = p.get("last_px") or {}
        exit_ce = float(p.get("exit_ce") or last.get("CE") or 0.0)
        exit_pe = float(p.get("exit_pe") or last.get("PE") or 0.0)
        if exit_ce <= 0 or exit_pe <= 0:
            exit_ce, exit_pe = px * 0.5, px * 0.5
        combined = exit_ce + exit_pe
        if px > 0 and combined > 0 and abs(combined - px) > 1e-9:
            # Keep the booked premium consistent with the leg round trips.
            scale = px / combined
            exit_ce, exit_pe = exit_ce * scale, exit_pe * scale
        leg1 = costs.option_round_trip_cost(entry_ce, exit_ce, qty, is_short)
        leg2 = costs.option_round_trip_cost(entry_pe, exit_pe, qty, is_short)
        gross = leg1["gross_pnl"] + leg2["gross_pnl"]
        total_costs = leg1["costs"] + leg2["costs"]
        net = leg1["net_pnl"] + leg2["net_pnl"]
    else:
        rc = costs.option_round_trip_cost(entry, px, qty, is_short)
        gross, total_costs, net = rc["gross_pnl"], rc["costs"], rc["net_pnl"]
        exit_ce = px if opt == "CE" else 0.0
        exit_pe = px if opt == "PE" else 0.0
    exit_dt = tk.t if tk is not None else datetime.now()
    tag = p.get("tag") or ""
    tr = Trade(
        strategy=str(p.get("strategy") or "agent_discretionary"),
        underlying="NIFTY",
        symbol=f"NIFTY {p['expiry']} {p['strike']:.0f}{p['opt']}",
        opt=opt, direction="SHORT" if is_short else "LONG",
        lots=int(p.get("lots") or 1), lot=qty // max(int(p.get("lots") or 1), 1),
        qty=qty, expiry=p["expiry"], entry_time=str(p["entry_time"]),
        entry_premium=entry, entry_spot=float(p.get("entry_spot") or 0.0),
        exit_time=exit_dt.isoformat(),
        exit_premium=px, exit_spot=(tk.spot if tk else float(p.get("entry_spot") or 0.0)),
        exit_reason=reason, hold_min=_hold_min(p.get("entry_time"), exit_dt),
        gross_pnl=gross, costs=total_costs, net_pnl=net,
        points=round(net / qty, 3),
        reason=(f"[{tag}] " if tag else "") + str(p.get("reason") or ""),
        strike=float(p.get("strike") or 0.0), sl_pct=0.0, tp_pct=0.0,
        costs_version=costs.COSTS_VERSION,
        entry_ce=float(p.get("entry_ce") or 0.0),
        entry_pe=float(p.get("entry_pe") or 0.0),
        exit_ce=round(exit_ce, 2), exit_pe=round(exit_pe, 2),
        leg_orders=2 if opt == "STRADDLE" else 1,
    )
    res = book.record_trades([tr], run_as="agent")
    return {"net": net, "booked": res["inserted"], "premium": px}


# --------------------------------------------------------------------------
# Triggers
# --------------------------------------------------------------------------
def _trigger_side_ok(tr: dict, tk) -> bool:
    """False when the trigger was already through the market when armed.

    The check uses the spot recorded **at arm time** (``created_spot``): on the
    firing tick the price is necessarily through the level, so checking the
    current spot would reject every trigger that actually crossed. A legacy
    trigger without an anchor was validated by ``cmd_trigger`` and is allowed.
    """
    anchor = tr.get("created_spot")
    try:
        anchor = float(anchor) if anchor is not None else None
    except (TypeError, ValueError):
        anchor = None
    if anchor is None:
        return True
    level = float(tr.get("level") or 0.0)
    side = str(tr.get("side") or "").lower()
    if side == "below":
        return anchor > level
    if side == "above":
        return anchor < level
    return True


def cmd_trigger(args) -> int:
    """Arm a conditional order the live loop will execute when price hits."""
    tk = _last_tick()
    if tk is None:
        print("no tape yet — cannot arm a trigger"); return 2
    level = float(args.level)
    side = str(args.side).lower()
    # A trigger whose level is already through the spot would fire on the
    # next tick at a price the agent did not intend — reject it.
    if side == "below" and tk.spot <= level:
        print(f"refusing: spot {tk.spot:.1f} is already at/below {level:.1f} "
              f"— a 'below' trigger must be under the market")
        return 2
    if side == "above" and tk.spot >= level:
        print(f"refusing: spot {tk.spot:.1f} is already at/above {level:.1f} "
              f"— an 'above' trigger must be over the market")
        return 2
    tr = {"id": datetime.now().strftime("%H%M%S"), "opt": args.opt.upper(),
          "strike": float(args.strike), "side": side,
          "level": level, "stop_pct": args.stop_pct,
          "target_pct": args.target_pct, "lots": args.lots,
          "created_spot": tk.spot,
          "reason": args.reason or "agent trigger",
          "expiry": tk.expiry, "created": tk.t.isoformat()}
    ts = _load_triggers(); ts.append(tr); _save_triggers(ts)
    print(f"ARMED {tr['side']} {tr['level']:.1f} -> BUY {tr['opt']} {tr['strike']:.0f} "
          f"(stop -{tr['stop_pct']*100:.0f}%, target +{tr['target_pct']*100:.0f}%) "
          f"| spot {tk.spot:.1f}")
    return 0


def _fire_triggers(tk) -> list:
    """Fire the pending triggers whose level was reached. Returns the fills."""
    ts = _load_triggers()
    if not ts:
        return []
    keep: list = []
    fired: list = []
    for tr in ts:
        # A trigger for another expiry can never fire against today's chain.
        if str(tr.get("expiry") or "") != str(tk.expiry or ""):
            continue
        if not _trigger_side_ok(tr, tk):
            continue                       # already through — stale
        hit = ((tr["side"] == "below" and tk.spot <= tr["level"])
               or (tr["side"] == "above" and tk.spot >= tr["level"]))
        if not hit:
            keep.append(tr)
            continue
        px = _mark({"opt": tr["opt"], "strike": tr["strike"]}, tk)
        if not px or px <= 0:
            keep.append(tr)                # the contract is not priced — wait
            continue
        fired.append((tr, px))
    if len(keep) != len(ts):
        _save_triggers(keep)
    if fired:
        _append_positions([_new_pos(tr, px, tk) for tr, px in fired])
    return fired


def _new_pos(tr: dict, px: float, tk) -> dict:
    return {
        "id": datetime.now().strftime("%H%M%S"),
        "strategy": "agent_discretionary",
        "opt": tr["opt"], "strike": tr["strike"], "direction": "LONG",
        "lots": tr["lots"], "qty": tr["lots"] * spec.get_lot("NIFTY"),
        "entry_premium": px, "entry_time": tk.t.isoformat(),
        "entry_spot": tk.spot, "expiry": tr["expiry"],
        "stop": round(px * (1 - tr["stop_pct"]), 2),
        "target": round(px * (1 + tr["target_pct"]), 2),
        "best": px,
        "be_trigger": float(tr.get("be_trigger", DEFAULT_BE_TRIGGER)),
        "trail_pct": float(tr.get("trail_pct", DEFAULT_TRAIL_PCT)),
        "last_px": {tr["opt"]: px, "at": tk.t.isoformat()},
        "reason": tr["reason"],
    }


def _append_positions(new_positions: list) -> None:
    """Add positions to the ledger under the lock (no lost updates)."""
    if not new_positions:
        return
    def _apply(state: dict) -> None:
        positions = list(state.get("positions") or [])
        positions.extend(new_positions)
        state["positions"] = positions
    _mutate(_apply)


# --------------------------------------------------------------------------
# Position management
# --------------------------------------------------------------------------
def auto_manage(tk):
    """Fire pending triggers, then mark/exit open positions.

    Returns ``(fired, closed)``. Called by the live loop every minute, so a
    conditional order is executed even if nobody is watching.
    """
    if tk is None:
        return [], []
    fired = _fire_triggers(tk)
    closed = _manage_positions(tk)
    return fired, closed


def _manage_positions(tk) -> list:
    """Mark, ratchet and close the open positions (one locked pass)."""
    closed: list = []

    def _apply(state: dict) -> None:
        positions = list(state.get("positions") or [])
        keep: list = []
        for p in positions:
            expiry = str(p.get("expiry") or "")
            if expiry != str(tk.expiry or ""):
                # The contract is not on today's chain: never mark an old
                # expiry against today's prices. Settle it at the last known
                # price, or leave it flagged when it was never priced.
                px = _last_known(p)
                if px > 0:
                    r = _close_position(p, tk, px, "EXPIRY: contract expired")
                    closed.append((p, px, "EXPIRY", r))
                else:
                    p["expired_unpriced"] = True
                    keep.append(p)
                continue

            before_last = dict(p.get("last_px") or {})
            now = _mark(p, tk)
            short = (p.get("direction") or "LONG").upper() == "SHORT"
            entry = float(p.get("entry_premium") or 0.0)
            qty = int(p.get("qty") or spec.get_lot("NIFTY"))
            stop = float(p.get("stop") or 0.0)
            target = float(p.get("target") or 0.0)

            if now <= 0:
                # Unpriced: the contract is not in the chain and was never
                # marked. Never fabricate a stop/target hit.
                p["unpriced"] = True
                keep.append(p)
                continue
            p.pop("unpriced", None)

            # --- ratchet: breakeven after costs, then trail the best print -
            best = float(p.get("best", entry))
            best = min(best, now) if short else max(best, now)
            p["best"] = best
            best_fav = ((entry - best) / entry) if short else ((best - entry) / entry)
            be_trigger = float(p.get("be_trigger", DEFAULT_BE_TRIGGER))
            trail_pct = float(p.get("trail_pct", DEFAULT_TRAIL_PCT))
            ratchet = None
            if be_trigger > 0 and best_fav >= be_trigger:
                be_pts = costs.break_even_move_points(entry, qty,
                                                      is_short=short)
                if getattr(be_pts, "found", True):
                    ratchet = ((entry - float(be_pts)) if short
                               else (entry + float(be_pts)))
            trail_armed = (best_fav >= be_trigger if be_trigger > 0
                           else best_fav > 0)
            if trail_pct > 0 and trail_armed:
                # The trail gives back a fraction of the **profit**, not a
                # fraction of the premium.
                trail_stop = (entry - (1 - trail_pct) * (entry - best) if short
                              else entry + (1 - trail_pct) * (best - entry))
                ratchet = (trail_stop if ratchet is None
                           else (min(ratchet, trail_stop) if short
                                 else max(ratchet, trail_stop)))
            if ratchet is not None:
                new_stop = min(stop, ratchet) if short else max(stop, ratchet)
                if abs(new_stop - stop) > 1e-9:
                    p["stop"] = round(new_stop, 2)

            if (short and now >= p["stop"]) or ((not short) and now <= p["stop"]):
                # Stops fill at the observed mark (the conservative side).
                closed.append((p, now, "STOP", _close_position(p, tk, now, "STOP")))
            elif (short and now <= p["target"]) or ((not short) and now >= p["target"]):
                # A crossed target fills **at the target**: the observed mark
                # can overshoot the level, and booking the overshoot flatters
                # every target. (Long: min(mark, target); short: max.)
                target_px = (max(now, target) if short
                             else min(now, target))
                closed.append((p, target_px, "TARGET",
                               _close_position(p, tk, target_px, "TARGET")))
            else:
                keep.append(p)
        state["positions"] = keep

    _mutate(_apply)
    return closed


def describe(tk) -> str:
    """One-line MTM of the open discretionary positions (for the loop heartbeat)."""
    ps = _load()
    if not ps:
        return "-"
    bits = []
    for p in ps:
        now = _mark(p, tk)
        if now <= 0:
            bits.append(f"{p['opt']} K{p['strike']:.0f} unpriced")
            continue
        bits.append(f"{p['opt']} K{p['strike']:.0f} @{p['entry_premium']:.2f}"
                    f"→{now:.2f} (stop {p['stop']:.2f}/tgt {p['target']:.2f})")
    return "; ".join(bits)


def cmd_enter(args) -> int:
    tk = _last_tick()
    if tk is None:
        print("no tape yet — cannot enter"); return 2
    trail_pct = float(getattr(args, "trail_pct", DEFAULT_TRAIL_PCT))
    be_trigger = float(getattr(args, "be_trigger", DEFAULT_BE_TRIGGER))
    if not (0.0 <= trail_pct <= MAX_TRAIL_PCT):
        print(f"--trail-pct must be between 0 and {MAX_TRAIL_PCT} "
              f"(the fraction of the profit the trail gives back)")
        return 2
    if be_trigger < 0:
        print("--be-trigger must be >= 0 (the favourable move that arms the "
              "breakeven ratchet)")
        return 2
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
        "best": float(args.premium),
        # The ratchet parameters travel WITH the position: the runner's
        # ratchet reads them off the ledger.
        "be_trigger": be_trigger, "trail_pct": trail_pct,
        "last_px": {args.opt.upper(): float(args.premium), "at": tk.t.isoformat()},
        "tag": getattr(args, "tag", "") or "",
        "reason": args.reason or "agent discretionary",
    }
    _append_positions([pos])
    print(f"OPENED {direction} {pos['opt']} {pos['strike']:.0f} @ {pos['entry_premium']:.2f} "
          f"x{qty} | stop {pos['stop']:.2f} target {pos['target']:.2f} "
          f"| trail {trail_pct:.0%} be@{be_trigger:.0%} "
          f"| spot {tk.spot:.1f} at {tk.t:%H:%M}")
    return 0


def cmd_status(args) -> int:
    ps = _load()
    if not ps:
        print("no open agent positions"); return 0
    tk = _last_tick()
    for p in ps:
        now = _mark(p, tk)
        short = (p.get("direction") or "LONG").upper() == "SHORT"
        if now <= 0:
            state = "UNPRICED"
            print(f"{short and 'SHORT' or 'LONG'} {p['opt']} {p['strike']:.0f} "
                  f"@ {p['entry_premium']:.2f} -> unpriced | {state} | {p.get('reason','')}")
            continue
        pts = now - p["entry_premium"]
        pnl = (pts * p["qty"] * (-1 if short else 1))
        state = ("STOP HIT" if (now >= p["stop"] if short else now <= p["stop"]) else
                 "TARGET HIT" if (now <= p["target"] if short else now >= p["target"]) else "open")
        print(f"{'SHORT' if short else 'LONG'} {p['opt']} {p['strike']:.0f} "
              f"@ {p['entry_premium']:.2f} -> {now:.2f} (₹{pnl:+,.0f}) | "
              f"stop {p['stop']:.2f} target {p['target']:.2f} | {state} | {p.get('reason','')}")
    return 0


def _select_position(ps: list, args) -> dict | None:
    """Pick the position to exit: by ``--id``, ``--strike``/``--opt``, or the first."""
    pid = (getattr(args, "id", "") or "").strip()
    if pid:
        for p in ps:
            if str(p.get("id") or "") == pid:
                return p
        return None
    strike = float(getattr(args, "strike", 0.0) or 0.0)
    opt = str(getattr(args, "opt", "") or "").upper()
    if strike or opt:
        for p in ps:
            same_strike = (not strike) or abs(float(p.get("strike") or 0) - strike) < 0.5
            same_opt = (not opt) or str(p.get("opt") or "").upper() == opt
            if same_strike and same_opt:
                return p
        return None
    return ps[0] if ps else None


def cmd_exit(args) -> int:
    ps = _load()
    if not ps:
        print("no open agent positions"); return 2
    p = _select_position(ps, args)
    if p is None:
        print("no matching open agent position "
              f"(id={getattr(args, 'id', '')!r} strike={getattr(args, 'strike', 0)} "
              f"opt={getattr(args, 'opt', '')!r})")
        return 2
    tk = _last_tick()
    px = float(args.premium) if args.premium else _mark(p, tk)
    if px <= 0:
        print("the held contract is not priced (no chain price, no last known) "
              "— pass --premium to book the exit")
        return 2
    r = _close_position(p, tk, px, args.reason or "AGENT_EXIT")
    _save([x for x in ps if x is not p])
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
    e.add_argument("--trail-pct", type=float, default=DEFAULT_TRAIL_PCT,
                   help="the trail gives back this fraction of the profit "
                        f"(0..{MAX_TRAIL_PCT}; 0 disables the trail)")
    e.add_argument("--be-trigger", type=float, default=DEFAULT_BE_TRIGGER,
                   help="the favourable move (as a fraction of the entry "
                        "premium) that arms the breakeven ratchet (0 disables)")
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
    x.add_argument("--id", default="", help="position id (default: the first position)")
    x.add_argument("--strike", type=float, default=0.0, help="strike of the position")
    x.add_argument("--opt", default="", choices=["CE", "PE", "STRADDLE", "ce", "pe", "straddle"],
                   help="option type of the position")
    x.add_argument("--reason", default="")
    x.set_defaults(func=cmd_exit)
    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
