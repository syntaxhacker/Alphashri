import json, os, subprocess, time, re
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = {"tf":5,"buf":2.0,"maxdist":45.0,"disp_body":0.55,"atr_mult":1.2,"fvg_min":3.0,"fvg_max_atr":3.0,
        "look_disp":5,"entry_win":15,"sl_buf":2.0,"horizon":240,"exit":"trail","trail":0.5,"fixed_R":2.0}
def run(params):
    json.dump(params, open(os.path.join(HERE,"params.json"),"w"))
    out = subprocess.run([os.path.join(HERE,"autoresearch.sh")], capture_output=True, text=True, timeout=300).stdout
    m = dict(re.findall(r"METRIC (\w+)=([-\d.]+)", out))
    return {k: float(v) for k, v in m.items()}
def cand(d, **o):
    p = dict(BASE); p.update(o); return d, p
C = [
    cand("c_disp.5_sl0", disp_body=0.5, sl_buf=0.0),
    cand("c_disp.5_sl0_tr.25", disp_body=0.5, sl_buf=0.0, trail=0.25),
    cand("c_+ew5", disp_body=0.5, sl_buf=0.0, trail=0.25, entry_win=5),
    cand("c_+buf3", disp_body=0.5, sl_buf=0.0, trail=0.25, entry_win=5, buf=3.0),
    cand("c_+atr1.0", disp_body=0.5, sl_buf=0.0, trail=0.25, entry_win=5, atr_mult=1.0),
    cand("c_+fvg5", disp_body=0.5, sl_buf=0.0, trail=0.25, entry_win=5, fvg_min=5.0),
    cand("c_+tr.5", disp_body=0.5, sl_buf=0.0, trail=0.5, entry_win=5),
    cand("c_+tr.1", disp_body=0.5, sl_buf=0.0, trail=0.1, entry_win=5),
    cand("c_+disp.6", disp_body=0.6, sl_buf=0.0, trail=0.25, entry_win=5),
    cand("c_+lookd2", disp_body=0.5, sl_buf=0.0, trail=0.25, entry_win=5, look_disp=2),
    cand("c_tr.5_ew10_buf3", disp_body=0.5, sl_buf=0.0, trail=0.5, entry_win=10, buf=3.0),
    cand("c_tr.25_ew5_buf3_atr1", disp_body=0.5, sl_buf=0.0, trail=0.25, entry_win=5, buf=3.0, atr_mult=1.0),
]
# continue run numbering
run_no = 0
if os.path.exists(os.path.join(HERE,"autoresearch.jsonl")):
    run_no = sum(1 for _ in open(os.path.join(HERE,"autoresearch.jsonl")) )
best = None
log = open(os.path.join(HERE,"autoresearch.jsonl"), "a")
for desc, p in C:
    run_no += 1
    m = run(p); oos=m.get("oos_avgR",0); iss=m.get("is_avgR",0); n=int(m.get("oos_n",0))
    score = oos if iss > 0 else -999
    keep = best is None or score > best[0]
    if keep: best=(score,desc,dict(p),oos,iss,n)
    log.write(json.dumps({"run":run_no,"commit":"local","metric":round(oos,4),"metrics":{"is_avgR":round(iss,4),"oos_n":n},"status":"keep" if keep else "discard","description":desc,"timestamp":int(time.time()),"segment":1})+"\n"); log.flush()
    print(f"{run_no:>2} {desc:24} OOS {oos:+.3f}  IS {iss:+.3f}  n {n:>3} {'KEEP' if keep else ''}")
log.close()
print("\nBEST:", best[1], "OOS", round(best[3],3), "IS", round(best[4],3), "n", best[5])
json.dump(best[2], open(os.path.join(HERE,"best_params.json"),"w"))
