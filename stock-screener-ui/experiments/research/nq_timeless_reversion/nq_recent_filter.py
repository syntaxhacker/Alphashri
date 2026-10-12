import sys
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
sys.path.insert(0, '/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
from timeless_reversion import (
    ReversionConfig, _fetch_fresh_dukascopy_ticks, _shift_cash_ticks_to_nq,
    fair_price_at_et_open, run_timeless_reversion,
)
from scripts.smc_tick_eval import build_1m_bars

ET = ZoneInfo('America/New_York')
for d in ['2026-09-03','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14']:
    try:
        raw = _fetch_fresh_dukascopy_ticks(d)
        ticks, basis = _shift_cash_ticks_to_nq(d, raw)
        bars = build_1m_bars(ticks)
        fair = fair_price_at_et_open(bars, d)
    except Exception as exc:
        print(d, 'ERROR', repr(exc), flush=True)
        continue
    print(d, 'ticks', len(ticks), 'bars', len(bars), 'basis', round(basis,2), 'fair', round(fair,2), flush=True)
    for cap in [None, 25, 30, 40]:
        cfg = ReversionConfig(entry_start='09:30', entry_end='11:00', opening_drive_max_points=cap)
        tr = run_timeless_reversion(bars, ticks, fair_price=fair, config=cfg)
        print('  cap', cap, 'trades', len(tr), 'wins', sum(x['pnl']>0 for x in tr), 'points', round(sum(x['pnl'] for x in tr),1), flush=True)
