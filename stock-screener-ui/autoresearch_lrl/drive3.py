import json, os, subprocess, time, re
HERE=os.path.dirname(os.path.abspath(__file__))
BASE={"tf":1,"buf":3.0,"maxdist":45.0,"disp_body":0.5,"atr_mult":1.2,"fvg_min":3.0,"fvg_max_atr":3.0,
      "look_disp":5,"entry_win":5,"sl_buf":0.0,"horizon":240,"exit":"trail","trail":0.25,"fixed_R":2.0,
      "time_bars":10,"be":0.0,"sess_start":570,"sess_end":960,"trend":"none"}
def run(p):
    json.dump(p,open(os.path.join(HERE,"params.json"),"w"))
    out=subprocess.run([os.path.join(HERE,"autoresearch.sh")],capture_output=True,text=True,timeout=300).stdout
    m=dict(re.findall(r"METRIC (\w+)=([-\d.]+)",out)); return {k:float(v) for k,v in m.items()}
def c(d,**o):
    p=dict(BASE); p.update(o); return d,p
C=[
 # --- exits (longer holds) ---
 c("trail0.5",trail=0.5), c("trail0.75",trail=0.75), c("trail1.0",trail=1.0), c("trail1.5",trail=1.5), c("trail2.0",trail=2.0),
 c("fixed1.5",exit="fixed",fixed_R=1.5), c("fixed2",exit="fixed",fixed_R=2.0), c("fixed2.5",exit="fixed",fixed_R=2.5), c("fixed3",exit="fixed",fixed_R=3.0),
 c("time5",exit="time",time_bars=5), c("time10",exit="time",time_bars=10), c("time15",exit="time",time_bars=15), c("time30",exit="time",time_bars=30),
 c("be1_trail1",trail=1.0,be=1.0), c("be0.5_trail1",trail=1.0,be=0.5), c("be1_trail0.5",trail=0.5,be=1.0),
 # --- session filters (trail1.0 base) ---
 c("sess_open2h_trail1",sess_end=690,trail=1.0), c("sess_open3h_trail1",sess_end=750,trail=1.0),
 c("sess_open2h_trail0.5",sess_end=690,trail=0.5), c("sess_open2h_fixed2",sess_end=690,exit="fixed",fixed_R=2.0),
 c("trend_ema_trail1",trend="ema200",trail=1.0), c("trend_dayopen_trail1",trend="dayopen",trail=1.0),
 c("sess2h+trend_trail1",sess_end=690,trend="ema200",trail=1.0),
 # --- params with trail1.0 ---
 c("loose_buf2_fvg2_trail1",buf=2.0,fvg_min=2.0,disp_body=0.45,trail=1.0),
 c("loose_buf2_fvg2_fixed2",buf=2.0,fvg_min=2.0,disp_body=0.45,exit="fixed",fixed_R=2.0),
 c("ew10_trail1",entry_win=10,trail=1.0), c("ew15_trail1",entry_win=15,trail=1.0),
 c("fvg2_trail1",fvg_min=2.0,trail=1.0), c("db0.45_trail1",disp_body=0.45,trail=1.0),
 c("atr1.0_trail1",atr_mult=1.0,trail=1.0), c("slbuf2_trail1",sl_buf=2.0,trail=1.0),
]
run_no=0; best=None
log=open(os.path.join(HERE,"autoresearch.jsonl"),"a")
for desc,p in C:
    run_no+=1
    m=run(p)
    iss=m.get("is_avgR",0); oos=m.get("oos_avgR",0); n=int(m.get("oos_n",0)); hold=m.get("oos_hold",0); pf=m.get("oos_pf",0)
    robust=min(iss,oos)
    ok = robust>0 and hold>=3           # want robust edge AND holds >= 3 bars
    score=robust if ok else -999
    keep = best is None or score>best[0]
    if keep: best=(score,desc,dict(p),oos,iss,n,hold,pf)
    log.write(json.dumps({"run":run_no,"commit":"local","metric":round(oos,4),
        "metrics":{"is_avgR":round(iss,4),"oos_n":n,"oos_hold":hold,"oos_pf":pf},"status":"keep" if keep else "discard",
        "description":desc,"timestamp":int(time.time()),"segment":2})+"\n"); log.flush()
    print(f"{run_no:>2} {desc:28} IS {iss:+.3f} OOS {oos:+.3f} n {n:>4} hold {int(hold):>3} pf {pf:>5.2f} {'KEEP' if keep else ''}")
log.close()
print("\nBEST:",best[1],"IS",round(best[4],3),"OOS",round(best[3],3),"n",best[5],"hold",int(best[6]),"pf",best[7])
json.dump(best[2],open(os.path.join(HERE,"best_params.json"),"w"))
