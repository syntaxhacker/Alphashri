#!/usr/bin/env python3
"""Discretionary wall-to-wall replay gym (no look-ahead).

The agent sees the tape only up to ``--at``; a decision fills at the NEXT tape
row; stops/targets are walked forward row by row. State lives in
``reports/WALL_REPLAY/state/<date>.json`` so a session can be played one
decision at a time.

Commands
--------
    card   --date D --at HH:MM
    enter  --date D --at HH:MM --opt CE --strike 23000 --direction LONG \
           --lots 1 --stop 95 --target 155 --reason "..."
    mark   --date D --at HH:MM
    exit   --date D --at HH:MM --reason "..."
    status --date D

Read-only w.r.t. the tape; writes only the session state file.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from options_paper import costs  # noqa: E402

TAPE_DIR = ROOT / "experiments" / "data" / "nifty_tape"
STATE_DIR = ROOT / "reports" / "WALL_REPLAY" / "state"
LOT = 65
TRAIL_ARM = 0.02
TRAIL_PCT = 0.20


def _rows(date: str) -> list[dict]:
    path = TAPE_DIR / f"{date}.jsonl"
    if not path.exists():
        raise SystemExit(f"no tape: {path}")
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _at(rows: list[dict], at: str) -> tuple[int, dict]:
    """Index of the last row at/before ``at`` (HH:MM, HH:MM:SS, or full ISO)."""
    if "T" in at:
        target = datetime.fromisoformat(at)
        idx = -1
        for i, r in enumerate(rows):
            if datetime.fromisoformat(r["t"]) <= target:
                idx = i
            else:
                break
    else:
        target_t = time.fromisoformat(at)
        idx = -1
        for i, r in enumerate(rows):
            if datetime.fromisoformat(r["t"]).time() <= target_t:
                idx = i
            else:
                break
    if idx < 0:
        raise SystemExit(f"no tape row at/before {at}")
    return idx, rows[idx]


def _px(row: dict, strike: float, opt: str) -> float:
    leg = (row.get("chain") or {}).get(str(int(strike))) or (row.get("chain") or {}).get(str(strike))
    if leg and len(leg) >= (1 if opt.upper() == "CE" else 2):
        return float(leg[0] if opt.upper() == "CE" else leg[1])
    # Older tape has no chain: only the ATM premium is recorded.
    atm = row.get("atm_strike")
    try:
        if atm and abs(float(strike) - float(atm)) < 0.5:
            return float(row.get("atm_ce_ltp") if opt.upper() == "CE" else row.get("atm_pe_ltp") or 0.0)
    except (TypeError, ValueError):
        pass
    return 0.0


def _oi(row: dict, strike: float, opt: str) -> float:
    leg = (row.get("chain") or {}).get(str(int(strike))) or (row.get("chain") or {}).get(str(strike))
    if leg and len(leg) >= 4:
        return float(leg[2] if opt.upper() == "CE" else leg[3])
    # Older tape: the chain OI is missing but the walls block still carries it.
    for w in (row.get("walls") or {}).get("calls" if opt.upper() == "CE" else "puts") or []:
        try:
            if abs(float(w.get("strike") or 0) - float(strike)) < 0.5:
                return float(w.get("oi") or 0)
        except (TypeError, ValueError):
            pass
    return 0.0


def _state_path(date: str) -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    return STATE_DIR / f"{date}.json"


def _load(date: str) -> dict:
    p = _state_path(date)
    if p.exists():
        return json.loads(p.read_text())
    return {"date": date, "realized": 0.0, "trades": [], "position": None,
            "last_at": "09:15"}


def _save(state: dict) -> None:
    _state_path(state["date"]).write_text(json.dumps(state, indent=2))


def _rsi(closes: list[float], n: int = 14) -> float:
    if len(closes) < n + 1:
        return 50.0
    d = [closes[i] - closes[i - 1] for i in range(len(closes) - n, len(closes))]
    gains = sum(x for x in d if x > 0) / n
    losses = sum(-x for x in d if x < 0) / n
    if losses == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + gains / losses)


def _ema(vals: list[float], n: int) -> float:
    if not vals:
        return 0.0
    k = 2.0 / (n + 1)
    out = vals[0]
    for v in vals[1:]:
        out = v * k + out * (1 - k)
    return out


def _wall(row: dict, side: str) -> dict | None:
    arr = (row.get("walls") or {}).get("calls" if side == "call" else "puts") or []
    return arr[0] if arr else None


def _oi_delta(rows: list[dict], idx: int, strike: float, opt: str, mins: int = 5) -> float | None:
    now = _oi(rows[idx], strike, opt)
    j = max(0, idx - mins)
    then = _oi(rows[j], strike, opt)
    if now <= 0 or then <= 0:
        return None
    return now - then


def _fmt_m(x: float | None) -> str:
    if x is None:
        return "n/a"
    return f"{x/1e6:+.2f}M" if abs(x) >= 1e6 else f"{x/1e3:+.0f}k"


def cmd_card(a) -> int:
    rows = _rows(a.date)
    idx, r = _at(rows, a.at)
    spot = float(r["spot"])
    closes = [float(x["spot"]) for x in rows[: idx + 1]]
    rsi = _rsi(closes)
    e9, e20, e50 = _ema(closes[-60:], 9), _ema(closes[-60:], 20), _ema(closes[-120:], 50)
    hi = max(closes)
    lo = min(closes)
    sup = _wall(r, "put")
    res = _wall(r, "call")
    stamp = a.at[11:19] if "T" in a.at else a.at
    print(f"{a.date} {stamp}  spot {spot:,.1f}  session {lo:,.1f}-{hi:,.1f}")
    print(f"  asof {r['t']}")
    print(f"  put wall  {sup['strike']:,.0f} ({sup['oi']/1e6:.1f}M, 5m {_fmt_m(_oi_delta(rows, idx, sup['strike'], 'PE'))})  "
          f"call wall {res['strike']:,.0f} ({res['oi']/1e6:.1f}M, 5m {_fmt_m(_oi_delta(rows, idx, res['strike'], 'CE'))})")
    ups = (r.get("walls") or {}).get("calls") or []
    dns = (r.get("walls") or {}).get("puts") or []
    print("  walls up   " + "  ".join(f"{w['strike']:,.0f} ({w['oi']/1e6:.1f}M)" for w in ups))
    print("  walls down " + "  ".join(f"{w['strike']:,.0f} ({w['oi']/1e6:.1f}M)" for w in dns))
    mp = float(r.get("max_pain") or 0)
    print(f"  max pain {r.get('max_pain')} ({mp - spot:+.0f})  GEX {r.get('net_gex')}  PCR {r.get('pcr_oi')}  ATM IV {r.get('atm_ce_iv')}")
    print(f"  last closes {' / '.join(f'{c:,.1f}' for c in closes[-3:])}")
    chg = [abs(closes[i] - closes[i - 1]) for i in range(max(1, len(closes) - 14), len(closes))]
    atr = sum(chg) / len(chg) if chg else 0.0
    print(f"  RSI {rsi:.1f}  EMA9 {e9:,.1f}  EMA20 {e20:,.1f}  EMA50 {e50:,.1f}  ATR(1m) {atr:.1f}")
    ce_atm = _px(r, r.get("atm_strike") or 0, "CE")
    pe_atm = _px(r, r.get("atm_strike") or 0, "PE")
    atm = r.get("atm_strike")
    if not atm:
        ch = r.get("chain") or {}
        if ch:
            atm = min((float(k) for k in ch), key=lambda s: abs(s - spot))
        else:
            atm = round(spot / 50) * 50
    print(f"  ATM {atm:,.0f}  CE {ce_atm:.2f}  PE {pe_atm:.2f}")
    st = _load(a.date)
    p = st.get("position")
    if p:
        px = _px(r, p["strike"], p["opt"])
        pnl = (px - p["entry_premium"]) * p["qty"] * (-1 if p["direction"] == "SHORT" else 1)
        print(f"  POS {p['direction']} {p['opt']} {p['strike']:,.0f} @ {p['entry_premium']:.2f} -> {px:.2f} "
              f"P&L {pnl:+,.0f}  stop {p['stop']:.2f}  tgt {p['target']:.2f}")
    else:
        print("  POS flat")
    print(f"  realized {st['realized']:+,.0f}")
    return 0


def _close(state: dict, p: dict, px: float, at: str, reason: str) -> None:
    r = costs.option_round_trip_cost(p["entry_premium"], px, p["qty"],
                                     is_short=(p["direction"] == "SHORT"))
    state["trades"].append({
        "opt": p["opt"], "strike": p["strike"], "direction": p["direction"],
        "entry_time": p["entry_time"], "exit_time": at,
        "entry_premium": p["entry_premium"], "exit_premium": round(px, 2),
        "qty": p["qty"], "gross": r["gross_pnl"], "costs": r["costs"],
        "net": r["net_pnl"], "reason": reason, "entry_reason": p["reason"],
    })
    state["realized"] = round(state["realized"] + r["net_pnl"], 2)
    state["position"] = None


def _advance(state: dict, rows: list[dict], from_idx: int, to_idx: int) -> None:
    """Walk rows forward, ratchet the stop, close on stop/target."""
    p = state.get("position")
    if not p:
        return
    short = p["direction"] == "SHORT"
    for i in range(from_idx + 1, to_idx + 1):
        r = rows[i]
        px = _px(r, p["strike"], p["opt"])
        if px <= 0:
            continue
        entry = p["entry_premium"]
        best = min(p["best"], px) if short else max(p["best"], px)
        p["best"] = best
        fav = ((entry - best) / entry) if short else ((best - entry) / entry)
        arm = float(p.get("trail_arm", TRAIL_ARM))
        give = float(p.get("trail_pct", TRAIL_PCT))
        if fav >= arm:
            trail = (entry - (1 - give) * (entry - best) if short
                     else entry + (1 - give) * (best - entry))
            p["stop"] = min(p["stop"], trail) if short else max(p["stop"], trail)
        hit_stop = (px >= p["stop"]) if short else (px <= p["stop"])
        hit_tgt = (px <= p["target"]) if short else (px >= p["target"])
        if hit_stop:
            _close(state, p, px, r["t"], "STOP")
            return
        if hit_tgt:
            fill = max(px, p["target"]) if short else min(px, p["target"])
            _close(state, p, fill, r["t"], "TARGET")
            return


def _is_event(rows: list[dict], i: int, prev_spot: float, state: dict) -> str | None:
    r = rows[i]
    spot = float(r["spot"])
    sup = _wall(r, "put")
    res = _wall(r, "call")
    if sup and res:
        if abs(spot - sup["strike"]) <= 8 and abs(prev_spot - sup["strike"]) > 8:
            return f"put-wall touch {sup['strike']:.0f}"
        if abs(spot - res["strike"]) <= 8 and abs(prev_spot - res["strike"]) > 8:
            return f"call-wall touch {res['strike']:.0f}"
        if (prev_spot < sup["strike"] <= spot) or (prev_spot > sup["strike"] >= spot):
            return f"put-wall cross {sup['strike']:.0f}"
        if (prev_spot < res["strike"] <= spot) or (prev_spot > res["strike"] >= spot):
            return f"call-wall cross {res['strike']:.0f}"
        d_sup = _oi_delta(rows, i, sup["strike"], "PE")
        d_sup_prev = _oi_delta(rows, i - 1, sup["strike"], "PE")
        if (d_sup is not None and d_sup_prev is not None
                and abs(d_sup) >= 1_500_000 and abs(d_sup_prev) < 1_500_000):
            return f"put-wall OI shift {sup['strike']:.0f}"
        d_res = _oi_delta(rows, i, res["strike"], "CE")
        d_res_prev = _oi_delta(rows, i - 1, res["strike"], "CE")
        if (d_res is not None and d_res_prev is not None
                and abs(d_res) >= 1_500_000 and abs(d_res_prev) < 1_500_000):
            return f"call-wall OI shift {res['strike']:.0f}"
    p = state.get("position")
    if p:
        px = _px(r, p["strike"], p["opt"])
        if px > 0 and (abs(px - p["stop"]) <= 4 or abs(px - p["target"]) <= 4):
            return "position near stop/target"
    # Heartbeat: never let four hours pass with no card (2026-10-26 had a
    # 10:10 -> 14:08 blind spot because no wall event fired).
    last_i = int(state.get("last_index", -1))
    if last_i >= 0 and i - last_i >= 30:
        return "30m heartbeat"
    if datetime.fromisoformat(r["t"]).time() >= time(15, 0):
        return "15:00 cutoff"
    return None


def cmd_next(a) -> int:
    rows = _rows(a.date)
    st = _load(a.date)
    if a.start:
        idx, _ = _at(rows, a.start)
    elif st.get("last_index") is not None:
        idx = int(st["last_index"])
    else:
        idx = -1
    p = st.get("position")
    if p and idx >= 0:
        _advance(st, rows, p.get("fill_index", idx), idx)
        _save(st)
        if not st.get("position"):
            print(f"position closed before {rows[idx]['t'][11:19]}; realized {st['realized']:+,.0f}")
    for i in range(idx + 1, len(rows)):
        prev = float(rows[i - 1]["spot"]) if i > 0 else float(rows[i]["spot"])
        ev = _is_event(rows, i, prev, st)
        if ev:
            if st.get("position"):
                _advance(st, rows, st["position"].get("fill_index", i), i)
                _save(st)
            st["last_at"] = rows[i]["t"]
            st["last_index"] = i
            _save(st)
            print(f"EVENT {ev} @ {rows[i]['t'][11:19]}")
            a.at = rows[i]["t"]
            return cmd_card(a)
    st["last_at"] = rows[-1]["t"]
    st["last_index"] = len(rows) - 1
    _save(st)
    print("no further events; session done")
    return 0


def cmd_enter(a) -> int:
    rows = _rows(a.date)
    idx, _ = _at(rows, a.at)
    if idx + 1 >= len(rows):
        raise SystemExit("no next row to fill")
    fill_row = rows[idx + 1]
    px = _px(fill_row, a.strike, a.opt)
    if px <= 0:
        raise SystemExit("strike not priced on the next row")
    # The stop is computed from the FILL, never from the card LTP: the
    # next-bar fill can gap 10-25%, turning a 15% stop into a 5% one.
    if getattr(a, "stop_pct", 0):
        a.stop = (round(px * (1 - a.stop_pct), 2) if a.direction.upper() == "LONG"
                  else round(px * (1 + a.stop_pct), 2))
    if a.stop <= 0:
        raise SystemExit("pass --stop or --stop-pct")
    if a.direction.upper() == "LONG" and not (a.stop < px < a.target):
        raise SystemExit(f"LONG needs stop < fill < target (fill {px:.2f})")
    if a.direction.upper() == "SHORT" and not (a.target < px < a.stop):
        raise SystemExit(f"SHORT needs target < fill < stop (fill {px:.2f})")
    st = _load(a.date)
    if st.get("position"):
        raise SystemExit("a position is already open")
    _advance(st, rows, idx, idx)  # no-op, keeps state consistent
    st["position"] = {
        "opt": a.opt.upper(), "strike": float(a.strike),
        "direction": a.direction.upper(), "lots": a.lots, "qty": a.lots * LOT,
        "entry_time": fill_row["t"], "entry_premium": px,
        "entry_spot": fill_row["spot"], "stop": float(a.stop),
        "target": float(a.target), "best": px, "reason": a.reason,
        "trail_arm": float(getattr(a, "trail_arm", TRAIL_ARM)),
        "trail_pct": float(getattr(a, "trail_pct", TRAIL_PCT)),
        "fill_index": idx + 1,
    }
    _save(st)
    print(f"FILLED {a.direction.upper()} {a.opt.upper()} {a.strike:.0f} @ {px:.2f} "
          f"x{a.lots*LOT} at {fill_row['t'][11:19]} | stop {a.stop} target {a.target}")
    return 0


def cmd_mark(a) -> int:
    rows = _rows(a.date)
    idx, _ = _at(rows, a.at)
    st = _load(a.date)
    p = st.get("position")
    if not p:
        print("flat")
        return 0
    _advance(st, rows, p.get("fill_index", idx), idx)
    _save(st)
    if st.get("position"):
        r = rows[idx]
        px = _px(r, p["strike"], p["opt"])
        pnl = (px - p["entry_premium"]) * p["qty"] * (-1 if p["direction"] == "SHORT" else 1)
        print(f"MARK {px:.2f} P&L {pnl:+,.0f} stop {p['stop']:.2f} tgt {p['target']:.2f}")
    else:
        print(f"CLOSED | realized {st['realized']:+,.0f}")
    return 0


def cmd_exit(a) -> int:
    rows = _rows(a.date)
    idx, _ = _at(rows, a.at)
    st = _load(a.date)
    p = st.get("position")
    if not p:
        print("flat")
        return 0
    _advance(st, rows, p.get("fill_index", idx), idx)
    if st.get("position"):
        fill_row = rows[min(idx + 1, len(rows) - 1)]
        px = _px(fill_row, p["strike"], p["opt"])
        _close(st, p, px, fill_row["t"], a.reason or "AGENT_EXIT")
    _save(st)
    print(f"CLOSED | realized {st['realized']:+,.0f}")
    return 0


def cmd_note(a) -> int:
    st = _load(a.date)
    st.setdefault("notes", []).append({"at": a.at, "text": a.text})
    _save(st)
    print("noted")
    return 0


def cmd_status(a) -> int:
    st = _load(a.date)
    print(f"{a.date} realized {st['realized']:+,.0f}  trades {len(st['trades'])}")
    for t in st["trades"]:
        print(f"  {t['direction']:5s} {t['opt']} {t['strike']:,.0f} "
              f"{t['entry_premium']:.2f}->{t['exit_premium']:.2f} "
              f"net {t['net']:+,.0f}  {t['reason']}")
    if st.get("position"):
        print(f"  OPEN {st['position']}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("card", "enter", "mark", "exit", "status", "next", "note"):
        s = sub.add_parser(name)
        s.add_argument("--date", required=True)
        if name in ("card", "enter", "mark", "exit", "note"):
            s.add_argument("--at", required=True)
        if name == "next":
            s.add_argument("--start", default="")
        if name == "note":
            s.add_argument("--text", required=True)
        if name == "enter":
            s.add_argument("--opt", required=True, choices=["CE", "PE"])
            s.add_argument("--strike", type=float, required=True)
            s.add_argument("--direction", default="LONG", choices=["LONG", "SHORT"])
            s.add_argument("--lots", type=int, default=1)
            s.add_argument("--stop", type=float, default=0.0)
            s.add_argument("--stop-pct", type=float, default=0.0)
            s.add_argument("--target", type=float, required=True)
            s.add_argument("--trail-arm", type=float, default=TRAIL_ARM)
            s.add_argument("--trail-pct", type=float, default=TRAIL_PCT)
            s.add_argument("--reason", default="")
        if name == "exit":
            s.add_argument("--reason", default="")
    a = ap.parse_args(argv)
    return {"card": cmd_card, "enter": cmd_enter, "mark": cmd_mark,
            "exit": cmd_exit, "status": cmd_status, "next": cmd_next,
            "note": cmd_note}[a.cmd](a)


if __name__ == "__main__":
    raise SystemExit(main())
