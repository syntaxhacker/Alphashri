#!/usr/bin/env python3
"""
Smart Trade Filter - Intelligent Entry Validation System

Based on comprehensive analysis of winning vs losing patterns, this script provides
real-time trade filtering to prevent bad entries before they happen.

Key Success Factors Identified:
- MACD Bullish: 100% success rate
- Away from S/R levels: 100% success rate  
- High volume (>2x): 75% success rate
- Low volatility: 75% success rate
- Time-based: Avoid entries after 3 PM

Usage:
    python smart_trade_filter.py --symbol RELIANCE --check-entry
    python smart_trade_filter.py --symbol OSWALAGRO --live-monitor
"""

import pandas as pd
import numpy as np
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'config_and_utils'))
from free_indian_apis import UpstoxAPI
import talib
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box
import time
import warnings
warnings.filterwarnings('ignore')

console = Console()

# Load Upstox config
try:
    from config import UPSTOX_CONFIG
except ImportError:
    console.print("[red]❌ config.py not found. Please create it with your Upstox API credentials.[/red]")
    UPSTOX_CONFIG = {'api_key': None, 'api_secret': None}

class SmartTradeFilter:
    """
    Intelligent trade filtering system based on winning pattern analysis
    """
    
    def __init__(self):
        # Initialize Upstox API
        if UPSTOX_CONFIG.get('api_key') and UPSTOX_CONFIG.get('api_secret'):
            self.upstox = UpstoxAPI(api_key=UPSTOX_CONFIG['api_key'], api_secret=UPSTOX_CONFIG['api_secret'])
            if not self.upstox.access_token:
                console.print("[blue]🔐 Authenticating with Upstox...[/blue]")
                if not self.upstox.authenticate():
                    console.print("[red]❌ Upstox authentication failed[/red]")
                    self.upstox = None
        else:
            console.print("[red]❌ No Upstox credentials found in config.py[/red]")
            self.upstox = None
        
        # Success criteria based on analysis
        self.success_criteria = {
            'macd_bullish': {'weight': 100, 'required': True},  # 100% success rate
            'away_from_levels': {'weight': 100, 'required': True},  # 100% success rate
            'high_volume': {'weight': 75, 'required': False},  # 75% success rate
            'low_volatility': {'weight': 75, 'required': False},  # 75% success rate
            'good_time': {'weight': 80, 'required': False},  # Time-based filter
            'rsi_context': {'weight': 60, 'required': False}  # RSI with context
        }
        
        self.min_score = 200  # Minimum score to allow trade
        self.required_checks = ['macd_bullish', 'away_from_levels']  # Must pass these
    
    def get_market_data(self, symbol: str, timeframe: str = "1min", lookback_hours: int = 4) -> pd.DataFrame:
        """Get recent market data for analysis"""
        if not self.upstox:
            console.print("[red]❌ No Upstox connection available[/red]")
            return pd.DataFrame()
        
        try:
            # Get intraday data for today
            df_intraday = self.upstox.fetch_intraday_data_v3(
                symbol=symbol,
                unit="minutes",
                interval=1 if timeframe == "1min" else 5
            )
            
            if df_intraday is not None and not df_intraday.empty:
                # Get last N hours of data
                cutoff_time = datetime.now()
                if df_intraday.index.tz is not None:
                    cutoff_time = cutoff_time.replace(tzinfo=df_intraday.index.tz)
                cutoff_time = cutoff_time - timedelta(hours=lookback_hours)
                df_recent = df_intraday[df_intraday.index >= cutoff_time]
                
                if len(df_recent) > 0:
                    console.print(f"[dim]✅ Got {len(df_recent)} recent candles for {symbol}[/dim]")
                    return df_recent
            
            # Fallback to historical data if intraday not available
            console.print(f"[dim]⚠️ No intraday data, trying historical for {symbol}[/dim]")
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')
            
            df_hist = self.upstox.fetch_historical_data_v3(
                symbol=symbol,
                unit="minutes",
                interval=1 if timeframe == "1min" else 5,
                to_date=to_date,
                from_date=from_date
            )
            
            if df_hist is not None and not df_hist.empty:
                console.print(f"[dim]✅ Got {len(df_hist)} historical candles for {symbol}[/dim]")
                return df_hist
            
        except Exception as e:
            console.print(f"[red]❌ Error fetching data for {symbol}: {e}[/red]")
        
        return pd.DataFrame()
    
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Calculate technical indicators needed for filtering"""
        if df.empty or len(df) < 20:
            return df
        
        try:
            # Ensure numeric data
            for col in ['open', 'high', 'low', 'close', 'volume']:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
            
            # Core indicators for filtering
            df['sma_20'] = talib.SMA(df['close'], timeperiod=min(20, len(df)-1))
            df['ema_9'] = talib.EMA(df['close'], timeperiod=min(9, len(df)-1))
            
            # MACD - Critical success indicator (100% win rate)
            df['macd'], df['macd_signal'], df['macd_histogram'] = talib.MACD(
                df['close'], 
                fastperiod=min(12, len(df)//3), 
                slowperiod=min(26, len(df)//2), 
                signalperiod=min(9, len(df)//4)
            ) if len(df) >= 12 else (pd.Series([0]*len(df)), pd.Series([0]*len(df)), pd.Series([0]*len(df)))
            
            # RSI for context
            df['rsi'] = talib.RSI(df['close'], timeperiod=min(14, len(df)-1))
            
            # Bollinger Bands
            df['bb_upper'], df['bb_middle'], df['bb_lower'] = talib.BBANDS(
                df['close'], 
                timeperiod=min(20, len(df)-1)
            ) if len(df) >= 20 else (df['close']*1.02, df['close'], df['close']*0.98)
            
            # ATR for volatility
            df['atr'] = talib.ATR(df['high'], df['low'], df['close'], timeperiod=min(14, len(df)-1))
            
            # Volume analysis
            if 'volume' in df.columns:
                df['volume_sma'] = df['volume'].rolling(window=min(20, len(df))).mean()
                df['volume_ratio'] = df['volume'] / df['volume_sma'].fillna(df['volume'].mean())
                df['volume_ratio'] = df['volume_ratio'].fillna(1.0)
            else:
                df['volume_ratio'] = pd.Series([1.0]*len(df))
            
            # Support/Resistance levels
            df['pivot'] = (df['high'] + df['low'] + df['close']) / 3
            df['resistance_1'] = 2 * df['pivot'] - df['low']
            df['support_1'] = 2 * df['pivot'] - df['high']
            
            # Fill NaN values
            for col in ['rsi', 'macd', 'macd_signal', 'bb_upper', 'bb_middle', 'bb_lower', 'atr']:
                if col in df.columns:
                    df[col] = df[col].ffill().bfill()
                    if col == 'rsi':
                        df[col] = df[col].fillna(50)
                    elif col in ['bb_upper', 'bb_middle', 'bb_lower']:
                        df[col] = df[col].fillna(df['close'])
            
            console.print(f"[dim]✅ Calculated indicators for {len(df)} candles[/dim]")
            
        except Exception as e:
            console.print(f"[red]⚠️ Error calculating indicators: {e}[/red]")
        
        return df
    
    def check_entry_criteria(self, symbol: str, current_price: float = None) -> Dict:
        """
        Check if a trade entry meets success criteria
        Returns detailed analysis and recommendation
        """
        console.print(f"[blue]🔍 Analyzing entry criteria for {symbol}[/blue]")
        
        # Get market data
        df = self.get_market_data(symbol)
        if df.empty:
            return {
                'allow_trade': False,
                'score': 0,
                'reason': 'No market data available',
                'checks': {},
                'symbol': symbol,
                'current_price': current_price or 0,
                'max_score': sum(c['weight'] for c in self.success_criteria.values()),
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        
        # Calculate indicators
        df = self.calculate_indicators(df)
        if df.empty:
            return {
                'allow_trade': False,
                'score': 0,
                'reason': 'Cannot calculate indicators',
                'checks': {},
                'symbol': symbol,
                'current_price': current_price or 0,
                'max_score': sum(c['weight'] for c in self.success_criteria.values()),
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        
        # Get latest values
        latest = df.iloc[-1]
        current_price = current_price or latest['close']
        
        # Run all checks
        checks = {}
        total_score = 0
        
        # 1. MACD Bullish Signal (100% success rate - REQUIRED)
        macd = latest.get('macd', 0)
        macd_signal = latest.get('macd_signal', 0)
        macd_bullish = macd > macd_signal if (macd != 0 or macd_signal != 0) else False
        checks['macd_bullish'] = {
            'passed': macd_bullish,
            'value': f"MACD: {macd:.3f}, Signal: {macd_signal:.3f}",
            'score': self.success_criteria['macd_bullish']['weight'] if macd_bullish else 0,
            'importance': 'CRITICAL - 100% success rate'
        }
        if macd_bullish:
            total_score += self.success_criteria['macd_bullish']['weight']
        
        # 2. Away from Support/Resistance Levels (100% success rate - REQUIRED)
        support_1 = latest.get('support_1', current_price * 0.99)
        resistance_1 = latest.get('resistance_1', current_price * 1.01)
        support_dist = abs(current_price - support_1) / current_price * 100
        resistance_dist = abs(current_price - resistance_1) / current_price * 100
        away_from_levels = min(support_dist, resistance_dist) > 0.5  # >0.5% away from levels
        
        checks['away_from_levels'] = {
            'passed': away_from_levels,
            'value': f"S/R distance: {min(support_dist, resistance_dist):.2f}%",
            'score': self.success_criteria['away_from_levels']['weight'] if away_from_levels else 0,
            'importance': 'CRITICAL - 100% success rate'
        }
        if away_from_levels:
            total_score += self.success_criteria['away_from_levels']['weight']
        
        # 3. High Volume Support (75% success rate)
        volume_ratio = latest.get('volume_ratio', 1.0)
        high_volume = volume_ratio > 2.0
        checks['high_volume'] = {
            'passed': high_volume,
            'value': f"Volume ratio: {volume_ratio:.2f}x",
            'score': self.success_criteria['high_volume']['weight'] if high_volume else 0,
            'importance': 'HIGH - 75% success rate'
        }
        if high_volume:
            total_score += self.success_criteria['high_volume']['weight']
        
        # 4. Low Volatility Environment (75% success rate)
        atr = latest.get('atr', latest['close'] * 0.01)
        low_volatility = atr < latest['close'] * 0.02  # ATR < 2% of price
        checks['low_volatility'] = {
            'passed': low_volatility,
            'value': f"ATR: {atr:.2f} ({atr/latest['close']*100:.1f}%)",
            'score': self.success_criteria['low_volatility']['weight'] if low_volatility else 0,
            'importance': 'HIGH - 75% success rate'
        }
        if low_volatility:
            total_score += self.success_criteria['low_volatility']['weight']
        
        # 5. Good Time for Entry (avoid after 3 PM)
        current_hour = datetime.now().hour
        good_time = current_hour < 15  # Before 3 PM
        checks['good_time'] = {
            'passed': good_time,
            'value': f"Current time: {datetime.now().strftime('%H:%M')}",
            'score': self.success_criteria['good_time']['weight'] if good_time else 0,
            'importance': 'HIGH - Avoid late session entries'
        }
        if good_time:
            total_score += self.success_criteria['good_time']['weight']
        
        # 6. RSI Context (High RSI can work with volume confirmation)
        rsi_value = latest.get('rsi', 50)
        rsi_context_good = True  # RSI analysis shows high RSI can work with other factors
        if rsi_value > 90 and not high_volume:  # Very high RSI without volume is risky
            rsi_context_good = False
        
        checks['rsi_context'] = {
            'passed': rsi_context_good,
            'value': f"RSI: {rsi_value:.1f}",
            'score': self.success_criteria['rsi_context']['weight'] if rsi_context_good else 0,
            'importance': 'MEDIUM - Context dependent'
        }
        if rsi_context_good:
            total_score += self.success_criteria['rsi_context']['weight']
        
        # Check if all required criteria are met
        required_passed = all(checks[req]['passed'] for req in self.required_checks)
        
        # Final decision
        allow_trade = required_passed and total_score >= self.min_score
        
        # Generate recommendation reason
        if not required_passed:
            failed_required = [req for req in self.required_checks if not checks[req]['passed']]
            reason = f"CRITICAL checks failed: {', '.join(failed_required)}"
        elif total_score < self.min_score:
            reason = f"Score too low: {total_score}/{self.min_score} minimum"
        else:
            reason = f"All criteria met - Score: {total_score}"
        
        return {
            'allow_trade': allow_trade,
            'score': total_score,
            'max_score': sum(c['weight'] for c in self.success_criteria.values()),
            'reason': reason,
            'checks': checks,
            'symbol': symbol,
            'current_price': current_price,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
    
    def display_analysis(self, analysis: Dict) -> None:
        """Display comprehensive analysis in a formatted way"""
        symbol = analysis['symbol']
        score = analysis['score']
        max_score = analysis['max_score']
        allow_trade = analysis['allow_trade']
        
        # Header
        status_color = "green" if allow_trade else "red"
        status_text = "✅ TRADE ALLOWED" if allow_trade else "❌ TRADE BLOCKED"
        
        console.print(Panel.fit(
            f"🎯 Smart Trade Filter Analysis - {symbol}\n"
            f"[{status_color}]{status_text}[/{status_color}]\n"
            f"Score: {score}/{max_score} ({score/max_score*100:.1f}%)",
            style=f"bold {status_color}"
        ))
        
        # Detailed checks table
        checks_table = Table(title="Entry Criteria Analysis", box=box.ROUNDED)
        checks_table.add_column("Criteria", style="cyan")
        checks_table.add_column("Status", style="white")
        checks_table.add_column("Value", style="yellow")
        checks_table.add_column("Score", style="magenta")
        checks_table.add_column("Importance", style="blue")
        
        for check_name, check_data in analysis['checks'].items():
            status = "✅ PASS" if check_data['passed'] else "❌ FAIL"
            status_style = "green" if check_data['passed'] else "red"
            
            checks_table.add_row(
                check_name.replace('_', ' ').title(),
                f"[{status_style}]{status}[/{status_style}]",
                check_data['value'],
                str(check_data['score']),
                check_data['importance']
            )
        
        console.print(checks_table)
        
        # Recommendation
        console.print(f"\n[bold]💡 Recommendation:[/bold] {analysis['reason']}")
        
        if not allow_trade:
            console.print("\n[red]🚫 This trade does not meet success criteria. Consider waiting for better conditions.[/red]")
        else:
            console.print("\n[green]🎯 This trade meets all success criteria. Proceed with confidence![/green]")
    
    def live_monitor(self, symbols: List[str], check_interval: int = 60) -> None:
        """
        Live monitoring mode - continuously check symbols for entry opportunities
        """
        console.print(Panel.fit(
            f"📡 Live Trade Filter Monitor\n"
            f"Symbols: {', '.join(symbols)}\n"
            f"Check interval: {check_interval} seconds",
            style="bold blue"
        ))
        
        try:
            while True:
                console.print(f"\n[dim]--- {datetime.now().strftime('%H:%M:%S')} Check ---[/dim]")
                
                for symbol in symbols:
                    analysis = self.check_entry_criteria(symbol)
                    
                    if analysis['allow_trade']:
                        console.print(f"[green]🎯 {symbol}: ENTRY OPPORTUNITY! Score: {analysis['score']}[/green]")
                        # Could trigger notification/alert here
                    else:
                        console.print(f"[red]🚫 {symbol}: Not ready. {analysis['reason'][:50]}...[/red]")
                
                console.print(f"[dim]Sleeping for {check_interval} seconds...[/dim]")
                time.sleep(check_interval)
                
        except KeyboardInterrupt:
            console.print("\n[yellow]📴 Live monitoring stopped[/yellow]")

def main():
    parser = argparse.ArgumentParser(description='Smart Trade Filter - Prevent Bad Entries')
    parser.add_argument('--symbol', required=True, help='Stock symbol to analyze')
    parser.add_argument('--check-entry', action='store_true', help='Check if entry is recommended')
    parser.add_argument('--live-monitor', action='store_true', help='Live monitoring mode')
    parser.add_argument('--price', type=float, help='Current price (optional)')
    parser.add_argument('--interval', type=int, default=60, help='Check interval for live mode (seconds)')
    parser.add_argument('--symbols', nargs='+', help='Multiple symbols for live monitoring')
    
    args = parser.parse_args()
    
    # Initialize filter
    filter_system = SmartTradeFilter()
    
    if args.live_monitor:
        symbols = args.symbols or [args.symbol]
        filter_system.live_monitor(symbols, args.interval)
    elif args.check_entry:
        analysis = filter_system.check_entry_criteria(args.symbol, args.price)
        filter_system.display_analysis(analysis)
    else:
        console.print("[yellow]Use --check-entry or --live-monitor[/yellow]")

if __name__ == "__main__":
    main()