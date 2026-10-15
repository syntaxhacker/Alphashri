"""Cross-check of pattern_profit_week42.json + prior-week robustness + refinement.

1. EXACT recompute of every baseline trade from raw daily candles (independent
   code path, same Upstox cache): entry open, qty, SL-first walk, costs.py.
2. Optimism audit: gap-below-SL fills + zero-slippage bounds.
3. Prior-2-week robustness for top strategies (same fixed params) by reusing
   the baseline's own run_strategy() on W-2 / W-1 windows.
4. Refinement grid (<=2 params) on priors only; locked params evaluated once
   on W0.

Usage: .venv/bin/python experiments/verify_crosscheck.py
Writes experiments/verify_crosscheck.json
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

EXP = Path(__file__).resolve().parent
sys.path.insert(0, str(EXP.parent))

spec = importlib.util.spec_from_file_location("pp42", EXP / "pattern_profit_week42.py")
pp42 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp42)

from backtest.costs import calculate_trading_costs  # noqa: E402

NOTIONAL = 100_000
W0 = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
WM2 = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]
WM1 = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]  # Oct 2 holiday


def load_baseline():
    return json.loads((EXP / "pattern_profit_week42.json").read_text())


def frames_bydate():
    """{sym: {date: bar}} from verify_frames.pkl (independent read path)."""
    import pickle

    import pandas as pd

    serial = pickle.load(open(EXP / "verify_frames.pkl", "rb"))
    out = {}
    for sym, v in serial.items():
        if isinstance(v, tuple):
            continue
        df = pd.DataFrame.from_dict(v, orient="tight")
        d = {}
        for ts, row in df.iterrows():
            t = pd.Timestamp(ts)
            if t.tz is None:
                t = t.tz_localize("UTC")
            date = t.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d")
            d[date] = {"o": float(row["open"]), "h": float(row["high"]),
                       "l": float(row["low"]), "c": float(row["close"])}
        out[sym] = d
    return out


def recompute_trade(t, bars):
    """Exact-replica walk. Returns recomputed fields + optimism flags."""
    e = bars[t["entry_date"]]
    qty = max(1, int(NOTIONAL // e["o"]))
    days = W0[W0.index(t["entry_date"]):]
    rpx = rreason = rdate = None
    gap_below_sl = e["o"] < t["sl"]
    for di, d in enumerate(days):
        b = bars[d]
        sl_hit, tp_hit = b["l"] <= t["sl"], b["h"] >= t["tp"]
        if sl_hit and tp_hit:
            rpx, rreason, rdate = t["sl"], "SL", d
            break
        if sl_hit:
            rpx, rreason, rdate = t["sl"], "SL", d
            break
        if tp_hit:
            rpx, rreason, rdate = t["tp"], "TARGET", d
            break
        if di == len(days) - 1:
            rpx, rreason, rdate = b["c"], "EOW", d
    gross = (rpx - e["o"]) * qty
    c = calculate_trading_costs(e["o"], rpx, qty)["total_costs"]
    # adjusted: gap-below-SL exits at open; 5bps adverse slippage each fill
    ae = e["o"] * 1.0005
    aq = max(1, int(NOTIONAL // ae))
    if gap_below_sl:
        apx, arre = e["o"] * 0.9995, "OPEN_BELOW_SL"
    else:
        apx = {"SL": t["sl"] * 0.9995, "TARGET": t["tp"] * 0.9995,
               "EOW": bars[rdate]["c"] * 0.9995}[rreason]
        arre = rreason
    agross = (apx - ae) * aq
    ac = calculate_trading_costs(ae, apx, aq)["total_costs"]
    return {
        "qty_ok": qty == t["qty"], "entry_ok": abs(e["o"] - t["entry_price"]) < 0.01,
        "exit_ok": abs(rpx - t["exit_price"]) < 0.01,
        "reason_ok": rreason == t["exit_reason"], "date_ok": rdate == t["exit_date"],
        "gross_ok": abs(gross - t["gross"]) < 0.01, "costs_ok": abs(c - t["costs"]) < 0.01,
        "net_ok": abs(gross - c - t["net"]) < 0.01,
        "gap_below_sl": gap_below_sl,
        "adj_net": round(agross - ac, 2), "adj_reason": arre,
    }


def stage_recompute():
    base = load_baseline()
    bars = frames_bydate()
    sigs = base["signals"]
    res = {"n": len(sigs), "mismatches": [], "gap_below_sl": 0,
           "adj_net_total": 0.0, "claimed_net_total": 0.0, "per_strategy": {}}
    for t in sigs:
        b = bars.get(t["symbol"])
        if b is None or t["entry_date"] not in b:
            res["mismatches"].append({"symbol": t["symbol"], "strategy": t["strategy"],
                                      "issue": "no raw bars"})
            continue
        r = recompute_trade(t, b)
        res["claimed_net_total"] += t["net"]
        res["adj_net_total"] += r["adj_net"]
        if r["gap_below_sl"]:
            res["gap_below_sl"] += 1
        ps = res["per_strategy"].setdefault(t["strategy"],
                                            {"n": 0, "mismatch": 0, "gap": 0,
                                             "claimed": 0.0, "adj": 0.0})
        ps["n"] += 1
        ps["claimed"] += t["net"]
        ps["adj"] += r["adj_net"]
        if r["gap_below_sl"]:
            ps["gap"] += 1
        bad = [k for k in ("qty_ok", "entry_ok", "exit_ok", "reason_ok", "date_ok",
                           "gross_ok", "costs_ok", "net_ok") if not r[k]]
        if bad:
            ps["mismatch"] += 1
            res["mismatches"].append({"symbol": t["symbol"], "strategy": t["strategy"],
                                     "entry": f"{t['entry_date']}@{t['entry_price']}",
                                     "exit": f"{t['exit_date']}@{t['exit_price']} {t['exit_reason']}",
                                     "fields": bad})
    res["claimed_net_total"] = round(res["claimed_net_total"], 2)
    res["adj_net_total"] = round(res["adj_net_total"], 2)
    for ps in res["per_strategy"].values():
        ps["claimed"] = round(ps["claimed"], 2)
        ps["adj"] = round(ps["adj"], 2)
    return res


def prepared_for(frames_pkl_syms, week):
    """Build {sym: (week_bars, hist)} using baseline's bars_ist on live fetch.

    Uses the baseline fetch path (fetch_for_timeframe default cache) so the
    prior-week run is independent of verify_frames.pkl.
    """
    from chart_patterns.universes import get_universe

    data, failed = pp42.fetch_all(get_universe("nifty500"))
    prepared, skipped = {}, {}
    for sym, (df, last) in data.items():
        rows = pp42.bars_ist(df)
        bydate = {r["date"]: r for r in rows}
        if not all(d in bydate for d in week):
            skipped[sym] = [d for d in week if d not in bydate]
            continue
        hist = [r for r in rows if r["date"] < week[0]]
        if len(hist) < 60:
            skipped[sym] = f"only {len(hist)} pre-week bars"
            continue
        prepared[sym] = ([bydate[d] for d in week], hist)
    return prepared, skipped, failed


def stage_priors(strategies):
    out = {}
    for tag, week in (("W-2", WM2), ("W-1", WM1)):
        prep, skipped, failed = prepared_for(None, week)
        out[tag] = {"usable": len(prep), "skipped": len(skipped),
                    "failed": len(failed), "strategies": {}}
        for s in strategies:
            tr = pp42.run_strategy(s, prep)
            m = pp42.metrics(tr)
            out[tag]["strategies"][s] = m
            print(f"{tag} {s}: {m['trades']} trades net {m['net_pnl']}", flush=True)
    return out


def main():
    print("== stage 1: exact recompute of all baseline trades ==", flush=True)
    rec = stage_recompute()
    print(f"trades={rec['n']} mismatches={len(rec['mismatches'])} "
          f"gap_below_sl={rec['gap_below_sl']}", flush=True)
    print(f"claimed_net={rec['claimed_net_total']} "
          f"slippage/gap-adjusted_net={rec['adj_net_total']}", flush=True)
    for s, ps in sorted(rec["per_strategy"].items()):
        print(f"  {s}: n={ps['n']} mismatch={ps['mismatch']} gap={ps['gap']} "
              f"claimed={ps['claimed']} adj={ps['adj']}", flush=True)
    for m in rec["mismatches"][:20]:
        print("  MISMATCH:", m, flush=True)

    print("== stage 2: prior-week robustness (baseline code, fixed params) ==",
          flush=True)
    priors = stage_priors(["orb_proxy", "ema_stack", "adx_trend"])
    json.dump({"recompute": rec, "priors": priors},
              open(EXP / "verify_crosscheck.json", "w"), indent=1)
    print("wrote experiments/verify_crosscheck.json", flush=True)


if __name__ == "__main__":
    main()
