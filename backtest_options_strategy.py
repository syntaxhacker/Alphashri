#!/usr/bin/env python3
"""
Backtester for a simple options strategy using the Upstox API.
- Fetches historical data for an underlying stock and an options contract.
- Implements a basic trend-following strategy: buy a call option when the
  underlying stock is in an uptrend.
- Simulates trades and provides a performance summary.
"""

import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import os
import logging
import re
import argparse
from free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

# ANSI Color codes for terminal
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    RESET = '\033[0m'

# --- Backtest Logger (File) ---
backtest_formatter = logging.Formatter('%(asctime)s - %(message)s')
backtest_handler = logging.FileHandler('upstox_options_backtest.log', mode='w')
backtest_handler.setFormatter(backtest_formatter)
backtest_logger = logging.getLogger('upstox_options_backtest_logger')
backtest_logger.addHandler(backtest_handler)
backtest_logger.setLevel(logging.INFO)

class OptionsBacktester:
    """Backtester for a simple options trend-following strategy."""
    
    def __init__(self, underlying_data, option_data, symbol, option_symbol):
        self.underlying_data = underlying_data
        self.option_data = option_data
        self.underlying_symbol = symbol
        self.option_symbol = option_symbol
        
        self.trend_ema_period = 20
        
        self.in_position = False
        self.position_entry_price = 0.0
        
        self.trades = []
        self.total_pnl_pct = 0.0

    def log_trade(self, message):
        """Log trade to file and print to console."""
        print(message)
        backtest_logger.info(message)

    def run_backtest(self):
        print(f"{Colors.YELLOW}--- Starting Options Backtest for {self.option_symbol} based on {self.underlying_symbol} ---{Colors.RESET}")
        
        # Combine dataframes on their index (datetime)
        combined_data = self.underlying_data.join(self.option_data, lsuffix='_underlying', rsuffix='_option')
        combined_data.dropna(inplace=True)

        for index, row in combined_data.iterrows():
            underlying_price = row['close_underlying']
            option_price = row['close_option']
            
            # Calculate trend of the underlying stock
            ema = combined_data['close_underlying'].ewm(span=self.trend_ema_period, adjust=False).mean()
            
            # Entry condition: Buy call if underlying is above EMA
            if not self.in_position and underlying_price > ema[index]:
                self.in_position = True
                self.position_entry_price = option_price
                self.log_trade(f"OPEN_TRADE: BUY Call at {option_price:.2f} (Underlying: {underlying_price:.2f})")

            # Exit condition: Sell call if underlying is below EMA
            elif self.in_position and underlying_price < ema[index]:
                pnl = (option_price - self.position_entry_price) / self.position_entry_price * 100
                self.log_trade(f"CLOSE_TRADE: SELL Call at {option_price:.2f}, PnL: {pnl:.2f}%")
                self.trades.append({'pnl': pnl})
                self.total_pnl_pct += pnl
                self.in_position = False
        
        self.print_summary()

    def print_summary(self):
        print(f"\n{Colors.BLUE}--- Options Backtest Summary for {self.option_symbol} ---{Colors.RESET}")
        total_trades = len(self.trades)
        if total_trades == 0:
            print(f"{Colors.YELLOW}No trades were executed.{Colors.RESET}")
            return
            
        winning_trades = sum(1 for t in self.trades if t['pnl'] > 0)
        win_rate = (winning_trades / total_trades) * 100
        avg_pnl = self.total_pnl_pct / total_trades
        
        print(f"Total Trades: {total_trades}")
        print(f"Winning Trades: {winning_trades}")
        print(f"Losing Trades: {total_trades - winning_trades}")
        print(f"Win Rate: {win_rate:.2f}%")
        print(f"Total P&L: {self.total_pnl_pct:.2f}%")
        print(f"Average P&L per Trade: {avg_pnl:.2f}%")
        print(f"{Colors.BLUE}------------------------------------{Colors.RESET}")

def run_options_backtest(symbol: str, expiry: str, strike: float, option_type: str):
    os.system('clear' if os.name == 'posix' else 'cls')
    print(f"{Colors.BOLD}{Colors.BLUE}📊 UPSTOX OPTIONS STRATEGY BACKTESTER{Colors.RESET}")
    
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    if not api.access_token and not api.authenticate():
        print(f"{Colors.RED}Authentication failed. Exiting.{Colors.RESET}")
        return

    # Fetch data for the underlying stock
    print(f"{Colors.YELLOW}Fetching data for underlying: {symbol}...{Colors.RESET}")
    underlying_data = api.fetch_historical_data(symbol, "day", (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d"), datetime.now().strftime("%Y-%m-%d"), instrument_type='INDEX' if symbol == 'NIFTY' else 'EQ', exchange='NSE_INDEX' if symbol == 'NIFTY' else 'NSE_EQ')
    if underlying_data is None: return

    # Fetch data for the options contract
    print(f"{Colors.YELLOW}Fetching data for option: {symbol} {expiry} {strike} {option_type}...{Colors.RESET}")
    option_data = api.fetch_historical_data(symbol, "day", (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d"), datetime.now().strftime("%Y-%m-%d"), instrument_type=option_type, expiry_date=expiry, strike_price=strike, option_type=option_type, exchange='NSE_FO')
    if option_data is None: return

    backtester = OptionsBacktester(underlying_data, option_data, symbol, f"{symbol} {expiry} {strike} {option_type}")
    backtester.run_backtest()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upstox Options Strategy Backtester")
    parser.add_argument("--symbol", type=str, default="NIFTY", help="Underlying stock or index symbol.")
    parser.add_argument("--expiry", type=str, required=True, help="Option expiry date in YYYY-MM-DD format.")
    parser.add_argument("--strike", type=float, required=True, help="Option strike price.")
    parser.add_argument("--type", type=str, choices=['CE', 'PE'], default='CE', help="Option type: CE or PE.")
    
    args = parser.parse_args()
    
    run_options_backtest(symbol=args.symbol, expiry=args.expiry, strike=args.strike, option_type=args.type)
