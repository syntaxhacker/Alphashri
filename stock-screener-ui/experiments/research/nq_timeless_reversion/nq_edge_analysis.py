import gc, json, statistics, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
sys.path.insert(0,str(ROOT)); sys.path.insert(0,str(ROOT.parent))
from timeless_reversion import ReversionConfig, _fetch_fresh_dukascopy_ticks, _shift_cash_ticks_to_nq, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars
ET=ZoneInfo('America/New_York')
basis=json.load(open(ROOT.parent/'scripts'/'nq_basis.json'))
cfg=ReversionConfig(entry_start='09:30',entry_end='11:00',opening_drive_max_points=30)

def emastate(bars, end_time):
    e9=e20=None; vnum=0.; n=0
    for b in bars:
        if not (9*60+30 <= etmin(b['time']) <= etmin(end_time)): continue
        c=float(b['close']); typ=(float(b['high'])+float(b['low'])+c)/3
        e9=c if e9 is None else (2/10)*c+(1-2/10)*e9
        e20=c if e20 is None else (2/21)*c+(1-2/21)*e20
        vnum+=typ; n+=1
    return (e9-e20 if e9 is not None else None, (vnum/n) if n else None)
def etmin(ts):
    x=datetime.fromtimestamp(ts,timezone.utc).astimezone(ET); return x.hour*60+x.minute
def bclose(bars, m):
    b=next((x for x in bars if etmin(x['time'])==m),None); return float(b['close']) if b else None
def eval_day(day, raw, med):
    ticks=[{**t,'bidPrice':float(t['bidPrice'])+med,'askPrice':float(t['askPrice'])+med} for t in raw]
    bars=build_1m_bars(ticks)
    try: fair=fair_price_at_et_open(bars,day)
    except ValueError: return []
    opening=[b for b in bars if 570<=etmin(b['time'])<630]
    drives={n:(float(opening[n-1]['close'])-fair if len(opening)>=n else None) for n in (15,30,60)}
    session=[b for b in bars if etmin(b['time'])>=570]
    trades=run_timeless_reversion(bars,ticks,fair_price=fair,config=cfg)
    out=[]
    for num,tr in enumerate(trades,1):
        sb=next((b for b in bars if b['time']==tr['meta']['signal_bar']),None)
        if not sb: continue
        eg,vwap=emastate(bars,sb['time']); c=float(sb['close']); hi=float(sb['high']); lo=float(sb['low']); rng=hi-lo
        after=[b for b in bars if tr['time']<=b['time']<=tr['exit_time']]
        next5=[b for b in bars if tr['time']<=b['time']<tr['time']+5*60]
        x={'date':day,'pnl':float(tr['pnl']),'win':float(tr['pnl'])>0,'time':etmin(tr['meta']['signal_bar']),
           'trade_num':num,'day_trades':len(trades),'drive15':drives[15],'drive30':drives[30],'drive60':drives[60],
           'entry_fair':float(tr['entry'])-fair,'bos_depth':float(tr['meta']['bos_level'])-c,
           'range':rng,'body':abs(float(sb['open'])-c),'close_location':(c-lo)/rng if rng else None,
           'upper_wick':hi-max(float(sb['open']),c),'lower_wick':min(float(sb['open']),c)-lo,
           'ema_gap':eg,'vwap_gap':c-vwap if vwap is not None else None,
           'next5_reclaim':max((float(b['high'])-float(tr['meta']['bos_level']) for b in next5),default=0),
           'exit_reclaim':max((float(b['close'])-float(tr['meta']['bos_level']) for b in after),default=0)}
        out.append(x)
    del ticks,bars; gc.collect(); return out

rows=[]
for p in sorted((ROOT/'data'/'duka_cache').glob('usatechidxusd_2026-*.json')):
    d=p.stem.rsplit('_',1)[-1]
    if '2026-06-01'<=d<='2026-09-04' and p.stat().st_size>=1000:
        rows += eval_day(d,json.load(open(p)),float(basis.get(d,{}).get('med',0.0)))
for d in ['2026-09-03','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14']:
    raw=_fetch_fresh_dukascopy_ticks(d); shifted,med=_shift_cash_ticks_to_nq(d,raw); rows += eval_day(d,shifted,med)

print('rows',len(rows),'wins',sum(r['win'] for r in rows),'losses',sum(not r['win'] for r in rows),'points',sum(r['pnl'] for r in rows))
features=['time','drive15','drive30','drive60','entry_fair','bos_depth','range','body','close_location','upper_wick','lower_wick','ema_gap','vwap_gap','next5_reclaim','exit_reclaim']
for f in features:
    w=[r[f] for r in rows if r['win'] and r[f] is not None]; l=[r[f] for r in rows if not r['win'] and r[f] is not None]
    print(f, 'W', round(statistics.mean(w),2),round(statistics.median(w),2),'L',round(statistics.mean(l),2),round(statistics.median(l),2))

def bins(name, fn):
    d=defaultdict(list)
    for r in rows: d[fn(r)].append(r['pnl'])
    print(name)
    for k in sorted(d,key=str):
        v=d[k]; print(' ',k,'n',len(v),'w',sum(x>0 for x in v),'p',round(sum(v),1),'avg',round(sum(v)/len(v),2))
bins('time buckets',lambda r: '09:30-10:00' if r['time']<600 else ('10:00-10:30' if r['time']<630 else '10:30-11:00'))
bins('drive30',lambda r: '<60' if r['drive30']<60 else ('60-120' if r['drive30']<120 else '>=120'))
bins('drive60',lambda r: 'missing' if r['drive60'] is None else ('<80' if r['drive60']<80 else ('80-150' if r['drive60']<150 else '>=150')))
bins('bos depth',lambda r: '<5' if r['bos_depth']<5 else ('5-10' if r['bos_depth']<10 else '>=10'))
bins('ema9-20',lambda r: 'missing' if r['ema_gap'] is None else ('<-10' if r['ema_gap']<-10 else ('-10 to 0' if r['ema_gap']<0 else ('0 to 10' if r['ema_gap']<10 else '>=10'))))
bins('close-vwap',lambda r: 'missing' if r['vwap_gap'] is None else ('<0' if r['vwap_gap']<0 else ('0-30' if r['vwap_gap']<30 else '>=30')))
bins('trade number',lambda r: str(r['trade_num']))
print('DAY RESULTS')
dd=defaultdict(list)
for r in rows: dd[r['date']].append(r['pnl'])
for d in sorted(dd): print(d,len(dd[d]),sum(dd[d]),sum(x>0 for x in dd[d]))
