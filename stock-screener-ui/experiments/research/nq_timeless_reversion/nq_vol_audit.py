import gc, json, statistics, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
sys.path.insert(0,str(ROOT)); sys.path.insert(0,str(ROOT.parent))
from timeless_reversion import ReversionConfig, _fetch_fresh_dukascopy_ticks, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars
ET=ZoneInfo('America/New_York')
recent={'2026-09-03','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14'}
cfg=ReversionConfig(entry_start='09:30',entry_end='11:00',max_signal_range_points=30)

def m(ts):
    x=datetime.fromtimestamp(ts,timezone.utc).astimezone(ET); return x.hour*60+x.minute

def day_eval(day, raw):
    if not raw: return None
    bars=build_1m_bars(raw)
    try: fair=fair_price_at_et_open(bars,day)
    except ValueError: return None
    def window(end): return [b for b in bars if 570<=m(b['time'])<end]
    def tr_stats(bs):
        trs=[]; prev=None
        for b in bs:
            h=float(b['high']); l=float(b['low']); c=float(b['close'])
            trs.append(max(h-l, abs(h-prev), abs(l-prev)) if prev is not None else h-l); prev=c
        return statistics.mean(trs) if trs else None
    b15=window(585); b30=window(600); b60=window(630)
    tr=run_timeless_reversion(bars,raw,fair_price=fair,config=cfg)
    return {
        'date':day,'trades':len(tr),'pnl':sum(float(t['pnl']) for t in tr),'wins':sum(float(t['pnl'])>0 for t in tr),
        'range15':max(float(b['high']) for b in b15)-min(float(b['low']) for b in b15) if b15 else None,
        'range30':max(float(b['high']) for b in b30)-min(float(b['low']) for b in b30) if b30 else None,
        'range60':max(float(b['high']) for b in b60)-min(float(b['low']) for b in b60) if b60 else None,
        'atr15':tr_stats(b15),'atr30':tr_stats(b30),'atr60':tr_stats(b60),
        'drive15':float(b15[-1]['close'])-fair if b15 else None,
        'drive30':float(b30[-1]['close'])-fair if b30 else None,
        'drive60':float(b60[-1]['close'])-fair if b60 else None,
    }

days=[]
for p in sorted((ROOT/'data'/'duka_cache').glob('usatechidxusd_2026-*.json')):
    d=p.stem.rsplit('_',1)[-1]
    if '2026-03-01'<=d<='2026-09-14' and d not in recent and p.stat().st_size>=1000:
        days.append(day_eval(d,json.load(open(p))))
for d in sorted(recent): days.append(day_eval(d,_fetch_fresh_dukascopy_ticks(d)))
days=[d for d in days if d]

def summary(name, items):
    trades=sum(x['trades'] for x in items); pnl=sum(x['pnl'] for x in items); wins=sum(x['wins'] for x in items); losses=trades-wins
    print(name,'sessions',len(items),'trade_days',sum(x['trades']>0 for x in items),'trades',trades,'W/L',wins,losses,'points',round(pnl,1),'avg_day',round(pnl/len(items),1) if items else None)
    for f in ['range15','range30','range60','atr15','atr30','atr60','drive15','drive30','drive60']:
        vals=[x[f] for x in items if x[f] is not None]
        if vals: print(' ',f,'mean',round(statistics.mean(vals),1),'median',round(statistics.median(vals),1))

print('ALL DAYS')
summary('all',days)
for month in sorted({x['date'][:7] for x in days}): summary(month,[x for x in days if x['date'].startswith(month)])

def buckets(field, edges):
    print('BUCKET',field)
    for lo,hi in zip(edges,edges[1:]):
        xs=[x for x in days if x[field] is not None and lo<=x[field]<hi]
        summary(f'{lo}-{hi}',xs)
    xs=[x for x in days if x[field] is not None and x[field]>=edges[-1]]
    summary(f'>={edges[-1]}',xs)
buckets('range15',[0,50,75,100,125,150,200,9999])
buckets('range30',[0,75,100,125,150,200,250,300,9999])
buckets('atr30',[0,10,15,20,25,30,40,9999])
buckets('drive30',[-9999,-50,0,50,100,150,200,300,9999])
