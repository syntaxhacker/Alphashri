import os
import argparse
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv

import pandas as pd
from binance.client import Client

from backtester.backtest_engine import run_backtest, run_backtest_benchmark
from strategies.strategy_factory import StrategyFactory
from strategies.scalping import ScalpingStrategy
from trading.live_trader import BinancePaperTrader

def parse_args():
    parser = argparse.ArgumentParser(description='Binance Paper Trading Bot')
    parser.add_argument('--symbol', type=str, default='BTCUSDT', help='Trading symbol (default: BTCUSDT)')
    parser.add_argument('--balance', type=float, default=1000.0, help='Initial balance (default: 1000.0)')
    parser.add_argument('--strategy', type=str, required=True, choices=['scalping', 'mean_reversion'], help='Trading strategy')
    parser.add_argument('--live', action='store_true', help='Run in live trading mode')
    parser.add_argument('--leverage', type=int, default=1, help='Trading leverage (1-125x, default: 1)')
    parser.add_argument('--interval', type=str, default='1m', 
                       choices=['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'],
                       help='Trading interval (default: 1m)')
    return parser.parse_args()

def main():
    args = parse_args()
    
    # Load API credentials
    load_dotenv()
    api_key = os.getenv('BINANCE_API_KEY')
    api_secret = os.getenv('BINANCE_API_SECRET')
    
    if not api_key or not api_secret:
        print("Error: API credentials not found in .env file")
        return
        
    # Initialize strategy
    if args.strategy == 'scalping':
        strategy = ScalpingStrategy()
    elif args.strategy == 'mean_reversion':
        from strategies.mean_reversion import MeanReversionStrategy
        strategy = MeanReversionStrategy()
    else:
        print(f"Error: Unknown strategy {args.strategy}")
        return
        
    # Initialize and run trader with leverage
    trader = BinancePaperTrader(
        api_key=api_key,
        api_secret=api_secret,
        use_testnet=True,
        leverage=args.leverage
    )
    
    if args.live:
        # Run live trading
        trader.run(args.symbol, strategy, args.balance, interval=args.interval)
    else:
        # Run backtest
        trader.backtest(args.symbol, strategy, args.balance, interval=args.interval)

if __name__ == '__main__':
    main() 