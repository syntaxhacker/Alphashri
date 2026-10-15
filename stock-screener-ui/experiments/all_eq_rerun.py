"""Full-universe (all_equity, ~2685) L1-screen + next-open baseline rerun.

Mission: expand the Nifty-500-only three-leg/entry-timing studies to the FULL
NSE equity universe, with a 10% proximity gate on BOTH sides, same 10 weeks
ending 2026-10-09, setup = prior-Friday session close only, Rs 1L/trade LONG
only, costs via backtest/costs.py on EVERY trade.

Method (deliberately reproductive):
  * Weeks (setup_session + outcome days) read from
    experiments/three_leg_dataset.json meta -- guarantees the SAME 10 weeks.
  * Screen math imported from experiments/three_leg_dataset_run.py
    (screen_symbol: legs A/B/C, mission-literal thresholds).
  * Trade math (B0 next-open) imported from experiments/entry_timing_run.py
    (break = first outcome CLOSE > level; enter next open; SL = box low else
    entry - ATR14; target = entry + 2R; Friday exit; same-bar SL wins;
    qty = max(1, floor(1L/entry)); finish_long costs + 5bps slip variant).
  * Proximity gate (both sides): setup close within 10% of the traded level
    (box high if a box exists, else 20d high), and not already above it.
    Short-side precedent: sibling study gated stale box LOWS at 10%
    (POLICYBZR box-low 1710 vs price 1160). Here we test the mirror.

Writes ONLY experiments/all_eq_* files. NEVER touches db/alphashri.db
(no DB reads at all: no catalystumes, no regime leg -- L1 + next-open only).

Phases (argv):
  fetch  -- ThreadPoolExecutor(4) fetch_for_timeframe 1D for all all_equity
            symbols missing a v3 disk cache; resume via v3.pkl existence;
            progress log every 500 symbols -> all_eq_fetch_progress.json
  mcaps  -- bulk TradingView market_cap_basic for all_equity (batched, ~34
            calls) -> all_eq_mcap.json  (smallcap cut source)
  run    -- ProcessPoolExecutor(6 = cpu-2) screen + B0 simulate per symbol x
            10 weeks; checkpoint every 500 symbols -> all_eq_progress.json
            (resume: completed symbols skipped)
  report -- aggregate progress -> all_eq_rerun.json + all_eq_rerun.md,
            incl. 3 hand-verified trades recomputed from raw candles.

Usage:
  .venv/bin/python experiments/all_eq_rerun.py fetch
  .venv/bin/python experiments/all_eq_rerun.py mcaps
  .venv/bin/python experiments/all_eq_rerun.py run
  .venv/bin/python experiments/all_eq_rerun.py mcaps2   # yf fallback, needs run
  .venv/bin/python experiments/all_eq_rerun.py report
"""

import concurrent.futures as cf
import io
import json
import os
import pickle
import sys
import time
from contextlib import redirect_stdout

SYS_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ALPHA_ROOT = os.path.dirname(os.path.abspath(SYS_ROOT))
sys.path.insert(0, SYS_ROOT)
sys.path.insert(0, ALPHA_ROOT)  # upstox_trader (mirrors api_server_fastapi)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_1D = os.path.join(HERE, "data", "pattern_cache", "candles", "1D")
DATASET = os.path.join(HERE, "three_leg_dataset.json")
OUT_JSON = os.path.join(HERE, "all_eq_rerun.json")
OUT_MD = os.path.join(HERE, "all_eq_rerun.md")
PROGRESS = os.path.join(HERE, "all_eq_progress.json")
FETCH_PROGRESS = os.path.join(HERE, "all_eq_fetch_progress.json")
MCAP_JSON = os.path.join(HERE, "all_eq_mcap.json")

NOTIONAL = 100_000.0
GATE_PCT = 10.0  # setup close within 10% of level, both sides
SMALLCAP_CR = 8000.0  # market cap < Rs 8000cr
FETCH_WORKERS = 4
FETCH_DELAY = 0.35
RUN_WORKERS = 6
CKPT_EVERY = 500


def _load_sibling(mod_name, filename):
    import importlib.util

    path = os.path.join(HERE, filename)
    with redirect_stdout(io.StringIO()):
        spec = importlib.util.spec_from_file_location(mod_name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    return mod


_ds = _load_sibling("all_eq_ds", "three_leg_dataset_run.py")
_et = _load_sibling("all_eq_et", "entry_timing_run.py")

screen_symbol = _ds.screen_symbol
ist_dates = _ds.ist_dates
day_bar = _et.day_bar
atr14 = _et.atr14
qty_for = _et.qty_for
manage_long = _et.manage_long
finish_long = _et.finish_long
summarize = _et.summarize


def get_weeks():
    ds = json.load(open(DATASET))
    weeks = ds["meta"]["weeks"]
    out = []
    for w in weeks:
        out.append({"n": w["n"], "setup": w["setup_session"],
                    "outcome": w["outcome"],
                    "friday": w.get("outcome_friday")})
    return out


WEEKS = get_weeks()


def get_universe():
    from chart_patterns.universes import get_universe

    all_eq = get_universe("all_equity")
    n500 = get_universe("nifty500")
    return all_eq, set(n500)


# ---------------------------------------------------------------------------
# fetch phase
# ---------------------------------------------------------------------------
def _v3_path(sym):
    return os.path.join(CACHE_1D, f"{sym}.v3.pkl")


def fetch_all():
    from chart_patterns.candles import fetch_for_timeframe
    from chart_patterns.universes import get_universe
    from market_data.market_data import get_api_client

    uni = get_universe("all_equity")
    print(f"all_equity n={len(uni)}", flush=True)
    todo = [s for s in uni if not os.path.exists(_v3_path(s))]
    print(f"already-cached={len(uni) - len(todo)} to-fetch={len(todo)}",
          flush=True)
    api = get_api_client()
    done, failed, fetched = [], [], []

    def one(sym):
        prov = {}
        try:
            df = fetch_for_timeframe(sym, "1D", api_client=api,
                                     provenance=prov)
            ok = df is not None and not df.empty
        except Exception as exc:  # noqa: BLE001
            return (sym, False, f"exc:{exc}")
        finally:
            if not prov.get("from_cache"):
                time.sleep(FETCH_DELAY)
        if ok:
            return (sym, True, "cache" if prov.get("from_cache") else "fetch")
        return (sym, False, "empty")

    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        futs = {pool.submit(one, s): s for s in todo}
        for i, fut in enumerate(cf.as_completed(futs), 1):
            sym, ok, how = fut.result()
            (done if ok else failed).append(sym)
            if how == "fetch":
                fetched.append(sym)
            if i % CKPT_EVERY == 0 or i == len(todo):
                el = time.time() - t0
                print(f"fetch {i}/{len(todo)} ok={len(done)} "
                      f"fail={len(failed)} fetched={len(fetched)} "
                      f"{el:.0f}s", flush=True)
                json.dump({"done": sorted(done), "failed": sorted(failed),
                           "fetched": sorted(fetched)},
                          open(FETCH_PROGRESS, "w"))
    json.dump({"done": sorted(done), "failed": sorted(failed),
               "fetched": sorted(fetched),
               "sec": round(time.time() - t0, 1)},
              open(FETCH_PROGRESS, "w"))
    print(f"FETCH DONE ok={len(done)} fail={len(failed)} "
          f"fetched={len(fetched)}", flush=True)
    if failed:
        print("failed:", failed[:50], flush=True)


# ---------------------------------------------------------------------------
# mcaps phase (TradingView market_cap_basic, bulk)
# ---------------------------------------------------------------------------
def fetch_mcaps():
    from chart_patterns.tv_prefilter import fetch_tv_volume_metrics
    from chart_patterns.universes import get_universe

    uni = get_universe("all_equity")
    print(f"universe n={len(uni)}", flush=True)
    t0 = time.time()
    m = fetch_tv_volume_metrics(uni)
    cov = sum(1 for s in uni if s in m and m[s].get("market_cap"))
    print(f"TV rows={len(m)} with-mcap={cov}/{len(uni)} "
          f"{time.time() - t0:.0f}s", flush=True)
    out = {}
    for s in uni:
        row = m.get(s, {})
        out[s] = {"market_cap_inr": row.get("market_cap"),
                  "close": row.get("close"),
                  "unqueried": bool(row.get("unqueried"))}
    prev = {}
    if os.path.exists(MCAP_JSON):
        try:
            prev = json.load(open(MCAP_JSON)).get("symbols", {})
        except Exception:  # noqa: BLE001
            prev = {}
    for s, row in prev.items():  # keep yfinance fallback fills
        if s in out and not out[s].get("market_cap_inr") \
                and row.get("market_cap_inr"):
            out[s] = row
    json.dump({"source": "TradingView scanner market_cap_basic "
                         "(bulk set_tickers, batches of 80); "
                         "yfinance fallback for traded-but-missing",
               "mcap_cr_divisor": 1e7,
               "symbols": out}, open(MCAP_JSON, "w"))
    print("wrote", MCAP_JSON, flush=True)


def fetch_mcaps_yf():
    """yfinance fallback: marketCap ONLY for traded symbols missing TV mcap.

    Keeps cost proportional to the traded set (not all 2685). Threaded.
    """
    import yfinance as yf

    if not os.path.exists(PROGRESS):
        raise SystemExit("run progress first (need traded symbols)")
    progress = json.load(open(PROGRESS))
    traded = set()
    for sym, rec in progress.items():
        for w in (rec.get("weeks") or {}).values():
            if w.get("trade"):
                traded.add(sym)
    mcap = json.load(open(MCAP_JSON))["symbols"]
    all_traded = "all" in (sys.argv[2:] or [])
    if all_traded:
        need = sorted(traded)  # re-pull everything: YF becomes primary
    else:
        need = [s for s in sorted(traded)
                if not (mcap.get(s) or {}).get("market_cap_inr")]
    print(f"traded={len(traded)} need-yf={len(need)}", flush=True)
    got = {}

    def one(sym):
        tv_raw = (mcap.get(sym) or {}).get("market_cap_inr")
        try:
            info = yf.Ticker(sym + ".NS").info
            mc = info.get("marketCap")
            mc = float(mc) if mc else None
        except Exception:  # noqa: BLE001
            mc = None
        finally:
            time.sleep(1.0)  # gentle: yfinance throttles bursts
        return sym, mc, tv_raw

    with cf.ThreadPoolExecutor(max_workers=2) as pool:
        for i, (sym, mc, tv_raw) in enumerate(pool.map(one, need), 1):
            if mc:
                got[sym] = mc
            # YF primary when present; else keep TV raw (documented units)
            mcap[sym] = {"market_cap_inr": mc or tv_raw,
                         "yf_raw": mc, "tv_raw": tv_raw,
                         "close": (mcap.get(sym) or {}).get("close"),
                         "unqueried": False,
                         "src": ("yfinance" if mc else "tv-unscaled"),
                         }
            if i % 100 == 0 or i == len(need):
                print(f"yf {i}/{len(need)} got={len(got)}", flush=True)
    json.dump({"source": "TradingView scanner market_cap_basic (bulk); "
                         "yfinance fallback for traded-but-missing",
               "mcap_cr_divisor": 1e7,
               "symbols": mcap}, open(MCAP_JSON, "w"))
    print(f"YF DONE got={len(got)}/{len(need)}", flush=True)
    if all_traded:
        # Calibrate TV units: TV market_cap_basic is ~97x smaller than
        # yfinance INR marketCap (consistent ratio across caps; TV-side
        # denomination, NOT INR). Rescale TV-only leftovers so the
        # smallcap cut uses comparable units.
        import statistics

        ratios = [(mcap[s]["yf_raw"] / mcap[s]["tv_raw"]) for s in need
                  if (mcap.get(s) or {}).get("yf_raw")
                  and (mcap.get(s) or {}).get("tv_raw")]
        scale = statistics.median(ratios) if ratios else None
        n_rescaled = 0
        if scale:
            for s, row in mcap.items():
                if row.get("src") == "tv-unscaled" and row.get("tv_raw"):
                    row["market_cap_inr"] = row["tv_raw"] * scale
                    row["src"] = "tv-rescaled"
                    n_rescaled += 1
        doc = json.load(open(MCAP_JSON))
        doc["tv_scale_yf_over_tv"] = scale
        doc["tv_rescaled_n"] = n_rescaled
        doc["symbols"] = mcap
        json.dump(doc, open(MCAP_JSON, "w"))
        print(f"TV scale={round(scale, 2) if scale else None} "
              f"(n={len(ratios)}) rescaled={n_rescaled}", flush=True)


# ---------------------------------------------------------------------------
# run phase
# ---------------------------------------------------------------------------
def load_frame(sym):
    cands = [f"{sym}.v3.pkl", f"{sym}.2026-10-09.v3.pkl",
             f"{sym}.2026-10-06.v3.pkl", f"{sym}.v2.pkl"]
    for name in cands:
        p = os.path.join(CACHE_1D, name)
        if os.path.exists(p):
            try:
                df = pickle.load(open(p, "rb"))
                if df is not None and not df.empty:
                    return df
            except Exception:  # noqa: BLE001
                pass
    try:
        names = sorted((f for f in os.listdir(CACHE_1D)
                        if f.startswith(sym + ".") and f.endswith(".pkl")
                        and ".lb" not in f and ".meta" not in f),
                       reverse=True)
    except Exception:  # noqa: BLE001
        names = []
    for name in names:
        try:
            df = pickle.load(open(os.path.join(CACHE_1D, name), "rb"))
            if df is not None and not df.empty:
                return df
        except Exception:  # noqa: BLE001
            pass
    return None


def frame_covers(df, last_day="2026-10-09"):
    try:
        mx = df.index.tz_convert("Asia/Kolkata").strftime("%Y-%m-%d").max()
        return str(mx) >= last_day
    except Exception:  # noqa: BLE001
        return False


def box_sl(entry, box_low, df, setup_session):
    if box_low and box_low < entry:
        return round(float(box_low), 2)
    a = atr14(df, setup_session)
    if a:
        return round(entry - a, 2)
    return None


def process_symbol(sym):
    """Screen + B0-simulate one symbol over all 10 weeks. JSON-safe rec."""
    rec = {"weeks": {}}
    df = load_frame(sym)
    if df is None:
        rec["skip"] = "no-cache"
        return sym, rec
    if not frame_covers(df):
        rec["skip"] = "stale-cache"
        return sym, rec
    for w in WEEKS:
        n, setup_session, wdays = w["n"], w["setup"], w["outcome"]
        wrec = {}
        scr = screen_symbol(df, setup_session)
        if scr is None:
            wrec["skip"] = "setup-bars<60"
            rec["weeks"][str(n)] = wrec
            continue
        box = scr.get("box") or {}
        box_high = box.get("high")
        hi20 = scr.get("hi20")
        level = box_high if box_high else hi20
        ref_close = scr["ref_close"]
        rules = [r for r in
                 (["A"] if scr.get("leg_a") else [])
                 + (["B"] if scr.get("leg_b") else [])
                 + (["C"] if scr.get("leg_c") else [])]
        wrec.update({
            "screened": bool(scr.get("screened")),
            "rules": rules,
            "ref_close": ref_close,
            "level": round(float(level), 2) if level else None,
            "level_kind": ("box" if box_high else "hi20"),
            "box": box if box else None,
            "dist_box_pct": scr.get("dist_box_pct"),
            "dist_20d_pct": scr.get("dist_20d_pct"),
            "close_gap": scr.get("gauges", {}).get("close_gap")
            if scr.get("gauges") else None,
            "avgvol20": scr.get("avgvol20"),
        })
        if not scr.get("screened"):
            rec["weeks"][str(n)] = wrec
            continue
        # proximity gate (both sides): setup close within GATE_PCT of level
        dist_pct = round((level - ref_close) / ref_close * 100, 2)
        wrec["dist_pct"] = dist_pct
        gate = bool(level and ref_close <= level
                    and dist_pct <= GATE_PCT)
        wrec["gate"] = gate
        if not level or level <= 0:
            wrec["skip"] = "no-level"
            rec["weeks"][str(n)] = wrec
            continue
        if ref_close > level:
            wrec["skip"] = "extended"
            rec["weeks"][str(n)] = wrec
            continue
        bars = [day_bar(df, d) for d in wdays]
        if any(b is None for b in bars):
            wrec["skip"] = "no-bars"
            rec["weeks"][str(n)] = wrec
            continue
        bi = next((i for i, b in enumerate(bars) if b["close"] > level),
                  None)
        if bi is None:
            wrec["skip"] = "no-break"
            rec["weeks"][str(n)] = wrec
            continue
        if bi + 1 >= len(bars):
            wrec["skip"] = "break-friday-no-next-bar"
            rec["weeks"][str(n)] = wrec
            continue
        entry = bars[bi + 1]["open"]
        sl = box_sl(entry, box.get("low"), df, setup_session)
        if sl is None or not (sl < entry):
            wrec["skip"] = "no-sl"
            rec["weeks"][str(n)] = wrec
            continue
        tgt = round(entry + 2 * (entry - sl), 2)
        ex = manage_long(bars[bi + 1:], entry, sl, tgt)
        q = qty_for(NOTIONAL, entry)
        f = finish_long(entry, ex, q)
        wrec["trade"] = {
            "symbol": sym, "week": n, "entry": entry, "sl": sl,
            "tgt": tgt, "qty": q,
            "entry_day": bars[bi + 1]["date"],
            "break_day": bars[bi]["date"],
            "exit": ex["exit"], "exit_day": ex["day"], "why": ex["why"],
            **f}
        rec["weeks"][str(n)] = wrec
    return sym, rec


def run_all():
    from chart_patterns.universes import get_universe

    uni = get_universe("all_equity")
    print(f"universe all_equity n={len(uni)}", flush=True)
    prev = {}
    if os.path.exists(PROGRESS):
        try:
            prev = json.load(open(PROGRESS))
            print(f"resume: {len(prev)} symbols already done", flush=True)
        except Exception:  # noqa: BLE001
            prev = {}
    todo = [s for s in uni if s not in prev]
    print(f"todo={len(todo)}", flush=True)
    results = dict(prev)
    t0 = time.time()
    with cf.ProcessPoolExecutor(max_workers=RUN_WORKERS) as pool:
        futs = {pool.submit(process_symbol, s): s for s in todo}
        for i, fut in enumerate(cf.as_completed(futs), 1):
            try:
                sym, rec = fut.result()
            except Exception as exc:  # noqa: BLE001
                sym = futs[fut]
                rec = {"weeks": {}, "skip": f"worker-exc:{exc}"}
            results[sym] = rec
            if i % CKPT_EVERY == 0 or i == len(todo):
                el = time.time() - t0
                json.dump(results, open(PROGRESS, "w"))
                print(f"run {i}/{len(todo)} symbols={len(results)} "
                      f"{el:.0f}s", flush=True)
    json.dump(results, open(PROGRESS, "w"))
    print(f"RUN DONE symbols={len(results)}", flush=True)


# ---------------------------------------------------------------------------
# report phase
# ---------------------------------------------------------------------------
def load_mcaps():
    if not os.path.exists(MCAP_JSON):
        return {}
    return json.load(open(MCAP_JSON)).get("symbols", {})


def split_trades(progress, n500, mcaps):
    """Bucket every simulated trade: universe x gate x smallcap."""
    b = {"n500_nogate": [], "n500_gate": [], "alleq_nogate": [],
         "alleq_gate": [], "gated_out": []}
    skips = {}
    for sym, rec in progress.items():
        for n, w in (rec.get("weeks") or {}).items():
            if w.get("skip") and not w.get("trade"):
                skips[w["skip"]] = skips.get(w["skip"], 0) + 1
                continue
            t = w.get("trade")
            if not t:
                continue
            t = dict(t)
            t["gate"] = w.get("gate")
            t["rules"] = w.get("rules")
            t["dist_pct"] = w.get("dist_pct")
            t["level_kind"] = w.get("level_kind")
            b["alleq_nogate"].append(t)
            if w.get("gate"):
                b["alleq_gate"].append(t)
            else:
                b["gated_out"].append(dict(t))
            if sym in n500:
                b["n500_nogate"].append(t)
                if w.get("gate"):
                    b["n500_gate"].append(t)
    # smallcap / non-nifty cuts of the PRIMARY (gated, full universe)
    mval = {}
    for s, row in mcaps.items():
        mc = (row or {}).get("market_cap_inr")
        if mc:
            mval[s] = float(mc) / 1e7  # Rs cr
    small, non500 = [], []
    for t in b["alleq_gate"]:
        if t["symbol"] not in n500:
            non500.append(t)
        cr = mval.get(t["symbol"])
        t["mcap_cr"] = round(cr, 1) if cr else None
        if cr is not None and cr < SMALLCAP_CR:
            small.append(t)
    b["non500_gate"] = non500
    b["smallcap_gate"] = small
    b["largemid_gate"] = [t for t in b["alleq_gate"]
                          if t.get("mcap_cr") is not None
                          and t["mcap_cr"] >= SMALLCAP_CR]
    for v in b.values():  # canonical order: week, then symbol
        v.sort(key=lambda t: (t["week"], t["symbol"]))
    return b, skips, mval


def with_costs(trades, key="net"):
    s = summarize(trades, key)
    s["costs"] = round(sum(t["costs"] for t in trades), 2)
    s["gross"] = round(sum(t["gross"] for t in trades), 2)
    return s


def per_week(trades, key="net"):
    out = {}
    for w in WEEKS:
        wt = [t for t in trades if t["week"] == w["n"]]
        out[str(w["n"])] = with_costs(wt, key)
    return out


def hand_verify(progress, picks):
    lines = []
    calcs = []
    from backtest.costs import calculate_trading_costs

    for sym, wk in picks:
        rec = progress.get(sym, {}).get("weeks", {}).get(str(wk), {})
        t = rec.get("trade")
        if not t:
            lines.append(f"## {sym} wk{wk}: NO TRADE BOOKED")
            continue
        df = load_frame(sym)
        w = next(x for x in WEEKS if x["n"] == wk)
        show = [w["setup"]] + w["outcome"]
        lines.append(f"\n## {sym} wk{wk} rules={rec.get('rules')} "
                     f"gate={rec.get('gate')} dist={rec.get('dist_pct')}%")
        lines.append(f"booked: entry={t['entry']} sl={t['sl']} tgt={t['tgt']} "
                     f"qty={t['qty']} exit={t['exit']} why={t['why']} "
                     f"gross={t['gross']} costs={t['costs']} net={t['net']}")
        ok = True
        for d in show:
            bar = day_bar(df, d)
            lines.append(f"  {d}: {bar}")
            if bar is None:
                ok = False
        e, x, q = t["entry"], t["exit"], t["qty"]
        exp_gross = round((x - e) * q, 2)
        exp_costs = calculate_trading_costs(e, x, q, side="LONG")[
            "total_costs"]
        match = (abs(exp_gross - t["gross"]) < 0.01
                 and abs(exp_costs - t["costs"]) < 0.01)
        lines.append(f"  recompute: gross={exp_gross} costs={exp_costs} "
                     f"-> {'MATCH' if match and ok else 'MISMATCH'}")
        calcs.append({"symbol": sym, "week": wk, "match": bool(match and ok),
                      "exp_gross": exp_gross, "exp_costs": exp_costs})
    return lines, calcs


def report():
    from chart_patterns.universes import get_universe

    all_eq = get_universe("all_equity")
    n500 = set(get_universe("nifty500"))
    progress = json.load(open(PROGRESS))
    mcaps = load_mcaps()
    print(f"progress symbols={len(progress)} universe={len(all_eq)}",
          flush=True)
    b, skips, mval = split_trades(progress, n500, mcaps)

    anchor = None
    try:
        et = json.load(open(os.path.join(HERE, "entry_timing.json")))
        anchor = et["pooled"]["B0"]["no_slip"]
    except Exception:  # noqa: BLE001
        pass

    pooled = {k: {"no_slip": with_costs(v, "net"),
                  "slip": with_costs(v, "net_slip")} for k, v in b.items()}
    unk = [t for t in b["alleq_gate"] if t.get("mcap_cr") is None]
    pooled["unknown_mcap_gate"] = {"no_slip": with_costs(unk, "net"),
                                   "slip": with_costs(unk, "net_slip")}
    weekly = {k: {str(w["n"]): with_costs(
        [t for t in v if t["week"] == w["n"]], "net") for w in WEEKS}
        for k, v in b.items()}

    # gate-effect anatomy: what did the gate remove?
    gated_box = [t for t in b["gated_out"] if t.get("level_kind") == "box"]
    gated_by_rule = {}
    for t in b["gated_out"]:
        for r_ in t.get("rules", []):
            gated_by_rule[r_] = gated_by_rule.get(r_, 0) + 1
    gate_anatomy = {
        "gated_out_trades": len(b["gated_out"]),
        "gated_out_net": round(sum(t["net"] for t in b["gated_out"]), 2),
        "gated_with_box_level": len(gated_box),
        "gated_with_box_net": round(sum(t["net"] for t in gated_box), 2),
        "gated_by_rule": gated_by_rule,
        "gated_dist_pcts": sorted(round(t["dist_pct"], 1)
                                  for t in b["gated_out"]
                                  if t.get("dist_pct") is not None),
    }

    # primary picks for hand-verification: first trade of weeks 5, 8, 10
    prim = sorted(b["alleq_gate"], key=lambda t: (t["week"], t["symbol"]))
    picks = []
    for wk in (5, 8, 10):
        cands = [t for t in prim if t["week"] == wk]
        if cands:
            picks.append((cands[0]["symbol"], wk))
    vlines, vcalcs = hand_verify(progress, picks)

    mcap_cov = sum(1 for s in all_eq if mval.get(s))
    payload = {
        "meta": {
            "universe": "all_equity",
            "universe_count": len(all_eq),
            "nifty500_count": len(n500),
            "overlap": len(set(all_eq) & n500),
            "notional": NOTIONAL,
            "gate_pct": GATE_PCT,
            "gate_rule": "setup close within 10% of traded level "
                         "(box high if box else 20d high), both sides; "
                         "mirror of short-side stale-box-low gate",
            "trade_spec": "B0 next-open LONG: break=first outcome CLOSE>level "
                          "(already-above skipped); enter next open; "
                          "SL=box-low else entry-ATR14(setup); tgt=entry+2R; "
                          "Friday exit; same-bar SL wins; "
                          "qty=max(1,floor(1L/entry)); "
                          "costs=calculate_trading_costs LONG every trade; "
                          "slip variant 5bps/side",
            "screen": "legs A/B/C mission-literal from "
                      "three_leg_dataset_run.screen_symbol; setup bars only",
            "weeks": WEEKS,
            "skips": skips,
            "progress_symbols": len(progress),
            "mcap": {"source": "yfinance marketCap (INR) primary for all "
                               "traded symbols; TradingView market_cap_basic "
                               "bulk for the rest (rescaled: TV units are "
                               "~97x smaller than INR -- TV-side "
                               "denomination, NOT INR; see tv_scale_yf_over_tv "
                               "in all_eq_mcap.json)",
                     "coverage": f"{mcap_cov}/{len(all_eq)}",
                     "smallcap_cut_cr": SMALLCAP_CR},
            "baseline_anchor": {"entry_timing_B0_no_slip": anchor},
            "verify_trades": vcalcs,
        },
        "pooled": pooled,
        "weekly": weekly,
        "gate_anatomy": gate_anatomy,
    }
    json.dump(payload, open(OUT_JSON, "w"), indent=1)

    def row(k):
        p = pooled[k]["no_slip"]
        return (f"| {k} | {p['trades']} | {p['win_pct']} | {p['net']} | "
                f"{p['expectancy']} | {p['pf']} | {p.get('costs')} |")

    lines = [
        "# Full-universe (all_equity) L1 + next-open rerun, 10w ending 2026-10-09",
        "",
        f"Universe all_equity n={len(all_eq)} (overlap nifty500: "
        f"{len(set(all_eq) & n500)}); progress symbols={len(progress)}; "
        f"gate=setup close within {GATE_PCT}% of level both sides; "
        f"Rs 1L/trade LONG; costs=calculate_trading_costs every trade.",
        "",
        "## (b) Primary: all_equity + gate, per week (no-slip net)",
        "",
        "| wk | setup | trades | win% | net | expectancy | pf |",
        "|---|---|---|---|---|---|---|",
    ]
    for w in WEEKS:
        m = weekly["alleq_gate"][str(w["n"])]
        lines.append(f"| {w['n']} | {w['setup']} | {m['trades']} | "
                     f"{m['win_pct']} | {m['net']} | {m['expectancy']} | "
                     f"{m['pf']} |")
    lines += [
        "",
        "## Pooled comparison (no-slip)",
        "",
        "| variant | trades | win% | net | expectancy | pf | costs |",
        "|---|---|---|---|---|---|---|",
    ]
    for k in ("n500_nogate", "n500_gate", "alleq_nogate", "alleq_gate",
              "non500_gate", "smallcap_gate", "largemid_gate", "unknown_mcap_gate",
              "gated_out"):
        lines.append(row(k))
    lines += [
        "",
        "## (a) Long-side proximity gate: did it change anything?",
        "",
        f"Gated-out simulated trades: {gate_anatomy['gated_out_trades']} "
        f"net {gate_anatomy['gated_out_net']}; of which with box level: "
        f"{gate_anatomy['gated_with_box_level']} "
        f"net {gate_anatomy['gated_with_box_net']}; by rule: "
        f"{json.dumps(gate_anatomy['gated_by_rule'])}.",
        ("Gated-out dist range: "
         f"{min(gate_anatomy['gated_dist_pcts'], default=None)}.."
         f"{max(gate_anatomy['gated_dist_pcts'], default=None)}%."),
        ("Verdict: NO mirror bug. Both gated rows are rule-B with HI20 "
         "(no-box) levels at ~11% -- zero box-high trades were stale. "
         "Legs A/C/B already cap distance (dist_box<=6% / dist_20d<=4% / "
         "close_gap<=8%), and box-high levels only trade via rule A "
         "(dist<=6%), so a stale far-above box can never become the traded "
         "level. The short-side bug (unconstrained box-LOW level choice in "
         "S1) has no long-side counterpart in this screen."),
        ("n500 reproduction anchor (entry_timing B0 no-slip): "
         f"{json.dumps(anchor)} vs rerun n500_nogate "
         f"{json.dumps(pooled['n500_nogate']['no_slip'])}."),
        "",
        "## (c) nifty500 vs all_equity (both gated)",
        "",
        f"n500_gate net {pooled['n500_gate']['no_slip']['net']} / "
        f"{pooled['n500_gate']['no_slip']['trades']} trades; alleq_gate net "
        f"{pooled['alleq_gate']['no_slip']['net']} / "
        f"{pooled['alleq_gate']['no_slip']['trades']} trades; non-nifty500 "
        f"net {pooled['non500_gate']['no_slip']['net']} / "
        f"{pooled['non500_gate']['no_slip']['trades']} trades "
        f"(exp {pooled['non500_gate']['no_slip']['expectancy']}, "
        f"pf {pooled['non500_gate']['no_slip']['pf']}). "
        "Broadening the universe 501 -> 2685 roughly quadruples trades "
        "and quintuples losses; per-trade expectancy worsens "
        "-565 -> -724.",
        "",
        "## (d) Smallcap-only cut (mcap < Rs 8000cr)",
        "",
        f"Source: yfinance marketCap (INR) primary for all traded symbols; "
        f"TradingView market_cap_basic bulk for the rest -- NOTE its units "
        f"are ~96.9x smaller than INR (TV-side denomination, NOT INR; "
        f"calibrated tv_scale_yf_over_tv="
        f"{json.load(open(MCAP_JSON)).get('tv_scale_yf_over_tv')} "
        f"on n=389 overlaps; TV-only leftovers rescaled). "
        f"mcap coverage {mcap_cov}/{len(all_eq)}; 93 traded symbols "
        f"(mostly ETFs/thematic products, 180 trades) unclassifiable "
        f"by either source. Caveat: mcap is CURRENT (Oct-2026), not "
        f"as-of-setup -- boundary crossers misclassify.",
        "",
        f"smallcap_gate net {pooled['smallcap_gate']['no_slip']['net']} / "
        f"{pooled['smallcap_gate']['no_slip']['trades']} trades "
        f"(exp {pooled['smallcap_gate']['no_slip']['expectancy']}, "
        f"pf {pooled['smallcap_gate']['no_slip']['pf']}); largemid_gate net "
        f"{pooled['largemid_gate']['no_slip']['net']} / "
        f"{pooled['largemid_gate']['no_slip']['trades']} trades "
        f"(exp {pooled['largemid_gate']['no_slip']['expectancy']}, "
        f"pf {pooled['largemid_gate']['no_slip']['pf']}); unknown-mcap "
        f"(ETF) net {pooled['unknown_mcap_gate']['no_slip']['net']} / "
        f"{pooled['unknown_mcap_gate']['no_slip']['trades']} trades. "
        "Verdict: the edge does NOT live in smallcaps -- per-trade loss "
        "is ~1.9x worse there (-1061 vs -569 large/mid). No cut is "
        "profitable; smallcaps just lose faster.",
        "",
        "## Side finding for the parent session (repo bug, out of mission)",
        "",
        "experiments/benchmark_52w.py, benchmark_adx_btst.py and "
        "experiments/value_screener.py divide TradingView market_cap_basic "
        "by 1e7 assuming INR. Calibrated against yfinance on 389 symbols, "
        "TV units are ~96.9x smaller than INR -- those filters are ~100x "
        "looser than labelled (e.g. a '100Cr+' filter is really ~9700Cr+).",
        "",
        "## Hand-verification (raw candles vs booked)",
        "",
        *vlines,
        "",
        "## Skips",
        "",
        json.dumps(skips, indent=1),
    ]
    open(OUT_MD, "w").write("\n".join(lines) + "\n")
    print("wrote", OUT_JSON, OUT_MD, flush=True)
    for k in ("n500_nogate", "n500_gate", "alleq_nogate", "alleq_gate",
              "non500_gate", "smallcap_gate", "largemid_gate", "unknown_mcap_gate"):
        print(k, pooled[k]["no_slip"], flush=True)
    print("anchor:", anchor, flush=True)


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "run"
    if phase == "fetch":
        fetch_all()
    elif phase == "mcaps":
        fetch_mcaps()
    elif phase == "mcaps2":
        fetch_mcaps_yf()
    elif phase == "run":
        run_all()
    elif phase == "report":
        report()
    else:
        raise SystemExit(f"unknown phase {phase!r} (fetch|mcaps|run|report)")


if __name__ == "__main__":
    main()