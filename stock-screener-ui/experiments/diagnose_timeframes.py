#!/usr/bin/env python3
"""Test EMA cross on multiple timeframes to find where costs stop killing profits."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from experiments.ema_benchmark import (
    SYMBOLS, load_data, sim_symbol, compute_metrics, ENV
)

# Pre-load 5-min cache (all symbols)
ENV['TF'] = 5
print("Loading 5-min data...", file=sys.stderr)
data_5m = load_data(ENV['CACHE_DIR'])
print(f"  Loaded {len(data_5m)} symbols", file=sys.stderr)

# Test configs per timeframe
CONFIGS = {
    15: [  # 15-min bars, ~26 bars/day
        dict(FAST=3, SLOW=7, SL=2.0, TP=5.0, CD=2, label="3/7 SL=2.0 TP=5.0"),
        dict(FAST=3, SLOW=7, SL=2.5, TP=6.0, CD=2, label="3/7 SL=2.5 TP=6.0"),
        dict(FAST=3, SLOW=7, SL=3.0, TP=8.0, CD=2, label="3/7 SL=3.0 TP=8.0"),
        dict(FAST=5, SLOW=13, SL=2.0, TP=5.0, CD=2, label="5/13 SL=2.0 TP=5.0"),
    ],
    30: [  # 30-min bars, ~13 bars/day
        dict(FAST=2, SLOW=4, SL=3.0, TP=6.0, CD=1, label="2/4 SL=3.0 TP=6.0"),
        dict(FAST=2, SLOW=4, SL=3.0, TP=8.0, CD=1, label="2/4 SL=3.0 TP=8.0"),
        dict(FAST=2, SLOW=4, SL=4.0, TP=8.0, CD=1, label="2/4 SL=4.0 TP=8.0"),
        dict(FAST=2, SLOW=4, SL=5.0, TP=10.0, CD=1, label="2/4 SL=5.0 TP=10.0"),
    ],
    60: [  # 60-min bars, ~6-7 bars/day
        dict(FAST=1, SLOW=2, SL=3.0, TP=6.0, CD=1, label="1/2 SL=3.0 TP=6.0"),
        dict(FAST=1, SLOW=2, SL=4.0, TP=8.0, CD=1, label="1/2 SL=4.0 TP=8.0"),
        dict(FAST=1, SLOW=2, SL=5.0, TP=10.0, CD=1, label="1/2 SL=5.0 TP=10.0"),
        dict(FAST=1, SLOW=2, SL=6.0, TP=12.0, CD=1, label="1/2 SL=6.0 TP=12.0"),
    ],
}

# Also add 5-min best config for reference
CONFIGS[5] = [
    dict(FAST=9, SLOW=21, SL=1.5, TP=5.0, CD=3, label="9/21 SL=1.5 TP=5.0 (best 5-min)"),
]

results = []
for tf in sorted(CONFIGS.keys()):
    print(f"\n{'='*65}")
    print(f"  TIMEFRAME: {tf}-min")
    print(f"{'='*65}")

    # Resample data
    from market_data.market_data import resample_candles
    data = {}
    for sym, df in data_5m.items():
        rdf = resample_candles(df, tf)
        if rdf is not None and len(rdf) > 5:
            data[sym] = rdf
    print(f"  {len(data)} symbols after resample", file=sys.stderr)

    for cfg in CONFIGS[tf]:
        ENV['FAST'] = cfg['FAST']
        ENV['SLOW'] = cfg['SLOW']
        ENV['SL'] = cfg['SL']
        ENV['TP'] = cfg['TP']
        ENV['COOLDOWN'] = cfg['CD']
        ENV['EOD_HOUR'] = 15
        ENV['EOD_MINUTE'] = 0

        t0 = time.time()
        all_trades = []
        from concurrent.futures import ThreadPoolExecutor, as_completed
        with ThreadPoolExecutor(max_workers=3) as pool:
            fut = {pool.submit(sim_symbol, df): sym for sym, df in data.items()}
            for f in as_completed(fut):
                sym = fut[f]
                trades = f.result()
                for t in trades:
                    t['symbol'] = sym
                all_trades.extend(trades)

        m = compute_metrics(all_trades)
        elapsed = time.time() - t0
        gross_wins = [t for t in all_trades if t['gross_pnl'] > 0]
        gross_losses = [t for t in all_trades if t['gross_pnl'] <= 0]
        gp = sum(t['gross_pnl'] for t in gross_wins)
        gl = abs(sum(t['gross_pnl'] for t in gross_losses))
        gross_pf = gp / gl if gl > 0 else float('inf')

        result = {
            'tf': tf, 'label': cfg['label'],
            'trades': m['total_trades'], 'wr': m['win_rate'],
            'net_pnl': m['net_pnl'], 'pf': m['profit_factor'],
            'gross_pf': round(gross_pf, 4),
            'costs': m['total_costs'], 'stocks': m['stocks_with_trades'],
        }
        results.append(result)

        status = '✅' if m['profit_factor'] >= 1.0 else '❌'
        print(f"  {status} {cfg['label']:<35} "
              f"Trades={m['total_trades']:<5} Net=Rs{m['net_pnl']:+,.0f} "
              f"PF={m['profit_factor']:<8.4f} GrossPF={gross_pf:.4f} "
              f"({elapsed:.0f}s)")

print(f"\n{'='*80}")
print(f"  SUMMARY — All Timeframes")
print(f"{'='*80}")
print(f"  {'TF':<5} {'Config':<35} {'Trades':<8} {'WR':<6} {'Net P&L':<14} {'PF':<10} {'GrossPF':<10}")
print(f"  {'-'*5} {'-'*35} {'-'*8} {'-'*6} {'-'*14} {'-'*10} {'-'*10}")
for r in sorted(results, key=lambda x: x['pf'], reverse=True):
    m = '✅' if r['pf'] >= 1.0 else '❌'
    print(f"  {m} {r['tf']:<3}min {r['label']:<35} {r['trades']:<8} {r['wr']:<5.1f}% "
          f"Rs{r['net_pnl']:+,.0f}  {r['pf']:<10.4f} {r['gross_pf']:<10.4f}")
