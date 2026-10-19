#!/usr/bin/env python3
"""One-minute situation check for the agent options desk.

Prints, for a session: spot/ATM premiums, ATM greeks and their 5-minute CHANGE,
GEX/positioning/regime, the 30-min TWAP (VWAP proxy — the index feed has no
volume), the expansion gauge (5-min range vs session median), day-low/high room,
a mechanical SETUP flag, the full strike scan (5-min movers + most active), the
OI walls and their 20-minute change, and P&L (realized + open, coded + mine).

Read-only. It never trades and never writes.

Usage
-----
    python scripts/agent_options_check.py                 # today
    python scripts/agent_options_check.py --date 2026-10-20
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import sqlite3
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

TAPE_DIR = ROOT / "experiments" / "data" / "nifty_tape"
SNAP_DIR = ROOT / "experiments" / "data" / "nifty_snapshots"
LEDGER = ROOT / "options_paper" / "journal" / "agent_positions.json"
LOG = ROOT / "logs" / "agent_options.log"

# Trade ids that must be excluded from every P&L view. Id 3129 (a short straddle
# the pre-fix loop mis-marked as a long, force-closed for -3,059) was deleted from
# the DB on 2026-10-20, so this is a no-op today; the tuple is retained only in
# case a replay re-creates it.
EXCLUDED_TRADE_IDS = (3129,)


def _tail(path: pathlib.Path, n: int, back: int) -> list:
    """Last ``n`` JSON rows without reading the whole file (snapshots are 25 MB+)."""
    if not path.exists():
        return []
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - back))
        data = f.read().decode("utf-8", "ignore")
    out = []
    for line in data.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out[-n:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=dt.date.today().isoformat())
    a = ap.parse_args()

    now = dt.datetime.now().astimezone()
    trows = _tail(TAPE_DIR / f"{a.date}.jsonl", 80, 900_000)
    if not trows:
        print(f"FAIL: no tape for {a.date}"); return 2
    tl = trows[-1]
    ta = (now - dt.datetime.fromisoformat(tl["t"])).total_seconds()

    srows = _tail(SNAP_DIR / f"{a.date}.jsonl", 6, 4_000_000)
    sl = srows[-1] if srows else {}
    rep = sl.get("report") or {}
    sa = (now - dt.datetime.fromisoformat(sl["t"])).total_seconds() if sl else 9e9

    src = f"local(tape {ta:.0f}s/snap {sa:.0f}s)"
    if ta > 180 or sa > 300 or not rep.get("strikes"):
        try:
            with urllib.request.urlopen(
                    "http://localhost:8765/api/reports/nifty/live", timeout=45) as r:
                rep = json.load(r)
            src = f"live-api(tape {ta:.0f}s)"
        except Exception as e:
            src = f"stale(tape {ta:.0f}s):{type(e).__name__}"
    if ta > 300 and a.date == dt.date.today().isoformat():
        print(f"FAIL: TAPE stale {ta:.0f}s — recorder/host problem"); return 2

    spot = tl["spot"] if ta <= 180 else (rep.get("spot") or tl["spot"])
    ch = tl.get("chain") or {}
    atm = tl.get("atm_strike") or round(spot / 50) * 50
    ce, pe = tl.get("atm_ce_ltp"), tl.get("atm_pe_ltp")
    st = rep.get("strikes") or []
    k = min(st, key=lambda x: abs((x.get("strike") or 0) - spot)) if st else {}
    c = k.get("ce") or {}
    gex = rep.get("gex") or {}
    pos = rep.get("positioning") or {}
    ctl = rep.get("control") or {}
    reg = rep.get("regime") or {}
    stg = rep.get("strength") or {}

    print(f"[{now:%H:%M:%S}] spot={spot:.1f} ATM={atm:.0f} CE={ce} PE={pe} "
          f"straddle={(ce or 0) + (pe or 0):.1f} | {src}")
    print(f"   greeks K{k.get('strike')}: d={c.get('delta')} g={c.get('gamma')} "
          f"th={c.get('theta')} v={c.get('vega')} iv={c.get('iv')} pop={c.get('pop')}")
    print(f"   GEX={gex.get('net_total')}({gex.get('regime')}) flip={gex.get('zero_cross')} | "
          f"pos={pos.get('verdict')} | {ctl.get('verdict')} skew={ctl.get('skew')} | "
          f"{reg.get('verdict')} RV={reg.get('rv')}/IV={reg.get('iv')} | rsi={stg.get('rsi')}")

    intr = rep.get("intraday") or []
    twap = (sum((x["high"] + x["low"] + x["close"]) / 3 for x in intr) / len(intr)) if intr else 0
    recent = intr[-30:] if len(intr) >= 30 else intr
    twap30 = (sum((x["high"] + x["low"] + x["close"]) / 3 for x in recent) / len(recent)) if recent else twap
    e9, e20, e50 = stg.get("ema9"), stg.get("ema20"), stg.get("ema50")
    trend = "n/a"
    if e9 and e20 and e50:
        trend = ("bearish" if spot < e9 < e20 < e50
                 else "bullish" if spot > e9 > e20 > e50 else "mixed")
    print(f"   trend: spot={spot:.1f} ema9={e9} ema20={e20} ema50={e50} -> {trend}")

    sp = [r.get("spot") or 0 for r in trows]
    d5 = spot - sp[-6] if len(sp) >= 6 else 0.0
    d10 = spot - (sp[-11] if len(sp) >= 11 else sp[-6] if len(sp) >= 6 else spot)
    gate = "BREAK-DOWN" if (spot < atm and d5 <= -15) else \
           "BREAK-UP" if (spot > atm and d5 >= 15) else \
           "FAST" if abs(d5) >= 25 else "moving" if abs(d5) >= 12 else "SIDEWAYS"
    print(f"   momentum: 5m {d5:+.1f} | 10m {d10:+.1f} -> {gate}")

    above_avg = spot > twap30 if twap30 else False
    print(f"   avg line (30-min TWAP proxy for VWAP): {twap30:.1f} -> "
          f"spot {'ABOVE' if above_avg else 'BELOW'}")
    print(f"   ATM IV (tape): CE {tl.get('atm_ce_iv')} PE {tl.get('atm_pe_iv')}")

    if srows and len(srows) >= 6:
        def _atm(rp):
            s = rp.get("strikes") or []
            spt = rp.get("spot") or 0
            kk = min(s, key=lambda x: abs((x.get("strike") or 0) - spt)) if s else {}
            return kk.get("ce") or {}
        gn, go = _atm(rep), _atm((srows[-6].get("report") or {}))
        chg = [f"{g} {gn[g] - go[g]:+.3f}" for g in ("delta", "gamma", "theta", "vega", "iv")
               if gn.get(g) is not None and go.get(g) is not None]
        if chg:
            print("   greeks Δ5m (ATM CE): " + " | ".join(chg))
    print(f"   moneyness/pop: K{k.get('strike')} vs spot {spot:.0f} "
          f"(d={c.get('delta')}, pop={c.get('pop')}%)")

    expanding = False
    if len(sp) >= 8:
        r5 = max(sp[-5:]) - min(sp[-5:])
        wins = [max(sp[i:i + 5]) - min(sp[i:i + 5]) for i in range(len(sp) - 5)]
        med5 = sorted(wins)[len(wins) // 2] if wins else 0
        exp = (r5 / med5) if med5 else 0
        expanding = exp >= 1.2
        print(f"   expansion: 5m range {r5:.0f} vs median {med5:.0f} -> x{exp:.1f} "
              f"({'EXPANDING' if expanding else 'quiet'})")

    lo, hi = min(sp), max(sp)
    rd, ru = spot - lo, hi - spot
    print(f"   room: session low {lo:.0f} ({rd:+.0f}) | session high {hi:.0f} ({ru:+.0f})")
    setup = "WAIT"
    if expanding and above_avg and d5 >= 20 and abs(d10) <= 40 and ru >= 30:
        setup = "CE-OK (above avg + fresh + expanding + room)"
    elif expanding and (not above_avg) and d5 <= -20 and abs(d10) <= 40 and rd >= 30:
        setup = "PE-OK (below avg + fresh + expanding + room)"
    print(f"   SETUP: {setup}")

    if ch and len(trows) >= 6:
        old = trows[-6].get("chain") or {}
        mv = []
        for kk in ch:
            o = old.get(kk)
            if not o:
                continue
            for leg, i in (("CE", 0), ("PE", 1)):
                x, y = o[i], ch[kk][i]
                if x and y and x > 1:
                    mv.append((abs(y / x - 1), kk, leg, x, y))
        mv.sort(reverse=True)
        print("   movers 5m: " + " | ".join(
            f"{m[1]}{m[2]} {m[3]:.1f}->{m[4]:.1f} ({(m[4]/m[3]-1)*100:+.0f}%)" for m in mv[:4]))
        act = sorted(((max((v[4] or 0), (v[5] or 0)), kk) for kk, v in ch.items()), reverse=True)
        print("   most active: " + " | ".join(f"{kk} {v/1e6:.0f}M" for v, kk in act[:4]))

    if ch:
        ks = sorted(int(x) for x in ch)
        ce_oi = {x: (ch[str(x)][2] or 0) for x in ks}
        pe_oi = {x: (ch[str(x)][3] or 0) for x in ks}
        sup = max((x for x in ks if x <= spot), key=lambda x: pe_oi[x], default=0)
        res = min((x for x in ks if x >= spot), key=lambda x: -ce_oi[x], default=0)
        print(f"   OI walls: support {sup} ({pe_oi.get(sup, 0)/1e6:.1f}M, {spot-sup:+.0f}) | "
              f"resistance {res} ({ce_oi.get(res, 0)/1e6:.1f}M, {res-spot:+.0f}) | "
              f"max_pain={rep.get('max_pain')}")

    try:
        import config
        db = pathlib.Path(getattr(config, "LOCAL_DB_PATH", "db/alphashri.db"))
        if not db.is_absolute():
            db = pathlib.Path(getattr(config, "BASE_DIR", ROOT)) / db
    except Exception:
        db = ROOT / "db" / "alphashri.db"
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    _ph = ",".join("?" for _ in EXCLUDED_TRADE_IDS)
    tot, cost = con.execute(
        "select coalesce(sum(net_pnl),0), coalesce(sum(costs),0) from trades "
        "where date(entry_time)=? and source like 'options_paper%' "
        f"and id not in ({_ph})",
        (a.date, *EXCLUDED_TRADE_IDS)).fetchone()
    con.close()
    print(f"   P&L options: realized ₹{tot:+,.0f} | costs ₹{cost:,.0f}")

    my_pnl = 0.0
    if LEDGER.exists():
        for m in json.loads(LEDGER.read_text()).get("positions", []):
            row = ch.get(str(int(m["strike"]))) if ch else None
            if row:
                mark = (row[0] or 0) + (row[1] or 0) if m["opt"] == "STRADDLE" else \
                       (row[0] if m["opt"] == "CE" else row[1])
            else:
                mark = m["entry_premium"]
            mark = mark or m["entry_premium"]
            sgn = -1 if (m.get("direction") or "LONG").upper() == "SHORT" else 1
            my_pnl += (mark - m["entry_premium"]) * m["qty"] * sgn
            print(f"   mine: {m.get('direction','LONG')} {m['opt']} {m['strike']:.0f} "
                  f"@{m['entry_premium']:.2f} -> {mark:.2f} "
                  f"(₹{(mark - m['entry_premium']) * m['qty'] * sgn:+,.0f}) "
                  f"| stop {m['stop']:.2f} tgt {m['target']:.2f} | tag={m.get('tag','')}")

    coded, detail = 0.0, "-"
    if LOG.exists():
        lines = [l for l in LOG.read_text().splitlines() if "open=" in l]
        if lines:
            m2 = re.search(r"open=(\d+) \[(.*?)\]", lines[-1])
            if m2 and m2.group(1) != "0":
                detail = m2.group(2)
                coded = float(sum(int(x) for x in re.findall(r"MTM ([+-]?\d+)", lines[-1])))
    print(f"   coded open: {detail}")
    print(f"   OPEN P&L: coded ₹{coded:+,.0f} | mine ₹{my_pnl:+,.0f} | total ₹{coded + my_pnl:+,.0f}"
          f" | realized ₹{tot:+,.0f} | ALL-IN ₹{tot + coded + my_pnl:+,.0f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
