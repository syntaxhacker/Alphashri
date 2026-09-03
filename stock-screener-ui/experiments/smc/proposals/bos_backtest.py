"""BOS-BREAK entry backtest — standalone READ-ONLY analysis (does not touch trading/smc_ifvg.py).

Mirrors the engine's structure discovery EXACTLY (SMCIFVGEngine.on_close order):
  - 3-bar fractal pivots (2 bars each side, strict), confirmed at bar i for pivot bar j=i-2
  - BOS: 1m close beyond last unbroken pivot -> bos_dir, pivot marked broken
  - FVG detection (gap > gap_min) — tracked ONLY so TP selection sees the same
    liquidity pool as the engine's find_tp.

Differs from the engine ONLY in the entry trigger:
  - ENGINE: enters on FVG/iFVG inversions + retests with BOS bias.
  - HERE:   enters ON the BOS break itself — at the 1m close that breaks the last
             fractal swing, fill at the first tick of the next 1m bar.

Entry / SL / TP rules (frozen for this study):
  - ENTRY: side = bos_dir at the breaking bar's close; fill at first tick of bar i+1
           (LONG at ask, SHORT at bid). Cancel if that tick already gaps past SL.
  - SL:    just beyond the broken level +- 6 pts buffer:
             LONG  (broke piv_high P): SL = P - 6
             SHORT (broke piv_low  P): SL = P + 6
  - TP:    nearest untouched opposing liquidity (3-bar fractal pivot OR active
           non-inverted FVG edge, untouched across full history up to the fill bar)
           with |entry - TP| / risk >= 3.0, else SKIP the signal entirely (no trail,
           no structure-trail fallback).
  - RISK gate: skip if |fill - SL| < 5.0 (same min_risk as engine).
  - Management: one position at a time; BOS signals while in position are ignored;
    3-bar cooldown after each exit (same as engine default). SL-first on ambiguous
    ticks; LONG exits at bid, SHORT SL at ask / TP at bid (engine convention).
    Positions still open at session end are EXCLUDED (engine convention — run()
    only returns closed trades); counted as open_eod.

Overlap: the same sessions are also run through SMCIFVGEngine(entries="inv") and
matched by side + overlapping [t_in, t_out] windows.

Usage (from stock-screener-ui/):
  source .venv/bin/activate && python experiments/smc/proposals/bos_backtest.py
"""

import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from scripts.smc_tick_eval import fetch_ticks, build_1m_bars  # noqa: E402
from trading.smc_ifvg import SMCIFVGEngine  # noqa: E402  (read-only import for INV baseline)

SESSIONS = ["2026-07-02", "2026-07-10", "2026-07-22", "2026-07-24", "2026-08-26", "2026-09-02"]

GAP_MIN = 2.0
SL_BUF = 6.0
MIN_RR = 3.0
MIN_RISK = 5.0
COOLDOWN = 3


def find_tp_near(bars, fvgs, i, side, entry, risk):
    """Nearest untouched opposing liquidity with RR >= MIN_RR, else None.

    Exact copy of SMCIFVGEngine.find_tp with tp_mode="near".
    """
    cands = []
    for j in range(2, i - 2):
        w = bars[j - 2:j + 3]
        if side == "SHORT":
            if not all(w[2]["low"] < w[k]["low"] for k in (0, 1, 3, 4)):
                continue
            lvl = w[2]["low"]
            if lvl < entry and all(bars[k]["low"] > lvl for k in range(j + 3, i)):
                cands.append(lvl)
        else:
            if not all(w[2]["high"] > w[k]["high"] for k in (0, 1, 3, 4)):
                continue
            lvl = w[2]["high"]
            if lvl > entry and all(bars[k]["high"] < lvl for k in range(j + 3, i)):
                cands.append(lvl)
    for f in fvgs:
        if f["inv"] or f["form"] + 3 >= i:
            continue
        if side == "SHORT" and f["type"] == "bull" and f["top"] < entry:
            if all(bars[k]["low"] > f["top"] for k in range(f["form"] + 3, i)):
                cands.append(f["top"])
        elif side == "LONG" and f["type"] == "bear" and f["bot"] > entry:
            if all(bars[k]["high"] < f["bot"] for k in range(f["form"] + 3, i)):
                cands.append(f["bot"])
    ok = [c for c in cands if abs(entry - c) / risk >= MIN_RR]
    if not ok:
        return None
    return min(ok, key=lambda c: abs(entry - c))


def run_bos(bars, ticks):
    """BOS-break entries over one session. Returns (trades, diag)."""
    by_min = defaultdict(list)
    for t in ticks:
        by_min[int(t["timestamp"] // 1000 // 60) * 60].append(t)

    piv_high = piv_low = None
    piv_high_broken = piv_low_broken = False
    fvgs = []
    pos = None
    last_exit = -999
    trades = []
    diag = {"signals": 0, "skip_no_tp": 0, "skip_risk": 0, "skip_gap": 0,
            "skip_busy": 0, "skip_cool": 0, "open_eod": 0}
    signals_log = []

    def close_pos(i, px, why, ts_ms):
        nonlocal pos, last_exit
        p = pos
        leg = (px - p["entry"]) if p["side"] == "LONG" else (p["entry"] - px)
        trades.append({"t_in": p["ts"], "t_out": ts_ms, "side": p["side"],
                       "entry": p["entry"], "sl": p["sl"], "tp": p["tp"],
                       "exit": px, "result": why, "pnl": round(leg, 2),
                       "rr": round(leg / p["risk"], 2),
                       "bos_level": p["bos_level"], "sig_bar": p["sig_bar"]})
        pos = None
        last_exit = i

    for i, b in enumerate(bars):
        bt = by_min.get(b["time"], [])

        # --- position management: SL first, then TP (engine convention) ---
        if pos:
            p = pos
            for t in bt:
                bid, ask = t["bidPrice"], t["askPrice"]
                if p["side"] == "SHORT":
                    if ask >= p["sl"]:
                        close_pos(i, p["sl"], "SL", t["timestamp"])
                        break
                    if p["tp"] is not None and bid <= p["tp"]:
                        close_pos(i, p["tp"], "TP", t["timestamp"])
                        break
                else:
                    if bid <= p["sl"]:
                        close_pos(i, p["sl"], "SL", t["timestamp"])
                        break
                    if p["tp"] is not None and ask >= p["tp"]:
                        close_pos(i, p["tp"], "TP", t["timestamp"])
                        break

        # --- bar-close structure update (EXACT engine order) ---
        bos = 0
        bos_level = None
        if i >= 4:
            j = i - 2
            w = bars[j - 2:j + 3]
            if all(w[2]["high"] > w[k]["high"] for k in (0, 1, 3, 4)):
                piv_high = w[2]["high"]
                piv_high_broken = False
            if all(w[2]["low"] < w[k]["low"] for k in (0, 1, 3, 4)):
                piv_low = w[2]["low"]
                piv_low_broken = False
        if piv_high is not None and not piv_high_broken and b["close"] > piv_high:
            bos, bos_level = 1, piv_high
            piv_high_broken = True
        if piv_low is not None and not piv_low_broken and b["close"] < piv_low:
            bos, bos_level = -1, piv_low
            piv_low_broken = True
        if i >= 2:
            a, c = bars[i - 2], bars[i]
            if c["high"] < a["low"] and a["low"] - c["high"] > GAP_MIN:
                fvgs.append({"type": "bear", "top": a["low"], "bot": c["high"],
                             "form": i, "inv": False})
            if c["low"] > a["high"] and c["low"] - a["high"] > GAP_MIN:
                fvgs.append({"type": "bull", "top": c["low"], "bot": a["high"],
                             "form": i, "inv": False})

        # --- BOS-break entry: enter ON the break, fill first tick of bar i+1 ---
        if bos != 0:
            diag["signals"] += 1
            side = "LONG" if bos == 1 else "SHORT"
            sl = bos_level - SL_BUF if side == "LONG" else bos_level + SL_BUF
            if pos is not None:
                diag["skip_busy"] += 1
            elif i - last_exit < COOLDOWN:
                diag["skip_cool"] += 1
            elif i + 1 < len(bars):
                nxt = by_min.get(bars[i + 1]["time"], [])
                if not nxt:
                    diag["skip_gap"] += 1
                else:
                    t0 = nxt[0]
                    fill = t0["askPrice"] if side == "LONG" else t0["bidPrice"]
                    if (side == "SHORT" and fill > sl) or (side == "LONG" and fill < sl):
                        diag["skip_gap"] += 1  # gapped past SL before fill
                    else:
                        risk = abs(fill - sl)
                        if risk < MIN_RISK:
                            diag["skip_risk"] += 1
                        else:
                            tp = find_tp_near(bars, fvgs, i + 1, side, fill, risk)
                            if tp is None:
                                diag["skip_no_tp"] += 1
                            else:
                                pos = {"side": side, "entry": fill, "sl": sl, "tp": tp,
                                       "risk": risk, "ts": t0["timestamp"],
                                       "bos_level": bos_level, "sig_bar": b["time"]}
                            signals_log.append({"bar": b["time"], "side": side,
                                                "bos_level": bos_level, "fill": fill,
                                                "sl": sl, "tp": tp,
                                                "taken": pos is not None and
                                                pos["ts"] == t0["timestamp"]})
    if pos is not None:
        diag["open_eod"] += 1  # engine convention: unclosed EOD positions excluded
    return trades, diag, signals_log


def stats(trades):
    gp = sum(t["pnl"] for t in trades if t["pnl"] > 0)
    gl = abs(sum(t["pnl"] for t in trades if t["pnl"] <= 0))
    n = len(trades)
    w = sum(1 for t in trades if t["pnl"] > 0)
    pf = gp / gl if gl else (99.0 if gp > 0 else 0.0)
    net = round(gp - gl, 2)
    return {"n": n, "w": w, "net": net, "pf": round(pf, 3),
            "tp": sum(1 for t in trades if t["result"] == "TP"),
            "sl": sum(1 for t in trades if t["result"] == "SL")}


def overlap(bos_trades, inv_trades):
    """Match by same side + overlapping [t_in, t_out]. Returns dict of counts/lists."""
    inv_used = set()
    pairs = []       # (bos, inv, earlier)
    bos_only = []
    for bt in bos_trades:
        best = None
        for k, it in enumerate(inv_trades):
            if k in inv_used or it["side"] != bt["side"]:
                continue
            if bt["t_in"] <= it["t_out"] and it["t_in"] <= bt["t_out"]:
                if best is None or abs(it["t_in"] - bt["t_in"]) < abs(best[1]["t_in"] - bt["t_in"]):
                    best = (k, it)
        if best is None:
            bos_only.append(bt)
        else:
            inv_used.add(best[0])
            it = best[1]
            earlier = "BOS" if bt["t_in"] < it["t_in"] - 60_000 else (
                "INV" if it["t_in"] < bt["t_in"] - 60_000 else "SAME")
            pairs.append((bt, it, earlier))
    inv_only = [it for k, it in enumerate(inv_trades) if k not in inv_used]
    return {"pairs": pairs, "bos_only": bos_only, "inv_only": inv_only}


def fmt_ts(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%m-%d %H:%M")


def main():
    all_bos, all_inv = [], []
    print(f"{'session':<12}{'BOS n':>6}{'BOS net':>10}{'BOS PF':>8} | "
          f"{'INV n':>6}{'INV net':>10}{'INV PF':>8}")
    per_session = []
    for d in SESSIONS:
        ticks = fetch_ticks(d)
        bars = build_1m_bars(ticks)
        bos_trades, diag, _ = run_bos(bars, ticks)
        inv_trades = SMCIFVGEngine(entries="inv").run(bars, ticks)
        sb, si = stats(bos_trades), stats(inv_trades)
        print(f"{d:<12}{sb['n']:>6}{sb['net']:>+10.2f}{sb['pf']:>8.2f} | "
              f"{si['n']:>6}{si['net']:>+10.2f}{si['pf']:>8.2f}   "
              f"BOS W{sb['w']}/{sb['n']} TP{sb['tp']} SL{sb['sl']} "
              f"skip_noTP{diag['skip_no_tp']} skip_busy{diag['skip_busy']} "
              f"skip_cool{diag['skip_cool']} openEOD{diag['open_eod']}")
        for t in bos_trades:
            print(f"    BOS {fmt_ts(t['t_in'])} {t['side']:<5} in {t['entry']:>9.2f} "
                  f"SL {t['sl']:>9.2f} TP {t['tp']:>9.2f} -> {t['result']:<3} "
                  f"{t['pnl']:+8.2f} ({t['rr']:+.2f}R) lvl {t['bos_level']:.2f}")
        per_session.append((d, bos_trades, inv_trades, diag))
        all_bos.extend(bos_trades)
        all_inv.extend(inv_trades)

    sb, si = stats(all_bos), stats(all_inv)
    print(f"\nTOTAL  BOS: n={sb['n']} W={sb['w']} TP={sb['tp']} SL={sb['sl']} "
          f"net={sb['net']:+.2f} PF={sb['pf']:.2f}")
    print(f"TOTAL  INV: n={si['n']} W={si['w']} TP={si['tp']} SL={si['sl']} "
          f"net={si['net']:+.2f} PF={si['pf']:.2f}")

    ov = overlap(all_bos, all_inv)
    e = {"BOS": 0, "INV": 0, "SAME": 0}
    for _, _, who in ov["pairs"]:
        e[who] += 1
    print(f"\nOVERLAP: {len(ov['pairs'])} matched pairs "
          f"(BOS-first={e['BOS']} INV-first={e['INV']} same={e['SAME']}), "
          f"BOS-only={len(ov['bos_only'])} INV-only={len(ov['inv_only'])}")
    for bt, it, who in ov["pairs"]:
        print(f"  pair {who:<3} BOS {fmt_ts(bt['t_in'])} {bt['side']:<5} "
              f"{bt['pnl']:+8.2f} ({bt['result']})  vs "
              f"INV {fmt_ts(it['t_in'])} {it['pnl']:+8.2f} ({it['result']})")
    for bt in ov["bos_only"]:
        print(f"  BOS-only {fmt_ts(bt['t_in'])} {bt['side']:<5} "
              f"{bt['pnl']:+8.2f} ({bt['result']}) lvl {bt['bos_level']:.2f}")
    for it in ov["inv_only"]:
        print(f"  INV-only {fmt_ts(it['t_in'])} {it['side']:<5} "
              f"{it['pnl']:+8.2f} ({it['result']}) kind={it['kind']}")


if __name__ == "__main__":
    main()
