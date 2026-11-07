"""Autonomous manager for the agent's discretionary options desk.

Runs until EOD flat (15:10 IST), polling the live chain every 10 s and
enforcing the rules written in reports/OPTIONS_PAPER_SIM/agent_ledger.md:

  * short-strangle package take-profit  >= +1,200 **net of costs**
  * short-strangle package hard cut     <= -1,600 **net of costs**
  * cover the CE leg if spot >= the CE strike - 80
  * cover the PE leg if spot <= the PE strike + 80
  * flatten every open agent position at 15:10 (CAS safety), then RE-CHECK:
    a leftover leg exits non-zero and logs an ALERT

The expiry and the legs are resolved at startup — CLI (``--expiry``/``--leg``)
→ the open book → the last strangle recorded in the ledger → the last known
defaults. A hardcoded expiry was one roll away from managing the wrong contract.

It never opens trades. Entries stay discretionary (the agent), exits are
mechanical so a thesis cannot be abandoned just because nobody is watching.

Usage:
    .venv/bin/python scripts/agent_desk_manager.py [--date 2026-10-21]

Logs:  experiments/data/agent_desk/<date>_manager.log
State: experiments/data/agent_desk/<date>_manager.json
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import time
import traceback
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


import config  # noqa: E402
import options_paper.manual as manual  # noqa: E402
from options_paper import costs  # noqa: E402
from scripts import upstox_common  # noqa: E402

#: Fallbacks only — the live plan is resolved from the open book, then the
#: ledger, then the CLI (``--expiry`` / ``--leg``). A hardcoded expiry silently
#: manages the wrong contract on the next roll.
EXPIRY = "2026-10-27"
DEFAULT_STRANGLE = {22700: "PE", 23300: "CE"}
DEFAULT_ENTRY = {("PE", 22700): 64.5, ("CE", 23300): 55.2}
LEDGER_PATH = ROOT / "reports" / "OPTIONS_PAPER_SIM" / "agent_ledger.md"
POLL_SECONDS = 10

LOT = 65

PKG_TP = 1200.0
PKG_CUT = -1600.0
#: Default threat lines sit 80 pts inside each sold strike (23,300 CE / 22,700 PE).
THREAT_OFFSET = 80.0
EOD_FLAT = (15, 10)

#: ``SHORT STRANGLE 22,700 PE @ 64.5 + 23,300 CE @ 55.2`` (ledger prose).
_STRANGLE_RE = re.compile(
    r"STRANGLE\*{0,2}\s+([\d,]+(?:\.\d+)?)\s*PE\s*@\s*([\d.]+)"
    r"\s*\+\s*([\d,]+(?:\.\d+)?)\s*CE\s*@\s*([\d.]+)",
    re.IGNORECASE,
)
_DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")


# ---------------------------------------------------------------------------
# pure helpers (unit-tested; no network, no DB)
# ---------------------------------------------------------------------------
def _strike(value) -> float | None:
    """Parse ``22,700`` / ``22700`` / ``22700.0`` → float, else None."""
    try:
        out = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return out if out > 0 else None


def parse_ledger_strangle(text: str | None,
                          default_expiry: str | None = None) -> dict | None:
    """Last ``SHORT STRANGLE <strike> PE @ x + <strike> CE @ y`` in the ledger.

    Returns ``{"expiry", "legs": {strike: side}, "entries": {(side, strike): px}}``
    or None when the ledger has no such line. The expiry is taken from the same
    line when present (else ``default_expiry``) — never invented.
    """
    found = None
    for line in (text or "").splitlines():
        match = _STRANGLE_RE.search(line)
        if not match:
            continue
        pe_strike = _strike(match.group(1))
        ce_strike = _strike(match.group(3))
        if pe_strike is None or ce_strike is None:
            continue
        expiry = default_expiry
        same_line = _DATE_RE.search(line)
        if same_line:
            expiry = same_line.group(1)
        found = {
            "expiry": expiry,
            "legs": {pe_strike: "PE", ce_strike: "CE"},
            "entries": {
                ("PE", pe_strike): float(match.group(2)),
                ("CE", ce_strike): float(match.group(4)),
            },
        }
    return found


def resolve_plan(
    cli_expiry: str | None = None,
    cli_legs: dict | None = None,
    positions: list[dict] | None = None,
    ledger: dict | None = None,
    default_expiry: str = EXPIRY,
    default_legs: dict | None = None,
) -> dict:
    """Resolve the legs/expiry the manager should watch.

    Priority: CLI (``--leg``/``--expiry``) → the OPEN BOOK → the ledger's last
    recorded strangle → the hardcoded defaults. The open book wins over the
    ledger because the book is what is actually at risk right now.
    """
    legs: dict[float, str] = {}
    entries: dict[tuple[str, float], float] = {}
    expiry = cli_expiry

    if cli_legs:
        for strike, side in cli_legs.items():
            parsed = _strike(strike)
            side = str(side or "").upper()
            if parsed is not None and side in ("CE", "PE"):
                legs[parsed] = side
    else:
        for pos in positions or []:
            if not isinstance(pos, dict):
                continue
            side = str(pos.get("opt") or "").upper()
            parsed = _strike(pos.get("strike"))
            if side not in ("CE", "PE") or parsed is None:
                continue
            legs[parsed] = side
            entry = _strike(pos.get("entry_premium"))
            if entry is not None:
                entries[(side, parsed)] = entry
            if not expiry and pos.get("expiry"):
                expiry = str(pos["expiry"])
        if not legs and ledger:
            legs = {float(k): str(v).upper() for k, v in (ledger.get("legs") or {}).items()}
            entries = {tuple(k): float(v) for k, v in (ledger.get("entries") or {}).items()}
            expiry = expiry or ledger.get("expiry")

    if not legs:
        legs = {float(k): str(v).upper()
                for k, v in (default_legs or DEFAULT_STRANGLE).items()}
        if not entries and default_legs is None:
            entries = dict(DEFAULT_ENTRY)

    return {"expiry": expiry or default_expiry, "legs": legs, "entries": entries}


def find_leg(positions: list[dict], side: str, strike: float,
             leg_id=None, direction: str | None = None) -> dict | None:
    """The open position matching ``id`` (preferred) or ``side + strike``.

    A second leg at the same strike on the OTHER side is common (a risk
    reversal / a re-entry after a cover). Matching on ``opt + strike`` alone
    closed the wrong leg, so an id match wins, a direction narrows the match,
    and an ambiguous match returns None instead of guessing.
    """
    side = str(side or "").upper()
    want_dir = str(direction or "").upper()
    if leg_id is not None:
        for pos in positions or []:
            if isinstance(pos, dict) and str(pos.get("id")) == str(leg_id):
                return pos
        return None  # an id was given: never silently fall back to another leg
    target = _strike(strike)
    if target is None or side not in ("CE", "PE"):
        return None
    matches = []
    for pos in positions or []:
        if not isinstance(pos, dict):
            continue
        if str(pos.get("opt") or "").upper() != side:
            continue
        got = _strike(pos.get("strike"))
        if got is None or abs(got - target) > 1:
            continue
        if want_dir and str(pos.get("direction") or "LONG").upper() != want_dir:
            continue
        matches.append(pos)
    return matches[0] if len(matches) == 1 else None


def package_pnl(positions: list[dict], quotes: dict,
                lot: int = LOT) -> dict:
    """Package P&L NET of round-trip costs over the legs that are open.

    Every leg is priced **against its own entry and direction** (a short
    strangle scored against the old static ENTRY map produced a false
    -₹2,395 "cut" when a long PE replaced the short one). ``net`` is what
    closing now would actually bank; ``gross`` and ``costs`` are shown so the
    charge is visible.
    """
    gross = costs_total = net = 0.0
    priced = 0
    for pos in positions or []:
        if not isinstance(pos, dict):
            continue
        side = str(pos.get("opt") or "").upper()
        strike = _strike(pos.get("strike"))
        if strike is None:
            continue
        quote = quotes.get((side, strike)) if isinstance(quotes, dict) else None
        entry = _strike(pos.get("entry_premium"))
        if not quote or entry is None:
            continue
        qty = int(pos.get("qty") or lot)
        short = str(pos.get("direction") or "LONG").upper() == "SHORT"
        rc = costs.option_round_trip_cost(entry, float(quote.get("ltp") or 0),
                                         qty, is_short=short)
        gross += rc["gross_pnl"]
        costs_total += rc["costs"]
        net += rc["net_pnl"]
        priced += 1
    return {"gross": round(gross, 2), "costs": round(costs_total, 2),
            "net": round(net, 2), "priced": priced, "open": len(positions or [])}


def threat_levels(legs: dict, offset: float = THREAT_OFFSET) -> dict:
    """Threat spots implied by the sold strikes (CE strike - offset / PE + offset)."""
    out = {"ce": None, "pe": None}
    for strike, side in (legs or {}).items():
        strike = float(strike)
        if str(side).upper() == "CE":
            out["ce"] = strike - offset
        elif str(side).upper() == "PE":
            out["pe"] = strike + offset
    return out


def _now() -> datetime:
    return datetime.now(config.IST)


def _log(msg: str) -> None:
    print(f"[{_now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _token() -> str:
    return upstox_common.token()


def _chain(token: str, expiry: str = EXPIRY) -> dict:
    return upstox_common.chain(token=token, expiry=expiry)


def _quotes(chain: dict, legs: dict) -> dict:
    out = {}
    for strike, side in (legs or {}).items():
        row = next((x for x in chain["rows"]
                    if abs(float(x.get("strike_price", 0)) - float(strike)) < 1), None)
        if row is None:
            continue
        key = "put_options" if str(side).upper() == "PE" else "call_options"
        md = row[key]["market_data"]
        out[(str(side).upper(), float(strike))] = {
            "ltp": float(md.get("ltp") or 0),
            "bid": float(md.get("bid_price") or md.get("ltp") or 0),
            "ask": float(md.get("ask_price") or md.get("ltp") or 0),
        }
    return out


def _open_legs() -> list[dict]:
    # agent_positions.json only holds open positions — closing removes the row.
    return list(manual._load())


def _close_leg(side: str, strike: float, px: float, reason: str,
               leg_id=None, direction: str | None = None) -> dict | None:
    """Close ONE leg, identified by id when given (else side+strike+direction).

    ``find_leg`` refuses an ambiguous match, so a re-entry at the same strike
    can never cause the other leg to be closed by mistake.
    """
    positions = manual._load()
    pos = find_leg(positions, side, strike, leg_id=leg_id, direction=direction)
    if pos is None:
        _log(f"skip close {side}{float(strike):.0f} — no unambiguous open leg"
             + (f" (id {leg_id})" if leg_id is not None else ""))
        return None
    tick = manual._last_tick()
    result = manual._close_position(pos, tick, px, reason)
    manual._save([p for p in positions if p is not pos])
    return result


def _ratchet(quotes: dict) -> None:
    """Lift each open position's stop to breakeven-after-costs, then trail it.

    Mirrors ``options_paper.manual.auto_manage`` so the same protection runs on
    a 10 s cadence instead of waiting for the 60 s loop.
    """
    positions = manual._load()
    changed = False
    for p in positions:
        key = (p.get("opt"), float(p.get("strike", 0)))
        q = quotes.get(key)
        if not q:
            continue
        now = q["ltp"]
        entry = float(p.get("entry_premium") or 0)
        if entry <= 0:
            continue
        qty = int(p.get("qty") or LOT)
        short = (p.get("direction") or "LONG").upper() == "SHORT"
        best = float(p.get("best", entry))
        best = min(best, now) if short else max(best, now)
        if best != p.get("best"):
            p["best"] = best
            changed = True
        best_fav = ((entry - best) / entry) if short else ((best - entry) / entry)
        if best_fav < float(p.get("be_trigger", 0.08)):
            continue
        be_pts = costs.break_even_move_points(entry, qty, is_short=short)
        trail_pct = float(p.get("trail_pct", 0.20))
        if short:
            ratchet = entry - be_pts
            if trail_pct > 0:
                ratchet = min(ratchet, best * (1 + trail_pct))
            new_stop = min(float(p["stop"]), ratchet)
        else:
            ratchet = entry + be_pts
            if trail_pct > 0:
                ratchet = max(ratchet, best * (1 - trail_pct))
            new_stop = max(float(p["stop"]), ratchet)
        if abs(new_stop - float(p["stop"])) > 1e-9:
            p["stop"] = round(new_stop, 2)
            changed = True
            _log(f"RATCHET {p.get('opt')}{p['strike']:.0f} stop -> {p['stop']:.2f} "
                 f"(best {best:.2f}, entry {entry:.2f})")
    if changed:
        manual._save(positions)


def _close_all(reason: str, quotes: dict, rows: list[dict] | None = None) -> None:
    """Flatten every open agent position, using the live ask where available."""
    rows = rows or []
    for pos in list(_open_legs()):
        side = str(pos.get("opt"))
        strike = float(pos.get("strike", 0))
        short = (pos.get("direction") or "LONG").upper() == "SHORT"
        q = quotes.get((side, strike))
        if q:
            px = q["ask"] if short else q["bid"]
        else:
            row = next((x for x in rows
                        if abs(float(x.get("strike_price", 0)) - strike) < 1), None)
            key = "put_options" if side == "PE" else "call_options"
            md = (row or {}).get(key, {}).get("market_data", {})
            px = float((md.get("ask_price") if short else md.get("bid_price"))
                       or md.get("ltp") or pos.get("premium") or 0)
        if px <= 0:
            _log(f"skip {side}{strike:.0f} — no live quote")
            continue
        res = _close_leg(side, strike, px, reason,
                         leg_id=pos.get("id"), direction=pos.get("direction"))
        if res:
            _log(f"CLOSED {side} {strike:.0f} @ {px:.2f} net ₹{res['net']:+,.0f} — {reason}")


def _flatten_and_verify(reason: str, quotes: dict,
                        rows: list[dict] | None = None,
                        retry: bool = True) -> list[dict]:
    """Flatten, then RE-CHECK the book; returns the legs that still remain.

    "EOD flat done" used to be printed unconditionally, even when a leg had no
    live quote. A position carried into the CAS window has no continuous
    market to exit in, so a leftover leg is an ALERT (non-zero exit), not a
    log line.
    """
    _close_all(reason, quotes, rows)
    remaining = _open_legs()
    if remaining and retry:
        _log(f"EOD flat re-check: {len(remaining)} leg(s) still open — retrying")
        _close_all(reason + " (retry)", quotes, rows)
        remaining = _open_legs()
    return remaining


def _legs_arg(value: str) -> dict:
    """``--leg 22700:PE --leg 23300:CE`` → ``{22700.0: "PE", 23300.0: "CE"}``."""
    try:
        strike, side = str(value).split(":", 1)
    except ValueError:
        raise argparse.ArgumentTypeError(f"bad --leg {value!r} (want STRIKE:CE|PE)")
    parsed, side = _strike(strike), side.strip().upper()
    if parsed is None or side not in ("CE", "PE"):
        raise argparse.ArgumentTypeError(f"bad --leg {value!r} (want STRIKE:CE|PE)")
    return {parsed: side}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=_now().strftime("%Y-%m-%d"))
    ap.add_argument("--expiry", default=None,
                    help="option expiry (default: the open book, then the ledger, "
                         "then the last known expiry)")
    ap.add_argument("--leg", action="append", type=_legs_arg, default=None,
                    metavar="STRIKE:CE|PE",
                    help="leg to manage (repeatable; default: the open book)")
    ap.add_argument("--ledger", default=str(LEDGER_PATH),
                    help="ledger to read the last strangle from")
    ap.add_argument("--package-tp", type=float, default=PKG_TP,
                    help="package take-profit in ₹ net of costs")
    ap.add_argument("--package-cut", type=float, default=PKG_CUT,
                    help="package cut in ₹ net of costs")
    ap.add_argument("--threat-offset", type=float, default=THREAT_OFFSET,
                    help="points inside each sold strike that threaten it")
    args = ap.parse_args(argv)

    ledger = None
    try:
        ledger = parse_ledger_strangle(
            pathlib.Path(args.ledger).read_text(encoding="utf-8"), args.expiry)
    except OSError:
        ledger = None
    cli_legs = {}
    for item in args.leg or []:
        cli_legs.update(item)
    plan = resolve_plan(args.expiry, cli_legs, _open_legs(), ledger)
    expiry = plan["expiry"]
    legs = plan["legs"]
    leg_keys = {(side, float(strike)) for strike, side in legs.items()}
    threats = threat_levels(legs, args.threat_offset)

    out_dir = ROOT / "experiments" / "data" / "agent_desk"
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / f"{args.date}_manager.log"
    state_path = out_dir / f"{args.date}_manager.json"

    token = _token()
    _log(f"manager start — expiry {expiry}, legs {legs}, "
         f"TP {args.package_tp:+.0f}, cut {args.package_cut:+.0f} (net of costs)")

    while True:
        now = _now()
        if (now.hour, now.minute) >= EOD_FLAT:
            remaining: list[dict] = []
            try:
                chain = _chain(token, expiry)
                remaining = _flatten_and_verify(
                    "EOD flat 15:10 (CAS safety)", _quotes(chain, legs), chain["rows"])
            except Exception as exc:  # noqa: BLE001
                remaining = _open_legs()
                _log(f"EOD flatten failed: {type(exc).__name__}: {exc}")
            if remaining:
                names = ", ".join(f"{p.get('opt')}{float(p.get('strike', 0)):.0f}"
                                  for p in remaining)
                _log(f"ALERT EOD flat INCOMPLETE — {len(remaining)} leg(s) still open: {names}")
                try:
                    state_path.write_text(json.dumps({
                        "ts": now.isoformat(), "eod_flat": False,
                        "remaining": names,
                    }, indent=2))
                except OSError:
                    pass
                return 2
            _log("manager stop — EOD flat verified (0 legs open)")
            return 0

        try:
            chain = _chain(token, expiry)
            spot = float(chain["spot"])
            quotes = _quotes(chain, legs)
            _ratchet(quotes)
            # premium stop on a 10 s cadence (the 60 s loop is the backstop)
            for pos in list(_open_legs()):
                side = str(pos.get("opt"))
                strike = float(pos.get("strike", 0))
                q = quotes.get((side, strike))
                if not q or not pos.get("stop"):
                    continue
                short = (pos.get("direction") or "LONG").upper() == "SHORT"
                now_px = q["ltp"]
                hit = (now_px >= float(pos["stop"])) if short else (now_px <= float(pos["stop"]))
                if hit:
                    px = q["ask"] if short else q["bid"]
                    res = _close_leg(side, strike, px,
                                     f"stop {float(pos['stop']):.2f} hit (manager)",
                                     leg_id=pos.get("id"),
                                     direction=pos.get("direction"))
                    if res:
                        _log(f"CLOSED {side}{strike:.0f} stop @ {px:.2f} net ₹{res['net']:+,.0f}")
            open_positions = _open_legs()
            pkg = package_pnl(open_positions, quotes)
            state = {
                "ts": now.isoformat(),
                "spot": spot,
                "quotes": {f"{s}{k:.0f}": v for (s, k), v in quotes.items()},
                "package_pnl": pkg["net"],
                "package_gross": pkg["gross"],
                "package_costs": pkg["costs"],
                "open_legs": [f"{p['opt']}{float(p['strike']):.0f}"
                              for p in open_positions
                              if (p.get("opt"), float(p.get("strike", 0))) in leg_keys],
                "all_open": [f"{p['opt']}{float(p['strike']):.0f}" for p in open_positions],
            }
            state_path.write_text(json.dumps(state, indent=2))
            if open_positions:
                _log(
                    f"spot={spot:.1f} "
                    + " ".join(f"{s}{k:.0f}={q['ltp']:.2f}" for (s, k), q in quotes.items())
                    + f" pkg=₹{pkg['net']:+,.0f} net (gross {pkg['gross']:+,.0f}, "
                    f"costs {pkg['costs']:.0f})"
                )

                plan_positions = [
                    p for p in open_positions
                    if (p.get("opt"), float(p.get("strike", 0))) in leg_keys
                ]
                both = leg_keys.issubset({
                    (p.get("opt"), float(p.get("strike", 0)))
                    for p in open_positions})
                # Package TP/cut only for a *short* strangle. A risk reversal
                # (short CE + long PE) is a different animal; its legs are
                # managed by their own stops.
                all_short = bool(plan_positions) and all(
                    str(p.get("direction") or "LONG").upper() == "SHORT"
                    for p in plan_positions)
                if both and all_short and pkg["net"] >= args.package_tp:
                    remaining = _flatten_and_verify(
                        f"strangle TP: package >= +{args.package_tp:.0f}",
                        quotes, chain["rows"])
                    if remaining:
                        _log(f"ALERT TP flatten left {len(remaining)} leg(s) open")
                        return 2
                    _log("strangle closed — take profit")
                    return 0
                if both and all_short and pkg["net"] <= args.package_cut:
                    remaining = _flatten_and_verify(
                        f"strangle cut: package <= {args.package_cut:.0f}",
                        quotes, chain["rows"])
                    if remaining:
                        _log(f"ALERT cut flatten left {len(remaining)} leg(s) open")
                        return 2
                    _log("strangle closed — risk cut")
                    return 0
                ce_strikes = [k for k, s in legs.items() if s == "CE"]
                pe_strikes = [k for k, s in legs.items() if s == "PE"]
                if threats["ce"] is not None and spot >= threats["ce"]:
                    pos = next((p for p in open_positions
                                if str(p.get("opt") or "").upper() == "CE"
                                and ce_strikes
                                and abs(float(p.get("strike", 0)) - ce_strikes[0]) < 1
                                and str(p.get("direction") or "LONG").upper() == "SHORT"),
                               None)
                    if pos:
                        q = quotes.get(("CE", float(pos["strike"])))
                        if q:
                            _close_leg("CE", float(pos["strike"]), q["ask"],
                                       f"spot {spot:.0f} >= {threats['ce']:.0f}: pin failing, cover CE",
                                       leg_id=pos.get("id"),
                                       direction=pos.get("direction"))
                        _log("CE leg covered — range broken up")
                if threats["pe"] is not None and spot <= threats["pe"]:
                    pos = next((p for p in open_positions
                                if str(p.get("opt") or "").upper() == "PE"
                                and pe_strikes
                                and abs(float(p.get("strike", 0)) - pe_strikes[0]) < 1
                                and str(p.get("direction") or "LONG").upper() == "SHORT"),
                               None)
                    if pos:
                        q = quotes.get(("PE", float(pos["strike"])))
                        if q:
                            _close_leg("PE", float(pos["strike"]), q["ask"],
                                       f"spot {spot:.0f} <= {threats['pe']:.0f}: pin failing, cover PE",
                                       leg_id=pos.get("id"),
                                       direction=pos.get("direction"))
                        _log("PE leg covered — range broken down")
        except Exception as exc:  # noqa: BLE001
            _log(f"poll error: {type(exc).__name__}: {exc}")
            _log(traceback.format_exc().splitlines()[-1])

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
