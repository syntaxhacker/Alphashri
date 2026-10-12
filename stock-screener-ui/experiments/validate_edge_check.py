"""Independent adversarial recompute of sibling studies (validator-owned code).

Checks every trade of each best variant from raw 1D candles:
  entry-open equality, trigger conditions, exit simulation, qty, costs,
  V3 phantom-fill rate, S3 setup recount, duplicate-date rows, ATR cross-check.
"""
import importlib.util
import json
import math
import os
import pickle

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_1D = os.path.join(HERE, "data", "pattern_cache", "candles", "1D")


def _load_costs():
    p = os.path.normpath(os.path.join(HERE, "..", "backtest", "costs.py"))
    spec = importlib.util.spec_from_file_location("v2_costs", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.calculate_trading_costs


CC = _load_costs()
_frames = {}
_dup_report = {}


def load_bars(sym):
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
        best, bestn = None, -1
        try:
            cands = [f for f in os.listdir(CACHE_1D)
                     if f.startswith(sym + ".") and f.endswith(".pkl")]
        except OSError:
            cands = []
        for name in cands:
            try:
                d = pickle.load(open(os.path.join(CACHE_1D, name), "rb"))
                if d is not None and not d.empty and len(d) > bestn:
                    best, bestn = d, len(d)
            except Exception:
                pass
        df = best
    if df is None:
        _frames[sym] = {}
        return {}
    try:
        idx = df.index
        ist = idx.tz_convert("Asia/Kolkata") if idx.tz is not None else idx.tz_localize("UTC").tz_convert("Asia/Kolkata")
    except Exception:
        ist = df.index
    per_date = {}
    for ts, (_, r) in zip(ist, df.iterrows()):
        try:
            k = ts.strftime("%Y-%m-%d")
            per_date.setdefault(k, []).append(
                {"date": k, "o": float(r["open"]), "h": float(r["high"]),
                 "l": float(r["low"]), "c": float(r["close"]),
                 "v": float(r.get("volume", 0) or 0)})
        except Exception:
            continue
    dup = sum(1 for v in per_date.values() if len(v) > 1)
    if dup:
        _dup_report[sym] = {"dup_dates": dup,
                            "sample": {k: [(x["o"], x["c"]) for x in v]
                                       for k, v in list(per_date.items()) if len(v) > 1}[:1] if False else dup}
    # last row wins per date (matches sibling iloc[-1] convention); also keep first-open
    out = {}
    for k, v in per_date.items():
        last = v[-1]
        last["open_first"] = v[0]["o"]
        out[k] = last
    _frames[sym] = out
    return out


def sim_long(entry_day, sl, tgt, m, friday):
    for d in sorted(x for x in m if entry_day <= x <= friday):
        b = m[d]
        s, t = b["l"] <= sl, b["h"] >= tgt
        if s and t:
            return d, sl, "SL"
        if s:
            return d, sl, "SL"
        if t:
            return d, tgt, "TARGET"
    b = m.get(friday) or m[max(x for x in m if x <= friday)]
    return (friday if friday in m else max(x for x in m if x <= friday)), b["c"], "TIME-Friday"


def sim_short(entry_day, sl, tgt, m, friday):
    for d in sorted(x for x in m if entry_day <= x <= friday):
        b = m[d]
        s, t = b["h"] >= sl, b["l"] <= tgt
        if s and t:
            return d, sl, "SL"
        if s:
            return d, sl, "SL"
        if t:
            return d, tgt, "TARGET"
    b = m.get(friday) or m[max(x for x in m if x <= friday)]
    return (friday if friday in m else max(x for x in m if x <= friday)), b["c"], "TIME-Friday"


def check_costs(entry, exit_, qty, side, booked):
    try:
        c = float(CC(entry, exit_, qty, side)["total_costs"])
    except TypeError:
        c = float(CC(entry, exit_, qty)["total_costs"])
    return c, abs(c - booked) > 1.01


def outcome_friday(week_n):
    ds_weeks = {w["n"]: w for w in json.load(open(os.path.join(HERE, "three_leg_dataset.json")))["meta"]["weeks"]}
    return ds_weeks[week_n]["outcome_friday"], ds_weeks[week_n]["outcome"], ds_weeks[week_n]["setup_session"]


DSW = {w["n"]: w for w in json.load(open(os.path.join(HERE, "three_leg_dataset.json")))["meta"]["weeks"]}
DSROWS = {(r["symbol"], r["week"]): r for r in json.load(open(os.path.join(HERE, "three_leg_dataset.json")))["rows"]}

findings = {"mismatch_counts": {}, "details": [], "phantom_v3": {},
            "s3_recount": {}, "atr_xcheck": {}, "dup_dates": {}}


def note(kind, **kw):
    findings["mismatch_counts"][kind] = findings["mismatch_counts"].get(kind, 0) + 1
    if len(findings["details"]) < 2000:
        findings["details"].append({"kind": kind, **kw})


def check_entry_variant(trades, variant, side):
    n = 0
    for t in trades:
        if t.get("variant") != variant and variant not in ("ALL",):
            continue
        n += 1
        sym = t["symbol"]
        m = load_bars(sym)
        fri, odays, _ = DSW[t["week"]]["outcome_friday"], DSW[t["week"]]["outcome"], None
        fri = DSW[t["week"]]["outcome_friday"]
        if t["entry_day"] not in m:
            note("ENTRY-DAY-NO-BAR", sym=sym, variant=variant, day=t["entry_day"])
            continue
        b0 = m[t["entry_day"]]
        # entry-open check (skip V3 level-fill: checked separately; V3c enters at close)
        if variant != "V3":
            ref = b0["c"] if variant == "V3c" else b0["o"]
            if abs(ref - t["entry"]) > 0.005:
                note("ENTRY!=OPEN", sym=sym, variant=variant, day=t["entry_day"],
                     claimed=t["entry"], raw_open=b0["o"], first_open=b0.get("open_first"))
            if abs((b0.get("open_first") or b0["o"]) - b0["o"]) > 0.005:
                note("DUP-DATE-OPEN-DIFF", sym=sym, day=t["entry_day"],
                     first=b0.get("open_first"), last=b0["o"])
        # qty check
        notional = 50000.0 if (variant == "V5" and t.get("n_legs") == 1 and t.get("legs")) else 100000.0
        if variant == "V5":
            legs = t.get("legs", [])
            for leg in legs:
                qexp = max(1, math.floor(50000.0 / leg["entry"]))
                if leg["qty"] != qexp:
                    note("QTY-MISMATCH", sym=sym, variant="V5-leg", exp=qexp, got=leg["qty"])
            continue  # legs checked individually below
        qexp = math.floor(100000.0 / t["entry"])
        qexp = qexp if qexp > 0 else (1 if variant in ("B0", "V1", "V2", "V3", "V4") else 0)
        if t["qty"] != qexp and not (qexp == 0):
            note("QTY-MISMATCH", sym=sym, variant=variant, exp=qexp, got=t["qty"])
        # exit sim check
        if side == "LONG":
            ed, ex, why = sim_long(t["entry_day"], t["sl"], t["tgt"], m, fri)
            gross = round((ex - t["entry"]) * t["qty"], 2)
        else:
            ed, ex, why = sim_short(t["entry_day"], t["sl"], t["tgt"], m, fri)
            gross = round((t["entry"] - ex) * t["qty"], 2)
        why_claim = t["why"].replace("SL-same-bar", "SL")
        if why_claim != why or abs(ex - t["exit"]) > 0.005:
            # boundary: exact touch at rounded level may differ at full precision; same exit px = OK
            if abs(ex - t["exit"]) <= 0.005 and why_claim == why:
                pass
            else:
                note("EXIT-MISMATCH", sym=sym, variant=variant,
                     claimed=(t["exit"], t["why"]), recomputed=(round(ex, 2), why, ed))
        if abs(gross - t["gross"]) > 1.0:
            note("GROSS-MISMATCH", sym=sym, variant=variant, claimed=t["gross"], recomputed=gross)
        c, bad = check_costs(t["entry"], t["exit"], t["qty"], side, t["costs"])
        if bad:
            note("COSTS-MISMATCH", sym=sym, variant=variant, claimed=t["costs"], recomputed=c)
    return n


def check_v3(trades):
    ph = {"n": 0, "phantom": 0, "touch_ok": 0, "discounts": []}
    for t in trades:
        if t.get("variant") != "V3":
            continue
        m = load_bars(t["symbol"])
        row = DSROWS.get((t["symbol"], t["week"]))
        level = row["outcome"]["ref_level"] if row else None
        b = m.get(t["entry_day"])
        if b is None or level is None:
            continue
        ph["n"] += 1
        # claimed entry == level; real fill requires low <= level
        if abs(t["entry"] - round(level, 2)) > 0.01:
            note("V3-ENTRY!=LEVEL", sym=t["symbol"], entry=t["entry"], level=level)
        if b["l"] > level:
            ph["phantom"] += 1
            disc = (b["l"] - level) / level * 100
            ph["discounts"].append(round(disc, 3))
            if len([1 for _ in [0]]) and ph["phantom"] <= 5:
                note("V3-PHANTOM-FILL", sym=t["symbol"], day=t["entry_day"],
                     level=level, day_low=b["l"], phantom_pct=round(disc, 3))
        else:
            ph["touch_ok"] += 1
    import statistics as st
    ph["phantom_rate"] = round(ph["phantom"] / ph["n"], 3) if ph["n"] else 0
    ph["mean_phantom_pct"] = round(st.mean(ph["discounts"]), 3) if ph["discounts"] else 0
    ph["median_phantom_pct"] = round(st.median(ph["discounts"]), 3) if ph["discounts"] else 0
    findings["phantom_v3"] = ph


def check_v4_triggers(trades):
    ok = bad = 0
    for t in trades:
        if t.get("variant") != "V4":
            continue
        m = load_bars(t["symbol"])
        row = DSROWS.get((t["symbol"], t["week"]))
        if not row:
            continue
        level = row["outcome"]["ref_level"]
        odays = DSW[t["week"]]["outcome"]
        # break = first close > level; fail = close < level within next 2 sessions; entry next open
        bi = next((i for i, d in enumerate(odays) if d in m and m[d]["c"] > level), None)
        if bi is None:
            note("V4-NO-BREAK", sym=t["symbol"], week=t["week"])
            bad += 1
            continue
        if odays[bi] != t["break_day"]:
            note("V4-BREAK-DAY-DIFF", sym=t["symbol"], claimed=t["break_day"], recomputed=odays[bi])
            bad += 1
            continue
        fi = next((j for j in range(bi + 1, min(bi + 3, len(odays)))
                   if odays[j] in m and m[odays[j]]["c"] < level), None)
        if fi is None or odays[fi] != t.get("fail_day"):
            note("V4-FAIL-DAY-DIFF", sym=t["symbol"], claimed=t.get("fail_day"),
                 recomputed=odays[fi] if fi is not None else None)
            bad += 1
            continue
        # SL == break-day high?
        if abs(m[odays[bi]]["h"] - t["sl"]) > 0.01:
            note("V4-SL!=BREAKHIGH", sym=t["symbol"], claimed_sl=t["sl"], break_high=m[odays[bi]]["h"])
            bad += 1
            continue
        ok += 1
    findings["v4_triggers"] = {"ok": ok, "bad": bad}


def check_s3(trades):
    ok = bad = 0
    for t in trades:
        m = load_bars(t["symbol"])
        w = DSW[t["week"]]
        S = w["setup_session"]
        sdates = sorted(d for d in m if d <= S)[-10:]
        if len(sdates) < 10:
            note("S3-SHORT-SETUP", sym=t["symbol"])
            bad += 1
            continue
        row = DSROWS.get((t["symbol"], t["week"]))
        avgvol = (row["screen"].get("avgvol20") or 0) if row else 0
        dist = 0
        for k, d in enumerate(sdates):
            b = m[d]
            prev = m[sdates[k - 1]] if k > 0 else None
            rng = b["h"] - b["l"]
            weak = ((b["c"] - b["l"]) / rng < 0.5) if rng > 0 else False
            down = prev is not None and b["c"] < prev["c"]
            if down and avgvol > 0 and b["v"] >= 1.3 * avgvol and weak:
                dist += 1
        c_now = m[sdates[-1]]["c"]
        c_5 = m[sdates[-6]]["c"] if len(sdates) >= 6 else None
        ret5 = c_now / c_5 - 1 if c_5 else None
        sl_exp = max(m[d]["h"] for d in sdates[-5:])
        trig_ok = dist >= 3 and (ret5 is not None and ret5 < 0)
        if not trig_ok:
            note("S3-TRIGGER-FAIL", sym=t["symbol"], week=t["week"],
                 dist=dist, ret5=round(ret5 * 100, 2) if ret5 else None,
                 booked_dist=t.get("dist_days"))
            bad += 1
            continue
        if abs(sl_exp - t["sl"]) > max(0.01, t["entry"] * 0.002 + 0.02):
            # allow ATR-fallback closeness; flag big diffs
            if abs(sl_exp - t["sl"]) > t["entry"] * 0.02:
                note("S3-SL-DIFF", sym=t["symbol"], recomputed=round(sl_exp, 2), claimed=t["sl"])
                bad += 1
                continue
        if dist != t.get("dist_days"):
            note("S3-DIST-COUNT-DIFF", sym=t["symbol"], recomputed=dist, claimed=t.get("dist_days"))
        ok += 1
    findings["s3_recount"] = {"ok": ok, "bad": bad}


def check_short_variant(trades, system):
    n = 0
    for t in trades:
        if t.get("system") != system:
            continue
        n += 1
        m = load_bars(t["symbol"])
        fri = DSW[t["week"]]["outcome_friday"]
        if t["entry_day"] not in m:
            note("ENTRY-DAY-NO-BAR", sym=t["symbol"], variant=system, day=t["entry_day"])
            continue
        b0 = m[t["entry_day"]]
        if abs(b0["o"] - t["entry"]) > 0.005:
            note("ENTRY!=OPEN", sym=t["symbol"], variant=system,
                 claimed=t["entry"], raw_open=b0["o"], first_open=b0.get("open_first"))
        qexp = int(100000 // t["entry"])
        if t["qty"] != qexp:
            note("QTY-MISMATCH", sym=t["symbol"], variant=system, exp=qexp, got=t["qty"])
        ed, ex, why = sim_short(t["entry_day"], t["sl"], t["tgt"], m, fri)
        gross = round((t["entry"] - ex) * t["qty"], 2)
        why_claim = t["why"].replace("SL-same-bar", "SL")
        if why_claim != why or abs(ex - t["exit"]) > 0.005:
            if not (abs(ex - t["exit"]) <= 0.005 and why_claim == why):
                note("EXIT-MISMATCH", sym=t["symbol"], variant=system,
                     claimed=(t["exit"], t["why"]), recomputed=(round(ex, 2), why, ed))
        if abs(gross - t["gross"]) > 1.0:
            note("GROSS-MISMATCH", sym=t["symbol"], variant=system, claimed=t["gross"], recomputed=gross)
        c, bad = check_costs(t["entry"], t["exit"], t["qty"], "SHORT", t["costs"])
        if bad:
            note("COSTS-MISMATCH", sym=t["symbol"], variant=system, claimed=t["costs"], recomputed=c)
    return n


def main():
    et = json.load(open(os.path.join(HERE, "entry_timing.json")))
    ss = json.load(open(os.path.join(HERE, "short_side.json")))
    counts = {}
    for v, side in (("B0", "LONG"), ("V1", "LONG"), ("V2", "LONG"), ("V4", "SHORT"), ("V3c", "LONG")):
        counts[v] = check_entry_variant(et["trades"][v], v, side)
    # V5 legs
    nlegs = 0
    for t in et["trades"]["V5"]:
        for leg in t.get("legs", []):
            nlegs += 1
            m = load_bars(t["symbol"])
            fri = DSW[t["week"]]["outcome_friday"]
            b0 = m.get(leg["entry_day"])
            if b0 is None:
                note("ENTRY-DAY-NO-BAR", sym=t["symbol"], variant="V5-leg", day=leg["entry_day"])
                continue
            if abs(b0["o"] - leg["entry"]) > 0.005:
                note("ENTRY!=OPEN", sym=t["symbol"], variant="V5-leg", claimed=leg["entry"], raw_open=b0["o"])
            ed, ex, why = sim_long(leg["entry_day"], leg["sl"], leg["tgt"], m, fri)
            if why != leg["why"] or abs(ex - leg["exit"]) > 0.005:
                note("EXIT-MISMATCH", sym=t["symbol"], variant="V5-leg",
                     claimed=(leg["exit"], leg["why"]), recomputed=(round(ex, 2), why))
            c, bad = check_costs(leg["entry"], leg["exit"], leg["qty"], "LONG", leg["costs"])
            if bad:
                note("COSTS-MISMATCH", sym=t["symbol"], variant="V5-leg", claimed=leg["costs"], recomputed=c)
    counts["V5-legs"] = nlegs
    check_v3(et["trades"]["V3"])
    check_v4_triggers(et["trades"]["V4"])
    for s in ("S1_breakdown", "S2_fade", "S3_dist"):
        counts[s] = check_short_variant(ss["trades"][s], s)
    check_s3(ss["trades"]["S3_dist"])
    findings["counts_checked"] = counts
    findings["dup_date_symbols"] = len(_dup_report)
    findings["dup_date_sample"] = dict(list(_dup_report.items())[:10])
    json.dump(findings, open(os.path.join(HERE, "validate_edge_findings.json"), "w"), indent=1)
    print(json.dumps(findings["mismatch_counts"], indent=1))
    print("CHECKED:", json.dumps(counts))
    print("V3-PHANTOM:", json.dumps(findings["phantom_v3"]))
    print("V4-TRIG:", json.dumps(findings.get("v4_triggers")))
    print("S3-RECOUNT:", json.dumps(findings["s3_recount"]))
    print("DUP-DATE-SYMBOLS:", len(_dup_report))


if __name__ == "__main__":
    main()
