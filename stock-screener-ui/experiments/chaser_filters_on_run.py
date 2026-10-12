"""FULL all-equity sweep with filters ENABLED: 52W Chaser, days=365,
params={"enable_filters": True}.

Universe: chart_patterns.universes.get_universe("all_equity") (~2685).
Engine: backtest.engine.get_engine().run("52w_chaser", chunk, days=365, params)
Chunked (CHUNK=10, internal pool <=4 workers i.e. <=6) with resume:
progress in experiments/chaser_filters_on_progress.json, saved every chunk,
logged every 50 symbols. Re-run skips done/error symbols.

Additionally stores minimal per-trade records (date/gross/costs/net/reason)
per symbol under "trades" for the first-half/second-half split in the report.
"""
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

PROG = Path("experiments/chaser_filters_on_progress.json")
PARAMS = {"enable_filters": True}
CHUNK = 10
LOG_EVERY = 50


def save(prog):
    tmp = str(PROG) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(prog, f, indent=1)
    os.replace(tmp, PROG)


def zero_row(note="no signals in window"):
    return {"trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
            "gross_pnl": 0.0, "total_costs": 0.0, "net_pnl": 0.0,
            "note": note, "trades_list": []}


def main():
    sys.path.insert(0, ".")
    from chart_patterns.universes import get_universe
    symbols = sorted(get_universe("all_equity"))
    if os.path.exists(PROG):
        with open(PROG) as f:
            prog = json.load(f)
    else:
        prog = {"started_at": datetime.now().isoformat(), "strategy": "52w_chaser",
                "days": 365, "params": PARAMS, "universe": "all_equity",
                "universe_n": len(symbols),
                "done": {}, "errors": {}, "chunks_completed": 0, "chunk_times_sec": []}
    prog["universe_n"] = len(symbols)
    prog["params"] = PARAMS
    done, errors = prog["done"], prog["errors"]
    todo = [s for s in symbols if s not in done and s not in errors]
    print(f"universe={len(symbols)} done={len(done)} errors={len(errors)} "
          f"todo={len(todo)} params={PARAMS}", flush=True)

    from backtest.engine import get_engine
    eng = get_engine()

    since_log = 0
    i = 0
    n_chunks = (len(todo) + CHUNK - 1) // CHUNK
    base_chunk = prog["chunks_completed"]
    while i < len(todo):
        chunk = todo[i:i + CHUNK]
        cnum = base_chunk + (i // CHUNK) + 1
        t0 = time.time()
        try:
            res = eng.run("52w_chaser", chunk, days=365, params=dict(PARAMS))
        except Exception as e:
            print(f"CHUNK {cnum}/{base_chunk + n_chunks} ENGINE EXCEPTION: {e}", flush=True)
            for s in chunk:
                errors[s] = f"engine exception: {e}"[:300]
            prog["chunks_completed"] = cnum
            save(prog)
            i += CHUNK
            continue
        el = round(time.time() - t0, 1)
        by_sym = {r.get("symbol"): r for r in (res.get("results") or [])}
        skips = {s.get("symbol"): s.get("error", "?") for s in (res.get("skipped_stocks") or [])}
        chart = res.get("chart_data") or {}
        n_tr = 0
        for s in chunk:
            if s in by_sym:
                r = by_sym[s]
                tl = (chart.get(s) or {}).get("trades") or []
                mini = [{"d": t.get("date"),
                         "g": t.get("gross_pnl", 0.0),
                         "c": t.get("trading_costs", 0.0),
                         "n": t.get("net_pnl", 0.0),
                         "r": t.get("exit_reason"),
                         "ep": t.get("entry_price"),
                         "xp": t.get("exit_price"),
                         "q": t.get("quantity")}
                        for t in tl]
                done[s] = {"trades": r.get("trades", 0), "wins": r.get("wins", 0),
                           "losses": r.get("losses", 0), "win_rate": r.get("win_rate", 0.0),
                           "gross_pnl": r.get("gross_pnl", 0.0), "total_costs": r.get("total_costs", 0.0),
                           "net_pnl": r.get("net_pnl", 0.0), "pf": r.get("pf"),
                           "tp_exits": r.get("tp_exits", 0), "sl_exits": r.get("sl_exits", 0),
                           "trailing_exits": r.get("trailing_exits", 0),
                           "max_hold_exits": r.get("max_hold_exits", 0),
                           "trades_list": mini}
                n_tr += r.get("trades", 0)
            elif s in skips:
                errors[s] = skips[s]
            else:
                done[s] = zero_row()
        prog["chunks_completed"] = cnum
        prog["chunk_times_sec"].append(el)
        prog["last_chunk_at"] = datetime.now().isoformat()
        save(prog)
        since_log += len(chunk)
        if since_log >= LOG_EVERY or (i + CHUNK) >= len(todo):
            print(f"CHUNK {cnum}/{base_chunk + n_chunks}: done={len(done)} errors={len(errors)} "
                  f"chunk_trades={n_tr} {el}s", flush=True)
            since_log = 0
        i += CHUNK

    print(f"COMPLETE: done={len(done)} errors={len(errors)}", flush=True)


if __name__ == "__main__":
    main()
