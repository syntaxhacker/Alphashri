import gc
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
sys.path.insert(0, str(ROOT.parent))
sys.path.insert(0, str(ROOT))

from timeless_reversion import ReversionConfig, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars

ET = ZoneInfo('America/New_York')
basis_path = ROOT.parent / 'scripts' / 'nq_basis.json'
basis = json.load(open(basis_path))
cache_dir = ROOT / 'data' / 'duka_cache'
start = '2026-06-01'
end = '2026-09-14'
config = ReversionConfig(entry_start='09:30', entry_end='11:00')

def run_one(path):
    d = path.stem.rsplit('_', 1)[-1]
    raw = json.load(open(path))
    if not isinstance(raw, list) or len(raw) < 1000:
        return {'date': d, 'status': 'small', 'ticks': len(raw) if isinstance(raw, list) else -1}
    med = float(basis.get(d, {}).get('med', 0.0))
    ticks = [{**t, 'bidPrice': float(t['bidPrice']) + med, 'askPrice': float(t['askPrice']) + med} for t in raw]
    bars = build_1m_bars(ticks)
    try:
        fair = fair_price_at_et_open(bars, d)
    except ValueError:
        return {'date': d, 'status': 'no_open', 'ticks': len(ticks), 'bars': len(bars)}
    trades = run_timeless_reversion(bars, ticks, fair_price=fair, config=config)
    for tr in trades:
        tr['date'] = d
    return {'date': d, 'status': 'ok', 'ticks': len(ticks), 'bars': len(bars), 'fair': fair, 'trades': trades}

paths = [p for p in sorted(cache_dir.glob('usatechidxusd_2026-*.json')) if start <= p.stem.rsplit('_',1)[-1] <= end]
all_trades = []
rows = []
for i, p in enumerate(paths, 1):
    r = run_one(p)
    rows.append(r)
    all_trades.extend(r.get('trades', []))
    print(f"[{i}/{len(paths)}] {r['date']} {r['status']} ticks={r.get('ticks',0):,} trades={len(r.get('trades',[]))}", flush=True)
    gc.collect()

points = sum(float(t['pnl']) for t in all_trades)
wins = [t for t in all_trades if t['pnl'] > 0]
losses = [t for t in all_trades if t['pnl'] <= 0]
gross_win = sum(float(t['pnl']) for t in wins)
gross_loss = -sum(float(t['pnl']) for t in losses)
daily = defaultdict(float)
for t in all_trades:
    daily[t['date']] += float(t['pnl'])
ordered_days = sorted(daily)
max_day = max(daily.items(), key=lambda x: x[1]) if daily else None
min_day = min(daily.items(), key=lambda x: x[1]) if daily else None
streak = best_streak = 0
for t in all_trades:
    if t['pnl'] < 0:
        streak += 1
        best_streak = max(best_streak, streak)
    else:
        streak = 0
print('\nSUMMARY')
print('paths', len(paths), 'valid_sessions', sum(r['status']=='ok' for r in rows), 'with_trades', len(daily), 'skipped', [(r['date'],r['status']) for r in rows if r['status']!='ok'])
print('trades', len(all_trades), 'wins', len(wins), 'losses', len(losses), 'win_rate', round(100*len(wins)/len(all_trades),2) if all_trades else None)
print('points', round(points,2), 'usd_gross', round(points*12,2), 'avg_trade', round(points/len(all_trades),2) if all_trades else None, 'profit_factor', round(gross_win/gross_loss,3) if gross_loss else None)
print('positive_days', sum(v>0 for v in daily.values()), 'negative_days', sum(v<0 for v in daily.values()), 'flat_days', sum(v==0 for v in daily.values()))
print('best_day', max_day, 'worst_day', min_day, 'max_consecutive_losses', best_streak)
print('daily')
for d in ordered_days:
    print(d, round(daily[d],2), len([t for t in all_trades if t['date']==d]))
print('TRADES')
for t in all_trades:
    e = datetime.fromtimestamp(t['time'], tz=timezone.utc).astimezone(ET)
    x = datetime.fromtimestamp(t['exit_time'], tz=timezone.utc).astimezone(ET)
    print(t['date'], e.strftime('%H:%M:%S'), t['result'], t['pnl'], x.strftime('%H:%M:%S'), t['entry'], t['exit'])
