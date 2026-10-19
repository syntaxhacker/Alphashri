"""Continuous intraday paper trading off the live recorded tape (agent runner).

The API records one tape row per minute during market hours
(``experiments/data/nifty_tape/<date>.jsonl``) with spot, the ATM CE/PE and the
full strike chain. This runner wakes every ``interval`` seconds, re-reads the
tape, replays it through the same no-lookahead engine, and:

* prints a **minute heartbeat** — spot, ATM strike, CE/PE, straddle, open
  positions, and what got booked;
* tracks **open positions** (the engine's still-open ``MTM`` rows) so you can see
  what is being held right now, not only closed trades;
* books every newly **closed** trade under the agent identity.

Honest framing
--------------
* Not low-latency execution: a price can only be acted on once the tape row
  carrying it exists, so decisions lag by up to one tape interval (60 s).
* No lookahead: only minutes already written are used.
* It never books an open position — only closed trades reach the DB.
* ``nifty_spot_scalp`` trades continuously by design; that means frequent
  entries and heavy cost drag. It is a paper experiment, not an edge.

Usage
-----
    python -m options_paper.live --once                 # one pass
    python -m options_paper.live                        # loop until the close
    python -m options_paper.live --dry-run --once       # show, book nothing
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date as _date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from options_paper import book, greeks as G, manual, panel, tape  # noqa: E402
from options_paper.strategies import build  # noqa: E402

#: What the agent runs: selective strategies + a continuous spot scalp.
AGENT_STRATEGIES = ("nifty_momentum", "nifty_gap", "nifty_iv_delta",
                    "nifty_open_straddle", "nifty_spot_scalp")


def market_open(now: datetime | None = None) -> bool:
    """Canonical market-hours check (falls back to a simple 09:15-15:30 rule)."""
    try:
        from trading.utils import is_market_open
        return bool(is_market_open())
    except Exception:
        now = now or datetime.now()
        return now.weekday() < 5 and (9, 15) <= (now.hour, now.minute) <= (15, 30)


def snapshot(tk) -> dict:
    """The last tape minute, in the shape the heartbeat/state file wants."""
    return {"t": tk.t.isoformat(), "spot": tk.spot, "atm": tk.atm_strike,
            "ce": tk.ce_ltp, "pe": tk.pe_ltp,
            "straddle": round(tk.ce_ltp + tk.pe_ltp, 2),
            "expiry": tk.expiry, "chain_strikes": len(tk.chain),
            "iv_ce": tk.ce_iv, "iv_pe": tk.pe_iv}


def _t_years(tk) -> float:
    exp = _date.fromisoformat(tk.expiry)
    exp_dt = datetime.combine(exp, datetime.min.time()).replace(hour=15, minute=30)
    secs = (exp_dt - tk.t.replace(tzinfo=None)).total_seconds()
    return max(secs / (365.0 * 24 * 3600), G.MIN_T_YEARS)


def _strike_iv(tk, strike: int, opt: str) -> float | None:
    """Implied vol of one strike, from its own parity forward."""
    row = (tk.chain or {}).get(int(strike))
    if not row or len(row) < 2 or not row[0] or not row[1]:
        return None
    ce, pe = float(row[0]), float(row[1])
    t = _t_years(tk)
    fwd = G.implied_forward(int(strike), ce, pe, t)
    if not fwd:
        return None
    px = ce if opt == "CE" else pe
    return G.implied_vol(px, fwd, int(strike), t, opt)


def analyse_chain(tk) -> dict:
    """Per-minute options-chain read: PCR, max-pain, OI walls, IV, skew."""
    ch = tk.chain or {}
    if not ch:
        return {}
    rows = []
    meta = tk.chain_meta or {}
    for k, v in ch.items():
        m = meta.get(int(k), (0, 0, 0, 0))
        rows.append((int(k), v[0] or 0, v[1] or 0,
                     m[0] or 0, m[1] or 0, m[2] or 0, m[3] or 0))
    rows.sort()
    ce_oi = sum(r[3] for r in rows)
    pe_oi = sum(r[4] for r in rows)
    ce_vol = sum(r[5] for r in rows)
    pe_vol = sum(r[6] for r in rows)

    # Max pain: the strike where total option-holder payout is smallest.
    best = None
    for K, *_ in rows:
        pain = 0.0
        for C, _cpx, _ppx, coi, poi, _cv, _pv in rows:
            if coi:
                pain += max(C - K, 0) * coi
            if poi:
                pain += max(K - C, 0) * poi
        if best is None or pain < best[0]:
            best = (pain, K)
    top_c = max(rows, key=lambda r: r[3]) if rows else None
    top_p = max(rows, key=lambda r: r[4]) if rows else None

    k = int(tk.atm_strike)
    iv_put = _strike_iv(tk, k - 100, "PE")      # 2 strikes OTM put
    iv_call = _strike_iv(tk, k + 100, "CE")     # 2 strikes OTM call
    return {
        "pcr_oi": round(pe_oi / ce_oi, 3) if ce_oi else 0.0,
        "pcr_vol": round(pe_vol / ce_vol, 3) if ce_vol else 0.0,
        "ce_oi": int(ce_oi), "pe_oi": int(pe_oi),
        "ce_vol": int(ce_vol), "pe_vol": int(pe_vol),
        "max_pain": int(best[1]) if best else 0,
        "wall_call": int(top_c[0]) if top_c else 0,
        "wall_put": int(top_p[0]) if top_p else 0,
        "strikes": len(rows),
        "active": sum(1 for r in rows if (r[5] or 0) + (r[6] or 0) > 0),
        "iv_ce": round(tk.ce_iv * 100, 2),
        "iv_pe": round(tk.pe_iv * 100, 2),
        "skew": round((iv_put - iv_call) * 100, 2) if iv_put and iv_call else None,
    }


def run_once(date_str: str, strategies: tuple | list, lots: int = 1,
             dry_run: bool = False) -> dict:
    """One pass: replay the tape so far, book newly closed agent trades."""
    ticks = tape.load_tape(date_str)
    if len(ticks) < 3:
        return {"ticks": len(ticks), "completed": 0, "inserted": 0,
                "skipped": 0, "open": [], "last": None}
    ctx = {"prev_close": tape.prev_session_close(date_str)}
    trades, open_pos = [], []
    for name in strategies:
        try:
            strat = build(name, lots=lots)
        except KeyError:
            continue
        for t in strat.run(list(ticks), dict(ctx)):
            if t.exit_reason == "MTM":
                open_pos.append(t)          # still open — never booked
            else:
                trades.append(t)
    trades.sort(key=lambda t: t.exit_time)
    res = {"completed": len(trades), "inserted": 0, "skipped": 0}
    if not dry_run and trades:
        r = book.record_trades(trades, journal_date=date_str, run_as="agent")
        res.update(inserted=r["inserted"], skipped=r["skipped"])
    an = analyse_chain(ticks[-1])
    if len(ticks) >= 6:
        prev_an = analyse_chain(ticks[-6])
        if prev_an:
            an["ce_oi_chg"] = an.get("ce_oi", 0) - prev_an.get("ce_oi", 0)
            an["pe_oi_chg"] = an.get("pe_oi", 0) - prev_an.get("pe_oi", 0)
    # Manage the agent's discretionary positions every minute (stop/target).
    manual_closed = []
    manual_fired = []
    try:
        manual_fired, manual_closed = manual.auto_manage(ticks[-1])
    except Exception as e:
        print(f"manual manage failed: {type(e).__name__}: {e}", flush=True)
    return {"ticks": len(ticks), **res, "open": open_pos,
            "analysis": an, "last": snapshot(ticks[-1]),
            "manual": manual.describe(ticks[-1]),
            "manual_fired": manual_fired,
            "manual_closed": manual_closed}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="options_paper.live",
                                description="Agent options paper runner (live tape)")
    p.add_argument("--date", help="YYYY-MM-DD (default: today)")
    p.add_argument("--interval", type=int, default=60, help="seconds between passes")
    p.add_argument("--lots", type=int, default=1)
    p.add_argument("--strategies", default=",".join(AGENT_STRATEGIES))
    p.add_argument("--dry-run", action="store_true", help="print only, never book")
    p.add_argument("--once", action="store_true", help="one pass, then exit")
    args = p.parse_args(argv)

    date_str = args.date or datetime.now().strftime("%Y-%m-%d")
    names = tuple(s.strip() for s in args.strategies.split(",") if s.strip())

    if not args.dry_run:
        acct = book.ensure_account()
        print(f"agent identity: bot='{book.AGENT_BOT_NAME}' "
              f"tag='{book.AGENT_TRADE_TAG}' (new: {acct['created']['bots']})")

    print(f"agent live runner — date={date_str} strategies={list(names)} "
          f"lots={args.lots} interval={args.interval}s dry_run={args.dry_run}")
    close_min = 15 * 60 + 30          # 15:30 IST — run until the close
    while True:
        try:
            r = run_once(date_str, names, args.lots, args.dry_run)
        except Exception as e:
            # A transient tape/DB/API error must never end the session.
            print(f"[{datetime.now():%H:%M:%S}] pass failed "
                  f"({type(e).__name__}: {e}) — continuing", flush=True)
            if args.once:
                return 1
            time.sleep(max(5, args.interval))
            continue
        last = r.get("last") or {}
        opens = r.get("open") or []
        an = r.get("analysis") or {}
        op = "; ".join(
            f"{t.strategy}:{t.opt} K{int(t.strike)} @{t.entry_premium:.1f}"
            f"→{t.exit_premium:.1f} MTM {t.net_pnl:+.0f}"
            for t in opens) or "-"
        if last:
            print(f"[{datetime.now():%H:%M:%S}] spot={last['spot']:.1f} "
                  f"ATM={last['atm']:.0f} CE={last['ce']:.1f} PE={last['pe']:.1f} "
                  f"straddle={last['straddle']:.1f} | open={len(opens)} [{op}] "
                  f"| new={r['inserted']} (skip {r['skipped']}) "
                  f"| tape={r['ticks']}min", flush=True)
            if an:
                skew = an.get("skew")
                print(f"           chain: {an['strikes']}strikes/{an['active']}active "
                      f"PCRoi={an['pcr_oi']:.2f} PCRvol={an['pcr_vol']:.2f} "
                      f"maxPain={an['max_pain']} walls C{an['wall_call']}/P{an['wall_put']} "
                      f"IV {an['iv_ce']:.1f}/{an['iv_pe']:.1f}"
                      + (f" skew={skew:+.1f}" if skew is not None else "")
                      + (f" OI5m CE{an['ce_oi_chg']:+,} PE{an['pe_oi_chg']:+,}"
                         if "ce_oi_chg" in an else ""), flush=True)
            if r.get("manual") and r["manual"] != "-":
                print(f"           my position: {r['manual']}", flush=True)
            for (tr, px) in (r.get("manual_fired") or []):
                print(f"           >>> TRIGGER FIRED: BUY {tr['opt']} K{tr['strike']:.0f} "
                      f"@ {px:.2f} ({tr['reason']})", flush=True)
            for (p, px, why, res) in (r.get("manual_closed") or []):
                print(f"           >>> AUTO-EXIT {why}: {p['opt']} K{p['strike']:.0f} "
                      f"@ {px:.2f} net ₹{res['net']:+,.0f}", flush=True)
        else:
            print(f"[{datetime.now():%H:%M:%S}] waiting for tape "
                  f"({r['ticks']} min)", flush=True)
        if args.once:
            return 0
        now = datetime.now()
        if now.hour * 60 + now.minute >= close_min:
            print("market closed — agent runner stopping")
            return 0
        time.sleep(max(5, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
