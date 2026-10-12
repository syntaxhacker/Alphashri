"""52W Chaser universe sweep: days=365, default params, chunked engine.run with resume.

Reads:  experiments/chaser_universe_list.json  (liquid_symbols)
Writes: experiments/chaser_universe_progress.json (every 25-symbol chunk)
"""
import json
import os
import time
from datetime import datetime

LIST = "experiments/chaser_universe_list.json"
PROG = "experiments/chaser_universe_progress.json"
CHUNK = 25


def save(prog):
    tmp = PROG + ".tmp"
    with open(tmp, "w") as f:
        json.dump(prog, f, indent=1)
    os.replace(tmp, PROG)


def zero_row(note="no signals in window"):
    return {"trades": 0, "wins": 0, "losses": 0, "win_rate": 0.0,
            "gross_pnl": 0.0, "total_costs": 0.0, "net_pnl": 0.0, "note": note}


def main():
    with open(LIST) as f:
        symbols = json.load(f)["liquid_symbols"]
    if os.path.exists(PROG):
        with open(PROG) as f:
            prog = json.load(f)
    else:
        prog = {"started_at": datetime.now().isoformat(), "done": {}, "errors": {},
                "chunks_completed": 0, "chunk_times_sec": []}
    done, errors = prog["done"], prog["errors"]
    todo = [s for s in symbols if s not in done and s not in errors]
    print(f"universe={len(symbols)} done={len(done)} errors={len(errors)} todo={len(todo)}", flush=True)

    from backtest.engine import get_engine
    eng = get_engine()

    i = 0
    n_chunks = (len(todo) + CHUNK - 1) // CHUNK
    while i < len(todo):
        chunk = todo[i:i + CHUNK]
        cnum = prog["chunks_completed"] + 1
        t0 = time.time()
        try:
            res = eng.run("52w_chaser", chunk, days=365, params={})
        except Exception as e:
            print(f"CHUNK {cnum}/{n_chunks} ENGINE EXCEPTION: {e}", flush=True)
            for s in chunk:
                errors[s] = f"engine exception: {e}"
            prog["chunks_completed"] = cnum
            save(prog)
            i += CHUNK
            continue
        el = round(time.time() - t0, 1)
        by_sym = {r.get("symbol"): r for r in (res.get("results") or [])}
        skips = {s.get("symbol"): s.get("error", "?") for s in (res.get("skipped_stocks") or [])}
        n_tr = 0
        for s in chunk:
            if s in by_sym:
                r = by_sym[s]
                done[s] = {"trades": r.get("trades", 0), "wins": r.get("wins", 0),
                           "losses": r.get("losses", 0), "win_rate": r.get("win_rate", 0.0),
                           "gross_pnl": r.get("gross_pnl", 0.0), "total_costs": r.get("total_costs", 0.0),
                           "net_pnl": r.get("net_pnl", 0.0), "pf": r.get("pf"),
                           "tp_exits": r.get("tp_exits", 0), "sl_exits": r.get("sl_exits", 0),
                           "trailing_exits": r.get("trailing_exits", 0),
                           "max_hold_exits": r.get("max_hold_exits", 0)}
                n_tr += r.get("trades", 0)
            elif s in skips:
                errors[s] = skips[s]
            else:
                done[s] = zero_row()
        prog["chunks_completed"] = cnum
        prog["chunk_times_sec"].append(el)
        prog["last_chunk_at"] = datetime.now().isoformat()
        save(prog)
        print(f"CHUNK {cnum}/{n_chunks}: {len(chunk)} sym, {len(by_sym)} with trades, "
              f"{len(skips)} skipped, chunk_trades={n_tr}, {el}s", flush=True)
        i += CHUNK

    print(f"COMPLETE: done={len(done)} errors={len(errors)}", flush=True)


if __name__ == "__main__":
    main()
