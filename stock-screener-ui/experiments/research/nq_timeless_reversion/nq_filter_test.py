import gc, json, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
sys.path.insert(0, str(ROOT.parent))
sys.path.insert(0, str(ROOT))
from timeless_reversion import ReversionConfig, fair_price_at_et_open, run_timeless_reversion
from scripts.smc_tick_eval import build_1m_bars
basis = json.load(open(ROOT.parent / 'scripts' / 'nq_basis.json'))
cache_dir = ROOT / 'data' / 'duka_cache'
paths = [p for p in sorted(cache_dir.glob('usatechidxusd_2026-*.json')) if '2026-06-01' <= p.stem.rsplit('_',1)[-1] <= '2026-09-04']
configs = [
    ('baseline', None, None),
    ('loss1', None, 1),
    ('loss2', None, 2),
    ('loss3', None, 3),
    ('drive30', 30, None),
    ('drive30_loss2', 30, 2),
    ('drive55_loss2', 55, 2),
]
results = {name: [] for name, _, _ in configs}
for p in paths:
    d = p.stem.rsplit('_',1)[-1]
    raw = json.load(open(p))
    if len(raw) < 1000:
        continue
    med = float(basis.get(d, {}).get('med', 0.0))
    ticks = [{**t, 'bidPrice': float(t['bidPrice']) + med, 'askPrice': float(t['askPrice']) + med} for t in raw]
    bars = build_1m_bars(ticks)
    try:
        fair = fair_price_at_et_open(bars, d)
    except ValueError:
        continue
    for name, cap, max_losses in configs:
        cfg = ReversionConfig(entry_start='09:30', entry_end='11:00', opening_drive_max_points=cap, max_consecutive_losses=max_losses)
        trades = run_timeless_reversion(bars, ticks, fair_price=fair, config=cfg)
        results[name].extend((d, float(t['pnl'])) for t in trades)
    del raw, ticks, bars
    gc.collect()
for name, cap, max_losses in configs:
    rows = results[name]
    wins = [p for _,p in rows if p > 0]
    losses = [p for _,p in rows if p <= 0]
    days = defaultdict(float)
    for d,p in rows: days[d] += p
    gross_win = sum(wins); gross_loss = -sum(losses)
    print(f'{name:15s} trades={len(rows):3d} wins={len(wins):3d} losses={len(losses):3d} winrate={100*len(wins)/len(rows):5.1f}% points={sum(p for _,p in rows):7.1f} usd={sum(p for _,p in rows)*12:8.0f} pf={gross_win/gross_loss if gross_loss else 0:.3f} days={len(days):2d} pos={sum(v>0 for v in days.values()):2d} neg={sum(v<0 for v in days.values()):2d} worst={min(days.values()) if days else 0:6.1f}')
    print('  by_month', {m: round(sum(p for d,p in rows if d.startswith(m)),1) for m in ['2026-06','2026-07','2026-08','2026-09']})
