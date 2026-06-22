#!/usr/bin/env python3
"""
Direct replay engine verification: run actual replay on 5 stocks × ~10 dates,
compare trades against expected ORB results.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models.bot import BotConfig
from trading.runner_core import MultiStrategyRunner
from trading.timezone import IST
import pandas as pd

# Load bot
with SessionLocal() as db:
    bot_config = db.query(BotConfig).filter(BotConfig.id == 4).first()
if not bot_config:
    print("Bot 4 not found!")
    sys.exit(1)

# 5 volatile stocks
STOCKS = ["RELIANCE", "TCS", "ADANIENSOL", "HAL"]
DATES = ["2026-06-11", "2026-06-12", "2026-06-01", "2026-06-04", "2026-06-05", "2026-06-08"]

all_replay_trades = []

for sym in STOCKS:
    for date_str in DATES:
        runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
        events = []
        def on_event(e):
            events.append(e)
        
        runner.run_replay(
            date_str=date_str,
            symbols=[sym],
            strategy_filter="ORB",
            on_event=on_event,
        )
        
        trades = [e for e in events if e['type'] == 'trade_close']
        if trades:
            for t in trades:
                all_replay_trades.append({
                    "symbol": sym,
                    "date": date_str,
                    "entry_time": t.get("entry_time", "?"),
                    "exit_time": t.get("exit_time", "?"),
                    "side": t.get("side", "?"),
                    "entry_price": t.get("entry_price", 0),
                    "exit_price": t.get("exit_price", 0),
                    "pnl_pct": t.get("pnl_pct", 0),
                    "reason": t.get("reason", "?"),
                })

# Summary
print(f"\n{'Symbol':<12} {'Date':<12} {'Side':<6} {'EntryTime':<10} {'Entry':>8} {'Exit':>8} {'PnL%':>7} {'Reason'}")
print("=" * 80)
for t in sorted(all_replay_trades, key=lambda x: (x['symbol'], x['date'])):
    print(f"{t['symbol']:<12} {t['date']:<12} {t['side']:<6} {t['entry_time'][:8]:<10} "
          f"{t['entry_price']:>8.1f} {t['exit_price']:>8.1f} {t['pnl_pct']:>+7.2f} {t['reason'][:30]}")
