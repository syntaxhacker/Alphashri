#!/usr/bin/env python3
"""Live desk card for the v3.11 wall rules. Run on demand — no background.

Prints the walls, OI/volume confirmation, max pain, GEX and the current
BREAK/FADE/WAIT signal with a copy-paste manual entry line.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "wall_replay"))
import batch  # noqa: E402


def walls(r):
    return ((r.get("walls") or {}).get("calls") or [],
            (r.get("walls") or {}).get("puts") or [])


def streak(rs, i, strike, side):
    n = 0
    for j in range(i, max(-1, i - 10), -1):
        c, p = walls(rs[j])
        arr = p if side == "put" else c
        if arr and arr[0]["strike"] == strike:
            n += 1
        else:
            break
    return n


def _fmt(x):
    if x is None:
        return "n/a"
    return f"{x/1e6:+.2f}M" if abs(x) >= 1e6 else f"{x/1e3:+.0f}k"


def main():
    today = datetime.now().strftime("%Y-%m-%d")
    dates = sorted(p.stem for p in batch.TAPE.glob("*.jsonl") if ".gaps" not in p.stem)
    date = today if today in dates else (max(dates) if dates else today)
    rs = batch.rows(date)
    if len(rs) < 6:
        print(f"{date}: no tape yet"); return 2
    i = len(rs) - 1
    r = rs[i]
    spot = float(r["spot"])
    calls, puts = walls(r)
    if not calls or not puts:
        print(f"{date} {r['t'][11:19]} spot {spot:,.1f} — no walls"); return 0
    sup, res = puts[0], calls[0]
    mp = float(r.get("max_pain") or 0)
    corridor = res["strike"] - sup["strike"]
    closes = [float(x["spot"]) for x in rs]
    a = batch.atr(closes)
    e9 = batch.ema(closes[-60:], 9)
    e20 = batch.ema(closes[-60:], 20)
    vw = sum(closes[-30:]) / min(30, len(closes))
    nxt_up = calls[1] if len(calls) > 1 else None
    nxt_dn = puts[1] if len(puts) > 1 else None
    prev = float(rs[i - 1]["spot"])

    print(f"{date} {r['t'][11:19]}  spot {spot:,.1f}  corridor {corridor:.0f}  ATR {a:.1f}")
    print(f"  put wall  {sup['strike']:,.0f} ({sup['oi']/1e6:.1f}M, 5m {_fmt(batch.oi5(rs, i, sup['strike'], 'PE'))})  "
          f"call wall {res['strike']:,.0f} ({res['oi']/1e6:.1f}M, 5m {_fmt(batch.oi5(rs, i, res['strike'], 'CE'))})")
    print(f"  max pain {mp:,.0f} ({mp - spot:+.0f})  GEX {r.get('net_gex')}  flip {r.get('flip')}  PCR {r.get('pcr_oi')}")
    print(f"  last closes {' / '.join(f'{c:,.1f}' for c in closes[-3:])}  EMA9 {e9:,.1f}  EMA20 {e20:,.1f}  VWAP30 {vw:,.1f}")

    sig = None
    # break up
    if prev < res["strike"] <= spot and spot - res["strike"] >= 1:
        d = batch.oi5(rs, i, res["strike"], "CE")
        v = batch.vol5(rs, i, res["strike"], "CE")
        vm = batch.vol_med(rs, i, res["strike"], "CE")
        room = nxt_up["strike"] - spot if nxt_up else 999
        if d is not None and abs(d) >= 100_000 and v is not None and vm and v >= vm and room >= 50:
            entry_strike = res["strike"] - 50
            px = batch.px(r, entry_strike, "CE")
            sig = ("BREAK UP", "CE", entry_strike, px, mp < spot - 5,
                   f"OI 5m {_fmt(d)} · vol {v/1e6:.2f}M >= med {vm/1e6:.2f}M · room {room:.0f}")
    # break down
    if sig is None and prev > sup["strike"] >= spot and sup["strike"] - spot >= 1:
        d = batch.oi5(rs, i, sup["strike"], "PE")
        v = batch.vol5(rs, i, sup["strike"], "PE")
        vm = batch.vol_med(rs, i, sup["strike"], "PE")
        room = spot - nxt_dn["strike"] if nxt_dn else 999
        if d is not None and abs(d) >= 100_000 and v is not None and vm and v >= vm and room >= 50:
            entry_strike = sup["strike"] + 50
            px = batch.px(r, entry_strike, "PE")
            sig = ("BREAK DOWN", "PE", entry_strike, px, mp > spot + 5,
                   f"OI 5m {_fmt(d)} · vol {v/1e6:.2f}M >= med {vm/1e6:.2f}M · room {room:.0f}")
    # fade put
    if sig is None and streak(rs, i, sup["strike"], "put") >= 3 and corridor >= 30 and mp - spot >= 20:
        if 0 <= spot - sup["strike"] <= max(5, 0.5 * a) and closes[-1] > closes[-2] > closes[-3]:
            entry_strike = sup["strike"] - 50
            px = batch.px(r, entry_strike, "CE")
            sig = ("FADE PUT", "CE", entry_strike, px, False,
                   f"wall {streak(rs, i, sup['strike'], 'put')} cards · higher low · room {mp - spot:.0f}")
    # fade call
    if sig is None and streak(rs, i, res["strike"], "call") >= 3 and corridor >= 30 and spot - mp >= 20:
        if 0 <= res["strike"] - spot <= max(5, 0.5 * a) and closes[-1] < closes[-2] < closes[-3]:
            entry_strike = res["strike"] + 50
            px = batch.px(r, entry_strike, "PE")
            sig = ("FADE CALL", "PE", entry_strike, px, False,
                   f"wall {streak(rs, i, res['strike'], 'call')} cards · lower high · room {spot - mp:.0f}")

    if sig is None:
        print("  SIGNAL: WAIT — no valid wall trade")
        return 0
    name, opt, strike, px, half, why = sig
    if px <= 0:
        print(f"  SIGNAL: {name} {opt} {strike:.0f} — strike not priced, skip")
        return 0
    stop = round(px * 0.85, 2)
    risk = px - stop
    target = round(px + 1.5 * risk, 2)
    print(f"  SIGNAL: {name} {opt} {strike:.0f} @ {px:.2f}  stop {stop:.2f}  target {target:.2f} (1.5R)")
    print(f"    {why}")
    if half:
        print("    MAX PAIN ON THE WRONG SIDE — skip at 1 lot / half size at 2+")
    print(f"    manual: enter --opt {opt} --strike {strike:.0f} --direction LONG --premium {px:.2f} "
          f"--stop {stop:.2f} --target {target:.2f} --lots 1 --trail-pct 0.10 --trail-arm 0.15 --hold-min 20")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
