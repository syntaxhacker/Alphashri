import json,os,subprocess,time,re
HERE=os.getcwd()
BASE={"htf":15,"htf_buf":10.0,"htf_look":20,"ltf_win":30,"disp_body":0.5,"atr_mult":1.2,
      "fvg_min":2.0,"fvg_max_atr":3.0,"entry_win":10,"sl_buf":2.0,"time_bars":60}
def run(p):
    json.dump(p,open("params.json","w"))
    out=subprocess.run(["/home/mysyntax/Documents/Alphashri/stock-screener-ui/.venv/bin/python","backtest_v2.py"],capture_output=True,text=True,timeout=300).stdout
    return {k:float(v) for k,v in re.findall(r"METRIC (\w+)=([-\d.]+)",out)}
def c(d,**o):
    p=dict(BASE); p.update(o); return d,p
C=[c("base"),c("htf60",htf=60),c("htf5",htf=5),c("htf30",htf=30),
   c("look10",htf_look=10),c("look40",htf_look=40),c("look60",htf_look=60),
   c("buf5",htf_buf=5.0),c("buf20",htf_buf=20.0),c("buf0",htf_buf=0.0),
   c("ltf15",ltf_win=15),c("ltf60",ltf_win=60),c("ltf120",ltf_win=120),
   c("t30",time_bars=30),c("t120",time_bars=120),c("t240",time_bars=240),
   c("ew5",entry_win=5),c("ew20",entry_win=20),c("db.4",disp_body=0.4),c("db.6",disp_body=0.6),
   c("fvg3",fvg_min=3.0),c("fvg1",fvg_min=1.0),c("slbuf5",sl_buf=5.0),c("atr1.0",atr_mult=1.0),
   c("htf60_look40_t120",htf=60,htf_look=40,time_bars=120),
   c("htf15_ltf60_t120",ltf_win=60,time_bars=120),
   c("htf15_buf20_t120",htf_buf=20.0,time_bars=120)]
run_no=1000; best=None; log=open("autoresearch.jsonl","a")
for desc,p in C:
    run_no+=1; m=run(p)
    iss=m.get("is_avgR",0); oos=m.get("oos_avgR",0); n=int(m.get("total_n",0)); pf=m.get("oos_pf",0); win=m.get("oos_win",0)
    robust=min(iss,oos); ok=robust>0 and n>=40; score=robust if ok else -999
    keep=best is None or score>best[0]
    if keep: best=(score,desc,dict(p),oos,iss,n,pf,win)
    log.write(json.dumps({"run":run_no,"metric":round(oos,4),"metrics":{"is_avgR":round(iss,4),"total_n":n,"oos_pf":pf,"oos_win":win},"status":"keep" if keep else "discard","description":"V2 "+desc,"timestamp":int(time.time()),"segment":8,"commit":"local"})+"\n"); log.flush()
    print(f"{run_no:>4} {desc:22} IS {iss:+.3f} OOS {oos:+.3f} n {n:>4} pf {pf:>5.2f} win {win:>3.0f} {'KEEP' if keep else ''}")
log.close()
print("\nBEST V2:",best[1],"IS",round(best[4],3),"OOS",round(best[3],3),"n",best[5],"pf",best[6])
json.dump(best[2],open("best_v2.json","w"))
