#!/usr/bin/env python3
"""
Market Condition Monitor
Monitors market conditions and alerts when they become favorable for trading
Helps identify when to start/stop trading based on validated criteria
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

class MarketConditionMonitor:
    """Monitor market conditions for trading opportunities"""
    
    def __init__(self, symbols: List[str] = None):
        self.symbols = symbols or ['ETHUSDT', 'BTCUSDT', 'SOLUSDT']
        self.fetcher = EnhancedDataFetcher()
        
        # Market condition thresholds for trading viability
        self.favorable_thresholds = {
            'min_volatility': 0.003,        # Minimum volatility for opportunities
            'max_volatility': 0.020,        # Maximum volatility (too risky above)
            'min_volume_activity': 1.2,     # Volume activity threshold
            'min_momentum_strength': 0.008,  # Minimum momentum
            'min_trend_strength': 0.015,    # Minimum trend strength
            'min_breakout_frequency': 0.05, # Minimum breakout frequency
            'max_correlation': 0.8,         # Maximum symbol correlation
            'min_market_breadth': 0.6       # Minimum % of symbols looking good
        }
        
        # Alert thresholds
        self.alert_config = {
            'check_frequency_hours': 6,     # Check every 6 hours
            'lookback_days': 7,             # Look back 7 days for analysis
            'consecutive_good_periods': 3,   # Need 3 consecutive good readings
            'alert_cooldown_hours': 24      # Don't spam alerts
        }
        
        self.last_alert_time = None
        self.consecutive_favorable = 0
        
    def analyze_current_conditions(self) -> Dict:
        """Analyze current market conditions comprehensively"""
        
        console.print(Panel.fit(
            f"[bold cyan]📊 MARKET CONDITION ANALYSIS[/bold cyan]\n"
            f"Monitoring {len(self.symbols)} symbols\n"
            f"Lookback Period: {self.alert_config['lookback_days']} days\n"
            f"Checking for trading viability...",
            border_style="cyan"
        ))
        
        # Load recent data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.alert_config['lookback_days'] + 5)
        
        symbol_conditions = {}
        
        for symbol in self.symbols:
            console.print(f"[cyan]📈 Analyzing {symbol}...[/cyan]")
            
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                
                if df is not None and len(df) > 500:
                    conditions = self._analyze_symbol_conditions(symbol, df)
                    symbol_conditions[symbol] = conditions
                    
                    status = "🟢 FAVORABLE" if conditions['is_favorable'] else "🔴 UNFAVORABLE"
                    console.print(f"   {status} (Score: {conditions['overall_score']:.1f}/100)")
                else:
                    console.print(f"[red]   ✗ Insufficient data[/red]")
                    
            except Exception as e:
                console.print(f"[red]   ✗ Error: {str(e)[:50]}[/red]")
        
        # Aggregate market analysis
        market_analysis = self._aggregate_market_conditions(symbol_conditions)
        
        # Display results
        self._display_market_analysis(market_analysis, symbol_conditions)
        
        # Check for alerts
        self._check_trading_alerts(market_analysis)
        
        return {
            'timestamp': datetime.now(),
            'market_analysis': market_analysis,
            'symbol_conditions': symbol_conditions,
            'trading_recommendation': self._get_trading_recommendation(market_analysis)
        }
    
    def _analyze_symbol_conditions(self, symbol: str, df: pd.DataFrame) -> Dict:
        """Analyze conditions for a single symbol"""
        
        recent = df.tail(self.alert_config['lookback_days'] * 24 * 4)
        
        # 1. Volatility analysis
        returns = recent['close'].pct_change().dropna()
        volatility = returns.std()
        volatility_score = self._score_volatility(volatility)
        
        # 2. Volume activity
        volume_ma = recent['volume'].rolling(48).mean()
        current_volume = recent['volume'].tail(24).mean()
        volume_activity = current_volume / volume_ma.iloc[-1] if volume_ma.iloc[-1] > 0 else 1.0
        volume_score = self._score_volume_activity(volume_activity)
        
        # 3. Momentum strength
        momentum_1h = (recent['close'].iloc[-4] - recent['close'].iloc[-8]) / recent['close'].iloc[-8]
        momentum_4h = (recent['close'].iloc[-1] - recent['close'].iloc[-16]) / recent['close'].iloc[-16]
        momentum_score = self._score_momentum(momentum_1h, momentum_4h)
        
        # 4. Trend strength
        sma_20 = recent['close'].rolling(20).mean()
        sma_50 = recent['close'].rolling(50).mean()
        trend_strength = abs(sma_20.iloc[-1] - sma_50.iloc[-1]) / sma_50.iloc[-1] if len(sma_50) > 0 else 0
        trend_score = self._score_trend_strength(trend_strength)
        
        # 5. Breakout frequency
        high_max = recent['high'].rolling(12).max()
        breakouts = (recent['close'] > high_max.shift(1) * 1.006).sum()
        breakout_frequency = breakouts / len(recent)
        breakout_score = self._score_breakout_frequency(breakout_frequency)
        
        # 6. Price range analysis
        price_range = (recent['high'].max() - recent['low'].min()) / recent['close'].iloc[-1]
        range_score = min(price_range * 1000, 100)  # Cap at 100
        
        # Calculate overall score
        weights = {
            'volatility': 0.25,
            'volume': 0.20,
            'momentum': 0.20,
            'trend': 0.15,
            'breakout': 0.15,
            'range': 0.05
        }
        
        overall_score = (
            volatility_score * weights['volatility'] +
            volume_score * weights['volume'] +
            momentum_score * weights['momentum'] +
            trend_score * weights['trend'] +
            breakout_score * weights['breakout'] +
            range_score * weights['range']
        )
        
        return {
            'symbol': symbol,
            'overall_score': overall_score,
            'is_favorable': overall_score >= 60,  # 60+ is favorable
            'volatility': volatility,
            'volatility_score': volatility_score,
            'volume_activity': volume_activity,
            'volume_score': volume_score,
            'momentum_strength': max(abs(momentum_1h), abs(momentum_4h)) * 100,
            'momentum_score': momentum_score,
            'trend_strength': trend_strength,
            'trend_score': trend_score,
            'breakout_frequency': breakout_frequency,
            'breakout_score': breakout_score,
            'price_range': price_range,
            'range_score': range_score
        }
    
    def _score_volatility(self, volatility: float) -> float:
        """Score volatility (sweet spot for trading)"""
        if self.favorable_thresholds['min_volatility'] <= volatility <= self.favorable_thresholds['max_volatility']:
            return 100
        elif volatility < self.favorable_thresholds['min_volatility']:
            return volatility / self.favorable_thresholds['min_volatility'] * 50
        else:
            return max(0, 100 - (volatility - self.favorable_thresholds['max_volatility']) * 2000)
    
    def _score_volume_activity(self, activity: float) -> float:
        """Score volume activity"""
        if activity >= self.favorable_thresholds['min_volume_activity']:
            return min(activity * 50, 100)
        else:
            return activity / self.favorable_thresholds['min_volume_activity'] * 50
    
    def _score_momentum(self, momentum_1h: float, momentum_4h: float) -> float:
        """Score momentum strength"""
        max_momentum = max(abs(momentum_1h), abs(momentum_4h))
        if max_momentum >= self.favorable_thresholds['min_momentum_strength']:
            return min(max_momentum * 5000, 100)
        else:
            return max_momentum / self.favorable_thresholds['min_momentum_strength'] * 50
    
    def _score_trend_strength(self, trend_strength: float) -> float:
        """Score trend strength"""
        if trend_strength >= self.favorable_thresholds['min_trend_strength']:
            return min(trend_strength * 3000, 100)
        else:
            return trend_strength / self.favorable_thresholds['min_trend_strength'] * 50
    
    def _score_breakout_frequency(self, frequency: float) -> float:
        """Score breakout frequency"""
        if frequency >= self.favorable_thresholds['min_breakout_frequency']:
            return min(frequency * 1000, 100)
        else:
            return frequency / self.favorable_thresholds['min_breakout_frequency'] * 50
    
    def _aggregate_market_conditions(self, symbol_conditions: Dict) -> Dict:
        """Aggregate individual symbol conditions into market assessment"""
        
        if not symbol_conditions:
            return {
                'overall_market_score': 0,
                'favorable_symbols': 0,
                'total_symbols': 0,
                'market_breadth': 0,
                'is_market_favorable': False
            }
        
        scores = [cond['overall_score'] for cond in symbol_conditions.values()]
        favorable_count = len([cond for cond in symbol_conditions.values() if cond['is_favorable']])
        
        overall_score = np.mean(scores)
        market_breadth = favorable_count / len(symbol_conditions)
        
        is_favorable = (
            overall_score >= 55 and  # Average score above 55
            market_breadth >= self.favorable_thresholds['min_market_breadth']  # At least 60% favorable
        )
        
        return {
            'overall_market_score': overall_score,
            'favorable_symbols': favorable_count,
            'total_symbols': len(symbol_conditions),
            'market_breadth': market_breadth,
            'is_market_favorable': is_favorable,
            'best_symbol': max(symbol_conditions.items(), key=lambda x: x[1]['overall_score'])[0] if symbol_conditions else None,
            'worst_symbol': min(symbol_conditions.items(), key=lambda x: x[1]['overall_score'])[0] if symbol_conditions else None
        }
    
    def _display_market_analysis(self, market_analysis: Dict, symbol_conditions: Dict):
        """Display comprehensive market analysis"""
        
        console.print(f"\n[bold cyan]📊 MARKET CONDITION REPORT[/bold cyan]")
        
        # Overall market status
        status_color = "green" if market_analysis['is_market_favorable'] else "red"
        status_text = "🟢 FAVORABLE FOR TRADING" if market_analysis['is_market_favorable'] else "🔴 UNFAVORABLE FOR TRADING"
        
        console.print(Panel.fit(
            f"[bold {status_color}]{status_text}[/bold {status_color}]\n\n"
            f"Overall Market Score: {market_analysis['overall_market_score']:.1f}/100\n"
            f"Favorable Symbols: {market_analysis['favorable_symbols']}/{market_analysis['total_symbols']}\n"
            f"Market Breadth: {market_analysis['market_breadth']:.1%}\n"
            f"Best Symbol: {market_analysis['best_symbol']}\n"
            f"Worst Symbol: {market_analysis['worst_symbol']}",
            border_style=status_color
        ))
        
        # Individual symbol breakdown
        if symbol_conditions:
            symbol_table = Table(title="Symbol Condition Breakdown")
            symbol_table.add_column("Symbol", style="cyan")
            symbol_table.add_column("Overall Score", justify="right")
            symbol_table.add_column("Status", style="bold")
            symbol_table.add_column("Volatility", justify="right")
            symbol_table.add_column("Volume", justify="right")
            symbol_table.add_column("Momentum", justify="right")
            symbol_table.add_column("Trend", justify="right")
            
            for symbol, conditions in symbol_conditions.items():
                status_emoji = "🟢" if conditions['is_favorable'] else "🔴"
                symbol_table.add_row(
                    symbol,
                    f"{conditions['overall_score']:.1f}",
                    status_emoji,
                    f"{conditions['volatility_score']:.0f}",
                    f"{conditions['volume_score']:.0f}",
                    f"{conditions['momentum_score']:.0f}",
                    f"{conditions['trend_score']:.0f}"
                )
            
            console.print(symbol_table)
    
    def _check_trading_alerts(self, market_analysis: Dict):
        """Check if we should send trading alerts"""
        
        if market_analysis['is_market_favorable']:
            self.consecutive_favorable += 1
            console.print(f"[green]✅ Consecutive favorable periods: {self.consecutive_favorable}[/green]")
            
            # Check if we should alert
            if (self.consecutive_favorable >= self.alert_config['consecutive_good_periods'] and
                self._should_send_alert()):
                
                self._send_trading_alert(market_analysis)
                
        else:
            self.consecutive_favorable = 0
            console.print(f"[red]❌ Market conditions unfavorable - waiting...[/red]")
    
    def _should_send_alert(self) -> bool:
        """Check if enough time has passed since last alert"""
        
        if self.last_alert_time is None:
            return True
        
        time_since_alert = datetime.now() - self.last_alert_time
        return time_since_alert.total_seconds() / 3600 >= self.alert_config['alert_cooldown_hours']
    
    def _send_trading_alert(self, market_analysis: Dict):
        """Send trading opportunity alert"""
        
        self.last_alert_time = datetime.now()
        
        console.print(Panel.fit(
            f"[bold green]🚨 TRADING OPPORTUNITY ALERT! 🚨[/bold green]\n\n"
            f"Market conditions have improved!\n"
            f"Overall Score: {market_analysis['overall_market_score']:.1f}/100\n"
            f"Favorable Symbols: {market_analysis['favorable_symbols']}/{market_analysis['total_symbols']}\n"
            f"Best Symbol: {market_analysis['best_symbol']}\n\n"
            f"🎯 RECOMMENDATION: Resume strategy validation and testing\n"
            f"⚠️ Start with paper trading and small positions",
            border_style="green"
        ))
    
    def _get_trading_recommendation(self, market_analysis: Dict) -> Dict:
        """Get trading recommendation based on market conditions"""
        
        if market_analysis['is_market_favorable']:
            if market_analysis['overall_market_score'] >= 75:
                recommendation = {
                    'action': 'AGGRESSIVE_TRADING',
                    'confidence': 'HIGH',
                    'position_size': 'NORMAL',
                    'message': 'Excellent conditions - resume normal trading'
                }
            else:
                recommendation = {
                    'action': 'CAUTIOUS_TRADING',
                    'confidence': 'MODERATE',
                    'position_size': 'REDUCED',
                    'message': 'Good conditions - start with smaller positions'
                }
        else:
            if market_analysis['overall_market_score'] >= 40:
                recommendation = {
                    'action': 'PAPER_TRADING',
                    'confidence': 'LOW',
                    'position_size': 'MINIMAL',
                    'message': 'Marginal conditions - paper trade only'
                }
            else:
                recommendation = {
                    'action': 'NO_TRADING',
                    'confidence': 'VERY_LOW',
                    'position_size': 'NONE',
                    'message': 'Poor conditions - preserve capital'
                }
        
        return recommendation
    
    def continuous_monitoring(self, hours: int = 24):
        """Run continuous monitoring for specified hours"""
        
        console.print(Panel.fit(
            f"[bold blue]🔄 CONTINUOUS MARKET MONITORING[/bold blue]\n"
            f"Monitoring for {hours} hours\n"
            f"Check frequency: every {self.alert_config['check_frequency_hours']} hours\n"
            f"Will alert when conditions improve",
            border_style="blue"
        ))
        
        checks_needed = hours // self.alert_config['check_frequency_hours']
        
        for check in range(checks_needed):
            console.print(f"\n[blue]📊 Check #{check + 1}/{checks_needed}[/blue]")
            
            # Analyze current conditions
            analysis = self.analyze_current_conditions()
            
            # Save monitoring log
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"market_monitoring_{timestamp}.json"
            
            with open(filename, 'w') as f:
                json.dump(analysis, f, indent=2, default=str)
            
            # Wait for next check (unless it's the last one)
            if check < checks_needed - 1:
                console.print(f"[yellow]⏰ Waiting {self.alert_config['check_frequency_hours']} hours until next check...[/yellow]")
                time.sleep(self.alert_config['check_frequency_hours'] * 3600)

def main():
    """Main function for market condition monitoring"""
    
    console.print(Panel.fit(
        "[bold cyan]📊 MARKET CONDITION MONITOR[/bold cyan]\n"
        "Monitoring market conditions for trading viability\n"
        "Alerts when conditions become favorable\n"
        "Helps determine when to start/stop trading",
        border_style="cyan"
    ))
    
    # Initialize monitor
    monitor = MarketConditionMonitor()
    
    # Run single analysis
    console.print("[cyan]Running single market condition analysis...[/cyan]")
    analysis = monitor.analyze_current_conditions()
    
    # Display recommendation
    recommendation = analysis['trading_recommendation']
    
    console.print(f"\n[bold yellow]🎯 TRADING RECOMMENDATION[/bold yellow]")
    console.print(f"Action: {recommendation['action']}")
    console.print(f"Confidence: {recommendation['confidence']}")
    console.print(f"Position Size: {recommendation['position_size']}")
    console.print(f"Message: {recommendation['message']}")
    
    # Ask if user wants continuous monitoring
    console.print(f"\n[blue]💡 TIP: Run monitor.continuous_monitoring(24) for 24-hour monitoring[/blue]")

if __name__ == "__main__":
    main() 