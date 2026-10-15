import json, sys, gc
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
sys.path.insert(0, '/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
from timeless_reversion import (
    ReversionConfig, _fetch_fresh_dukascopy_ticks, _shift_cash_ticks_to_nq,
    fair_price_at_et_open, run_timeless_reversion,
)
from scripts.smc_tick_eval import build_1m_bars

ROOT = Path('/home/mysyntax/Documents/Alphashri/stock-screener-ui/experiments')
ET = ZoneInfo('America/New_York')
basis = json.load(open(ROOT.parent / 'scripts' / 'nq_basis.json'))

def et_min(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone(ET).hour * 60 + datetime.fromtimestamp(ts, timezone.utc).astimezone(ET).minute

def bar_at(bars, hour, minute):
    want = hour * 60 + minute
    return next((b for b in bars if et_min(b['time']) == want), None)

def prior_regular_close(day):
    files = sorted(ROOT.glob('data/duka_cache/usatechidxusd_2026-*.json'))
    for p in reversed(files):
        d = p.stem.rsplit('_',1)[-1]
        if d >= day or p.stat().st_size < 1000:
            continue
        raw = json.load(open(p))
        med = float(basis.get(d, {}).get('med', 0.0))
        t = [{**x, 'bidPrice': float(x['bidPrice'])+med, 'askPrice': float(x['askPrice'])+med} for x in raw]
        b = build_1m_bars(t)
        regular = [x for x in b if 9*60+30 <= et_min(x['time']) <= 15*60+59]
        if regular:
            return d, float(regular[-1]['close'])
    return None, None

def ema(values, period):
    if not values: return None
    a = 2 / (period + 1)
    out = values[0]
    for v in values[1:]: out = a*v + (1-a)*out
    return out

def load(day):
    if day == '2026-09-14':
        raw = _fetch_fresh_dukascopy_ticks(day)
        ticks, basis_val = _shift_cash_ticks_to_nq(day, raw)
    else:
        raw = json.load(open(ROOT / 'data' / 'duka_cache' / f'usatechidxusd_{day}.json'))
        basis_val = float(basis.get(day, {}).get('med', 0.0))
        ticks = [{**x, 'bidPrice': float(x['bidPrice'])+basis_val, 'askPrice': float(x['askPrice'])+basis_val} for x in raw]
    bars = build_1m_bars(ticks)
    fair = fair_price_at_et_open(bars, day)
    return ticks, bars, fair, basis_val

def profile(day):
    ticks, bars, fair, basis_val = load(day)
    cfg = ReversionConfig(entry_start='09:30', entry_end='11:00')
    trades = run_timeless_reversion(bars, ticks, fair_price=fair, config=cfg)
    prior_day, prior_close = prior_regular_close(day)
    b0930 = bar_at(bars,9,30); b0800 = bar_at(bars,8,0); b0830 = bar_at(bars,8,30); b0900 = bar_at(bars,9,0)
    b1000 = bar_at(bars,10,0); b1100 = bar_at(bars,11,0)
    opening = [b for b in bars if 9*60+30 <= et_min(b['time']) < 10*60+30]
    close_vals = [float(b['close']) for b in bars]
    # Session-only EMA/VWAP, avoiding lookahead and keeping the same bar history used by the strategy.
    session = [b for b in bars if et_min(b['time']) >= 9*60+30]
    vwap_num = vwap_den = 0.0
    ema20 = None; ema50 = None
    for b in session:
        typical = (float(b['high']) + float(b['low']) + float(b['close'])) / 3
        vwap_num += typical; vwap_den += 1
        alpha20 = 2/21; alpha50 = 2/51
        ema20 = typical if ema20 is None else alpha20*float(b['close'])+(1-alpha20)*ema20
        ema50 = typical if ema50 is None else alpha50*float(b['close'])+(1-alpha50)*ema50
    drive15 = float(opening[14]['close']) - fair if len(opening) >= 15 else None
    drive30 = float(opening[29]['close']) - fair if len(opening) >= 30 else None
    drive60 = float(opening[59]['close']) - fair if len(opening) >= 60 else None
    print(f'\nDAY {day} fair={fair:.2f} basis={basis_val:.2f} ticks={len(ticks):,} trades={len(trades)} prior={prior_day} prior_close={prior_close}')
    print(' profile:', {
        'gap_vs_prior_close': round(fair-prior_close,2) if prior_close is not None else None,
        'pre_0830_to_open': round(fair-float(b0830['close']),2) if b0830 else None,
        'pre_0900_to_open': round(fair-float(b0900['close']),2) if b0900 else None,
        'drive15': round(drive15,2) if drive15 is not None else None,
        'drive30': round(drive30,2) if drive30 is not None else None,
        'drive60': round(drive60,2) if drive60 is not None else None,
        '10:00_close-fair': round(float(b1000['close'])-fair,2) if b1000 else None,
        '11:00_close-fair': round(float(b1100['close'])-fair,2) if b1100 else None,
        'session_ema20-ema50': round(ema20-ema50,2) if ema20 is not None and ema50 is not None else None,
    })
    for tr in trades:
        sb = next((b for b in bars if b['time'] == tr['meta']['signal_bar']), None)
        signal_close = float(sb['close']) if sb else None
        signal_high = float(sb['high']) if sb else None
        signal_low = float(sb['low']) if sb else None
        post = [b for b in bars if tr['time'] <= b['time'] <= tr['exit_time']]
        sess_before = [b for b in bars if 9*60+30 <= et_min(b['time']) <= et_min(tr['meta']['signal_bar'])]
        e9 = e20 = None; vnum = 0.0; vden = 0
        for b in sess_before:
            c = float(b['close']); typical = (float(b['high'])+float(b['low'])+c)/3
            e9 = c if e9 is None else (2/10)*c + (1-2/10)*e9
            e20 = c if e20 is None else (2/21)*c + (1-2/21)*e20
            vnum += typical; vden += 1
        vwap = vnum/vden if vden else None
        max_close = max((float(b['close']) for b in post), default=signal_close)
        min_close = min((float(b['close']) for b in post), default=signal_close)
        print(' trade', tr['result'], 'entry', tr['entry'], 'pnl', tr['pnl'], 'signal', datetime.fromtimestamp(tr['meta']['signal_bar'],timezone.utc).astimezone(ET).strftime('%H:%M'), 'signal_close', round(signal_close,2), 'bos', tr['meta']['bos_level'], 'bos_depth', round(tr['meta']['bos_level']-signal_close,2), 'ema9-ema20', round(e9-e20,2), 'close-vwap', round(signal_close-vwap,2), 'max_post_close', round(max_close,2), 'min_post_close', round(min_close,2), 'reclaim_after_bos', round(max_close-tr['meta']['bos_level'],2))
    del ticks, bars
    gc.collect()

for day in ['2026-06-15','2026-06-23','2026-07-08','2026-09-14']:
    try: profile(day)
    except Exception as exc: print(day, 'ERROR', repr(exc))
