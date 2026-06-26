#!/usr/bin/env python3
"""Run EMA 60-min best config replay across 5 days."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models.bot import BotConfig
from trading.runner_core import MultiStrategyRunner

BOT_ID = 6
TV_SYMBOLS = ['AEROENTER','PANAMAPET','PANACEABIO','THANGAMAYL','SENORES','WHEELS','ARVIND','EMSLIMITED','CORONA','GREAVESCOT','BORORENEW','NACLIND','ACUTAAS','GNA','AVALON','THERMAX','ADANIENT','VIJAYA','NUVAMA','ABSLAMC','TATACAP','INOXGREEN','SANSERA','KPIL','DYCL','ADANIGREEN','TMCV','POLYPLEX','LAURUSLABS','KAJARIACER','HNDFDS','FINEORG','NAVINFLUOR','BELRISE','NAZARA','MAXHEALTH','IKS','POONAWALLA','PARADEEP','BHARATFORG','PHOENIXLTD','ABCAPITAL','GMRAIRPORT']
DATES = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]

with SessionLocal() as db:
    bot_config = db.query(BotConfig).filter(BotConfig.id == BOT_ID).first()
    s = bot_config.strategies[0]
    print(f"Strategy: {s.name}")
    print(f"  TF={s.or_minutes}min EMA: FAST={s.ema_fast_period} SLOW={s.ema_slow_period}")
    print(f"  SL={s.sl_pct}% TP={s.tp_pct}% CD={s.cooldown_minutes}min EOD={s.eod_exit_hour}:{s.eod_exit_minute:02d}")
    print(f"  Symbols: {len(TV_SYMBOLS)}")
    print()

overall = []
for date_str in DATES:
    print(f"{'='*60}")
    print(f"  Running {date_str}...")
    print(f"{'='*60}")

    events = []
    def on_event(e):
        events.append(e)

    runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
    runner.run_replay(
        date_str=date_str,
        symbols=TV_SYMBOLS,
        strategy_filter="EMA",
        on_event=on_event,
    )

    trades = [e for e in events if e['type'] == 'trade_close']
    for t in trades:
        t['date'] = date_str
    overall.extend(trades)

    win = sum(1 for t in trades if t.get('pnl', 0) > 0)
    loss = sum(1 for t in trades if t.get('pnl', 0) <= 0)
    net = sum(t.get('pnl', 0) for t in trades)
    print(f"  Trades: {len(trades)} | Wins: {win} | Losses: {loss} | Net: Rs {net:+,.2f}")

if overall:
    wins = [t for t in overall if t.get('pnl', 0) > 0]
    losses = [t for t in overall if t.get('pnl', 0) <= 0]
    gp = sum(t.get('pnl', 0) for t in wins)
    gl = abs(sum(t.get('pnl', 0) for t in losses))
    net = sum(t.get('pnl', 0) for t in overall)
    print(f"\n{'='*60}")
    print(f"  OVERALL ({len(DATES)} days, {len(overall)} trades)")
    print(f"{'='*60}")
    print(f"  Win rate: {len(wins)/len(overall)*100:.1f}%")
    print(f"  Net P&L: Rs {net:+,.2f}")
    print(f"  Profit factor: {gp/gl:.4f}" if gl > 0 else "  PF: INF")
    print(f"\n  {'Date':<12} {'Trades':<8} {'Wins':<6} {'Losses':<6} {'Net PnL':<14}")
    print("  " + "-" * 46)
    for d in DATES:
        dt = [t for t in overall if t.get('date') == d]
        if dt:
            dw = [t for t in dt if t.get('pnl', 0) > 0]
            dl = [t for t in dt if t.get('pnl', 0) <= 0]
            dn = sum(t.get('pnl', 0) for t in dt)
            print(f"  {d:<12} {len(dt):<8} {len(dw):<6} {len(dl):<6} {dn:<+14,.2f}")
        else:
            print(f"  {d:<12} {0:<8} {0:<6} {0:<6} {'0.00':<14}")
    print("  " + "-" * 46)
    gn = sum(t.get('pnl', 0) for t in overall)
    print(f"  {'TOTAL':<12} {len(overall):<8} {len(wins):<6} {len(losses):<6} {gn:<+14,.2f}")
else:
    print("\n  No trades.")
