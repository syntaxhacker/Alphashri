import gc, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0, '/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
from timeless_reversion import ReversionConfig, _fetch_fresh_dukascopy_ticks, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars
ROOT=Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
recent={'2026-09-03','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14'}
def C(**kw): return ReversionConfig(entry_start='09:30',entry_end='11:00',max_signal_range_points=30,**kw)
configs={'range30':C()}
for x in [150,175,200,225,250,275,300]: configs[f'or30_{x}']=C(opening_range_max_points=x,opening_range_minutes=30)
for x in [75,100,125,150,175,200]: configs[f'or15_{x}']=C(opening_range_max_points=x,opening_range_minutes=15)
rows={k:[] for k in configs}
def ev(day,raw):
    if not raw: return
    bars=build_1m_bars(raw)
    try: fair=fair_price_at_et_open(bars,day)
    except ValueError: return
    for name,cfg in configs.items(): rows[name].extend((day,float(t['pnl'])) for t in run_timeless_reversion(bars,raw,fair_price=fair,config=cfg))
    del bars; gc.collect()
import json
for p in sorted((ROOT/'data'/'duka_cache').glob('usatechidxusd_2026-*.json')):
    d=p.stem.rsplit('_',1)[-1]
    if '2026-03-01'<=d<='2026-09-14' and d not in recent and p.stat().st_size>=1000: ev(d,json.load(open(p)))
for d in sorted(recent): ev(d,_fetch_fresh_dukascopy_ticks(d))
def stats(v):
    w=sum(p>0 for _,p in v); l=len(v)-w; pts=sum(p for _,p in v); gw=sum(p for _,p in v if p>0); gl=-sum(p for _,p in v if p<=0)
    return f'n={len(v):3d} W/L={w:3d}/{l:3d} pts={pts:+7.1f} usd={pts*12:+8.0f} PF={gw/gl if gl else 0:.2f}'
print('name | Mar-May | Jun-Aug | Sep | all')
for name,v in rows.items():
    def sub(a,b): return [(d,p) for d,p in v if a<=d<=b]
    print(f'{name:10s}| {stats(sub("2026-03-01","2026-05-31"))} | {stats(sub("2026-06-01","2026-08-31"))} | {stats(sub("2026-09-01","2026-09-14"))} | {stats(v)}')
    mo=defaultdict(float)
    for d,p in v: mo[d[:7]]+=p
    print(' monthly',dict(sorted(mo.items())))
