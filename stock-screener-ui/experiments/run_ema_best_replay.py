#!/usr/bin/env python3
"""Run EMA Cross Best v1 bot replay across multiple days and report performance."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models.bot import BotConfig
from trading.runner_core import MultiStrategyRunner
from datetime import datetime
import config

BOT_ID = 6  # EMA Cross Best Bot
SYMBOLS = [
    "RELIANCE", "TCS", "INFY", "ICICIBANK", "HDFCBANK", "SBIN",
    "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "BAJFINANCE",
    "MARUTI", "ASIANPAINT", "HCLTECH", "SUNPHARMA", "TITAN", "WIPRO",
    "ULTRACEMCO", "ADANIENT", "TRENT", "DIXON", "BAJAJFINSV",
    "NTPC", "POWERGRID", "HINDALCO", "IEX", "INDUSINDBK", "BPCL",
    "VEDL", "SRF", "BANDHANBNK", "JSWENERGY", "UPL",
]

# Pick recent trading days (excluding today if it's a partial day)
DATES = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]

with SessionLocal() as db:
    bot_config = db.query(BotConfig).filter(BotConfig.id == BOT_ID).first()
    if not bot_config:
        print(f"Bot {BOT_ID} not found!")
        sys.exit(1)
    print(f"Bot: {bot_config.name} (uuid={bot_config.uuid})")
    s = bot_config.strategies[0]
    print(f"Strategy: {s.name} — FAST={s.ema_fast_period} SLOW={s.ema_slow_period} "
          f"SL={s.sl_pct}% TP={s.tp_pct}% CD={s.cooldown_minutes}min "
          f"EOD={s.eod_exit_hour}:{s.eod_exit_minute:02d} shorts={'ON' if s.enable_shorts else 'OFF'}")
    print()

all_results = {}
overall_trades = []

for date_str in DATES:
    print(f"\n{'='*60}")
    print(f"  Running replay for {date_str}...")
    print(f"{'='*60}")

    events = []
    def on_event(e):
        events.append(e)

    runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
    runner.run_replay(
        date_str=date_str,
        symbols=SYMBOLS,
        strategy_filter="EMA",
        on_event=on_event,
    )

    trades = [e for e in events if e['type'] == 'trade_close']
    summary = [e for e in events if e['type'] == 'summary']

    for t in trades:
        t['date'] = date_str
    overall_trades.extend(trades)

    print(f"  Trades: {len(trades)}")
    if trades:
        for t in trades:
            print(f"    {t.get('symbol','?'):<15} {t.get('side','?'):<5} "
                  f"Entry:{t.get('entry_price',0):>8.2f} Exit:{t.get('exit_price',0):>8.2f} "
                  f"PnL:{t.get('pnl',0):>+8.2f} ({t.get('pnl_pct',0):>+5.2f}%) "
                  f"{t.get('reason','?')[:30]}")
    if summary:
        print(f"  Summary: {json.dumps(summary[0], indent=2)}")

    all_results[date_str] = {
        'trades': len(trades),
        'summary': summary[0] if summary else {},
    }

# Overall summary
print(f"\n{'='*60}")
print(f"  OVERALL RESULTS ({len(DATES)} days)")
print(f"{'='*60}")
print(f"  Total trades: {len(overall_trades)}")

if overall_trades:
    wins = [t for t in overall_trades if t.get('pnl', 0) > 0]
    losses = [t for t in overall_trades if t.get('pnl', 0) <= 0]
    gross_profit = sum(t.get('pnl', 0) for t in wins)
    gross_loss = abs(sum(t.get('pnl', 0) for t in losses))
    net_pnl = sum(t.get('pnl', 0) for t in overall_trades)

    print(f"  Wins: {len(wins)} | Losses: {len(losses)}")
    print(f"  Win rate: {len(wins)/len(overall_trades)*100:.1f}%")
    print(f"  Gross profit: Rs {gross_profit:,.2f}")
    print(f"  Gross loss: Rs {gross_loss:,.2f}")
    print(f"  Net P&L: Rs {net_pnl:,.2f}")
    print(f"  Profit factor: {gross_profit/gross_loss:.4f}" if gross_loss > 0 else "  Profit factor: INF")
    print()

    # Per-day breakdown
    print(f"{'Date':<12} {'Trades':<8} {'Wins':<6} {'Losses':<6} {'Net PnL':<12} {'PF':<8}")
    print("-" * 52)
    for date_str in DATES:
        day_trades = [t for t in overall_trades if t.get('date') == date_str]
        if day_trades:
            day_wins = [t for t in day_trades if t.get('pnl', 0) > 0]
            day_losses = [t for t in day_trades if t.get('pnl', 0) <= 0]
            day_net = sum(t.get('pnl', 0) for t in day_trades)
            day_gp = sum(t.get('pnl', 0) for t in day_wins)
            day_gl = abs(sum(t.get('pnl', 0) for t in day_losses))
            day_pf = day_gp / day_gl if day_gl > 0 else float('inf')
            print(f"{date_str:<12} {len(day_trades):<8} {len(day_wins):<6} {len(day_losses):<6} {day_net:<+12,.2f} {day_pf:<8.4f}")
        else:
            print(f"{date_str:<12} {0:<8} {0:<6} {0:<6} {'0.00':<12} {'N/A':<8}")
    print("-" * 52)
    print(f"{'TOTAL':<12} {len(overall_trades):<8} {len(wins):<6} {len(losses):<6} {net_pnl:<+12,.2f} "
          f"{gross_profit/gross_loss:.4f}" if gross_loss > 0 else f"{'TOTAL':<12} {len(overall_trades):<8} {len(wins):<6} {len(losses):<6} {net_pnl:<+12,.2f} INF")
else:
    print("  No trades generated.")
