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
    'INFY': 'NSE_EQ|INE009A01021',
    'HDFCBANK': 'NSE_EQ|INE040A01034',
    'ICICIBANK': 'NSE_EQ|INE090A01021',
    'SBIN': 'NSE_EQ|INE062A01020',
    'BAJFINANCE': 'NSE_EQ|INE296A01032',
    'MARUTI': 'NSE_EQ|INE585B01010',
    'TATASTEEL': 'NSE_EQ|INE081A01020',
    'ADANIENT': 'NSE_EQ|INE423A01024',
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
            logger.warning(f"No instrument key for {sym}, skipping")
            continue
        logger.info(f"Fetching {sym} ({key})...")
        df = fetch_upstox_v3(sym, key, from_date, to_date)
        if df is not None and len(df) >= 500:
            data[sym] = df
            logger.info(f"  {sym}: {len(df)} bars, {df.index[0].date()} to {df.index[-1].date()}")
        else:
            logger.warning(f"  {sym}: insufficient data ({len(df) if df is not None else 0} bars)")
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

    entries = np.zeros(n, dtype=bool)
    exits = np.zeros(n, dtype=bool)
    entry_prices = np.full(n, np.nan)
    exit_prices = np.full(n, np.nan)
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
                cost = fees
                net_ret = gross_ret - cost

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
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')

    if len(returns) > 1 and np.std(returns) > 0:
        sharpe = float(np.mean(returns) / np.std(returns) * np.sqrt(252))
    else:
        sharpe = 0.0

    cum_returns = np.cumsum(returns)
    peak = np.maximum.accumulate(cum_returns)
    drawdown = cum_returns - peak
    max_dd = float(abs(np.min(drawdown))) if len(drawdown) > 0 else 0.0

    date_range_days = (df.index[-1] - df.index[0]).days
    trades_per_year = total / (date_range_days / 365.25) if date_range_days > 0 else 0

    return TradeResult(
        total_trades=total,
        wins=wins,
        losses=losses,
        win_rate=win_rate,
        total_return_pct=total_return,
        profit_factor=profit_factor,
        avg_return_pct=avg_return,
        sharpe_ratio=sharpe,
        max_drawdown_pct=max_dd,
        trades_per_year=trades_per_year,
        pnl_series=returns,
    )


def walk_forward_optimize(
    df: pd.DataFrame,
    train_months: int = 12,
    test_months: int = 6,
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

    total_bars = len(df)
    train_bars = int(train_months * 21)
    test_bars = int(test_months * 21)
    step_bars = test_bars

    fold_results = []

    for fold in range(n_folds):
        test_end = total_bars - fold * step_bars
        test_start = test_end - test_bars
        train_end = test_start
        train_start = max(0, train_end - train_bars)

        if train_start < 252 or test_end > total_bars:
            break

        train_df = df.iloc[train_start:train_end]
        test_df = df.iloc[test_start:test_end]

        if len(train_df) < 300 or len(test_df) < 100:
            continue

        best_train_sharpe = -999
        best_params = None

        keys = list(param_grid.keys())
        values = list(param_grid.values())

        for combo in product(*values):
            params = dict(zip(keys, combo))
            result = run_52w_target_backtest(train_df, **params)

            if result.total_trades < 5:
                continue

            score = result.sharpe_ratio + 0.1 * min(result.win_rate, 70) / 70
            if score > best_train_sharpe:
                best_train_sharpe = score
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
            'train_sharpe': round(best_train_sharpe, 4),
            'test_sharpe': round(test_result.sharpe_ratio, 4),
            'test_win_rate': round(test_result.win_rate, 2),
            'test_pf': round(test_result.profit_factor, 2),
            'test_return': round(test_result.total_return_pct, 2),
            'test_trades': test_result.total_trades,
            'test_max_dd': round(test_result.max_drawdown_pct, 2),
        })

    if not fold_results:
        return {'avg_oos_sharpe': 0, 'avg_oos_win_rate': 0, 'folds': []}

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


def monte_carlo_significance(df: pd.DataFrame, params: Dict, n_simulations: int = 100) -> float:
    result_real = run_52w_target_backtest(df, **params)
    real_sharpe = result_real.sharpe_ratio

    shuffled_sharpes = []
    close_values = df['close'].values.copy()

    for _ in range(n_simulations):
        np.random.shuffle(close_values)
        df_shuffled = df.copy()
        df_shuffled['close'] = close_values
        df_shuffled['high'] = np.maximum(df_shuffled['high'], close_values)
        df_shuffled['low'] = np.minimum(df_shuffled['low'], close_values)
        result_shuffled = run_52w_target_backtest(df_shuffled, **params)
        shuffled_sharpes.append(result_shuffled.sharpe_ratio)

    shuffled_sharpes = np.array(shuffled_sharpes)
    p_value = float(np.mean(shuffled_sharpes >= real_sharpe)) if real_sharpe > 0 else 1.0

    return p_value


def run_full_optimization(
    stock_data: Dict[str, pd.DataFrame],
    param_grid: Optional[Dict] = None,
    train_months: int = 12,
    test_months: int = 6,
    n_folds: int = 3,
) -> Dict:
    stock_results = {}

    for sym, df in stock_data.items():
        logger.info(f"\nOptimizing {sym}...")
        result = walk_forward_optimize(df, train_months, test_months, n_folds, param_grid)
        result['symbol'] = sym
        stock_results[sym] = result
        logger.info(f"  OOS Sharpe: {result['avg_oos_sharpe']}, WR: {result['avg_oos_win_rate']}%, Trades: {result['avg_oos_trades']}")

        if result['folds']:
            for fold in result['folds']:
                logger.info(f"    Fold {fold['fold']}: train={fold['train_start']} to {fold['train_end']}, "
                           f"test={fold['test_start']} to {fold['test_end']}, "
                           f"sharpe={fold['test_sharpe']}, WR={fold['test_win_rate']}%, "
                           f"trades={fold['test_trades']}")

    all_sharpes = [r['avg_oos_sharpe'] for r in stock_results.values() if r['avg_oos_sharpe'] != 0]
    all_wrs = [r['avg_oos_win_rate'] for r in stock_results.values() if r['avg_oos_win_rate'] != 0]

    avg_sharpe = float(np.mean(all_sharpes)) if all_sharpes else 0
    avg_wr = float(np.mean(all_wrs)) if all_wrs else 0
    median_sharpe = float(np.median(all_sharpes)) if all_sharpes else 0

    profitable_stocks = sum(1 for s in all_sharpes if s > 0)
    consistency = profitable_stocks / len(all_sharpes) * 100 if all_sharpes else 0

    if all_sharpes:
        stability_score = 1.0 / (1.0 + float(np.std(all_sharpes)))
    else:
        stability_score = 0

    composite = 0.4 * avg_sharpe + 0.3 * (avg_wr / 100) + 0.2 * stability_score + 0.1 * (consistency / 100)

    all_param_stabilities = []
    for r in stock_results.values():
        if 'param_stability' in r:
            all_param_stabilities.append(r['param_stability'])

    return {
        'avg_oos_sharpe': round(avg_sharpe, 4),
        'median_oos_sharpe': round(median_sharpe, 4),
        'avg_oos_win_rate': round(avg_wr, 2),
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
        'entry_threshold_pct': [2.0, 3.0, 4.0, 5.0],
        'stop_loss_pct': [1.5, 2.0, 3.0],
        'trailing_stop_pct': [0.5, 1.0, 1.5],
        'max_holding_days': [10, 15, 20],
        'cooldown_days': [5, 7, 10],
    }

    logger.info("Fetching data for 10 stocks...")
    stock_data = fetch_all_stocks(list(INSTRUMENTS.keys()), days_back=1200)

    if len(stock_data) < 5:
        logger.error(f"Only {len(stock_data)} stocks fetched, need at least 5")
        print(f"METRIC sharpe_ratio=0")
        print(f"METRIC oos_win_rate=0")
        print(f"METRIC oos_profit_factor=0")
        print(f"METRIC oos_total_return=0")
        print(f"METRIC param_stability=0")
        print(f"METRIC trades_per_year=0")
        return

    logger.info(f"\nRunning walk-forward optimization across {len(stock_data)} stocks...")
    results = run_full_optimization(stock_data, param_grid, train_months=12, test_months=6, n_folds=3)

    elapsed = time.time() - t0
    logger.info(f"\nCompleted in {elapsed:.1f}s")

    logger.info(f"\n=== RESULTS ===")
    logger.info(f"Avg OOS Sharpe: {results['avg_oos_sharpe']}")
    logger.info(f"Median OOS Sharpe: {results['median_oos_sharpe']}")
    logger.info(f"Avg OOS Win Rate: {results['avg_oos_win_rate']}%")
    logger.info(f"Consistency: {results['consistency_pct']}% ({results['profitable_stocks']}/{results['total_stocks']})")
    logger.info(f"Stability Score: {results['stability_score']}")
    logger.info(f"Composite Score: {results['composite_score']}")

    avg_pf = 0
    avg_trades = 0
    for sym, sr in results['stock_results'].items():
        if sr['folds']:
            avg_pf += np.mean([f['test_pf'] for f in sr['folds']])
            avg_trades += sr['avg_oos_trades']
    avg_pf /= len(results['stock_results']) if results['stock_results'] else 1
    avg_trades /= len(results['stock_results']) if results['stock_results'] else 1

    avg_stability = 0
    stab_count = 0
    for sym, sr in results['stock_results'].items():
        if 'param_stability' in sr and sr['param_stability']:
            vals = list(sr['param_stability'].values())
            avg_stability += np.mean(vals)
            stab_count += 1
    avg_stability /= stab_count if stab_count else 1

    print(f"METRIC sharpe_ratio={results['avg_oos_sharpe']}")
    print(f"METRIC oos_win_rate={results['avg_oos_win_rate']}")
    print(f"METRIC oos_profit_factor={round(avg_pf, 2)}")
    print(f"METRIC oos_total_return={results.get('avg_oos_return', 0)}")
    print(f"METRIC param_stability={round(avg_stability, 4)}")
    print(f"METRIC trades_per_year={round(avg_trades, 1)}")


if __name__ == '__main__':
    main()
