#!/usr/bin/env python3
"""Run EMA Cross Best v1 bot replay — no position limits, TV screener stocks."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models.bot import BotConfig
from trading.runner_core import MultiStrategyRunner
from trading.runner_signals import RunnerSignalsMixin
import config

BOT_ID = 6

TV_SYMBOLS = ['AEROENTER','PANAMAPET','PANACEABIO','THANGAMAYL','SENORES','WHEELS','ARVIND','EMSLIMITED','CORONA','GREAVESCOT','BORORENEW','NACLIND','ACUTAAS','GNA','AVALON','THERMAX','ADANIENT','VIJAYA','NUVAMA','ABSLAMC','TATACAP','INOXGREEN','SANSERA','KPIL','DYCL','ADANIGREEN','TMCV','POLYPLEX','LAURUSLABS','KAJARIACER','HNDFDS','FINEORG','NAVINFLUOR','BELRISE','NAZARA','MAXHEALTH','IKS','POONAWALLA','PARADEEP','BHARATFORG','PHOENIXLTD','ABCAPITAL','GMRAIRPORT']

DATES = ["2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26"]

with SessionLocal() as db:
    bot_config = db.query(BotConfig).filter(BotConfig.id == BOT_ID).first()
    s = bot_config.strategies[0]
    print(f"Bot: {bot_config.name}")
    print(f"Strategy: {s.name} — FAST={s.ema_fast_period} SLOW={s.ema_slow_period} "
          f"SL={s.sl_pct}% TP={s.tp_pct}% CD={s.cooldown_minutes}min "
          f"EOD={s.eod_exit_hour}:{s.eod_exit_minute:02d}")
    print(f"Symbols: {len(TV_SYMBOLS)}")
    print()

overall_trades = []
for date_str in DATES:
    print(f"\n{'='*60}")
    print(f"  Running replay for {date_str}...")
    print(f"{'='*60}")

    events = []
    def on_event(e):
        events.append(e)

    runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
    # Disable consecutive loss limit
    for sid, rnr in runner.strategies.items():
        rnr.config["max_consecutive_losses"] = 0

    runner.run_replay(
        date_str=date_str,
        symbols=TV_SYMBOLS,
        strategy_filter="EMA",
        on_event=on_event,
    )

    trades = [e for e in events if e['type'] == 'trade_close']
    summary = [e for e in events if e['type'] == 'summary']

    for t in trades:
        t['date'] = date_str
    overall_trades.extend(trades)

    win = sum(1 for t in trades if t.get('pnl', 0) > 0)
    loss = sum(1 for t in trades if t.get('pnl', 0) <= 0)
    net = sum(t.get('pnl', 0) for t in trades)
    print(f"  Trades: {len(trades)} | Wins: {win} | Losses: {loss} | Net: Rs {net:.2f}")

if overall_trades:
    wins = [t for t in overall_trades if t.get('pnl', 0) > 0]
    losses = [t for t in overall_trades if t.get('pnl', 0) <= 0]
    gp = sum(t.get('pnl', 0) for t in wins)
    gl = abs(sum(t.get('pnl', 0) for t in losses))
    net = sum(t.get('pnl', 0) for t in overall_trades)

    print(f"\n{'='*60}")
    print(f"  OVERALL ({len(DATES)} days, {len(overall_trades)} trades)")
    print(f"{'='*60}")
    print(f"  Win rate: {len(wins)/len(overall_trades)*100:.1f}%")
    print(f"  Net P&L: Rs {net:,.2f}")
    print(f"  Profit factor: {gp/gl:.4f}" if gl > 0 else "  PF: INF")

    print(f"\n  {'Date':<12} {'Trades':<8} {'Wins':<6} {'Losses':<6} {'Net PnL':<14} {'PF':<8}")
    print("  " + "-" * 54)
    for d in DATES:
        dt = [t for t in overall_trades if t.get('date') == d]
        if dt:
            dw = [t for t in dt if t.get('pnl', 0) > 0]
            dl = [t for t in dt if t.get('pnl', 0) <= 0]
            dn = sum(t.get('pnl', 0) for t in dt)
            dg = sum(t.get('pnl', 0) for t in dw)
            dgl = abs(sum(t.get('pnl', 0) for t in dl))
            dpf = dg / dgl if dgl > 0 else float('inf')
            print(f"  {d:<12} {len(dt):<8} {len(dw):<6} {len(dl):<6} {dn:<+14,.2f} {dpf:<8.4f}")
        else:
            print(f"  {d:<12} {0:<8} {0:<6} {0:<6} {'0.00':<14} {'N/A':<8}")

    gp_all = sum(t.get('pnl', 0) for t in wins)
    gl_all = abs(sum(t.get('pnl', 0) for t in losses))
    net_all = sum(t.get('pnl', 0) for t in overall_trades)
    print("  " + "-" * 54)
    print(f"  {'TOTAL':<12} {len(overall_trades):<8} {len(wins):<6} {len(losses):<6} {net_all:<+14,.2f} {gp_all/gl_all:.4f}")
else:
    print("\n  No trades.")
