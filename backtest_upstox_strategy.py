#!/usr/bin/env python3
"""
Backtester for the Upstox Support & Resistance Trading Bot
- Fetches 6 months of 15-minute data for a given stock.
- Simulates the trading strategy on the historical data.
- Logs trades and provides a performance summary.
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
backtest_handler = logging.FileHandler('upstox_backtest_trades.log', mode='w')
backtest_handler.setFormatter(backtest_formatter)
backtest_logger = logging.getLogger('upstox_backtest_logger')
backtest_logger.addHandler(backtest_handler)
backtest_logger.setLevel(logging.INFO)

class StrategyBacktester:
    """Backtester for the Support & Resistance Strategy"""
    
    def __init__(self, historical_data, symbol="MEDANTA"):
        self.historical_data = historical_data
        self.trading_symbol = symbol
        
        # Strategy Parameters (same as the bot)
        self.lookback_periods = 50
        self.min_touches = 2
        self.level_threshold = 0.5
        self.bounce_threshold = 0.25
        self.risk_reward_ratio = 2.5
        self.max_risk_pct = 1.5
        self.trend_ema_period = 20
        
        # State Tracking
        self.in_position = False
        self.position_side = None
        self.position_entry_price = 0.0
        self.actual_position_size = 0
        self.support_levels = []
        self.resistance_levels = []
        self.trend_direction = None
        self.trend_ema = 0.0
        self.current_price = 0.0
        
        # Performance Metrics
        self.trades = []
        self.total_pnl_pct = 0.0

    def log_trade(self, message):
        """Log trade to file and print to console."""
        print(message)
        backtest_logger.info(message)

    def identify_support_resistance_levels(self, current_candles):
        if len(current_candles) < self.lookback_periods: return
        highs = [c['high'] for c in current_candles]
        lows = [c['low'] for c in current_candles]
        self.resistance_levels = self._group_levels([h for i, h in enumerate(highs) if i > 1 and i < len(highs) - 2 and h > highs[i-1] and h > highs[i-2] and h > highs[i+1] and h > highs[i+2]])
        self.support_levels = self._group_levels([l for i, l in enumerate(lows) if i > 1 and i < len(lows) - 2 and l < lows[i-1] and l < lows[i-2] and l < lows[i+1] and l < lows[i+2]])
        self.resistance_levels = self._filter_by_touches(self.resistance_levels, highs)
        self.support_levels = self._filter_by_touches(self.support_levels, lows)
        self.resistance_levels.sort(reverse=True)
        self.support_levels.sort(reverse=True)

    def _group_levels(self, levels):
        if not levels: return []
        levels.sort()
        grouped, current_group = [], [levels[0]]
        for level in levels[1:]:
            if abs(level - current_group[0]) / current_group[0] * 100 < self.level_threshold:
                current_group.append(level)
            else:
                grouped.append(sum(current_group) / len(current_group))
                current_group = [level]
        grouped.append(sum(current_group) / len(current_group))
        return grouped

    def _filter_by_touches(self, levels, price_data):
        return [l for l in levels if sum(1 for p in price_data if abs(p - l) / l * 100 < self.level_threshold) >= self.min_touches]

    def calculate_trend_direction(self, current_candles):
        if len(current_candles) < self.trend_ema_period: return
        closes = [c['close'] for c in current_candles]
        self.trend_ema = pd.Series(closes).ewm(span=self.trend_ema_period, adjust=False).mean().iloc[-1]
        if self.current_price > self.trend_ema * 1.002: self.trend_direction = "BULLISH"
        elif self.current_price < self.trend_ema * 0.998: self.trend_direction = "BEARISH"
        else: self.trend_direction = "NEUTRAL"

    def find_nearest_levels(self):
        return max([l for l in self.support_levels if l < self.current_price] or [None]), min([l for l in self.resistance_levels if l > self.current_price] or [None])

    def run_backtest(self):
        print(f"{Colors.YELLOW}--- Starting Backtest for {self.trading_symbol} ---{Colors.RESET}")
        
        historical_candles = [
            {
                'timestamp': int(row.name.timestamp() * 1000),
                'open': row['open'], 'high': row['high'],
                'low': row['low'], 'close': row['close'],
                'volume': row['volume']
            } for _, row in self.historical_data.iterrows()
        ]

        for i in range(self.lookback_periods, len(historical_candles)):
            current_candle_slice = historical_candles[i-self.lookback_periods:i]
            self.current_price = historical_candles[i]['close']
            
            # Update indicators
            self.identify_support_resistance_levels(current_candle_slice)
            self.calculate_trend_direction(current_candle_slice)
            
            # Check for closing condition
            if self.in_position:
                pnl = (self.current_price - self.position_entry_price) / self.position_entry_price * 100
                if self.position_side == 'SELL': pnl *= -1
                
                if pnl >= self.max_risk_pct * self.risk_reward_ratio or pnl <= -self.max_risk_pct:
                    reason = "Profit target" if pnl > 0 else "Stop loss"
                    self.log_trade(f"CLOSE_TRADE: Side={self.position_side}, PnL={pnl:.2f}%, Reason={reason}, ExitPrice={self.current_price:.2f}")
                    self.trades.append({'side': self.position_side, 'pnl': pnl})
                    self.total_pnl_pct += pnl
                    self.in_position = False

            # Check for entry condition
            if not self.in_position:
                nearest_support, nearest_resistance = self.find_nearest_levels()
                
                # Buy signal
                if nearest_support and self.trend_direction in ["BULLISH", "NEUTRAL"] and 0 < (self.current_price - nearest_support) / nearest_support * 100 <= self.bounce_threshold:
                    self.in_position = True
                    self.position_side = 'BUY'
                    self.position_entry_price = self.current_price
                    self.log_trade(f"OPEN_TRADE: Side=BUY, Price={self.current_price:.2f}, Level={nearest_support:.2f}, Trend={self.trend_direction}")

                # Sell signal
                elif nearest_resistance and self.trend_direction in ["BEARISH", "NEUTRAL"] and 0 < (nearest_resistance - self.current_price) / self.current_price * 100 <= self.bounce_threshold:
                    self.in_position = True
                    self.position_side = 'SELL'
                    self.position_entry_price = self.current_price
                    self.log_trade(f"OPEN_TRADE: Side=SELL, Price={self.current_price:.2f}, Level={nearest_resistance:.2f}, Trend={self.trend_direction}")

        self.print_summary()

    def print_summary(self):
        print(f"\n{Colors.BLUE}--- Backtest Summary for {self.trading_symbol} ---{Colors.RESET}")
        total_trades = len(self.trades)
        if total_trades == 0:
            print(f"{Colors.YELLOW}No trades were executed.{Colors.RESET}")
            return
            
        winning_trades = sum(1 for t in self.trades if t['pnl'] > 0)
        losing_trades = total_trades - winning_trades
        win_rate = (winning_trades / total_trades) * 100 if total_trades > 0 else 0
        
        avg_pnl = self.total_pnl_pct / total_trades
        
        print(f"Total Trades: {total_trades}")
        print(f"Winning Trades: {winning_trades}")
        print(f"Losing Trades: {losing_trades}")
        print(f"Win Rate: {win_rate:.2f}%")
        print(f"Total P&L: {self.total_pnl_pct:.2f}%")
        print(f"Average P&L per Trade: {avg_pnl:.2f}%")
        print(f"{Colors.BLUE}------------------------------------{Colors.RESET}")


def fetch_and_resample_data(api: UpstoxAPI, symbol: str, timeframe: str, days_to_fetch: int):
    """Fetches and resamples data to the target timeframe."""
    
    # Determine the best base interval to fetch from Upstox
    timeframe_td = pd.to_timedelta(timeframe)
    if timeframe_td < pd.to_timedelta('60min'):
        base_interval = '1minute'
        chunk_days = 30 # 1-minute data is limited
    else:
        base_interval = '30minute'
        chunk_days = 180 # 30-minute data has a longer lookback

    print(f"{Colors.YELLOW}Fetching {days_to_fetch} days of {base_interval} data for {symbol} to resample to {timeframe}...{Colors.RESET}")

    to_date = datetime.now()
    from_date = to_date - timedelta(days=days_to_fetch)
    
    all_data = []
    current_from_date = from_date
    
    while current_from_date < to_date:
        current_to_date = min(current_from_date + timedelta(days=chunk_days), to_date)
        print(f"Fetching data from {current_from_date.strftime('%Y-%m-%d')} to {current_to_date.strftime('%Y-%m-%d')}...")
        
        df = api.fetch_historical_data(
            symbol=symbol,
            interval=base_interval,
            from_date=current_from_date.strftime("%Y-%m-%d"),
            to_date=current_to_date.strftime("%Y-%m-%d")
        )
        
        if df is not None and not df.empty:
            all_data.append(df)
        
        current_from_date += timedelta(days=chunk_days)
        time.sleep(1) # Be nice to the API

    if not all_data:
        return None

    full_df = pd.concat(all_data).sort_index()
    full_df = full_df[~full_df.index.duplicated(keep='first')]

    # Resample to the target timeframe
    ohlc_dict = {'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}
    resampled_data = full_df.resample(timeframe).apply(ohlc_dict)
    resampled_data.dropna(subset=['open'], inplace=True)
    
    return resampled_data

def run_backtest(symbol: str, timeframe: str, duration_days: int):
    """Configures and runs the backtester."""
    os.system('clear' if os.name == 'posix' else 'cls')
    print(f"{Colors.BOLD}{Colors.BLUE}📊 UPSTOX STRATEGY BACKTESTER{Colors.RESET}")
    print(f"{Colors.CYAN}Symbol: {symbol} | Timeframe: {timeframe} | Duration: {duration_days} days{Colors.RESET}")
    
    api = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
    if not api.access_token and not api.authenticate():
        print(f"{Colors.RED}Authentication failed. Exiting.{Colors.RESET}")
        return

    historical_data = fetch_and_resample_data(api, symbol, timeframe, duration_days)
    
    if historical_data is None or historical_data.empty:
        print(f"{Colors.RED}Failed to fetch or resample historical data for {symbol}. Exiting.{Colors.RESET}")
        return
        
    print(f"{Colors.GREEN}✅ Successfully prepared {len(historical_data)} data points for backtest.{Colors.RESET}")
    
    backtester = StrategyBacktester(historical_data, symbol=symbol)
    backtester.run_backtest()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upstox Support & Resistance Strategy Backtester")
    parser.add_argument("--symbol", type=str, default="LTFOODS", help="Stock symbol to backtest (e.g., TATAMOTORS, RELIANCE).")
    parser.add_argument("--timeframe", type=str, default="15min", help="Candlestick timeframe (e.g., '5min', '15min', '1H', '4H').")
    parser.add_argument("--duration", type=int, default=180, help="Duration in days to backtest.")
    
    args = parser.parse_args()
    
    run_backtest(symbol=args.symbol, timeframe=args.timeframe, duration_days=args.duration)
