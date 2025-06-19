#!/usr/bin/env python3
"""
Production-Ready Crypto Breakout Strategy
Based on comprehensive analysis and walk-forward validation
Conservative, adaptive approach with regime filtering
"""

import json
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import warnings

# Rich for beautiful console output
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel

# Import modules
from enhanced_data_fetcher import EnhancedDataFetcher

warnings.filterwarnings('ignore')
console = Console()

class ProductionCryptoBreakout:
    """Production-ready crypto breakout strategy with conservative parameters"""
    
    def __init__(self, symbols: List[str] = None, risk_level: str = 'conservative'):
        self.symbols = symbols or ['ETHUSDT']  # Start with best performing symbol
        self.fetcher = EnhancedDataFetcher()
        self.data_cache = {}
        self.risk_level = risk_level
        
        # Production parameters based on analysis
        self.production_params = {
            'conservative': {
                'lookback_periods': 20,
                'volume_multiplier': 1.8,
                'min_breakout_percent': 0.15,
                'sl_percent': 2.0,
                'tp_percent': 4.0,
                'position_size_percent': 3.0,  # Very conservative
                'min_confidence_threshold': 0.8,
                'max_daily_trades': 2,
                'max_hold_hours': 8
            },
            'moderate': {
                'lookback_periods': 18,
                'volume_multiplier': 1.5,
                'min_breakout_percent': 0.12,
                'sl_percent': 2.5,
                'tp_percent': 5.0,
                'position_size_percent': 5.0,
                'min_confidence_threshold': 0.7,
                'max_daily_trades': 3,
                'max_hold_hours': 12
            },
            'aggressive': {
                'lookback_periods': 15,
                'volume_multiplier': 1.3,
                'min_breakout_percent': 0.08,
                'sl_percent': 3.0,
                'tp_percent': 6.0,
                'position_size_percent': 8.0,
                'min_confidence_threshold': 0.6,
                'max_daily_trades': 5,
                'max_hold_hours': 16
            }
        }
        
        self.params = self.production_params[risk_level]
        
    def assess_market_regime(self, df: pd.DataFrame) -> Dict:
        """Assess current market regime for trading decisions"""
        
        lookback_bars = 30 * 24 * 4  # 30 days of 15-min bars
        recent_data = df.tail(lookback_bars) if len(df) > lookback_bars else df
        
        if len(recent_data) < 100:
            return {'favorable': False, 'confidence': 0.0, 'reason': 'Insufficient data'}
        
        # Volatility analysis
        returns = recent_data['close'].pct_change().dropna()
        volatility = returns.std() * np.sqrt(96 * 365)  # Annualized
        
        # Volume analysis
        avg_volume = recent_data['volume'].mean()
        recent_volume = recent_data['volume'].tail(200).mean()  # Last ~2 days
        volume_ratio = recent_volume / avg_volume
        
        # Trend strength
        price_change_1d = (recent_data['close'].iloc[-96] - recent_data['close'].iloc[-192]) / recent_data['close'].iloc[-192]  # 1 day
        price_change_3d = (recent_data['close'].iloc[-1] - recent_data['close'].iloc[-288]) / recent_data['close'].iloc[-288]  # 3 days
        
        # Breakout environment assessment
        favorable_conditions = 0
        reasons = []
        
        # 1. Volatility check (moderate volatility preferred)
        if 0.3 <= volatility <= 1.0:
            favorable_conditions += 1
            reasons.append("✅ Healthy volatility")
        else:
            reasons.append(f"⚠️ Volatility {volatility:.2f} (prefer 0.3-1.0)")
        
        # 2. Volume check
        if volume_ratio > 0.7:
            favorable_conditions += 1
            reasons.append("✅ Adequate volume")
        else:
            reasons.append(f"⚠️ Low volume ratio {volume_ratio:.2f}")
        
        # 3. Trend momentum check
        if abs(price_change_3d) > 0.03:  # Some momentum
            favorable_conditions += 1
            reasons.append("✅ Price momentum present")
        else:
            reasons.append("⚠️ Weak price momentum")
        
        # 4. Recent price action
        if abs(price_change_1d) < 0.15:  # Not too volatile recently
            favorable_conditions += 1
            reasons.append("✅ Stable recent price action")
        else:
            reasons.append("⚠️ High recent volatility")
        
        confidence = favorable_conditions / 4.0
        favorable = confidence >= self.params['min_confidence_threshold']
        
        return {
            'favorable': favorable,
            'confidence': confidence,
            'volatility': volatility,
            'volume_ratio': volume_ratio,
            'price_change_3d': price_change_3d,
            'reasons': reasons,
            'score': f"{favorable_conditions}/4"
        }
    
    def generate_signals(self, df: pd.DataFrame, regime: Dict) -> pd.DataFrame:
        """Generate trading signals with regime filtering"""
        
        if not regime['favorable']:
            console.print(f"[yellow]⚠️ Unfavorable market regime - no signals generated[/yellow]")
            df['signal'] = 'HOLD'
            return df
        
        df = df.copy()
        df['signal'] = 'HOLD'
        
        # Calculate indicators
        df['volume_ma'] = df['volume'].rolling(window=30).mean()
        df['high_max'] = df['high'].rolling(window=self.params['lookback_periods']).max().shift(1)
        df['low_min'] = df['low'].rolling(window=self.params['lookback_periods']).min().shift(1)
        
        # Additional filters
        df['atr'] = self._calculate_atr(df, 14)
        df['rsi'] = self._calculate_rsi(df['close'], 14)
        
        # Track daily trades
        daily_trades = {}
        
        for i in range(self.params['lookback_periods'], len(df)):
            row = df.iloc[i]
            current_date = row.name.date()
            
            # Daily trade limit
            if daily_trades.get(current_date, 0) >= self.params['max_daily_trades']:
                continue
            
            # Entry conditions with multiple filters
            breakout_up = row['close'] > row['high_max'] * (1 + self.params['min_breakout_percent']/100)
            volume_ok = row['volume'] > row['volume_ma'] * self.params['volume_multiplier']
            
            # Additional quality filters
            rsi_ok = 40 <= row['rsi'] <= 80  # Avoid extreme RSI
            atr_ok = row['atr'] > 0  # Ensure some volatility
            
            # Momentum confirmation
            momentum_ok = row['close'] > df['close'].iloc[i-4]  # Higher than 1 hour ago
            
            if (breakout_up and volume_ok and rsi_ok and atr_ok and momentum_ok and 
                not pd.isna(row['high_max'])):
                
                df.iloc[i, df.columns.get_loc('signal')] = 'LONG'
                daily_trades[current_date] = daily_trades.get(current_date, 0) + 1
        
        return df
    
    def _calculate_atr(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
        """Calculate Average True Range"""
        high_low = df['high'] - df['low']
        high_close = np.abs(df['high'] - df['close'].shift())
        low_close = np.abs(df['low'] - df['close'].shift())
        
        true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        return true_range.rolling(window=period).mean()
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def backtest_production_strategy(self, days_back: int = 30) -> Dict:
        """Backtest the production strategy"""
        
        console.print(Panel.fit(
            f"[bold cyan]🚀 PRODUCTION CRYPTO BREAKOUT BACKTEST[/bold cyan]\n"
            f"Risk Level: {self.risk_level.upper()}\n"
            f"Position Size: {self.params['position_size_percent']}%\n"
            f"Stop Loss: {self.params['sl_percent']}%\n"
            f"Take Profit: {self.params['tp_percent']}%\n"
            f"Testing Period: {days_back} days",
            border_style="cyan"
        ))
        
        # Load data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back + 30)  # Extra data for indicators
        
        results = {}
        
        for symbol in self.symbols:
            console.print(f"\n[cyan]📊 Testing {symbol}...[/cyan]")
            
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is None or len(df) < 1000:
                    console.print(f"[red]✗ {symbol}: Insufficient data[/red]")
                    continue
                
                # Use last N days for testing
                test_bars = days_back * 24 * 4
                test_data = df.tail(test_bars)
                
                # Assess market regime
                regime = self.assess_market_regime(df)
                
                console.print(f"[yellow]Market Assessment:[/yellow]")
                console.print(f"[yellow]  Favorable: {regime['favorable']} (Score: {regime['score']})[/yellow]")
                console.print(f"[yellow]  Confidence: {regime['confidence']:.2f}[/yellow]")
                for reason in regime['reasons']:
                    console.print(f"[yellow]  {reason}[/yellow]")
                
                # Generate signals
                df_signals = self.generate_signals(test_data, regime)
                
                # Run backtest
                result = self._run_backtest(df_signals, symbol, regime)
                results[symbol] = result
                
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error - {str(e)}[/red]")
        
        # Display results
        self._display_production_results(results)
        
        return results
    
    def _run_backtest(self, df: pd.DataFrame, symbol: str, regime: Dict) -> Dict:
        """Run backtest with production parameters"""
        
        portfolio_value = 10000.0
        trades = []
        position = None
        
        long_signals = df[df['signal'] == 'LONG']
        
        for i, row in df.iterrows():
            if position is None:
                # Entry
                if row['signal'] == 'LONG':
                    # Adjust position size based on regime confidence
                    base_size = self.params['position_size_percent']
                    confidence_adjusted_size = base_size * regime['confidence']
                    
                    position = {
                        'entry_price': row['close'],
                        'entry_time': i,
                        'size': (portfolio_value * confidence_adjusted_size / 100) / row['close'],
                        'entry_bar_index': df.index.get_loc(i)
                    }
            else:
                # Exit logic
                current_price = row['close']
                entry_price = position['entry_price']
                bars_held = df.index.get_loc(i) - position['entry_bar_index']
                hours_held = bars_held * 0.25  # 15-min bars
                
                # Exit conditions
                stop_loss = entry_price * (1 - self.params['sl_percent']/100)
                take_profit = entry_price * (1 + self.params['tp_percent']/100)
                max_hold_exceeded = hours_held >= self.params['max_hold_hours']
                
                if (current_price <= stop_loss or 
                    current_price >= take_profit or 
                    max_hold_exceeded):
                    
                    # Determine exit reason
                    if current_price <= stop_loss:
                        exit_reason = 'STOP_LOSS'
                    elif current_price >= take_profit:
                        exit_reason = 'TAKE_PROFIT'
                    else:
                        exit_reason = 'TIME_EXIT'
                    
                    pnl = position['size'] * (current_price - entry_price)
                    
                    trades.append({
                        'entry_time': position['entry_time'],
                        'exit_time': i,
                        'entry_price': entry_price,
                        'exit_price': current_price,
                        'pnl': pnl,
                        'return_pct': (current_price - entry_price) / entry_price * 100,
                        'hours_held': hours_held,
                        'exit_reason': exit_reason
                    })
                    
                    portfolio_value += pnl
                    position = None
        
        # Calculate comprehensive metrics
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            # Exit reason analysis
            exit_reasons = {}
            for trade in trades:
                reason = trade['exit_reason']
                exit_reasons[reason] = exit_reasons.get(reason, 0) + 1
            
            # Risk metrics
            returns = [t['return_pct'] for t in trades]
            max_loss = min(returns) if returns else 0
            max_gain = max(returns) if returns else 0
            avg_return = np.mean(returns) if returns else 0
            
            # Drawdown
            running_pnl = 0
            max_dd = 0
            peak = 0
            for trade in trades:
                running_pnl += trade['pnl']
                if running_pnl > peak:
                    peak = running_pnl
                drawdown = peak - running_pnl
                if drawdown > max_dd:
                    max_dd = drawdown
            
            max_dd_pct = max_dd / 10000 * 100
            
            return {
                'symbol': symbol,
                'regime': regime,
                'win_rate': win_rate,
                'total_return_percent': total_return,
                'max_drawdown': max_dd_pct,
                'total_trades': len(trades),
                'avg_return_per_trade': avg_return,
                'max_loss': max_loss,
                'max_gain': max_gain,
                'exit_reasons': exit_reasons,
                'trades': trades
            }
        else:
            return {
                'symbol': symbol,
                'regime': regime,
                'win_rate': 0.0,
                'total_return_percent': 0.0,
                'max_drawdown': 0.0,
                'total_trades': 0,
                'avg_return_per_trade': 0.0,
                'max_loss': 0.0,
                'max_gain': 0.0,
                'exit_reasons': {},
                'trades': []
            }
    
    def _display_production_results(self, results: Dict):
        """Display production backtest results"""
        
        console.print(f"\n[bold green]📊 PRODUCTION STRATEGY RESULTS ({self.risk_level.upper()})[/bold green]")
        
        # Main results table
        table = Table(title=f"Production Backtest Results - {self.risk_level.upper()} Risk")
        table.add_column("Symbol", style="cyan")
        table.add_column("Regime", style="yellow")
        table.add_column("Win Rate%", justify="right")
        table.add_column("Return%", justify="right")
        table.add_column("Max DD%", justify="right")
        table.add_column("Trades", justify="right")
        table.add_column("Avg/Trade%", justify="right")
        table.add_column("Max Loss%", justify="right")
        
        for symbol, result in results.items():
            regime_status = "✅ Favorable" if result['regime']['favorable'] else "❌ Unfavorable"
            
            table.add_row(
                symbol,
                regime_status,
                f"{result['win_rate']:.1f}",
                f"{result['total_return_percent']:.1f}",
                f"{result['max_drawdown']:.1f}",
                str(result['total_trades']),
                f"{result['avg_return_per_trade']:.1f}",
                f"{result['max_loss']:.1f}"
            )
        
        console.print(table)
        
        # Exit analysis
        console.print(f"\n[bold yellow]📊 EXIT ANALYSIS[/bold yellow]")
        for symbol, result in results.items():
            if result['total_trades'] > 0:
                console.print(f"\n[cyan]{symbol} Exit Breakdown:[/cyan]")
                for reason, count in result['exit_reasons'].items():
                    pct = count / result['total_trades'] * 100
                    console.print(f"  {reason}: {count} ({pct:.1f}%)")
        
        # Save results
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"production_crypto_breakout_{self.risk_level}_{timestamp}.json"
        
        save_data = {
            'timestamp': timestamp,
            'strategy': 'Production Crypto Breakout',
            'risk_level': self.risk_level,
            'parameters': self.params,
            'results': results
        }
        
        with open(filename, 'w') as f:
            json.dump(save_data, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Production results saved to: {filename}[/green]")

def main():
    """Main function for production strategy"""
    
    console.print(Panel.fit(
        "[bold cyan]🚀 PRODUCTION CRYPTO BREAKOUT STRATEGY[/bold cyan]\n"
        "Conservative, regime-aware implementation\n"
        "Based on comprehensive analysis and validation",
        border_style="cyan"
    ))
    
    # Test different risk levels
    for risk_level in ['conservative', 'moderate']:
        console.print(f"\n[bold magenta]Testing {risk_level.upper()} risk level...[/bold magenta]")
        
        strategy = ProductionCryptoBreakout(
            symbols=['ETHUSDT'],  # Best performing symbol
            risk_level=risk_level
        )
        
        results = strategy.backtest_production_strategy(days_back=30)
    
    console.print(f"\n[bold green]🎊 Production strategy testing complete![/bold green]")
    
    # Final recommendations
    console.print(Panel.fit(
        "[bold green]✅ PRODUCTION RECOMMENDATIONS[/bold green]\n\n"
        "1. Start with CONSERVATIVE risk level\n"
        "2. Monitor performance for 2-4 weeks\n"
        "3. Only increase risk after consistent profits\n"
        "4. Reoptimize parameters weekly\n"
        "5. Stop trading if market regime becomes unfavorable\n\n"
        "[yellow]Remember: Real trading involves additional costs (fees, slippage)[/yellow]",
        border_style="green"
    ))

if __name__ == "__main__":
    main() 