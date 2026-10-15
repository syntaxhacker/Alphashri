"""52W Target universe study: run 52w_target (365d, default params) across liquid Nifty500.

Universe: nifty500 constituents with 10-day avg volume >= 500k shares (TV prefilter).
Per-symbol via backtest.engine.get_engine().run("52w_target", [sym], days=365, params).
ThreadPoolExecutor(max_workers=4). Checkpoint every 25 symbols; resume by skipping done.
"""
import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PARAMS = {"entry_threshold_pct": 2.0, "stop_loss_pct": 2.0, "trailing_stop_pct": 2.0}
DAYS = 365
VOL_THRESHOLD = 500_000
WORKERS = 4
CHECKPOINT_EVERY = 25

BASE = os.path.dirname(os.path.abspath(__file__))
SYMBOLS_FILE = os.path.join(BASE, "target_universe_symbols.json")
PROGRESS_FILE = os.path.join(BASE, "target_universe_progress.json")
RESULT_FILE = os.path.join(BASE, "target_universe.json")
MD_FILE = os.path.join(BASE, "target_universe.md")


def build_universe():
    from chart_patterns.universes import get_universe
    nifty500 = get_universe("nifty500")
    print(f"nifty500 size: {len(nifty500)}", flush=True)
    if os.path.exists(SYMBOLS_FILE):
        with open(SYMBOLS_FILE) as f:
            saved = json.load(f)
        print(f"reusing saved universe: {len(saved['symbols'])} symbols "
              f"(from_nifty500={saved.get('from_nifty500')}, method={saved.get('method')})", flush=True)
        return saved["symbols"], saved
    from chart_patterns.tv_prefilter import fetch_tv_volume_metrics
    metrics = fetch_tv_volume_metrics(nifty500)
    print(f"TV metrics returned for {len(metrics)} symbols", flush=True)
    if not metrics:
        print("TV unreachable/empty -> FALLBACK to NSE F&O list", flush=True)
        fo = get_universe("nse_fo")
        meta = {"method": "nse_fo_fallback", "from_nifty500": len(nifty500),
                "tv_metrics": 0, "symbols": fo}
        with open(SYMBOLS_FILE, "w") as f:
            json.dump(meta, f, indent=1)
        return fo, meta
    kept, dropped_no_data, dropped_low = [], [], []
    for s in nifty500:
        m = metrics.get(s, {})
        if m.get("unqueried"):
            dropped_no_data.append(s)
            continue
        av = m.get("avg_volume_10d")
        if av is None:
            dropped_no_data.append(s)
        elif av >= VOL_THRESHOLD:
            kept.append(s)
        else:
            dropped_low.append(s)
    print(f"universe filter: kept={len(kept)} low_vol={len(dropped_low)} "
          f"no_data={len(dropped_no_data)}", flush=True)
    meta = {"method": "tv_avg_volume_10d>=500k", "from_nifty500": len(nifty500),
            "tv_metrics": len(metrics), "kept": len(kept),
            "low_vol": len(dropped_low), "no_data": len(dropped_no_data),
            "no_data_symbols": dropped_no_data, "symbols": kept}
    with open(SYMBOLS_FILE, "w") as f:
        json.dump(meta, f, indent=1)
    return kept, meta


def run_one(symbol):
    t0 = time.time()
    try:
        from backtest.engine import get_engine
        out = get_engine().run("52w_target", [symbol], days=DAYS, params=dict(PARAMS))
        elapsed = round(time.time() - t0, 1)
        results = out.get("results", []) or []
        entry = next((r for r in results if r.get("symbol") == symbol), None)
        if entry:
            r = entry
            return {"symbol": symbol, "ok": True, "trades": r.get("trades", 0),
                    "wins": r.get("wins", 0), "losses": r.get("losses", 0),
                    "win_rate": r.get("win_rate", 0), "net": r.get("net_pnl", 0),
                    "gross": r.get("gross_pnl", 0), "costs": r.get("total_costs", 0),
                    "pf": r.get("pf", 0), "sl_exits": r.get("sl_exits", 0),
                    "trailing_exits": r.get("trailing_exits", 0),
                    "max_hold_exits": r.get("max_hold_exits", 0),
                    "elapsed_s": elapsed}
        skipped = out.get("skipped_stocks", []) or []
        if skipped:
            err = skipped[0].get("error", "unknown") if isinstance(skipped[0], dict) else str(skipped[0])
            return {"symbol": symbol, "ok": False, "error": str(err)[:200], "elapsed_s": elapsed}
        return {"symbol": symbol, "ok": True, "trades": 0, "wins": 0,
                "losses": 0, "win_rate": 0, "net": 0.0, "gross": 0.0,
                "costs": 0.0, "pf": 0, "elapsed_s": elapsed, "note": "0 trades"}
    except Exception as e:
        traceback.print_exc()
        return {"symbol": symbol, "ok": False, "error": str(e)[:200],
                "elapsed_s": round(time.time() - t0, 1)}


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}


def save_progress(progress):
    tmp = PROGRESS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(progress, f, indent=1)
    os.replace(tmp, PROGRESS_FILE)


def main():
    verify_only = "--verify" in sys.argv
    symbols, meta = build_universe()
    progress = load_progress()
    todo = [s for s in symbols if s not in progress]
    print(f"universe={len(symbols)} done={len(progress)} todo={len(todo)}", flush=True)

    if verify_only:
        test_syms = [s for s in symbols if s not in progress][:2]
        print(f"VERIFY on {test_syms}", flush=True)
        for s in test_syms:
            r = run_one(s)
            print(json.dumps(r, indent=1), flush=True)
        return

    t_start = time.time()
    done_count = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(run_one, s): s for s in todo}
        for fut in as_completed(futs):
            r = fut.result()
            progress[r["symbol"]] = r
            done_count += 1
            status = f"[{len(progress)}/{len(symbols)}] {r['symbol']}: " + (
                f"trades={r.get('trades')} win%={r.get('win_rate')} net={r.get('net')}"
                if r.get("ok") else f"FAIL {r.get('error')}")
            print(status, flush=True)
            if done_count % CHECKPOINT_EVERY == 0:
                save_progress(progress)
                print(f"-- checkpoint saved ({len(progress)} symbols, "
                      f"{round((time.time()-t_start)/60,1)} min elapsed)", flush=True)
    save_progress(progress)
    print(f"ALL DONE: {len(progress)} symbols in {round((time.time()-t_start)/60,1)} min", flush=True)


if __name__ == "__main__":
    main()
