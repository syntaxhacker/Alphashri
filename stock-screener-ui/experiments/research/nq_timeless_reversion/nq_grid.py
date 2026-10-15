import gc, json, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0,'/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments'); sys.path.insert(0,'/home/mysyntax/Documents/Alphashri/stock-screener-ui')
from timeless_reversion import ReversionConfig, _fetch_fresh_dukascopy_ticks, _shift_cash_ticks_to_nq, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars
ROOT=Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
basis=json.load(open(ROOT.parent/'scripts'/'nq_basis.json'))
def C(**kw): return ReversionConfig(entry_start='09:30',entry_end='11:00',**kw)
configs={
 'baseline':C(), 'drive20':C(opening_drive_max_points=20), 'drive30':C(opening_drive_max_points=30), 'drive40':C(opening_drive_max_points=40), 'drive50':C(opening_drive_max_points=50),
 'range25':C(max_signal_range_points=25), 'range30':C(max_signal_range_points=30), 'range35':C(max_signal_range_points=35), 'range40':C(max_signal_range_points=40),
 'drive30_range25':C(opening_drive_max_points=30,max_signal_range_points=25), 'drive30_range30':C(opening_drive_max_points=30,max_signal_range_points=30), 'drive30_range35':C(opening_drive_max_points=30,max_signal_range_points=35), 'drive30_range40':C(opening_drive_max_points=30,max_signal_range_points=40),
 'ema_range30':C(require_bearish_ema=True,max_signal_range_points=30), 'drive30_ema':C(opening_drive_max_points=30,require_bearish_ema=True), 'drive30_ema_range30':C(opening_drive_max_points=30,require_bearish_ema=True,max_signal_range_points=30),
 'confirm1':C(bos_confirmation_bars=1), 'range30_confirm1':C(max_signal_range_points=30,bos_confirmation_bars=1), 'drive30_confirm1':C(opening_drive_max_points=30,bos_confirmation_bars=1),
 'range30_loss1':C(max_signal_range_points=30,max_consecutive_losses=1), 'range30_loss2':C(max_signal_range_points=30,max_consecutive_losses=2),
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
    w=sum(p>0 for _,p in v); l=len(v)-w; pts=sum(p for _,p in v); gw=sum(p for _,p in v if p>0); gl=-sum(p for _,p in v if p<=0)
    return f'n={len(v):3d} W/L={w:2d}/{l:2d} pts={pts:+7.1f} usd={pts*12:+8.0f} PF={gw/gl if gl else 0:.2f}'
def bucket(v, start, end): return [(d,p) for d,p in v if start<=d<=end]
print('name | train May-Jul | validation Aug | final Sep | all')
for name,v in rows.items():
    print(f'{name:20s}| {stats(bucket(v,"2026-05-01","2026-07-31"))} | {stats(bucket(v,"2026-08-01","2026-08-31"))} | {stats(bucket(v,"2026-09-01","2026-09-14"))} | {stats(v)}')
