import sys
import os
import json
import pickle
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from backtest.costs import calculate_trading_costs

IST = config.IST
MKT_OPEN = 9 * 60 + 15
MKT_CLOSE = 15 * 60 + 30


def simulate_orb(candles_df, params):
    symbol = params.get('symbol', candles_df.columns[0] if hasattr(candles_df, 'columns') else 'UNKNOWN')

    if candles_df.empty:
        return []

    or_minutes = params['or_minutes']
    sl_pct = params['stop_loss_pct']
    tp_pct = params['take_profit_pct']
    trade_size = params['trade_size']
    enable_shorts = params.get('enable_shorts', False)
    cooldown_bars = params.get('cooldown_bars', 0)
    buffer_pct = params.get('breakout_buffer_pct', 0.0)
    min_entry_minutes = params.get('min_entry_minutes', 0)
    max_trades_per_day = params.get('max_trades_per_day', 0)
    eod_exit_min = params.get('eod_exit_min', 14 * 60 + 45)

    if candles_df.index.tz is not None:
        df_ist = candles_df.index.tz_convert(IST)
    else:
        df_ist = candles_df.index.tz_localize(IST)

    or_end_min = MKT_OPEN + or_minutes
    buffer = buffer_pct / 100

    or_high = None
    or_low = None
    or_bars = 0
    current_date = None

    entry_price = None
    entry_time = None
    side = None
    qty = trade_size
    last_exit_bar = None
    trades_this_day = 0

    trades = []

    for bar_number in range(len(candles_df)):
        ts = df_ist[bar_number]
        hour = ts.hour
        minute = ts.minute
        cur_min = hour * 60 + minute

        if cur_min < MKT_OPEN or cur_min > MKT_CLOSE:
            continue

        date_str = ts.strftime('%Y-%m-%d')
        if date_str != current_date:
            current_date = date_str
            or_high = None
            or_low = None
            or_bars = 0
            trades_this_day = 0
            if entry_price is not None:
                close_val = float(candles_df.iloc[bar_number]['close'])
                if side == 'LONG':
                    gross_pnl = (close_val - entry_price) * qty
                else:
                    gross_pnl = (entry_price - close_val) * qty
                costs = calculate_trading_costs(entry_price, close_val, qty, side)['total_costs']
                net_pnl = gross_pnl - costs
                pnl_pct = ((close_val - entry_price) / entry_price) * 100 if side == 'LONG' else ((entry_price - close_val) / entry_price) * 100
                entry_minutes = entry_time.hour * 60 + entry_time.minute
                exit_minutes = cur_min
                hold = exit_minutes - entry_minutes
                trades.append({
                    'symbol': symbol,
                    'side': side,
                    'entry_price': float(entry_price),
                    'exit_price': float(close_val),
                    'entry_time': entry_time,
                    'exit_time': ts,
                    'qty': int(qty),
                    'gross_pnl': float(gross_pnl),
                    'costs': float(costs),
                    'net_pnl': float(net_pnl),
                    'pnl_pct': float(pnl_pct),
                    'exit_reason': 'EOD',
                    'date': date_str,
                    'or_high': float(or_high) if or_high is not None else 0.0,
                    'or_low': float(or_low) if or_low is not None else 0.0,
                    'hold_minutes': hold,
                })
                entry_price = None
                side = None

        high = float(candles_df.iloc[bar_number]['high'])
        low = float(candles_df.iloc[bar_number]['low'])
        close = float(candles_df.iloc[bar_number]['close'])

        if cur_min < or_end_min:
            if or_high is None:
                or_high = high
                or_low = low
            else:
                or_high = max(or_high, high)
                or_low = min(or_low, low)
            or_bars += 1
            continue

        if or_high is None or or_low is None:
            continue

        if entry_price is not None:
            if side == 'LONG':
                pnl_pct = ((close - entry_price) / entry_price) * 100
            else:
                pnl_pct = ((entry_price - close) / entry_price) * 100

            exit_reason = None

            if pnl_pct >= tp_pct:
                exit_reason = 'TP'
            elif pnl_pct <= -sl_pct:
                exit_reason = 'SL'
            elif cur_min >= eod_exit_min:
                exit_reason = 'EOD'

            if exit_reason is not None:
                if side == 'LONG':
                    gross_pnl = (close - entry_price) * qty
                else:
                    gross_pnl = (entry_price - close) * qty
                costs = calculate_trading_costs(entry_price, close, qty, side)['total_costs']
                net_pnl = gross_pnl - costs

                entry_ts = entry_time
                entry_minutes_val = entry_ts.hour * 60 + entry_ts.minute
                exit_minutes_val = cur_min
                hold = exit_minutes_val - entry_minutes_val

                trades.append({
                    'symbol': symbol,
                    'side': side,
                    'entry_price': float(entry_price),
                    'exit_price': float(close),
                    'entry_time': entry_ts,
                    'exit_time': ts,
                    'qty': int(qty),
                    'gross_pnl': float(gross_pnl),
                    'costs': float(costs),
                    'net_pnl': float(net_pnl),
                    'pnl_pct': float(pnl_pct),
                    'exit_reason': exit_reason,
                    'date': date_str,
                    'or_high': float(or_high),
                    'or_low': float(or_low),
                    'hold_minutes': hold,
                })
                entry_price = None
                side = None
                last_exit_bar = bar_number
                continue

        if entry_price is not None:
            continue

        if last_exit_bar is not None and cooldown_bars > 0 and (bar_number - last_exit_bar) < cooldown_bars:
            continue

        if min_entry_minutes > 0 and cur_min < min_entry_minutes:
            continue

        if max_trades_per_day > 0 and trades_this_day >= max_trades_per_day:
            continue

        long_entry = close > or_high * (1 + buffer)
        short_entry = close < or_low * (1 - buffer)

        if long_entry:
            entry_price = close
            entry_time = ts
            side = 'LONG'
            trades_this_day += 1
        elif short_entry and enable_shorts:
            entry_price = close
            entry_time = ts
            side = 'SHORT'
            trades_this_day += 1

    return trades


def run_benchmark(params, cache_dir='experiments/data'):
    cache_path = Path(cache_dir) / 'orb_cache.pkl'
    symbols_path = Path(cache_dir) / 'orb_symbols.json'

    with open(cache_path, 'rb') as f:
        cached_data = pickle.load(f)

    if symbols_path.exists():
        with open(symbols_path, 'r') as f:
            symbols = json.load(f)
    else:
        symbols = list(cached_data.keys())

    all_trades = []

    for symbol in symbols:
        if symbol not in cached_data:
            continue
        df = cached_data[symbol]
        if df.empty:
            continue
        p = {**params, 'symbol': symbol}
        trades = simulate_orb(df, p)
        all_trades.extend(trades)

    total_trades = len(all_trades)

    if total_trades == 0:
        print("METRIC profit_factor=0.00")
        print("METRIC win_rate=0.0")
        print("METRIC net_pnl=0.00")
        print("METRIC total_trades=0")
        print("METRIC wins=0")
        print("METRIC losses=0")
        print("METRIC tp_exits=0")
        print("METRIC sl_exits=0")
        print("METRIC eod_exits=0")
        print("METRIC stocks_with_trades=0")
        return all_trades

    wins = sum(1 for t in all_trades if t['net_pnl'] > 0)
    losses = sum(1 for t in all_trades if t['net_pnl'] < 0)
    win_rate = wins / total_trades * 100
    gross_profits = sum(t['net_pnl'] for t in all_trades if t['net_pnl'] > 0)
    gross_losses = abs(sum(t['net_pnl'] for t in all_trades if t['net_pnl'] < 0))

    if gross_losses > 0:
        profit_factor = gross_profits / gross_losses
    elif gross_profits > 0:
        profit_factor = 999.99
    else:
        profit_factor = 0.0

    net_pnl = sum(t['net_pnl'] for t in all_trades)
    tp_exits = sum(1 for t in all_trades if t['exit_reason'] == 'TP')
    sl_exits = sum(1 for t in all_trades if t['exit_reason'] == 'SL')
    eod_exits = sum(1 for t in all_trades if t['exit_reason'] == 'EOD')

    traded_symbols = set(t['symbol'] for t in all_trades)
    stocks_with_trades = len(traded_symbols)

    print(f"METRIC profit_factor={profit_factor:.2f}")
    print(f"METRIC win_rate={win_rate:.1f}")
    print(f"METRIC net_pnl={net_pnl:.2f}")
    print(f"METRIC total_trades={total_trades}")
    print(f"METRIC wins={wins}")
    print(f"METRIC losses={losses}")
    print(f"METRIC tp_exits={tp_exits}")
    print(f"METRIC sl_exits={sl_exits}")
    print(f"METRIC eod_exits={eod_exits}")
    print(f"METRIC stocks_with_trades={stocks_with_trades}")

    return all_trades


if __name__ == '__main__':
    params = {
        'or_minutes': int(os.environ.get('ORB_OR_MIN', 45)),
        'stop_loss_pct': float(os.environ.get('ORB_SL', 0.4)),
        'take_profit_pct': float(os.environ.get('ORB_TP', 1.2)),
        'breakout_buffer_pct': float(os.environ.get('ORB_BUFFER', 0.3)),
        'cooldown_bars': int(os.environ.get('ORB_COOLDOWN', 3)),
        'enable_shorts': bool(int(os.environ.get('ORB_SHORTS', 0))),
        'trade_size': int(os.environ.get('ORB_TRADE_SIZE', 100)),
        'min_entry_minutes': int(os.environ.get('ORB_MIN_ENTRY', 0)),
        'max_trades_per_day': int(os.environ.get('ORB_MAX_PER_DAY', 0)),
        'eod_exit_min': int(os.environ.get('ORB_EOD_EXIT', 885)),
    }
    cache_dir = os.environ.get('ORB_CACHE_DIR', 'experiments/data')
    run_benchmark(params, cache_dir)
