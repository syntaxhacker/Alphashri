import gc, json, sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
sys.path.insert(0, '/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
from timeless_reversion import ReversionConfig, _fetch_fresh_dukascopy_ticks, _shift_cash_ticks_to_nq, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars

ROOT=Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
basis=json.load(open(ROOT.parent/'scripts'/'nq_basis.json'))
cfg=ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30)
rows=[]
def evaluate(day, raw, med):
    ticks=[{**t,'bidPrice':float(t['bidPrice'])+med,'askPrice':float(t['askPrice'])+med} for t in raw]
    bars=build_1m_bars(ticks)
    try: fair=fair_price_at_et_open(bars,day)
    except ValueError: return
    tr=run_timeless_reversion(bars,ticks,fair_price=fair,config=cfg)
    rows.extend((day,float(x['pnl'])) for x in tr)
    del ticks,bars
    gc.collect()
for p in sorted((ROOT/'data'/'duka_cache').glob('usatechidxusd_2026-*.json')):
    d=p.stem.rsplit('_',1)[-1]
    if not ('2026-06-01'<=d<='2026-09-04') or p.stat().st_size<1000: continue
    raw=json.load(open(p)); evaluate(d,raw,float(basis.get(d,{}).get('med',0.0)))
for d in ['2026-09-03','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14']:
    raw=_fetch_fresh_dukascopy_ticks(d)
    shifted,med=_shift_cash_ticks_to_nq(d,raw)
    evaluate(d,shifted,0.0)

def label_week(d):
    x=date.fromisoformat(d); monday=x-timedelta(days=x.weekday()); return monday.isoformat()
def summarize(label, values):
    points=sum(v for _,v in values); wins=sum(v>0 for _,v in values); losses=sum(v<=0 for _,v in values)
    print(f'{label} trades={len(values):2d} W/L={wins}/{losses} points={points:+6.1f} usd=${points*12:+,.0f}')

by_month=defaultdict(list); by_week=defaultdict(list)
for d,p in rows:
    by_month[d[:7]].append((d,p)); by_week[label_week(d)].append((d,p))
print('FILTER opening_drive_max_points=30')
print('total_trades',len(rows),'total_points',sum(p for _,p in rows),'total_usd',sum(p for _,p in rows)*12)
print('MONTHLY')
for k in sorted(by_month): summarize(k,by_month[k])
print('WEEKLY')
for k in sorted(by_week): summarize(k,by_week[k])
