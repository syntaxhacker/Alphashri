import json,os,subprocess,time,re
BASE={"htf":60,"K":20,"brk":0.0,"min_rng_atr":1.0,"sl_buf":0.2,"exit":"trail","trail":2.0,"fixed_R":3.0,"maxhold":20}
def c(d,**o):
    p=dict(BASE); p.update(o); return d,p
C=[c("base"),
   c("htf15",htf=15),c("htf30",htf=30),c("htf240",htf=240),
   c("K10",K=10),c("K40",K=40),c("K60",K=60),c("K100",K=100),
   c("rng1.5",min_rng_atr=1.5),c("rng2",min_rng_atr=2.0),c("rng2.5",min_rng_atr=2.5),
   c("trail1",trail=1.0),c("trail1.5",trail=1.5),c("trail3",trail=3.0),c("trail1.0_mh40",trail=1.0,maxhold=40),
   c("fixed3",exit="fixed",fixed_R=3.0),c("fixed5",exit="fixed",fixed_R=5.0),
   c("mh10",maxhold=10),c("mh40",maxhold=40),c("mh80",maxhold=80),
   c("slbuf0.5",sl_buf=0.5),c("slbuf1.0",sl_buf=1.0),
   c("htf60_K40_rng1.5_trail2",K=40,min_rng_atr=1.5),
   c("htf60_K40_rng2_trail2",K=40,min_rng_atr=2.0),
   c("htf30_K40_rng1.5_trail2",htf=30,K=40,min_rng_atr=1.5),
   c("htf60_K100_rng2_trail3",K=100,min_rng_atr=2.0,trail=3.0)]
def run(p):
    json.dump(p,open("params.json","w"))
    out=subprocess.run(["/home/mysyntax/Documents/Alphashri/stock-screener-ui/.venv/bin/python","backtest_v3.py"],capture_output=True,text=True,timeout=300).stdout
    return {k:float(v) for k,v in re.findall(r"METRIC (\w+)=([-\d.]+)",out)}
run_no=2000; best=None; log=open("autoresearch.jsonl","a")
for desc,p in C:
    run_no+=1; m=run(p)
    iss=m.get("is_avgR",0); oos=m.get("oos_avgR",0); n=int(m.get("total_n",0)); pf=m.get("oos_pf",0); win=m.get("oos_win",0); rpm=m.get("oos_rpermo",0)
    robust=min(iss,oos); ok=robust>0 and n>=60; score=rpm if ok else -999
    keep=best is None or score>best[0]
    if keep: best=(score,desc,dict(p),oos,iss,n,pf,win,rpm)
    log.write(json.dumps({"run":run_no,"metric":round(oos,4),"metrics":{"is_avgR":round(iss,4),"total_n":n,"oos_pf":pf,"oos_win":win,"oos_rpermo":rpm},"status":"keep" if keep else "discard","description":"V3 "+desc,"timestamp":int(time.time()),"segment":10,"commit":"local"})+"\n"); log.flush()
    print(f"{run_no:>4} {desc:28} IS {iss:+.3f} OOS {oos:+.3f} n {n:>4} pf {pf:>5.2f} win {win:>3.0f} R/mo {rpm:>5.1f} {'KEEP' if keep else ''}")
log.close()
print("\nBEST V3 (by R/mo):",best[1],"IS",round(best[4],3),"OOS",round(best[3],3),"n",best[5],"pf",best[6],"R/mo",best[8])
json.dump(best[2],open("best_v3.json","w"))
