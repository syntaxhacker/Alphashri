#!/usr/bin/env python3
"""
Trade Visualization Script

Visualizes CSV candlestick data with optional trade markers from log files.
Creates separate HTML files for each symbol with interactive charts.
"""

import pandas as pd
import json
import sys
import os
from datetime import datetime, timedelta
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import argparse

# Add paths for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config_and_utils.free_indian_apis import UpstoxAPI
from config import UPSTOX_CONFIG

class TradeVisualizer:
    """Visualizes candlestick data with trade markers"""
    
    def __init__(self):
        self.template_path = Path("vis_candles/simple_template.html")
        self.output_dir = Path("vis_candles/output")
        self.output_dir.mkdir(exist_ok=True)
        
        # Initialize Upstox API for data fetching
        self.api = UpstoxAPI(
            api_key=UPSTOX_CONFIG['api_key'], 
            api_secret=UPSTOX_CONFIG['api_secret']
        )
    
    def parse_log_file(self, log_file_path: str) -> Tuple[str, List[Dict]]:
        """
        Parse log file to extract trade data and date
        
        Returns:
            tuple: (date_string, list_of_trades)
        """
        trades = []
        log_date = None
        
        if not os.path.exists(log_file_path):
            print(f"❌ Log file not found: {log_file_path}")
            return None, []
        
        print(f"📖 Parsing log file: {log_file_path}")
        
        with open(log_file_path, 'r') as f:
            for line in f:
                line = line.strip()
                
                # Extract date from filename or header
                if "Started:" in line:
                    date_match = re.search(r'(\d{4}-\d{2}-\d{2})', line)
                    if date_match:
                        log_date = date_match.group(1)
                
                # Parse trade lines
                if "|" in line and ("ENTRY" in line or "EXIT" in line):
                    parts = [p.strip() for p in line.split("|")]
                    if len(parts) >= 4:
                        try:
                            timestamp = parts[0]
                            action = parts[1]
                            symbol = parts[2].replace("NSE:", "")
                            price_str = parts[3].replace("₹", "").replace(",", "")
                            price = float(price_str)
                            
                            # Extract additional info if available
                            quantity = None
                            pnl = None
                            
                            if len(parts) > 4:
                                qty_match = re.search(r'(\d+)', parts[4])
                                if qty_match:
                                    quantity = int(qty_match.group(1))
                            
                            if len(parts) > 7 and "P&L:" in parts[7]:
                                pnl_match = re.search(r'P&L: ([+-]?\d*\.?\d*)%', parts[7])
                                if pnl_match:
                                    pnl = float(pnl_match.group(1))
                            
                            trades.append({
                                'timestamp': timestamp,
                                'action': action,
                                'symbol': symbol,
                                'price': price,
                                'quantity': quantity,
                                'pnl': pnl
                            })
                            
                        except (ValueError, IndexError) as e:
                            print(f"⚠️ Skipping malformed line: {line}")
                            continue
        
        # Extract date from filename if not found in content
        if not log_date:
            date_match = re.search(r'(\d{2}[a-z]{3})', log_file_path.lower())
            if date_match:
                # Convert format like "25jul" to "2025-07-25"
                day = date_match.group(1)[:2]
                month_abbr = date_match.group(1)[2:]
                month_map = {
                    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
                    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
                    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
                }
                if month_abbr in month_map:
                    current_year = datetime.now().year
                    log_date = f"{current_year}-{month_map[month_abbr]}-{day}"
        
        print(f"✅ Parsed {len(trades)} trades for date: {log_date}")
        return log_date, trades
    
    def load_csv_data(self, csv_file_path: str) -> Optional[pd.DataFrame]:
        """Load candlestick data from CSV file"""
        if not os.path.exists(csv_file_path):
            print(f"❌ CSV file not found: {csv_file_path}")
            return None
        
        try:
            df = pd.read_csv(csv_file_path, index_col=0, parse_dates=True)
            print(f"✅ Loaded {len(df)} candles from CSV")
            return df
        except Exception as e:
            print(f"❌ Error loading CSV: {e}")
            return None
    
    def fetch_data_for_date(self, symbol: str, date: str) -> Optional[pd.DataFrame]:
        """Fetch 1-minute data for a specific date using Upstox API"""
        print(f"📊 Fetching 1-minute data for {symbol} on {date}")
        
        # Authenticate if needed
        if not self.api.access_token and not self.api.authenticate():
            print("❌ Authentication failed")
            return None
        
        try:
            df = self.api.fetch_historical_data_v3(
                symbol=symbol,
                unit="minutes", 
                interval=1,
                to_date=date,
                from_date=date
            )
            
            if df is not None and not df.empty:
                print(f"✅ Fetched {len(df)} records for {symbol}")
                return df
            else:
                print(f"❌ No data available for {symbol} on {date}")
                return None
                
        except Exception as e:
            print(f"❌ Error fetching data: {e}")
            return None
    
    def prepare_chart_data(self, df: pd.DataFrame, trades: List[Dict], symbol: str) -> Dict:
        """Prepare data for ECharts visualization"""
        
        # Prepare candlestick data
        candlesticks = []
        volumes = []
        dates = []
        
        for idx, row in df.iterrows():
            # Format: [open, close, low, high] for ECharts candlestick
            candlesticks.append([row['open'], row['close'], row['low'], row['high']])
            volumes.append(row['volume'])
            dates.append(idx.strftime('%Y-%m-%d %H:%M:%S'))
        
        # Prepare trade markers
        entries = []
        exits = []
        
        symbol_trades = [t for t in trades if t['symbol'] == symbol]
        
        for trade in symbol_trades:
            # Parse timestamp and find closest candle
            try:
                trade_time = datetime.strptime(trade['timestamp'], '%Y-%m-%d %H:%M:%S')
                
                # Find closest candle time
                closest_idx = None
                min_diff = float('inf')
                
                for i, candle_time in enumerate(df.index):
                    # Handle timezone-aware datetime objects
                    if candle_time.tz is not None:
                        candle_time_naive = candle_time.tz_localize(None)
                    else:
                        candle_time_naive = candle_time
                    
                    diff = abs((trade_time - candle_time_naive).total_seconds())
                    if diff < min_diff:
                        min_diff = diff
                        closest_idx = i
                
                if closest_idx is not None and min_diff < 300:  # Within 5 minutes
                    trade_data = [dates[closest_idx], trade['price']]
                    
                    if trade['action'] == 'ENTRY':
                        entries.append(trade_data)
                    elif trade['action'] == 'EXIT':
                        exits.append(trade_data)
                        
            except (ValueError, IndexError):
                continue
        
        return {
            'dates': dates,
            'candlesticks': candlesticks,
            'volumes': volumes,
            'entries': entries,
            'exits': exits
        }
    
    def generate_trade_items_html(self, trades: List[Dict], symbol: str) -> str:
        """Generate HTML for trade list"""
        symbol_trades = [t for t in trades if t['symbol'] == symbol]
        
        if not symbol_trades:
            return '<div class="no-trades">No trades found for this symbol</div>'
        
        html_items = []
        for trade in symbol_trades:
            action_class = trade['action'].lower()
            pnl_info = ""
            if trade['pnl'] is not None:
                pnl_class = "positive" if trade['pnl'] > 0 else "negative" if trade['pnl'] < 0 else "neutral"
                pnl_info = f'<span class="{pnl_class}">P&L: {trade["pnl"]:+.2f}%</span>'
            
            qty_info = f"Qty: {trade['quantity']}" if trade['quantity'] else ""
            
            html_items.append(f'''
                <div class="trade-item {action_class}">
                    <div class="trade-action {action_class}">{trade['action']}</div>
                    <div class="trade-details">{symbol} | {qty_info}</div>
                    <div class="trade-price">₹{trade['price']:.2f}</div>
                    <div class="trade-time">{trade['timestamp']} {pnl_info}</div>
                </div>
            ''')
        
        return '\n'.join(html_items)
    
    def create_visualization(self, csv_file: str = None, log_file: str = None, symbol: str = None):
        """Create visualization from CSV data and optional log file"""
        
        trades = []
        log_date = None
        
        # Parse log file if provided
        if log_file:
            log_date, trades = self.parse_log_file(log_file)
            if not log_date:
                print("❌ Could not extract date from log file")
                return
        
        # Load data
        df = None
        if csv_file:
            df = self.load_csv_data(csv_file)
            # Extract symbol from CSV filename if not provided
            if not symbol and csv_file:
                symbol_match = re.search(r'([A-Z]+)', os.path.basename(csv_file))
                if symbol_match:
                    symbol = symbol_match.group(1)
        
        # If no CSV but have log file with date, fetch data for all symbols
        if (df is None or df.empty) and log_date and trades:
            symbols_in_trades = list(set([t['symbol'] for t in trades]))
            print(f"📊 Found symbols in trades: {symbols_in_trades}")
            
            for sym in symbols_in_trades:
                print(f"\n🔄 Processing {sym}...")
                sym_df = self.fetch_data_for_date(sym, log_date)
                if sym_df is not None:
                    self._create_single_chart(sym_df, trades, sym, log_date)
            return
        
        # Create single chart
        if df is not None and not df.empty and symbol:
            date_range = f"{df.index[0].date()} to {df.index[-1].date()}"
            self._create_single_chart(df, trades, symbol, date_range)
        else:
            print("❌ No valid data to visualize")
    
    def _create_single_chart(self, df: pd.DataFrame, trades: List[Dict], symbol: str, date_info: str):
        """Create a single chart for a symbol"""
        
        # Load template
        if not self.template_path.exists():
            print(f"❌ Template not found: {self.template_path}")
            return
        
        with open(self.template_path, 'r') as f:
            template = f.read()
        
        # Prepare chart data
        chart_data = self.prepare_chart_data(df, trades, symbol)
        
        # Calculate statistics
        min_price = df['low'].min()
        max_price = df['high'].max()
        total_volume = df['volume'].sum()
        total_candles = len(df)
        symbol_trades = [t for t in trades if t['symbol'] == symbol]
        total_trades = len(symbol_trades)
        
        # Generate trade items HTML
        trade_items_html = self.generate_trade_items_html(trades, symbol)
        
        # Fill template using simple replacement
        html_content = template.replace('SYMBOL_PLACEHOLDER', symbol)
        html_content = html_content.replace('DATE_RANGE_PLACEHOLDER', date_info)
        html_content = html_content.replace('MIN_PRICE_PLACEHOLDER', f"{min_price:.2f}")
        html_content = html_content.replace('MAX_PRICE_PLACEHOLDER', f"{max_price:.2f}")
        html_content = html_content.replace('TOTAL_VOLUME_PLACEHOLDER', f"{int(total_volume):,}")
        html_content = html_content.replace('TOTAL_CANDLES_PLACEHOLDER', str(total_candles))
        html_content = html_content.replace('TOTAL_TRADES_PLACEHOLDER', str(total_trades))
        html_content = html_content.replace('CHART_DATA_PLACEHOLDER', json.dumps(chart_data, indent=2))
        html_content = html_content.replace('TRADE_ITEMS_PLACEHOLDER', trade_items_html)
        
        # Save HTML file
        output_file = self.output_dir / f"{symbol}_{date_info.replace(' ', '_').replace(':', '-')}.html"
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print(f"✅ Created visualization: {output_file}")
        
        # Save CSV if fetched from API
        if not hasattr(self, '_csv_provided'):
            csv_file = self.output_dir / f"{symbol}_{date_info}_1min.csv"
            df.to_csv(csv_file)
            print(f"💾 Saved CSV: {csv_file}")

def main():
    parser = argparse.ArgumentParser(description="Visualize trading data with candlestick charts")
    parser.add_argument("--csv", help="Path to CSV file with OHLCV data")
    parser.add_argument("--log", help="Path to log file with trade data")
    parser.add_argument("--symbol", help="Symbol name (if not inferrable from files)")
    
    args = parser.parse_args()
    
    if not args.csv and not args.log:
        print("❌ Please provide either --csv or --log file")
        print("\nExamples:")
        print("  python visualize_trades.py --csv TATAMOTORS_1min_2025-07-25.csv")
        print("  python visualize_trades.py --log logs/tv_screener_prebreakout_25jul.log")
        print("  python visualize_trades.py --csv data.csv --log trades.log --symbol RELIANCE")
        return
    
    visualizer = TradeVisualizer()
    visualizer.create_visualization(
        csv_file=args.csv,
        log_file=args.log,
        symbol=args.symbol
    )

if __name__ == "__main__":
    main()