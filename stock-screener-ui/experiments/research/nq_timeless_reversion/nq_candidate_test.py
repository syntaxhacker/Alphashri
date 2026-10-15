import gc, json, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0,'/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments'); sys.path.insert(0,'/home/mysyntax/Documents/Alphashri/stock-screener-ui')
from timeless_reversion import ReversionConfig, _fetch_fresh_dukascopy_ticks, _shift_cash_ticks_to_nq, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars
ROOT=Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
basis=json.load(open(ROOT.parent/'scripts'/'nq_basis.json'))
configs={
 'baseline':ReversionConfig(entry_start='09:30',entry_end='11:00'),
 'ema':ReversionConfig(entry_start='09:30',entry_end='11:00',require_bearish_ema=True),
 'range30':ReversionConfig(entry_start='09:30',entry_end='11:00',max_signal_range_points=30),
 'ema_range30':ReversionConfig(entry_start='09:30',entry_end='11:00',require_bearish_ema=True,max_signal_range_points=30),
 'drive30':ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30),
 'drive30_ema':ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30,require_bearish_ema=True),
 'drive30_range30':ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30,max_signal_range_points=30),
 'drive30_range35':ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30,max_signal_range_points=35),
 'drive30_ema_range30':ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30,require_bearish_ema=True,max_signal_range_points=30),
}
rows={k:[] for k in configs}
def ev(d,raw,med):
    ticks=[{**t,'bidPrice':float(t['bidPrice'])+med,'askPrice':float(t['askPrice'])+med} for t in raw]; bars=build_1m_bars(ticks)
    try: fair=fair_price_at_et_open(bars,d)
    except ValueError: return
    for name,cfg in configs.items(): rows[name].extend((d,float(t['pnl'])) for t in run_timeless_reversion(bars,ticks,fair_price=fair,config=cfg))
    del ticks,bars; gc.collect()
for p in sorted((ROOT/'data'/'duka_cache').glob('usatechidxusd_2026-*.json')):
    d=p.stem.rsplit('_',1)[-1]
    if '2026-05-01'<=d<='2026-09-04' and p.stat().st_size>=1000: ev(d,json.load(open(p)),float(basis.get(d,{}).get('med',0.0)))
for d in ['2026-09-03','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14']:
    raw=_fetch_fresh_dukascopy_ticks(d); shifted,med=_shift_cash_ticks_to_nq(d,raw); ev(d,shifted,med)
def stats(v):
    w=sum(p>0 for _,p in v); l=len(v)-w; pts=sum(p for _,p in v); return len(v),w,l,pts,pts*12
for name,v in rows.items():
    print(name,'ALL',stats(v),'TRAIN',stats([(d,p) for d,p in v if d<='2026-07-31']),'HOLDOUT',stats([(d,p) for d,p in v if d>='2026-08-01']))
    dm=defaultdict(float)
    for d,p in v: dm[d[:7]]+=p
    print(' MONTH',dict(sorted(dm.items())))
    dw=defaultdict(float)
    for d,p in v:
        x=date.fromisoformat(d); dw[(x-timedelta(days=x.weekday())).isoformat()]+=p
    print(' WEEK',dict(sorted(dw.items())))
