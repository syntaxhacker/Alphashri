#!/usr/bin/env python3
"""Unified swing strategy benchmark on daily data.

Usage: python3 experiments/swing_benchmark.py
Outputs METRIC lines for autoresearch.

Environment variables:
  SWING_STRATEGY=short_52w_failed   Strategy type
  SWING_SL=3.0                      Stop loss percent
  SWING_TP=5.0                      Take profit percent
  SWING_ADX_THRESHOLD=25            ADX threshold (for ADX_TREND)
  SWING_MAX_HOLDING=20              Max holding days
  SWING_COOLDOWN=10                 Cooldown days between entries
  SWING_SHORTS=1                    Enable shorts (0/1)
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from backtest.costs import calculate_trading_costs
from market_data.market_data import fetch_candles
import config; IST = config.IST

ENV = {
    "STRATEGY": os.environ.get("SWING_STRATEGY", "short_52w_failed"),
    "SL": float(os.environ.get("SWING_SL", "3.0")),
    "TP": float(os.environ.get("SWING_TP", "5.0")),
    "ADX_THRESHOLD": float(os.environ.get("SWING_ADX_THRESHOLD", "25")),
    "MAX_HOLDING": int(os.environ.get("SWING_MAX_HOLDING", "20")),
    "COOLDOWN": int(os.environ.get("SWING_COOLDOWN", "10")),
    "SHORTS": int(os.environ.get("SWING_SHORTS", "1")),
    "DATE_START": os.environ.get("SWING_DATE_START", "2026-01-01"),
    "DATE_END": os.environ.get("SWING_DATE_END", "2026-07-01"),
}

TV_SYMBOLS = [
    "AEROENTER","PANAMAPET","PANACEABIO","THANGAMAYL","SENORES",
    "WHEELS","ARVIND","EMSLIMITED","CORONA","GREAVESCOT",
    "BORORENEW","NACLIND","ACUTAAS","GNA","AVALON",
    "THERMAX","ADANIENT","VIJAYA","NUVAMA","ABSLAMC",
    "TATACAP","INOXGREEN","SANSERA","KPIL","DYCL",
    "ADANIGREEN","TMCV","POLYPLEX","LAURUSLABS","KAJARIACER",
    "HNDFDS","FINEORG","NAVINFLUOR","BELRISE","NAZARA",
    "MAXHEALTH","IKS","POONAWALLA","PARADEEP","BHARATFORG",
    "PHOENIXLTD","ABCAPITAL","GMRAIRPORT",
]


def load_daily_data():
    """Load daily OHLCV data for all symbols."""
    data = {}
    for sym in TV_SYMBOLS:
        df = fetch_candles(symbol=sym, tf=1440,
                           from_date=ENV["DATE_START"],
                           to_date=ENV["DATE_END"])
        if df is not None and len(df) > 20:
            if not df.index.tz:
                df.index = pd.DatetimeIndex(df.index).tz_localize("UTC")
            df = df.sort_index()
            data[sym] = df
        print(f"  {sym}: {len(df) if df is not None else 0} daily candles", file=sys.stderr)
    return data


def compute_52w_from_highs(highs, period=252):
    if not highs:
        return None
    period = min(period, len(highs))
    return max(highs[-period:])


def sim_symbol(symbol, df, config) -> list:
    """Run swing strategy simulation on one symbol's daily data."""
    from trading.short_52w_failed_signals import Short52WFailedSignalGenerator
    from trading.adx_trend_signals import ADXTrendSignalGenerator

    strategy_type = config["strategy"]
    if strategy_type == "short_52w_failed":
        gen = Short52WFailedSignalGenerator(config)
    elif strategy_type == "adx_trend":
        gen = ADXTrendSignalGenerator(config)
    else:
        return []

    closes = df['close'].tolist()
    highs = df['high'].tolist()
    lows = df['low'].tolist()

    trades = []
    in_position = False
    pos = {}
    last_exit_date = None
    entry_date = None

    min_bars = 50  # enough for ADX/MA warmup
    for i in range(min_bars, len(closes)):
        ts = df.index[i]
        trade_date = ts.strftime('%Y-%m-%d') if hasattr(ts, 'strftime') else str(ts)[:10]
        current_price = float(closes[i])
        prev_close = float(closes[i-1]) if i > 0 else current_price

        # Build market_data
        daily_highs = highs[:i]
        daily_closes = closes[:i]
        daily_lows = lows[:i]
        high_52w = compute_52w_from_highs(daily_highs, period=min(252, len(daily_highs)))
        ma50 = sum(closes[max(0,i-50):i]) / min(50, i) if i >= 50 else 0
        ma200 = sum(closes[max(0,i-200):i]) / min(200, i) if i >= 200 else 0

        market_data = {
            'current_price': current_price,
            'high_52w': high_52w,
            'days_since_52w_high': 0,
            'daily_highs': daily_highs,
            'daily_closes': daily_closes,
            'daily_lows': daily_lows,
            'volume': float(df.iloc[i].get('volume', 0)),
            'avg_volume_20d': sum(float(df.iloc[j].get('volume', 0)) for j in range(max(0,i-20), i)) / min(20, i) if i >= 20 else 0,
            'ma50': ma50,
            'ma200': ma200,
        }

        # Cooldown check
        if last_exit_date and trade_date <= last_exit_date:
            continue

        if in_position:
            days_in = (pd.Timestamp(trade_date) - pd.Timestamp(entry_date)).days if entry_date else 0
            exit_signal = gen.check_exit(
                symbol=symbol,
                position_side=pos['side'],
                entry_price=pos['entry'],
                stop_loss=pos['sl'],
                take_profit=pos['tp'],
                current_price=current_price,
                days_in_position=days_in,
                max_holding_days=config['max_holding_days'],
                highest_price_since_entry=max(pos.get('peak', pos['entry']), current_price),
                entry_52w_high=pos.get('entry_52w_high'),
                timestamp=ts,
            )
            if exit_signal:
                exit_price = exit_signal.price
                shares = int(100000 / pos['entry'])
                gross_pnl = (exit_price - pos['entry']) * shares if pos['side'] == 'BUY' else (pos['entry'] - exit_price) * shares
                costs = calculate_trading_costs(pos['entry'], exit_price, shares, pos['side'])['total_costs']
                trades.append({
                    'symbol': symbol, 'date': trade_date, 'side': pos['side'],
                    'entry': pos['entry'], 'exit': exit_price,
                    'gross_pnl': gross_pnl, 'costs': costs,
                    'net_pnl': gross_pnl - costs,
                    'reason': exit_signal.notes,
                })
                in_position = False
                entry_date = None
                last_exit_date = (pd.Timestamp(trade_date) + pd.Timedelta(days=config['cooldown_days'])).strftime('%Y-%m-%d')
                continue

            # Track peak
            if 'peak' not in pos or current_price > pos['peak']:
                pos['peak'] = current_price

        if in_position:
            continue

        # Check entry
        signal = gen.check_entry(symbol, market_data)
        if signal:
            sl, tp = signal.stop_loss, signal.take_profit
            side = 'BUY' if signal.signal_type.value in ('LONG_ENTRY',) else 'SELL'
            pos = {
                'side': side,
                'entry': signal.price,
                'sl': sl,
                'tp': tp,
                'entry_52w_high': high_52w,
                'peak': signal.price,
            }
            in_position = True
            entry_date = trade_date

    return trades


def compute_metrics(all_trades):
    if not all_trades:
        return {"total_trades": 0, "wins": 0, "losses": 0, "net_pnl": 0.0,
                "profit_factor": 0.0, "win_rate": 0.0, "total_costs": 0}
    wins = [t for t in all_trades if t['net_pnl'] > 0]
    losses = [t for t in all_trades if t['net_pnl'] <= 0]
    gp = sum(t['net_pnl'] for t in wins)
    gl = abs(sum(t['net_pnl'] for t in losses))
    return {
        "total_trades": len(all_trades),
        "wins": len(wins),
        "losses": len(losses),
        "net_pnl": round(sum(t['net_pnl'] for t in all_trades), 2),
        "profit_factor": round(gp / gl, 4) if gl > 0 else 99.9999,
        "win_rate": round(len(wins) / len(all_trades) * 100, 1) if all_trades else 0.0,
        "total_costs": round(sum(t.get('costs', 0) for t in all_trades), 2),
    }


def main():
    cfg = {
        'strategy': ENV['STRATEGY'],
        'sl_pct': ENV['SL'],
        'tp_pct': ENV['TP'],
        'adx_threshold': ENV['ADX_THRESHOLD'],
        'max_holding_days': ENV['MAX_HOLDING'],
        'cooldown_days': ENV['COOLDOWN'],
        'enable_shorts': bool(ENV['SHORTS']),
    }
    print(f"Strategy: {cfg['strategy']} SL={cfg['sl_pct']}% TP={cfg['tp_pct']}% "
          f"ADX>{cfg['adx_threshold'] if cfg['strategy']=='adx_trend' else 'N/A'} "
          f"Hold={cfg['max_holding_days']}d CD={cfg['cooldown_days']}d "
          f"Shorts={'ON' if cfg['enable_shorts'] else 'OFF'}",
          file=sys.stderr)

    data = load_daily_data()
    print(f"Loaded {len(data)} symbols", file=sys.stderr)

    all_trades = []
    for sym, df in data.items():
        trades = sim_symbol(sym, df, cfg)
        all_trades.extend(trades)
        print(f"  {sym}: {len(trades)} trades", file=sys.stderr)

    m = compute_metrics(all_trades)
    print(file=sys.stderr)
    print(f"Total trades: {m['total_trades']}", file=sys.stderr)
    print(f"Win rate: {m['win_rate']}%", file=sys.stderr)
    print(f"Net P&L: Rs {m['net_pnl']:,.2f}", file=sys.stderr)
    print(f"Profit factor: {m['profit_factor']}", file=sys.stderr)
    print(f"Total costs: Rs {m['total_costs']:,.2f}", file=sys.stderr)

    print(f"METRIC profit_factor={m['profit_factor']}")
    print(f"METRIC win_rate={m['win_rate']}")
    print(f"METRIC net_pnl={m['net_pnl']}")
    print(f"METRIC total_trades={m['total_trades']}")
    print(f"METRIC total_costs={m['total_costs']}")


if __name__ == "__main__":
    main()
