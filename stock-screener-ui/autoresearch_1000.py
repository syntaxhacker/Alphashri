import sys
import os
import json
import time
import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, Optional
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import warnings
warnings.filterwarnings('ignore')

logging.basicConfig(level=logging.ERROR, format='%(message)s')
logger = logging.getLogger(__name__)

INSTRUMENTS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'upstox_trader', 'config_and_utils', 'nse_instruments.json'
)

API_KEY = os.getenv('UPSTOX_API_KEY', '93b32fc7-a2f4-4efc-9fe8-c28a9f6b4181')
API_SECRET = os.getenv('UPSTOX_API_SECRET', '2ean3hfhba')

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', '52w_data')
os.makedirs(DATA_DIR, exist_ok=True)

BEST_PARAMS = {
    'entry_threshold_pct': 1.0,
    'stop_loss_pct': 5.0,
    'trailing_stop_pct': 0.5,
    'max_holding_days': 20,
    'cooldown_days': 3,
    'lookback': 63,
}


def load_nse_instrument_lookup():
    if not os.path.exists(INSTRUMENTS_FILE):
        return {}
    with open(INSTRUMENTS_FILE) as f:
        data = json.load(f)
    lookup = {}
    for item in data:
        if isinstance(item, dict) and item.get('segment') == 'NSE_EQ':
            sym = item.get('trading_symbol', '')
            key = item.get('instrument_key', '')
            if sym and key:
                lookup[sym] = key
    return lookup


def fetch_tv_stocks(limit=1000, min_market_cap_cr=2000):
    from tradingview_screener import Query, col

    print(f"Querying TradingView screener (market cap > {min_market_cap_cr} Cr, NSE)...")
    total_rows, df = (
        Query()
        .select('name', 'close', 'market_cap_basic', 'exchange', 'sector')
        .set_markets('india')
        .where(
            col('market_cap_basic') > min_market_cap_cr * 1e7,
            col('close') > 20,
            col('exchange') == 'NSE',
        )
        .order_by('market_cap_basic', ascending=False)
        .limit(limit)
        .get_scanner_data()
    )

    if df is None or df.empty:
        print("TradingView returned no data")
        return []

    symbols = []
    for _, row in df.iterrows():
        name = str(row.get('name', ''))
        if name.startswith('NSE:'):
            name = name[4:]
        elif ':' in name:
            name = name.split(':')[-1]
        symbols.append(name)

    print(f"TradingView returned {len(symbols)} stocks (of {total_rows} total)")
    return symbols


def fetch_upstox_v3(symbol: str, instrument_key: str, from_date: str, to_date: str) -> Optional[pd.DataFrame]:
    from upstox_client import Configuration, ApiClient, HistoryV3Api

    config = Configuration()
    config.api_key['api_key'] = API_KEY
    config.api_key['x-client-secret'] = API_SECRET

    client = ApiClient(config)
    api = HistoryV3Api(client)

    cache_file = os.path.join(DATA_DIR, f"{symbol}_{from_date}_{to_date}.parquet")
    if os.path.exists(cache_file):
        try:
            df = pd.read_parquet(cache_file)
            if not df.empty:
                return df
        except Exception:
            pass

    try:
        result = api.get_historical_candle_data(
            instrument_key=instrument_key,
            unit='days',
            interval=1,
            to_date=to_date,
        )
        candles = result.data.candles
        if not candles:
            return None

        rows = []
        for c in candles:
            rows.append({
                'date': c[0][:10],
                'open': float(c[1]),
                'high': float(c[2]),
                'low': float(c[3]),
                'close': float(c[4]),
                'volume': int(c[5]),
            })

        df = pd.DataFrame(rows)
        df['date'] = pd.to_datetime(df['date'])
        df = df.set_index('date').sort_index()
        df = df[df.index >= pd.Timestamp(from_date)]

        if not df.empty:
            df.to_parquet(cache_file)
        return df if not df.empty else None

    except Exception:
        return None


def _fetch_one(sym, instrument_key, from_date, to_date):
    df = fetch_upstox_v3(sym, instrument_key, from_date, to_date)
    if df is not None and len(df) >= 500:
        return sym, df
    return sym, None


def fetch_stocks(instruments: Dict[str, str], days_back: int = 1200, workers: int = 10) -> Dict[str, pd.DataFrame]:
    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')

    tasks = [(sym, key, from_date, to_date) for sym, key in instruments.items()]
    n = len(tasks)
    data = {}
    done = 0
    lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_one, *t): t[0] for t in tasks}
        for fut in as_completed(futures):
            sym, df = fut.result()
            if df is not None:
                data[sym] = df
            with lock:
                done += 1
                if done % 100 == 0 or done == n:
                    print(f"  Fetched {len(data)} stocks from {done}/{n}...")

    return data


@dataclass
class TradeResult:
    total_trades: int
    wins: int
    losses: int
    win_rate: float
    total_return_pct: float
    profit_factor: float
    avg_return_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    trades_per_year: float
    pnl_series: np.ndarray
    trades_list: list


def run_52w_target_backtest(
    df: pd.DataFrame,
    entry_threshold_pct: float = 2.0,
    stop_loss_pct: float = 2.0,
    trailing_stop_pct: float = 0.5,
    max_holding_days: int = 15,
    cooldown_days: int = 7,
    fees: float = 0.0005,
    lookback: int = 252,
) -> TradeResult:
    close = df['close'].values
    high = df['high'].values
    low = df['low'].values

    n = len(df)
    min_window = max(50, lookback // 3)
    w52_high = np.full(n, np.nan)
    for i in range(n):
        start = max(0, i - lookback)
        window = high[start:i]
        if len(window) >= min_window:
            w52_high[i] = np.max(window)

    in_position = False
    entry_price = 0.0
    entry_idx = 0
    highest_since_entry = 0.0
    trailing_active = False
    bars_in_trade = 0
    cooldown_remaining = 0

    trades = []

    for i in range(n):
        if np.isnan(w52_high[i]):
            continue

        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        if not in_position:
            threshold = w52_high[i] * (1 - entry_threshold_pct / 100)
            if close[i] >= threshold and cooldown_remaining <= 0:
                in_position = True
                entry_price = close[i]
                entry_idx = i
                highest_since_entry = close[i]
                trailing_active = False
                bars_in_trade = 0

        if in_position:
            bars_in_trade += 1
            if high[i] > highest_since_entry:
                highest_since_entry = high[i]

            exit_reason = None

            if high[i] >= w52_high[i]:
                trailing_active = True

            if trailing_active:
                trail_stop = highest_since_entry * (1 - trailing_stop_pct / 100)
                if low[i] <= trail_stop:
                    exit_price = trail_stop
                    exit_reason = 'TRAILING_STOP'

            if exit_reason is None and low[i] <= entry_price * (1 - stop_loss_pct / 100):
                exit_price = entry_price * (1 - stop_loss_pct / 100)
                exit_reason = 'STOP_LOSS'

            if exit_reason is None and bars_in_trade >= max_holding_days:
                exit_price = close[i]
                exit_reason = 'MAX_HOLDING'

            if exit_reason is not None:
                gross_ret = (exit_price - entry_price) / entry_price
                net_ret = gross_ret - fees

                trades.append({
                    'entry_idx': entry_idx,
                    'exit_idx': i,
                    'entry_price': entry_price,
                    'exit_price': exit_price,
                    'return_pct': net_ret * 100,
                    'reason': exit_reason,
                    'bars_held': bars_in_trade,
                })

                in_position = False
                cooldown_remaining = cooldown_days

    if not trades:
        return TradeResult(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, np.array([]), [])

    returns = np.array([t['return_pct'] for t in trades])
    wins = int(np.sum(returns > 0))
    losses = int(np.sum(returns <= 0))
    total = len(returns)
    win_rate = wins / total * 100 if total > 0 else 0
    total_return = float(np.sum(returns))
    avg_return = float(np.mean(returns))

    gross_profit = float(np.sum(returns[returns > 0])) if wins > 0 else 0.0
    gross_loss = float(abs(np.sum(returns[returns < 0]))) if losses > 0 else 0.001
    profit_factor = min(gross_profit / gross_loss if gross_loss > 0 else 10.0, 10.0)

    daily_returns = np.zeros(n)
    for t in trades:
        if t['exit_idx'] < n:
            daily_returns[t['exit_idx']] = t['return_pct'] / 100

    nonzero = daily_returns[daily_returns != 0]
    if len(nonzero) > 1 and np.std(nonzero) > 0:
        sharpe = float(np.mean(nonzero) / np.std(nonzero) * np.sqrt(252))
    else:
        sharpe = 0.0
    sharpe = max(-10.0, min(sharpe, 10.0))

    cum = np.cumsum(returns)
    peak = np.maximum.accumulate(cum)
    dd = cum - peak
    max_dd = float(abs(np.min(dd))) if len(dd) > 0 else 0.0

    date_range_days = (df.index[-1] - df.index[0]).days
    tpy = total / (date_range_days / 365.25) if date_range_days > 0 else 0

    return TradeResult(total, wins, losses, win_rate, total_return, profit_factor, avg_return, sharpe, max_dd, tpy, returns, trades)


def validate_stock(df, params, train_bars=500, test_bars=300, n_folds=3):
    n = len(df)
    fold_results = []
    raw_trades = []

    for fold in range(n_folds):
        test_end = n - fold * test_bars
        test_start = test_end - test_bars
        train_end = test_start
        train_start = max(0, train_end - train_bars)

        if test_end > n or test_start < 0 or train_start < 0:
            break

        train_df = df.iloc[train_start:train_end]
        test_df = df.iloc[test_start:test_end]

        if len(train_df) < 300 or len(test_df) < 60:
            continue

        test_result = run_52w_target_backtest(test_df, **params)

        if test_result.total_trades == 0:
            continue

        fold_results.append({
            'fold': fold,
            'test_start': test_df.index[0].strftime('%Y-%m-%d'),
            'test_end': test_df.index[-1].strftime('%Y-%m-%d'),
            'sharpe': round(test_result.sharpe_ratio, 4),
            'win_rate': round(test_result.win_rate, 2),
            'pf': round(test_result.profit_factor, 2),
            'return': round(test_result.total_return_pct, 2),
            'trades': test_result.total_trades,
            'max_dd': round(test_result.max_drawdown_pct, 2),
        })

        test_dates = test_df.index.tolist()
        for t in test_result.trades_list:
            entry_date = test_dates[t['entry_idx']].strftime('%Y-%m-%d') if t['entry_idx'] < len(test_dates) else ''
            exit_date = test_dates[t['exit_idx']].strftime('%Y-%m-%d') if t['exit_idx'] < len(test_dates) else ''
            raw_trades.append({
                'fold': fold,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'entry_price': round(t['entry_price'], 2),
                'exit_price': round(t['exit_price'], 2),
                'return_pct': round(t['return_pct'], 2),
                'reason': t['reason'],
                'bars_held': t['bars_held'],
            })

    if not fold_results:
        return {'avg_sharpe': 0, 'avg_wr': 0, 'avg_return': 0, 'avg_trades': 0, 'avg_pf': 0, 'folds': [], 'raw_trades': []}

    return {
        'avg_sharpe': round(np.mean([f['sharpe'] for f in fold_results]), 4),
        'avg_wr': round(np.mean([f['win_rate'] for f in fold_results]), 2),
        'avg_return': round(np.mean([f['return'] for f in fold_results]), 2),
        'avg_trades': round(np.mean([f['trades'] for f in fold_results]), 1),
        'avg_pf': round(np.mean([f['pf'] for f in fold_results]), 2),
        'folds': fold_results,
        'raw_trades': raw_trades,
    }


def run_52w_target_backtest_with_trades(
    df, params, train_bars=500, test_bars=300, n_folds=3
):
    n = len(df)
    all_trades = []

    for fold in range(n_folds):
        test_end = n - fold * test_bars
        test_start = test_end - test_bars
        train_end = test_start
        train_start = max(0, train_end - train_bars)

        if test_end > n or test_start < 0 or train_start < 0:
            break

        train_df = df.iloc[train_start:train_end]
        test_df = df.iloc[test_start:test_end]

        if len(train_df) < 300 or len(test_df) < 60:
            continue

        result = run_52w_target_backtest(test_df, **params)
        if result.total_trades == 0:
            continue

        test_dates = test_df.index.tolist()
        for t in result.trades_list:
            entry_date = test_dates[t['entry_idx']].strftime('%Y-%m-%d') if t['entry_idx'] < len(test_dates) else ''
            exit_date = test_dates[t['exit_idx']].strftime('%Y-%m-%d') if t['exit_idx'] < len(test_dates) else ''
            all_trades.append({
                'fold': fold,
                'entry_date': entry_date,
                'exit_date': exit_date,
                'entry_price': round(t['entry_price'], 2),
                'exit_price': round(t['exit_price'], 2),
                'return_pct': round(t['return_pct'], 2),
                'reason': t['reason'],
                'bars_held': t['bars_held'],
            })

    return all_trades

    if not fold_results:
        return {'avg_sharpe': 0, 'avg_wr': 0, 'avg_return': 0, 'avg_trades': 0, 'avg_pf': 0, 'folds': []}

    return {
        'avg_sharpe': round(np.mean([f['sharpe'] for f in fold_results]), 4),
        'avg_wr': round(np.mean([f['win_rate'] for f in fold_results]), 2),
        'avg_return': round(np.mean([f['return'] for f in fold_results]), 2),
        'avg_trades': round(np.mean([f['trades'] for f in fold_results]), 1),
        'avg_pf': round(np.mean([f['pf'] for f in fold_results]), 2),
        'folds': fold_results,
    }


def main():
    t0 = time.time()

    import argparse
    parser = argparse.ArgumentParser(description='52W Target OOS validation on TradingView large+mid cap stocks')
    parser.add_argument('-n', '--num-stocks', type=int, default=1000, help='Number of stocks to fetch from TradingView (default: 1000)')
    parser.add_argument('--min-cap', type=int, default=2000, help='Min market cap in Cr (default: 2000)')
    args = parser.parse_args()

    tv_symbols = fetch_tv_stocks(limit=args.num_stocks, min_market_cap_cr=args.min_cap)
    if not tv_symbols:
        print("No stocks from TradingView")
        return

    lookup = load_nse_instrument_lookup()
    matched = {s: lookup[s] for s in tv_symbols if s in lookup}
    print(f"Matched {len(matched)}/{len(tv_symbols)} to Upstox instrument keys")

    if len(matched) < 10:
        print("Too few matched stocks")
        return

    print(f"Fetching historical data...")
    stock_data = fetch_stocks(matched, days_back=1200)
    print(f"Fetched {len(stock_data)} stocks with >= 500 bars")

    if len(stock_data) < 10:
        print("Not enough data")
        return

    param_variants = [
        {'entry_threshold_pct': 1.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 0.5, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 3.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 1.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 3.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 2.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 5.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 1.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 5.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 2.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 5.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 3.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 5.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 2.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 5.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 3.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 5.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 5.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 7.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 2.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 7.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 3.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 7.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 2.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 7.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 3.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 7.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 5.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 10.0, 'stop_loss_pct': 5.0, 'trailing_stop_pct': 2.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 10.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 3.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
        {'entry_threshold_pct': 10.0, 'stop_loss_pct': 7.0, 'trailing_stop_pct': 5.0, 'max_holding_days': 20, 'cooldown_days': 3, 'lookback': 63},
    ]

    print(f"\nComparing {len(param_variants)} param variants on {len(stock_data)} stocks (parallel)...")
    print(f"Walk-forward: 500 train / 300 test / 3 folds\n")

    all_variant_results = []
    all_variant_trades = {}

    for vi, params in enumerate(param_variants):
        tag = f"e={params['entry_threshold_pct']}% t={params['trailing_stop_pct']}% h={params['max_holding_days']}d sl={params['stop_loss_pct']}%"
        print(f"  [{vi+1}/{len(param_variants)}] {tag}")

        stock_results = {}
        done = 0
        n_total = len(stock_data)

        def _validate_one(item):
            sym, df = item
            return sym, validate_stock(df, params, train_bars=500, test_bars=300, n_folds=3)

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_validate_one, item): item[0] for item in stock_data.items()}
            for fut in as_completed(futures):
                sym, result = fut.result()
                stock_results[sym] = result
                done += 1
                if done % 200 == 0 or done == n_total:
                    print(f"    {done}/{n_total}...")

        sharpes = [r['avg_sharpe'] for r in stock_results.values() if r['avg_sharpe'] != 0]
        wrs = [r['avg_wr'] for r in stock_results.values() if r['avg_wr'] != 0]
        rets = [r['avg_return'] for r in stock_results.values() if r['avg_return'] != 0]
        pfs = [r['avg_pf'] for r in stock_results.values() if r['avg_pf'] != 0]
        tps = [r['avg_trades'] for r in stock_results.values() if r['avg_trades'] != 0]

        n_active = len(sharpes)
        avg_sharpe = float(np.mean(sharpes)) if sharpes else 0
        med_sharpe = float(np.median(sharpes)) if sharpes else 0
        avg_wr = float(np.mean(wrs)) if wrs else 0
        avg_ret = float(np.mean(rets)) if rets else 0
        avg_pf = float(np.mean(pfs)) if pfs else 0
        avg_tpy = float(np.mean(tps)) if tps else 0
        profitable = sum(1 for s in sharpes if s > 0)
        consistency = profitable / len(sharpes) * 100 if sharpes else 0

        csv_rows = []
        for sym, r in stock_results.items():
            for t in r.get('raw_trades', []):
                csv_rows.append({
                    'symbol': sym, 'fold': t['fold'],
                    'entry_date': t['entry_date'], 'exit_date': t['exit_date'],
                    'entry_price': t['entry_price'], 'exit_price': t['exit_price'],
                    'return_pct': t['return_pct'], 'reason': t['reason'],
                    'bars_held': t['bars_held'],
                })

        all_variant_trades[tag] = csv_rows

        all_variant_results.append({
            'params': params, 'tag': tag, 'n_stocks': n_active,
            'avg_sharpe': round(avg_sharpe, 4), 'med_sharpe': round(med_sharpe, 4),
            'avg_wr': round(avg_wr, 2), 'avg_return': round(avg_ret, 2),
            'avg_pf': round(avg_pf, 2), 'avg_tpy': round(avg_tpy, 1),
            'consistency': round(consistency, 1), 'profitable': profitable,
            'stock_results': stock_results,
        })

    elapsed = time.time() - t0

    by_return = sorted(all_variant_results, key=lambda x: x['avg_return'], reverse=True)
    by_sharpe = sorted(all_variant_results, key=lambda x: x['avg_sharpe'], reverse=True)

    print(f"\n{'='*110}")
    print(f"  PARAM COMPARISON — sorted by RETURN")
    print(f"{'='*110}")
    print(f"  {'#':>2}  {'Entry':>5}  {'Trail':>5}  {'Hold':>4}  {'SL':>4}  {'LB':>4}  {'Stocks':>6}  {'Sharpe':>7}  {'MedSh':>7}  {'WR%':>6}  {'PF':>5}  {'Return':>7}  {'Tr/yr':>5}  {'Cons%':>6}")
    print(f"  {'-'*108}")
    for i, r in enumerate(by_return):
        p = r['params']
        print(f"  {i+1:2d}  {p['entry_threshold_pct']:5.1f}  {p['trailing_stop_pct']:5.1f}  {p['max_holding_days']:4d}  {p['stop_loss_pct']:4.1f}  {p['lookback']:4d}  {r['n_stocks']:6d}  {r['avg_sharpe']:7.2f}  {r['med_sharpe']:7.2f}  {r['avg_wr']:5.1f}%  {r['avg_pf']:4.2f}  {r['avg_return']:6.2f}%  {r['avg_tpy']:5.1f}  {r['consistency']:5.1f}%")

    print(f"\n{'='*110}")
    print(f"  PARAM COMPARISON — sorted by SHARPE")
    print(f"{'='*110}")
    print(f"  {'#':>2}  {'Entry':>5}  {'Trail':>5}  {'Hold':>4}  {'SL':>4}  {'LB':>4}  {'Stocks':>6}  {'Sharpe':>7}  {'MedSh':>7}  {'WR%':>6}  {'PF':>5}  {'Return':>7}  {'Tr/yr':>5}  {'Cons%':>6}")
    print(f"  {'-'*108}")
    for i, r in enumerate(by_sharpe):
        p = r['params']
        print(f"  {i+1:2d}  {p['entry_threshold_pct']:5.1f}  {p['trailing_stop_pct']:5.1f}  {p['max_holding_days']:4d}  {p['stop_loss_pct']:4.1f}  {p['lookback']:4d}  {r['n_stocks']:6d}  {r['avg_sharpe']:7.2f}  {r['med_sharpe']:7.2f}  {r['avg_wr']:5.1f}%  {r['avg_pf']:4.2f}  {r['avg_return']:6.2f}%  {r['avg_tpy']:5.1f}  {r['consistency']:5.1f}%")

    print(f"\n  Time: {elapsed:.1f}s")

    best_ret = by_return[0]
    best_sh = by_sharpe[0]
    print(f"\n  Best RETURN: {best_ret['tag']} => ret={best_ret['avg_return']}%, sharpe={best_ret['avg_sharpe']}, wr={best_ret['avg_wr']}%")
    print(f"  Best SHARPE: {best_sh['tag']} => sharpe={best_sh['avg_sharpe']}, ret={best_sh['avg_return']}%, wr={best_sh['avg_wr']}%")

    print(f"\nMETRIC best_return_pct={best_ret['avg_return']}")
    print(f"METRIC best_return_sharpe={best_ret['avg_sharpe']}")
    print(f"METRIC best_sharpe={best_sh['avg_sharpe']}")
    print(f"METRIC best_sharpe_return={best_sh['avg_return']}")

    best_stock_results = best_ret['stock_results']
    ranked = sorted(
        [(sym, r) for sym, r in best_stock_results.items() if r['avg_sharpe'] != 0],
        key=lambda x: x[1]['avg_sharpe'], reverse=True,
    )

    print(f"\nTOP 20 ({best_ret['tag']}):")
    for sym, r in ranked[:20]:
        print(f"  {sym:15s}  sharpe={r['avg_sharpe']:7.2f}  wr={r['avg_wr']:5.1f}%  pf={r['avg_pf']:4.2f}  ret={r['avg_return']:6.2f}%  trades={r['avg_trades']}")

    print(f"\nBOTTOM 10 ({best_ret['tag']}):")
    for sym, r in ranked[-10:]:
        print(f"  {sym:15s}  sharpe={r['avg_sharpe']:7.2f}  wr={r['avg_wr']:5.1f}%  pf={r['avg_pf']:4.2f}  ret={r['avg_return']:6.2f}%  trades={r['avg_trades']}")

    print(f"\nExporting trades CSV for best variant...")
    best_csv = all_variant_trades[best_ret['tag']]
    if best_csv:
        csv_df = pd.DataFrame(best_csv)
        csv_df = csv_df.sort_values(['entry_date', 'symbol'])
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'autoresearch-1000-trades.csv')
        csv_df.to_csv(csv_path, index=False)
        print(f"Trades CSV: {csv_path} ({len(csv_df)} trades, {csv_df['symbol'].nunique()} stocks)")

        print(f"\nHolding period distribution:")
        bh = csv_df['bars_held'].value_counts().sort_index()
        for k, v in bh.items():
            avg_ret = csv_df[csv_df['bars_held'] == k]['return_pct'].mean()
            print(f"  {k:2d} days: {v:5d} trades ({v/len(csv_df)*100:5.1f}%)  avg_ret={avg_ret:+.2f}%")


if __name__ == '__main__':
    main()
