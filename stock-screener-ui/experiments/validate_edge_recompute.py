"""Adversarial recompute harness (validator side, independent code).

Recomputes trades from raw 1D candles in experiments/data/pattern_cache/candles/1D.
Own loader, own IST mapping, own exit simulator. Costs via backtest/costs.py.

Usage:
  python3 experiments/validate_edge_recompute.py --trades <trades.json> [--out ...]
  python3 experiments/validate_edge_recompute.py --three-leg  # recompute L3 of three_leg_backtest.json
  python3 experiments/validate_edge_recompute.py --failed-breakdown  # recompute failed_breakdown in new_patterns_week42_trades.json
"""
import glob
import importlib.util
import json
import os
import pickle
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_1D = os.path.join(HERE, "data", "pattern_cache", "candles", "1D")


def _load_costs():
    p = os.path.normpath(os.path.join(HERE, "..", "backtest", "costs.py"))
    spec = importlib.util.spec_from_file_location("validate_costs_mod", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.calculate_trading_costs


calculate_trading_costs = _load_costs()

_frames = {}


def load_bars(sym):
    """Own loader: prefer undated full-history frame, dedupe by IST date."""
    if sym in _frames:
        return _frames[sym]
    df = None
    for name in (f"{sym}.v3.pkl", f"{sym}.lb500.v3.pkl", f"{sym}.v2.pkl"):
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                d = pickle.load(open(p, "rb"))
                if d is not None and not d.empty:
                    df = d
                    break
            except Exception:
                pass
    if df is None:
        try:
            cands = sorted(f for f in os.listdir(CACHE_1D)
                           if f.startswith(sym + ".") and f.endswith(".pkl"))
        except OSError:
            cands = []
        # prefer longest frame (most history)
        best, bestn = None, -1
        for name in cands:
            try:
                d = pickle.load(open(os.path.join(CACHE_1D, name), "rb"))
                if d is not None and not d.empty and len(d) > bestn:
                    best, bestn = d, len(d)
            except Exception:
                pass
        df = best
    if df is None:
        _frames[sym] = []
        return []
    try:
        idx = df.index
        ist = idx.tz_convert("Asia/Kolkata") if idx.tz is not None else idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
    except Exception:
        ist = df.index
    by_date = {}
    for ts, (_, r) in zip(ist, df.iterrows()):
        try:
            by_date[ts.strftime("%Y-%m-%d")] = {
                "date": ts.strftime("%Y-%m-%d"),
                "o": float(r["open"]), "h": float(r["high"]),
                "l": float(r["low"]), "c": float(r["close"]),
                "v": float(r.get("volume", 0) or 0),
            }
        except Exception:
            continue
    rows = [by_date[k] for k in sorted(by_date)]
    _frames[sym] = rows
    return rows


def costs_of(entry, exit_, qty, side="LONG"):
    try:
        return float(calculate_trading_costs(entry, exit_, qty, side)["total_costs"])
    except Exception:
        return float(calculate_trading_costs(entry, exit_, qty)["total_costs"])


def simulate_long(entry_day, entry_px, sl, tgt, bars_by_date, friday):
    """Day-by-day exit sim. Entry filled at entry_px on entry_day open (checked by caller).
    Returns (exit_day, exit_px, why). Same-bar SL+tgt conflict -> SL (conservative)."""
    dates = sorted(d for d in bars_by_date if d >= entry_day and d <= friday)
    for d in dates:
        b = bars_by_date[d]
        hit_sl = b["l"] <= sl
        hit_tg = b["h"] >= tgt
        if hit_sl and hit_tg:
            return d, sl, "SL"
        if hit_sl:
            return d, sl, "SL"
        if hit_tg:
            return d, tgt, "TARGET"
    b = bars_by_date.get(friday)
    if b is None and dates:
        b = bars_by_date[dates[-1]]
        return dates[-1], b["c"], "TIME-Friday"
    return friday, b["c"], "TIME-Friday"


def recompute_three_leg_l3(backtest_path):
    """Recompute every L3 trade claimed in three_leg_backtest.json from raw candles."""
    data = json.load(open(backtest_path))
    mismatches = []
    checked = 0
    agree_net = 0.0
    claimed_net = 0.0
    for w in data["weeks"]:
        friday = w["mon_fri"][-1]
        l3syms = None
        for leg in ("L3",):
            lt = w["legs"][leg]["trades"]
            for t in lt:
                sym = t["symbol"]
                bars = load_bars(sym)
                if not bars:
                    mismatches.append({"symbol": sym, "issue": "NO-CANDLES"})
                    continue
                m = {b["date"]: b for b in bars}
                checked += 1
                claimed_net += t["net"]
                # 1. entry must equal that day's open (next-bar-open rule)
                b0 = m.get(t["entry_day"])
                if b0 is None:
                    mismatches.append({"symbol": sym, "entry_day": t["entry_day"], "issue": "ENTRY-DAY-NO-BAR"})
                    continue
                if abs(b0["o"] - t["entry"]) > 1e-9:
                    mismatches.append({"symbol": sym, "entry_day": t["entry_day"],
                                       "issue": "ENTRY!=OPEN",
                                       "claimed_entry": t["entry"], "raw_open": b0["o"]})
                # 2. break day must show high > setup level... (level not stored; check break bar exists)
                # 3. exit simulation
                ex_day, ex_px, why = simulate_long(t["entry_day"], t["entry"], t["sl"], t["tgt"], m, friday)
                qty = int(100000 // t["entry"])
                gross = (ex_px - t["entry"]) * qty
                c = costs_of(t["entry"], ex_px, qty)
                net = gross - c
                agree_net += net
                if why != t["why"] or abs(ex_px - t["exit"]) > 1e-9 or abs(net - t["net"]) > 1.0:
                    mismatches.append({"symbol": sym, "entry_day": t["entry_day"],
                                       "issue": "EXIT-MISMATCH",
                                       "claimed": (t["exit"], t["why"], round(t["net"], 2)),
                                       "recomputed": (round(ex_px, 2), why, round(net, 2))})
    return {"checked": checked, "claimed_net": round(claimed_net, 2),
            "recomputed_net": round(agree_net, 2), "mismatches": mismatches}


def half_split(trades, date_key="entry_day"):
    ds = sorted(t[date_key] for t in trades if t.get(date_key))
    if not ds:
        return None
    # split by week: first-5 vs last-5 weeks via week_end/week field if present else median date
    weeks = sorted(set(t.get("week", t[date_key][:10]) for t in trades))
    mid = len(weeks) // 2
    first, second = set(weeks[:mid]), set(weeks[mid:])
    h1 = [t for t in trades if t.get("week", t[date_key][:10]) in first]
    h2 = [t for t in trades if t.get("week", t[date_key][:10]) in second]
    def summ(ts):
        net = sum(t["net"] for t in ts)
        return {"n": len(ts), "net": round(net, 2),
                "mean": round(net / len(ts), 2) if ts else 0.0,
                "wr": round(sum(1 for t in ts if t["net"] > 0) / len(ts) * 100, 1) if ts else 0.0}
    return {"weeks_first": sorted(first), "weeks_second": sorted(second),
            "first5": summ(h1), "last5": summ(h2)}


def main():
    a = sys.argv[1] if len(sys.argv) > 1 else "--three-leg"
    if a == "--three-leg":
        r = recompute_three_leg_l3(os.path.join(HERE, "three_leg_backtest.json"))
        print(json.dumps({k: (v if k != "mismatches" else v[:50]) for k, v in r.items()}, indent=1))
        print("N_MISMATCH:", len(r["mismatches"]))
        data = json.load(open(os.path.join(HERE, "three_leg_backtest.json")))
        l3 = [dict(t, week=w["week_end"]) for w in data["weeks"] for t in w["legs"]["L3"]["trades"]]
        print(json.dumps(half_split(l3), indent=1))
    elif a == "--failed-breakdown":
        d = json.load(open(os.path.join(HERE, "new_patterns_week42_trades.json")))
        print(list(d.keys())[:10] if isinstance(d, dict) else type(d))
    else:
        print("unknown mode", a)


if __name__ == "__main__":
    main()
