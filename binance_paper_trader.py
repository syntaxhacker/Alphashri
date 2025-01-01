import os
import argparse
import logging
from datetime import datetime, timedelta

import pandas as pd
from binance.client import Client

from backtester.backtest_engine import run_backtest, run_backtest_benchmark
from strategies.strategy_factory import StrategyFactory
from trading.live_trader import BinancePaperTrader

def main():
    parser = argparse.ArgumentParser(description='Binance Paper Trading Bot')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading pair symbol')
    parser.add_argument('--strategy', type=str, default='trend_following', help='Trading strategy to use')
    parser.add_argument('--days', type=int, default=30, help='Number of days of historical data to use')
    parser.add_argument('--balance', type=float, default=1000.0, help='Initial balance in USDT')
    parser.add_argument('--plot', action='store_true', help='Plot backtest results')
    parser.add_argument('--live', action='store_true', help='Run live trading')
    parser.add_argument('--benchmark', action='store_true', help='Run benchmark comparison')
    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=logging.WARNING,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )

    # Hardcoded API credentials (Binance Futures Testnet)
    api_key = "d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3"
    api_secret = "7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"

    # Create strategy instance
    strategy = StrategyFactory.create_strategy(args.strategy)

    if args.live:
        # Run live trading
        trader = BinancePaperTrader(api_key, api_secret, use_testnet=True)
        trader.run(args.symbol, strategy, args.balance)
    else:
        # Run backtest
        start_date = datetime.now() - timedelta(days=args.days)
        end_date = datetime.now()

        if args.benchmark:
            run_backtest_benchmark(
                symbol=args.symbol,
                start_date=start_date,
                end_date=end_date,
                initial_balance=args.balance,
                strategy=strategy,
                plot=args.plot
            )
        else:
            run_backtest(
                symbol=args.symbol,
                start_date=start_date,
                end_date=end_date,
                initial_balance=args.balance,
                strategy=strategy,
                plot=args.plot
            )

if __name__ == '__main__':
    main() 