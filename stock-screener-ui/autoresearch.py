import sys
import os
import json
import time
import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from itertools import product
import warnings
warnings.filterwarnings('ignore')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(level=logging.WARNING, format='%(message)s')
logger = logging.getLogger(__name__)

INSTRUMENTS = {
    'RELIANCE': 'NSE_EQ|INE002A01018',
    'TCS': 'NSE_EQ|INE467B01029',
    'HDFCBANK': 'NSE_EQ|INE040A01034',
    'INFY': 'NSE_EQ|INE009A01021',
    'ICICIBANK': 'NSE_EQ|INE090A01021',
    'SBIN': 'NSE_EQ|INE062A01020',
    'BHARTIARTL': 'NSE_EQ|INE397D01024',
    'ITC': 'NSE_EQ|INE154A01025',
    'KOTAKBANK': 'NSE_EQ|INE237A01036',
    'LT': 'NSE_EQ|INE018A01030',
    'AXISBANK': 'NSE_EQ|INE238A01034',
    'BAJFINANCE': 'NSE_EQ|INE296A01032',
    'MARUTI': 'NSE_EQ|INE585B01010',
    'TITAN': 'NSE_EQ|INE280A01028',
    'SUNPHARMA': 'NSE_EQ|INE044A01036',
    'WIPRO': 'NSE_EQ|INE075A01022',
    'ULTRACEMCO': 'NSE_EQ|INE481G01011',
    'HCLTECH': 'NSE_EQ|INE860A01027',
    'ADANIENT': 'NSE_EQ|INE423A01024',
    'ONGC': 'NSE_EQ|INE213A01029',
    'NTPC': 'NSE_EQ|INE733E01010',
    'POWERGRID': 'NSE_EQ|INE752E01010',
    'TATASTEEL': 'NSE_EQ|INE081A01020',
    'JSWSTEEL': 'NSE_EQ|INE019A01038',
    'COALINDIA': 'NSE_EQ|INE522F01014',
    'INDUSINDBK': 'NSE_EQ|INE095A01012',
    'HINDUNILVR': 'NSE_EQ|INE030A01027',
    'DMART': 'NSE_EQ|INE192R01011',
    'NESTLEIND': 'NSE_EQ|INE239A01024',
    'CIPLA': 'NSE_EQ|INE059A01026',
    'TECHM': 'NSE_EQ|INE669C01036',
    'GRASIM': 'NSE_EQ|INE047A01021',
    'BAJAJFINSV': 'NSE_EQ|INE918I01026',
    'DRREDDY': 'NSE_EQ|INE089A01031',
    'EICHERMOT': 'NSE_EQ|INE066A01021',
    'HEROMOTOCO': 'NSE_EQ|INE158A01026',
    'BPCL': 'NSE_EQ|INE029A01011',
    'DIVISLAB': 'NSE_EQ|INE361B01024',
    'BRITANNIA': 'NSE_EQ|INE216A01030',
    'SHRIRAMFIN': 'NSE_EQ|INE721A01047',
    'HINDALCO': 'NSE_EQ|INE038A01020',
    'APOLLOHOSP': 'NSE_EQ|INE437A01024',
    'TATACONSUM': 'NSE_EQ|INE192A01025',
    'ASIANPAINT': 'NSE_EQ|INE021A01026',
    'TATAMOTORS': 'NSE_EQ|INE155A01022',
    'M_M': 'NSE_EQ|INE101A01026',
    'TATAPOWER': 'NSE_EQ|INE245A01021',
    'CHOLAHLDNG': 'NSE_EQ|INE149A01033',
    'PIDILITIND': 'NSE_EQ|INE318A01026',
    'INDIGO': 'NSE_EQ|INE646L01027',
    'PAGEIND': 'NSE_EQ|INE761H01022',
    'AUBANK': 'NSE_EQ|INE949L01017',
    'IDFCFIRSTB': 'NSE_EQ|INE092T01019',
    'FEDERALBNK': 'NSE_EQ|INE171A01029',
    'MANAPPURAM': 'NSE_EQ|INE522D01027',
    'BANDHANBNK': 'NSE_EQ|INE545U01014',
    'RBLBANK': 'NSE_EQ|INE976G01028',
    'CANBK': 'NSE_EQ|INE476A01022',
    'CGPOWER': 'NSE_EQ|INE067A01029',
    'LALPATHLAB': 'NSE_EQ|INE600L01024',
    'LAURUSLABS': 'NSE_EQ|INE947Q01028',
    'ALKEM': 'NSE_EQ|INE540L01014',
    'VBL': 'NSE_EQ|INE200M01039',
    'OFSS': 'NSE_EQ|INE881D01027',
    'TRENT': 'NSE_EQ|INE849A01020',
    'DABUR': 'NSE_EQ|INE016A01026',
    'BERGEPAINT': 'NSE_EQ|INE463A01038',
    'NAUKRI': 'NSE_EQ|INE663F01032',
    'ZYDUSLIFE': 'NSE_EQ|INE010B01027',
    'HINDZINC': 'NSE_EQ|INE267A01025',
    'COLPAL': 'NSE_EQ|INE259A01022',
    'JUBLFOOD': 'NSE_EQ|INE797F01020',
    'MUTHOOTFIN': 'NSE_EQ|INE414G01012',
    'YESBANK': 'NSE_EQ|INE528G01035',
    'SUZLON': 'NSE_EQ|INE040H01021',
    'ADANIPOWER': 'NSE_EQ|INE814H01029',
    'IRFC': 'NSE_EQ|INE053F01010',
    'NHPC': 'NSE_EQ|INE848E01016',
    'IRCTC': 'NSE_EQ|INE335Y01020',
    'CDSL': 'NSE_EQ|INE736A01011',
    'IDEA': 'NSE_EQ|INE669E01016',
}

API_KEY = os.getenv('UPSTOX_API_KEY', '93b32fc7-a2f4-4efc-9fe8-c28a9f6b4181')
API_SECRET = os.getenv('UPSTOX_API_SECRET', '2ean3hfhba')

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cache', '52w_data')
os.makedirs(DATA_DIR, exist_ok=True)


def fetch_upstox_v3(symbol: str, instrument_key: str, from_date: str, to_date: str) -> Optional[pd.DataFrame]:
    from upstox_client import Configuration, ApiClient, HistoryV3Api

    config = Configuration()
    config.api_key['api_key'] = API_KEY
    config.api_key['x-client-secret'] = API_SECRET

    client = ApiClient(config)
    api = HistoryV3Api(client)

    cache_file = os.path.join(DATA_DIR, f"{symbol}_{from_date}_{to_date}.parquet")
    if os.path.exists(cache_file):
        df = pd.read_parquet(cache_file)
        if not df.empty:
            return df

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

    except Exception as e:
        logger.warning(f"Fetch failed for {symbol}: {e}")
        return None


def fetch_all_stocks(symbols: List[str] = None, days_back: int = 1200) -> Dict[str, pd.DataFrame]:
    if symbols is None:
        symbols = list(INSTRUMENTS.keys())

    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')

    data = {}
    for sym in symbols:
        key = INSTRUMENTS.get(sym)
        if not key:
            continue
        df = fetch_upstox_v3(sym, key, from_date, to_date)
        if df is not None and len(df) >= 500:
            data[sym] = df
        time.sleep(0.3)

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


def run_52w_target_backtest(
    df: pd.DataFrame,
    entry_threshold_pct: float = 2.0,
    stop_loss_pct: float = 2.0,
    trailing_stop_pct: float = 0.5,
    max_holding_days: int = 15,
    cooldown_days: int = 7,
    fees: float = 0.0005,
) -> TradeResult:
    close = df['close'].values
    high = df['high'].values
    low = df['low'].values

    n = len(df)
    w52_high = np.full(n, np.nan)
    for i in range(n):
        start = max(0, i - 252)
        window = high[start:i]
        if len(window) >= 100:
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
        return TradeResult(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, np.array([]))

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

    return TradeResult(total, wins, losses, win_rate, total_return, profit_factor, avg_return, sharpe, max_dd, tpy, returns)


def anchored_walk_forward(
    df: pd.DataFrame,
    train_bars: int = 500,
    test_bars: int = 300,
    n_folds: int = 3,
    param_grid: Optional[Dict] = None,
) -> Dict:
    if param_grid is None:
        param_grid = {
            'entry_threshold_pct': [2.0, 3.0, 4.0, 5.0],
            'stop_loss_pct': [1.5, 2.0, 3.0],
            'trailing_stop_pct': [0.5, 1.0, 1.5],
            'max_holding_days': [10, 15, 20],
            'cooldown_days': [5, 7, 10],
        }

    n = len(df)
    fold_results = []

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

        best_score = -999
        best_params = None

        keys = list(param_grid.keys())
        values = list(param_grid.values())

        for combo in product(*values):
            params = dict(zip(keys, combo))
            result = run_52w_target_backtest(train_df, **params)

            if result.total_trades < 2:
                continue

            score = result.sharpe_ratio + 0.3 * min(result.win_rate, 70) / 70 + 0.1 * min(result.total_trades, 20) / 20
            if score > best_score:
                best_score = score
                best_params = params

        if best_params is None:
            continue

        test_result = run_52w_target_backtest(test_df, **best_params)

        fold_results.append({
            'fold': fold,
            'train_start': train_df.index[0].strftime('%Y-%m-%d'),
            'train_end': train_df.index[-1].strftime('%Y-%m-%d'),
            'test_start': test_df.index[0].strftime('%Y-%m-%d'),
            'test_end': test_df.index[-1].strftime('%Y-%m-%d'),
            'best_params': best_params,
            'train_sharpe': round(best_score, 4),
            'test_sharpe': round(test_result.sharpe_ratio, 4),
            'test_win_rate': round(test_result.win_rate, 2),
            'test_pf': round(test_result.profit_factor, 2),
            'test_return': round(test_result.total_return_pct, 2),
            'test_trades': test_result.total_trades,
            'test_max_dd': round(test_result.max_drawdown_pct, 2),
        })

    if not fold_results:
        return {'avg_oos_sharpe': 0, 'avg_oos_win_rate': 0, 'avg_oos_trades': 0, 'avg_oos_return': 0, 'param_stability': {}, 'folds': []}

    avg_sharpe = np.mean([f['test_sharpe'] for f in fold_results])
    avg_wr = np.mean([f['test_win_rate'] for f in fold_results])
    avg_return = np.mean([f['test_return'] for f in fold_results])
    avg_trades = np.mean([f['test_trades'] for f in fold_results])

    param_keys = list(fold_results[0]['best_params'].keys())
    param_stability = {}
    for k in param_keys:
        vals = [f['best_params'][k] for f in fold_results]
        param_stability[k] = round(float(np.std(vals)), 4)

    return {
        'avg_oos_sharpe': round(avg_sharpe, 4),
        'avg_oos_win_rate': round(avg_wr, 2),
        'avg_oos_return': round(avg_return, 2),
        'avg_oos_trades': round(avg_trades, 1),
        'param_stability': param_stability,
        'folds': fold_results,
    }


def run_full_optimization(
    stock_data: Dict[str, pd.DataFrame],
    param_grid: Optional[Dict] = None,
    train_bars: int = 500,
    test_bars: int = 300,
    n_folds: int = 3,
) -> Dict:
    stock_results = {}

    for sym, df in stock_data.items():
        result = anchored_walk_forward(df, train_bars, test_bars, n_folds, param_grid)
        result['symbol'] = sym
        stock_results[sym] = result

    all_sharpes = [r['avg_oos_sharpe'] for r in stock_results.values() if r['avg_oos_sharpe'] != 0]
    all_wrs = [r['avg_oos_win_rate'] for r in stock_results.values() if r['avg_oos_win_rate'] != 0]
    all_returns = [r['avg_oos_return'] for r in stock_results.values() if 'avg_oos_return' in r and r['avg_oos_return'] != 0]

    avg_sharpe = float(np.mean(all_sharpes)) if all_sharpes else 0
    avg_wr = float(np.mean(all_wrs)) if all_wrs else 0
    median_sharpe = float(np.median(all_sharpes)) if all_sharpes else 0
    avg_return = float(np.mean(all_returns)) if all_returns else 0.0

    profitable_stocks = sum(1 for s in all_sharpes if s > 0)
    consistency = profitable_stocks / len(all_sharpes) * 100 if all_sharpes else 0

    stability_score = 1.0 / (1.0 + float(np.std(all_sharpes))) if all_sharpes else 0

    composite = 0.4 * avg_sharpe + 0.3 * (avg_wr / 100) + 0.2 * stability_score + 0.1 * (consistency / 100)

    return {
        'avg_oos_sharpe': round(avg_sharpe, 4),
        'median_oos_sharpe': round(median_sharpe, 4),
        'avg_oos_win_rate': round(avg_wr, 2),
        'avg_oos_return': round(avg_return, 2),
        'consistency_pct': round(consistency, 1),
        'profitable_stocks': profitable_stocks,
        'total_stocks': len(all_sharpes),
        'stability_score': round(stability_score, 4),
        'composite_score': round(composite, 4),
        'stock_results': stock_results,
        'param_grid': param_grid,
    }


def main():
    t0 = time.time()

    param_grid = {
        'entry_threshold_pct': [2.0, 3.0, 4.0, 5.0, 7.0, 10.0],
        'stop_loss_pct': [1.5, 2.0, 3.0, 5.0],
        'trailing_stop_pct': [0.5, 1.0, 1.5, 2.5],
        'max_holding_days': [10, 15, 20, 30],
        'cooldown_days': [3, 5, 7, 10],
    }

    symbols = list(INSTRUMENTS.keys())
    logger.info(f"Fetching data for {len(symbols)} stocks...")
    stock_data = fetch_all_stocks(symbols, days_back=1200)

    if len(stock_data) < 5:
        logger.error(f"Only {len(stock_data)} stocks fetched")
        print("METRIC sharpe_ratio=0")
        print("METRIC oos_win_rate=0")
        print("METRIC oos_profit_factor=0")
        print("METRIC oos_total_return=0")
        print("METRIC param_stability=0")
        print("METRIC trades_per_year=0")
        return

    logger.info(f"Fetched {len(stock_data)} stocks. Running anchored walk-forward (500 train / 300 test / 3 folds)...")
    results = run_full_optimization(stock_data, param_grid, train_bars=500, test_bars=300, n_folds=3)

    elapsed = time.time() - t0
    logger.info(f"Completed in {elapsed:.1f}s")

    avg_pf = 0
    avg_trades = 0
    stab_count = 0
    avg_stability = 0

    for sr in results['stock_results'].values():
        if sr['folds']:
            avg_pf += np.mean([f['test_pf'] for f in sr['folds']])
            avg_trades += sr.get('avg_oos_trades', 0)
        if sr.get('param_stability'):
            vals = list(sr['param_stability'].values())
            if vals:
                avg_stability += np.mean(vals)
                stab_count += 1

    n_stocks = max(len(results['stock_results']), 1)
    avg_pf /= n_stocks
    avg_trades /= n_stocks
    avg_stability /= max(stab_count, 1)

    print(f"METRIC sharpe_ratio={results['avg_oos_sharpe']}")
    print(f"METRIC oos_win_rate={results['avg_oos_win_rate']}")
    print(f"METRIC oos_profit_factor={round(avg_pf, 2)}")
    print(f"METRIC oos_total_return={results.get('avg_oos_return', 0)}")
    print(f"METRIC param_stability={round(avg_stability, 4)}")
    print(f"METRIC trades_per_year={round(avg_trades, 1)}")


if __name__ == '__main__':
    main()
