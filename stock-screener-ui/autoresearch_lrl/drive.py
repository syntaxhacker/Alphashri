"""Autoresearch driver: run a grid of strategy-concept candidates, log to JSONL, keep best OOS avgR
subject to IS avgR > 0."""
import json, os, subprocess, time, re
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = {"tf":5,"buf":2.0,"maxdist":45.0,"disp_body":0.55,"atr_mult":1.2,"fvg_min":3.0,"fvg_max_atr":3.0,
        "look_disp":5,"entry_win":15,"sl_buf":2.0,"horizon":240,"exit":"trail","trail":0.5,"fixed_R":2.0}

def run(params):
    json.dump(params, open(os.path.join(HERE,"params.json"),"w"))
    out = subprocess.run([os.path.join(HERE,"autoresearch.sh")], capture_output=True, text=True, timeout=300).stdout
    m = dict(re.findall(r"METRIC (\w+)=([-\d.]+)", out))
    return {k: float(v) for k, v in m.items()}, out

def cand(desc, **over):
    p = dict(BASE); p.update(over); return desc, p

CANDIDATES = [
    cand("baseline trail0.5 tf5"),
    cand("tf1", tf=1),
    cand("trail0.25", trail=0.25), cand("trail0.75", trail=0.75), cand("trail1.0", trail=1.0), cand("trail1.5", trail=1.5),
    cand("trail2.0", trail=2.0),
    cand("fixedR2",  exit="fixed", fixed_R=2.0),
    cand("fixedR1",  exit="fixed", fixed_R=1.0),
    cand("fixedR3",  exit="fixed", fixed_R=3.0),
    cand("entry_win5", entry_win=5), cand("entry_win10", entry_win=10), cand("entry_win25", entry_win=25),
    cand("fvg_min1", fvg_min=1.0), cand("fvg_min2", fvg_min=2.0), cand("fvg_min5", fvg_min=5.0),
    cand("disp0.5", disp_body=0.5), cand("disp0.65", disp_body=0.65), cand("disp0.75", disp_body=0.75),
    cand("atr1.0", atr_mult=1.0), cand("atr1.5", atr_mult=1.5), cand("atr2.0", atr_mult=2.0),
    cand("buf1", buf=1.0), cand("buf3", buf=3.0), cand("buf5", buf=5.0),
    cand("sl0", sl_buf=0.0), cand("sl5", sl_buf=5.0), cand("sl10", sl_buf=10.0),
    cand("fvg_maxatr2", fvg_max_atr=2.0), cand("fvg_maxatr5", fvg_max_atr=5.0),
]

best = None
run_no = 0
log = open(os.path.join(HERE,"autoresearch.jsonl"), "a")
wl = open(os.path.join(HERE,"experiments","worklog.md"), "a")
for desc, p in CANDIDATES:
    run_no += 1
    m, _ = run(p)
    oos = m.get("oos_avgR", 0.0); iss = m.get("is_avgR", 0.0); n = int(m.get("oos_n", 0))
    ok = (iss > 0)                       # guard against fitting a losing IS period
    score = oos if ok else -999
    keep = best is None or score > best[0]
    if keep: best = (score, desc, dict(p), oos, iss)
    line = {"run":run_no,"commit":"local","metric":round(oos,4),"metrics":{"is_avgR":round(iss,4),"oos_n":n},"status":"keep" if keep else "discard","description":desc,"timestamp":int(time.time()),"segment":0}
    log.write(json.dumps(line)+"\n"); log.flush()
    wl.write(f"| {run_no} | {desc} | OOS {oos:+.3f} | IS {iss:+.3f} | n {n} | {'keep' if keep else ''} |\n"); wl.flush()
    print(f"{run_no:>2} {desc:28} OOS {oos:+.3f}  IS {iss:+.3f}  n {n:>3} {'KEEP' if keep else ''}")
log.close(); wl.close()
print("\nBEST:", best[1], "-> OOS", round(best[3],3), "IS", round(best[4],3))
json.dump(best[2], open(os.path.join(HERE,"best_params.json"),"w"))
