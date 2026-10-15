import gc, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, '/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
sys.path.insert(0, '/home/mysyntax/Documents/Alphashri/stock-screener-ui')
from timeless_reversion import ReversionConfig, _fetch_fresh_dukascopy_ticks, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars

ROOT = Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
recent = {'2026-09-03', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14'}
configs = {
    'original': ReversionConfig(entry_start='09:30', entry_end='11:00', max_signal_range_points=None),
    'improved': ReversionConfig(entry_start='09:30', entry_end='11:00', max_signal_range_points=30),
}
rows = {k: [] for k in configs}
sessions = []
skipped = []

def evaluate(day, raw):
    if not raw:
        skipped.append((day, 'empty'))
        return
    bars = build_1m_bars(raw)
    try:
        fair = fair_price_at_et_open(bars, day)
    except ValueError:
        skipped.append((day, 'no_09:30'))
        return
    sessions.append(day)
    for name, cfg in configs.items():
        for trade in run_timeless_reversion(bars, raw, fair_price=fair, config=cfg):
            rows[name].append((day, float(trade['pnl'])))
    del bars
    gc.collect()

for path in sorted((ROOT / 'data' / 'duka_cache').glob('usatechidxusd_2026-*.json')):
    day = path.stem.rsplit('_', 1)[-1]
    if '2026-03-01' <= day <= '2026-09-14' and day not in recent and path.stat().st_size >= 1000:
        import json
        evaluate(day, json.load(open(path)))
for day in sorted(recent):
    evaluate(day, _fetch_fresh_dukascopy_ticks(day))

def stat(values):
    wins = sum(p > 0 for _, p in values)
    losses = len(values) - wins
    points = sum(p for _, p in values)
    gross_win = sum(p for _, p in values if p > 0)
    gross_loss = -sum(p for _, p in values if p <= 0)
    equity = peak = drawdown = 0.0
    for _, p in values:
        equity += p
        peak = max(peak, equity)
        drawdown = min(drawdown, equity - peak)
    days = defaultdict(float)
    for day, p in values:
        days[day] += p
    return {
        'trades': len(values), 'wins': wins, 'losses': losses,
        'win_rate': round(100 * wins / len(values), 2) if values else 0,
        'points': round(points, 1), 'usd': round(points * 12, 0),
        'pf': round(gross_win / gross_loss, 2) if gross_loss else None,
        'max_dd_points': round(drawdown, 1), 'max_dd_usd': round(drawdown * 12, 0),
        'positive_days': sum(p > 0 for p in days.values()),
        'negative_days': sum(p < 0 for p in days.values()), 'trade_days': len(days),
    }

def week(day):
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()

def group(values, key):
    result = defaultdict(list)
    for day, p in values:
        result[key(day)].append((day, p))
    return result

print('sessions', len(set(sessions)), 'skipped', len(skipped), skipped)
for name, values in rows.items():
    print('\n' + name, stat(values))
    print('monthly')
    for key, group_values in sorted(group(values, lambda d: d[:7]).items()):
        print(key, stat(group_values))
    print('weekly')
    for key, group_values in sorted(group(values, week).items()):
        print(key, stat(group_values))
