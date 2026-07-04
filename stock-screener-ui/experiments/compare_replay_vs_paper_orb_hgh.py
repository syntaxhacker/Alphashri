#!/usr/bin/env python3
"""
Compare ORB High Beta Bot replay trades vs paper trades on June 24.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.database import SessionLocal
from db.models.bot import BotConfig
from db.models.trade import Trade
from trading.runner_core import MultiStrategyRunner
from datetime import datetime, date
import config

DATE_STR = "2026-06-24"
BOT_ID = 5

# ── 1. Load bot config and watchlist ──
with SessionLocal() as db:
    bot_config = db.query(BotConfig).filter(BotConfig.id == BOT_ID).first()
    if not bot_config:
        print(f"Bot {BOT_ID} not found!")
        sys.exit(1)
    
    # Get custom watchlist from the strategy
    strategy = bot_config.strategies[0] if bot_config.strategies else None
    if not strategy:
        print("No strategies on bot!")
        sys.exit(1)
    
    custom_watchlist = json.loads(strategy.custom_watchlist) if strategy.custom_watchlist else []
    print(f"Bot: {bot_config.name}")
    print(f"Strategy: {strategy.name} (sl={strategy.sl_pct}, tp={strategy.tp_pct})")
    print(f"Watchlist ({len(custom_watchlist)} symbols): {custom_watchlist}")
    print()

    # ── 2. Fetch paper trades from DB ──
    start = datetime(2026, 6, 24, tzinfo=config.IST)
    end = datetime(2026, 6, 25, tzinfo=config.IST)
    paper_trades = db.query(Trade).filter(
        Trade.bot_id == BOT_ID,
        Trade.entry_time >= start,
        Trade.entry_time < end
    ).order_by(Trade.entry_time).all()
    
    print(f"Paper trades on June 24: {len(paper_trades)}")
    paper_by_symbol = {}
    for t in paper_trades:
        paper_by_symbol[t.symbol] = {
            "symbol": t.symbol,
            "side": t.side,
            "entry_price": t.entry_price,
            "entry_time": t.entry_time,
            "exit_price": t.exit_price,
            "exit_time": t.exit_time,
            "pnl": t.pnl,
            "pnl_pct": t.pnl_pct,
            "exit_reason": t.exit_reason,
            "quantity": t.quantity,
        }
        print(f"  {t.symbol:<15} {t.side:<5} Entry:{t.entry_price:>8.2f} @ {t.entry_time.strftime('%H:%M:%S')}  "
              f"Exit:{t.exit_price:>8.2f} @ {t.exit_time.strftime('%H:%M:%S') if t.exit_time else '?':<8}  "
              f"PnL:{t.pnl:>+8.2f} ({t.pnl_pct:>+6.2f}%)  {t.exit_reason}")
    print()

# ── 3. Run replay ──
print("Running replay...")
runner = MultiStrategyRunner.create_for_replay(bot_config=bot_config)
replay_events = []

def on_event(e):
    replay_events.append(e)

runner.run_replay(
    date_str=DATE_STR,
    symbols=custom_watchlist,
    strategy_filter="ORB",
    on_event=on_event,
)

# ── 4. Collect replay trades ──
replay_trades = {}
for e in replay_events:
    if e['type'] == 'trade_open':
        sym = e['symbol']
        if sym not in replay_trades:
            replay_trades[sym] = {}
        replay_trades[sym].update({
            "symbol": sym,
            "side": e.get('side', 'BUY'),
            "entry_price": e.get('price', 0),
            "entry_time": e.get('time', '?'),
            "entry_reason": e.get('reason', ''),
        })
    elif e['type'] == 'trade_close':
        sym = e['symbol']
        if sym not in replay_trades:
            replay_trades[sym] = {}
        replay_trades[sym].update({
            "symbol": sym,
            "side": e.get('side', 'BUY'),
            "exit_price": e.get('exit_price', 0),
            "exit_time": e.get('exit_time', '?'),
            "pnl": e.get('pnl', 0),
            "pnl_pct": e.get('pnl_pct', 0),
            "exit_reason": e.get('reason', '?'),
        })

# ── 5. Side-by-side comparison ──
print("\n" + "="*140)
print(f"{'SYMBOL':<15} {'RESULT':<8} {'SIDE':<5} {'ENTRY_PRICE':>10} {'ENTRY_TIME':<10} {'EXIT_PRICE':>10} {'EXIT_TIME':<10} {'PnL₹':>9} {'PnL%':>7} {'REASON'}")
print("="*140)

all_symbols = sorted(set(replay_trades.keys()) | set(paper_by_symbol.keys()))

paper_match = 0
paper_mismatch = 0
paper_only = 0
replay_only = 0

for sym in all_symbols:
    r = replay_trades.get(sym, {})
    p = paper_by_symbol.get(sym, {})
    
    if r and p:
        # Both have this trade — compare
        entry_ok = abs(r.get('entry_price', 0) - p['entry_price']) < 0.5
        pnl_ok = p.get('pnl') is not None and abs((r.get('pnl') or 0) - p['pnl']) < 10
        
        match_status = "MATCH" if (entry_ok and pnl_ok) else "MISMATCH"
        if match_status == "MATCH":
            paper_match += 1
        else:
            paper_mismatch += 1
        
        entry_t = str(r.get('entry_time', '?'))[11:19]
        exit_t = str(r.get('exit_time', '?'))[11:19]
        
        print(f"{sym:<15} {match_status:<8} {r.get('side','?'):<5} "
              f"{r.get('entry_price',0):>10.2f} {entry_t:<10} "
              f"{r.get('exit_price',0):>10.2f} {exit_t:<10} "
              f"{r.get('pnl',0):>+9.2f} {r.get('pnl_pct',0):>+6.2f}%  {r.get('exit_reason','?')[:40]}")
        
        if match_status == "MISMATCH":
            print(f"{'':<15} {'PAPER':<8} {'':<5} {p['entry_price']:>10.2f} {p['entry_time'].strftime('%H:%M:%S'):<10} "
                  f"{p.get('exit_price',0):>10.2f} {'':<10} "
                  f"{p.get('pnl',0):>+9.2f} {p.get('pnl_pct',0):>+6.2f}%  {p.get('exit_reason','?')[:40]}")
    elif p and not r:
        paper_only += 1
        print(f"{sym:<15} {'PAPER-ONLY':<8} {p['side']:<5} "
              f"{p['entry_price']:>10.2f} {p['entry_time'].strftime('%H:%M:%S'):<10} "
              f"{p.get('exit_price',0):>10.2f} {'':<10} "
              f"{p.get('pnl',0):>+9.2f} {p.get('pnl_pct',0):>+6.2f}%  {p.get('exit_reason','?')[:40]}")
    elif r and not p:
        replay_only += 1
        entry_t = str(r.get('entry_time', '?'))[11:19]
        exit_t = str(r.get('exit_time', '?'))[11:19]
        print(f"{sym:<15} {'REPLAY-ONLY':<8} {r.get('side','?'):<5} "
              f"{r.get('entry_price',0):>10.2f} {entry_t:<10} "
              f"{r.get('exit_price',0):>10.2f} {exit_t:<10} "
              f"{r.get('pnl',0):>+9.2f} {r.get('pnl_pct',0):>+6.2f}%  {r.get('exit_reason','?')[:40]}")

# ── 6. Summary event ──
for e in replay_events:
    if e['type'] == 'summary':
        print(f"\n--- Replay Summary ---")
        for k, v in e.items():
            if k != 'type':
                print(f"  {k}: {v}")

print("\n" + "="*60)
print(f"MATCH (replay matches paper):     {paper_match}")
print(f"MISMATCH (replay ≠ paper):        {paper_mismatch}")
print(f"REPLAY-ONLY (no paper trade):     {replay_only}")
print(f"PAPER-ONLY (no replay trade):     {paper_only}")
print("="*60)
