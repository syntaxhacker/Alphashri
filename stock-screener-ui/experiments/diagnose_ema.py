#!/usr/bin/env python3
"""Diagnose EMA cross: screener vs config vs costs."""
import sys, os, copy
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import experiments.ema_benchmark as bm

LIQUID = [
    "RELIANCE", "TCS", "INFY", "ICICIBANK", "HDFCBANK", "SBIN",
    "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE",
    "MARUTI", "ASIANPAINT", "HCLTECH", "SUNPHARMA", "TITAN", "WIPRO",
    "ULTRACEMCO", "ADANIENT", "TRENT", "DIXON", "BAJAJFINSV",
    "NTPC", "POWERGRID", "HINDALCO", "IEX", "INDUSINDBK", "BPCL",
    "VEDL", "SRF", "BANDHANBNK", "JSWENERGY", "UPL",
]

# Best config from earlier
bm.ENV['SL'] = 1.5
bm.ENV['TP'] = 5.0
bm.ENV['EOD_HOUR'] = 15
bm.ENV['EOD_MINUTE'] = 0
bm.ENV['COOLDOWN'] = 3
bm.ENV['FAST'] = 9
bm.ENV['SLOW'] = 21

def run(label, symbols, with_costs):
    print(f"\n{'='*65}")
    print(f"  {label}")
    print(f"{'='*65}")
    bm.SYMBOLS = symbols
    data = bm.load_data(bm.ENV['CACHE_DIR'])
    all_trades = []
    for sym, df in data.items():
        trades = bm.sim_symbol(df)
        for t in trades:
            t['symbol'] = sym
            if not with_costs:
                t['net_pnl'] = t['gross_pnl']
        all_trades.extend(trades)
    m = bm.compute_metrics(all_trades)
    print(f"  Trades: {m['total_trades']} | WR: {m['win_rate']}%")
    print(f"  Net P&L: Rs {m['net_pnl']:+,.2f} | PF: {m['profit_factor']}")
    print(f"  Costs: Rs {m['total_costs']:+,.2f}")
    if with_costs and all_trades:
        gw = sum(t['gross_pnl'] for t in all_trades if t['gross_pnl'] > 0)
        gl = abs(sum(t['gross_pnl'] for t in all_trades if t['gross_pnl'] <= 0))
        print(f"  Gross PF (before costs): {gw/gl:.4f}" if gl else "  Gross PF: INF")
    return m

run("TEST A: 34 liquid F&O stocks WITH costs", LIQUID, with_costs=True)
run("TEST B: 43 TV screener stocks WITH costs", bm.SYMBOLS, with_costs=True)
run("TEST C: 43 TV screener stocks WITHOUT costs", bm.SYMBOLS, with_costs=False)
run("TEST D: 34 liquid stocks WITHOUT costs", LIQUID, with_costs=False)
