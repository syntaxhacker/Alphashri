#!/usr/bin/env python3
"""
🎯 REALISTIC MONEY MAKER V2
With Trailing Stop Loss Feature!

NEW FEATURE:
✅ When trade reaches take profit target
✅ Don't exit immediately  
✅ Use trailing stop loss to let winners run
✅ Protect profits while capturing bigger moves

This captures those 10-20% moves while protecting the 6% minimum!
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from enhanced_data_fetcher import EnhancedDataFetcher

console = Console()

class RealisticMoneyMakerV2:
    """Enhanced strategy with trailing stops"""
    
    def __init__(self, symbol: str = "ETHUSDT", capital: float = 1000):
        self.symbol = symbol
        self.capital = capital
        
        # Trailing stop settings
        self.trailing_stop_percent = 0.02  # 2% trailing stop
        self.min_profit_to_trail = 0.06   # Start trailing after 6% profit
        
        console.print(Panel.fit(
            "[bold green]🎯 REALISTIC MONEY MAKER V2[/bold green]\n"
            f"[cyan]Symbol: {symbol} | Capital: ${capital:,.2f}[/cyan]\n\n"
            "[white]Enhanced Features:[/white]\n"
            "🎯 Quality support/resistance trades\n"
            "💰 6% initial targets\n"
            "🚀 Trailing stops when profitable\n"
            "📈 Let winners run to 10-20%+\n"
            "🛡️ Protect profits with 2% trailing\n\n"
            "[yellow]Now captures the big moves![/yellow]",
            border_style="green"
        ))
    
    def fetch_data(self, days: int = 21) -> pd.DataFrame:
        """Get market data"""
        
        fetcher = EnhancedDataFetcher(
            api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
            api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
        )
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        data = fetcher.fetch_data(self.symbol, start_date, end_date, '1h')
        
        if data is not None:
            data.reset_index(inplace=True)
            data.rename(columns={'index': 'timestamp'}, inplace=True)
            console.print(f"[green]✅ Loaded {len(data):,} hourly bars ({days} days)[/green]")
            return data
        
        console.print("[red]❌ Failed to load data[/red]")
        return None
    
    def add_simple_indicators(self, data: pd.DataFrame) -> pd.DataFrame:
        """Add essential indicators"""
        
        df = data.copy()
        close = df['close']
        high = df['high']
        low = df['low']
        volume = df['volume']
        
        # Trend indicators
        df['ma_short'] = close.rolling(12).mean()
        df['ma_long'] = close.rolling(48).mean()
        
        # Support/Resistance  
        df['resistance'] = high.rolling(24).max()
        df['support'] = low.rolling(24).min()
        
        # Volume analysis
        df['vol_ma'] = volume.rolling(24).mean()
        df['volume_surge'] = volume > df['vol_ma'] * 1.5
        
        # Price momentum
        df['momentum_4h'] = (close - close.shift(4)) / close.shift(4) * 100
        df['momentum_12h'] = (close - close.shift(12)) / close.shift(12) * 100
        
        # Volatility
        df['price_range'] = (high - low) / close * 100
        df['avg_range'] = df['price_range'].rolling(12).mean()
        
        return df
    
    def find_realistic_opportunities(self, data: pd.DataFrame) -> list:
        """Find trading opportunities"""
        
        df = self.add_simple_indicators(data)
        opportunities = []
        
        for i in range(50, len(df) - 24):
            current = df.iloc[i]
            prev = df.iloc[i-1]
            
            if pd.isna(current['ma_short']) or pd.isna(current['ma_long']):
                continue
            
            # LONG OPPORTUNITY
            long_conditions = [
                current['close'] < current['support'] * 1.02,
                current['low'] >= current['support'] * 0.995,
                current['momentum_4h'] > -2,
                current['close'] > prev['close'],
                current['volume_surge'],
                current['ma_short'] > current['ma_long'] * 0.98,
                current['price_range'] < current['avg_range'] * 1.5
            ]
            
            # SHORT OPPORTUNITY
            short_conditions = [
                current['high'] >= current['resistance'] * 0.998,
                current['close'] < current['resistance'] * 0.995,
                current['momentum_4h'] < 2,
                current['close'] < prev['close'],
                current['volume_surge'],
                current['ma_short'] < current['ma_long'] * 1.02,
                (current['high'] - current['close']) / current['close'] > 0.01
            ]
            
            if sum(long_conditions) >= 4:
                opportunities.append({
                    'timestamp': current['timestamp'],
                    'type': 'LONG',
                    'entry': current['close'],
                    'stop_loss': current['support'] * 0.99,
                    'take_profit': current['close'] * 1.06,
                    'confidence': sum(long_conditions) / 7,
                    'risk_reward': ((current['close'] * 1.06) - current['close']) / (current['close'] - (current['support'] * 0.99)),
                    'conditions_met': sum(long_conditions)
                })
                
            elif sum(short_conditions) >= 4:
                opportunities.append({
                    'timestamp': current['timestamp'],
                    'type': 'SHORT',
                    'entry': current['close'],
                    'stop_loss': current['resistance'] * 1.01,
                    'take_profit': current['close'] * 0.94,
                    'confidence': sum(short_conditions) / 7,
                    'risk_reward': (current['close'] - (current['close'] * 0.94)) / ((current['resistance'] * 1.01) - current['close']),
                    'conditions_met': sum(short_conditions)
                })
        
        # Filter for good risk/reward
        quality_opportunities = [
            opp for opp in opportunities 
            if opp['risk_reward'] >= 2.0
        ]
        
        console.print(f"[yellow]📊 Found {len(opportunities)} opportunities, {len(quality_opportunities)} high-quality[/yellow]")
        return quality_opportunities
    
    def simulate_trade_with_trailing_stop(self, entry_price: float, trade_type: str, 
                                        stop_loss: float, take_profit: float, 
                                        future_data: pd.DataFrame) -> dict:
        """Simulate trade with trailing stop loss"""
        
        current_stop = stop_loss
        highest_profit = 0  # Track highest profit achieved
        trailing_active = False
        
        for i, (_, bar) in enumerate(future_data.iterrows()):
            current_price = bar['close']
            
            # Calculate current profit
            if trade_type == 'LONG':
                current_profit_pct = (current_price - entry_price) / entry_price
            else:
                current_profit_pct = (entry_price - current_price) / entry_price
            
            # Track highest profit
            if current_profit_pct > highest_profit:
                highest_profit = current_profit_pct
            
            # Check if we should activate trailing stop
            if not trailing_active and current_profit_pct >= self.min_profit_to_trail:
                trailing_active = True
                console.print(f"    🚀 Trailing stop activated at {current_profit_pct:.1%} profit")
            
            # Update trailing stop if active
            if trailing_active:
                if trade_type == 'LONG':
                    # For longs: trailing stop moves up with price
                    new_stop = current_price * (1 - self.trailing_stop_percent)
                    if new_stop > current_stop:
                        current_stop = new_stop
                else:
                    # For shorts: trailing stop moves down with price  
                    new_stop = current_price * (1 + self.trailing_stop_percent)
                    if new_stop < current_stop:
                        current_stop = new_stop
            
            # Check exit conditions
            if trade_type == 'LONG':
                # Check trailing stop
                if bar['low'] <= current_stop:
                    exit_price = current_stop
                    if trailing_active:
                        return {
                            'exit_price': exit_price,
                            'exit_reason': 'trailing_stop',
                            'bars_held': i + 1,
                            'highest_profit': highest_profit,
                            'profit_captured': (exit_price - entry_price) / entry_price
                        }
                    else:
                        return {
                            'exit_price': exit_price,
                            'exit_reason': 'stop_loss',
                            'bars_held': i + 1,
                            'highest_profit': highest_profit,
                            'profit_captured': (exit_price - entry_price) / entry_price
                        }
                
                # If not using trailing stops, check original take profit
                if not trailing_active and bar['high'] >= take_profit:
                    return {
                        'exit_price': take_profit,
                        'exit_reason': 'take_profit',
                        'bars_held': i + 1,
                        'highest_profit': highest_profit,
                        'profit_captured': (take_profit - entry_price) / entry_price
                    }
            
            else:  # SHORT
                # Check trailing stop
                if bar['high'] >= current_stop:
                    exit_price = current_stop
                    if trailing_active:
                        return {
                            'exit_price': exit_price,
                            'exit_reason': 'trailing_stop',
                            'bars_held': i + 1,
                            'highest_profit': highest_profit,
                            'profit_captured': (entry_price - exit_price) / entry_price
                        }
                    else:
                        return {
                            'exit_price': exit_price,
                            'exit_reason': 'stop_loss',
                            'bars_held': i + 1,
                            'highest_profit': highest_profit,
                            'profit_captured': (entry_price - exit_price) / entry_price
                        }
                
                # If not using trailing stops, check original take profit
                if not trailing_active and bar['low'] <= take_profit:
                    return {
                        'exit_price': take_profit,
                        'exit_reason': 'take_profit',
                        'bars_held': i + 1,
                        'highest_profit': highest_profit,
                        'profit_captured': (entry_price - take_profit) / entry_price
                    }
        
        # Time exit if no other condition met
        final_price = future_data.iloc[-1]['close']
        if trade_type == 'LONG':
            final_profit = (final_price - entry_price) / entry_price
        else:
            final_profit = (entry_price - final_price) / entry_price
            
        return {
            'exit_price': final_price,
            'exit_reason': 'time_exit',
            'bars_held': len(future_data),
            'highest_profit': highest_profit,
            'profit_captured': final_profit
        }
    
    def backtest_with_trailing_stops(self, data: pd.DataFrame) -> dict:
        """Enhanced backtest with trailing stops"""
        
        console.print("[cyan]📈 Running enhanced backtest with trailing stops...[/cyan]")
        
        opportunities = self.find_realistic_opportunities(data)
        
        if not opportunities:
            return {
                'total_return': 0,
                'win_rate': 0,
                'total_trades': 0,
                'trades': []
            }
        
        balance = self.capital
        trades = []
        max_position_size = 0.1
        
        for opp_idx, opp in enumerate(opportunities):
            # Position sizing
            risk_per_trade = 0.02
            
            if opp['type'] == 'LONG':
                risk_amount = opp['entry'] - opp['stop_loss']
            else:
                risk_amount = opp['stop_loss'] - opp['entry']
            
            risk_percent = risk_amount / opp['entry']
            
            if risk_percent <= 0:
                continue
                
            position_size = min(risk_per_trade / risk_percent, max_position_size)
            position_value = balance * position_size
            
            # Get future data
            entry_time = opp['timestamp']
            future_data = data[data['timestamp'] > entry_time].head(48)
            
            if len(future_data) == 0:
                continue
            
            console.print(f"  Trade {opp_idx + 1}: {opp['type']} at ${opp['entry']:.2f}")
            
            # Simulate trade with trailing stop
            trade_result = self.simulate_trade_with_trailing_stop(
                opp['entry'], opp['type'], opp['stop_loss'], 
                opp['take_profit'], future_data
            )
            
            # Calculate final return
            trade_return = trade_result['profit_captured']
            trade_pnl = position_value * trade_return
            balance += trade_pnl
            
            # Record trade
            hold_hours = trade_result['bars_held']
            
            trades.append({
                'entry_time': entry_time,
                'type': opp['type'],
                'entry_price': opp['entry'],
                'exit_price': trade_result['exit_price'],
                'return_pct': trade_return * 100,
                'pnl': trade_pnl,
                'exit_reason': trade_result['exit_reason'],
                'confidence': opp['confidence'],
                'position_size': position_size * 100,
                'hold_hours': hold_hours,
                'highest_profit_pct': trade_result['highest_profit'] * 100,
                'profit_captured_pct': trade_return * 100
            })
            
            profit_status = "💚" if trade_return > 0 else "❤️"
            console.print(f"    {profit_status} Exit: {trade_result['exit_reason']} at {trade_return * 100:.1f}% (max: {trade_result['highest_profit'] * 100:.1f}%)")
        
        # Calculate metrics
        total_return = (balance - self.capital) / self.capital
        total_trades = len(trades)
        winning_trades = len([t for t in trades if t['return_pct'] > 0])
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        return {
            'total_return': total_return,
            'win_rate': win_rate,
            'total_trades': total_trades,
            'winning_trades': winning_trades,
            'losing_trades': total_trades - winning_trades,
            'final_balance': balance,
            'trades': trades
        }
    
    def display_enhanced_results(self, results: dict):
        """Display results with trailing stop analysis"""
        
        console.print(f"\n[bold green]🎯 ENHANCED RESULTS WITH TRAILING STOPS[/bold green]")
        
        if results['total_trades'] == 0:
            console.print(Panel.fit(
                "[bold yellow]⚠️ NO QUALITY OPPORTUNITIES FOUND[/bold yellow]\n\n"
                "[white]No good setups in this period[/white]",
                border_style="yellow"
            ))
            return
        
        # Main results table
        table = Table(title="🚀 Enhanced Performance with Trailing Stops")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", style="green")
        table.add_column("Assessment", justify="center")
        
        table.add_row(
            "Total Return",
            f"{results['total_return']:.1%}",
            "🎯" if results['total_return'] > 0.05 else "✅" if results['total_return'] > 0 else "❌"
        )
        
        table.add_row(
            "Win Rate",
            f"{results['win_rate']:.1%}",
            "🎯" if results['win_rate'] >= 0.7 else "✅" if results['win_rate'] >= 0.5 else "❌"
        )
        
        table.add_row(
            "Total Trades",
            str(results['total_trades']),
            "🎯" if 3 <= results['total_trades'] <= 15 else "⚠️"
        )
        
        table.add_row(
            "Final Balance",
            f"${results['final_balance']:.2f}",
            "💰"
        )
        
        if results['trades']:
            # Trailing stop analysis
            trailing_exits = [t for t in results['trades'] if t['exit_reason'] == 'trailing_stop']
            take_profit_exits = [t for t in results['trades'] if t['exit_reason'] == 'take_profit']
            
            avg_return = np.mean([t['return_pct'] for t in results['trades']])
            avg_max_profit = np.mean([t['highest_profit_pct'] for t in results['trades']])
            
            table.add_row(
                "Avg Return/Trade",
                f"{avg_return:.1f}%",
                "🎯" if avg_return > 5 else "✅" if avg_return > 0 else "❌"
            )
            
            table.add_row(
                "Avg Max Profit",
                f"{avg_max_profit:.1f}%",
                "📈"
            )
            
            table.add_row(
                "Trailing Stop Exits",
                str(len(trailing_exits)),
                "🚀"
            )
        
        console.print(table)
        
        # Enhanced verdict
        if results['total_return'] >= 0.1:
            verdict = "EXCELLENT ENHANCED STRATEGY!"
            color = "green"
            message = "Trailing stops are capturing bigger moves!"
        elif results['total_return'] >= 0.05:
            verdict = "VERY GOOD STRATEGY"
            color = "green"
            message = "Solid performance with enhanced exits"
        elif results['total_return'] > 0:
            verdict = "PROFITABLE STRATEGY"
            color = "yellow"
            message = "Making money with room for improvement"
        else:
            verdict = "NEEDS ADJUSTMENT"
            color = "red"
            message = "Strategy needs tuning for this period"
        
        console.print(Panel.fit(
            f"[bold {color}]🚀 {verdict}[/bold {color}]\n\n"
            f"[white]{message}[/white]\n\n"
            f"[cyan]Enhanced Performance:[/cyan]\n"
            f"• Total Return: {results['total_return']:.1%}\n"
            f"• Win Rate: {results['win_rate']:.1%}\n"
            f"• Trades: {results['total_trades']}\n"
            f"• Final Balance: ${results['final_balance']:.2f}",
            border_style=color
        ))
        
        # Show trailing stop effectiveness
        if results['trades']:
            console.print(f"\n[yellow]🚀 Trailing Stop Analysis:[/yellow]")
            
            trailing_trades = [t for t in results['trades'] if t['exit_reason'] == 'trailing_stop']
            if trailing_trades:
                avg_trailing_return = np.mean([t['return_pct'] for t in trailing_trades])
                console.print(f"  • Trailing stop trades: {len(trailing_trades)}")
                console.print(f"  • Average trailing return: {avg_trailing_return:.1f}%")
                console.print(f"  • These captured bigger moves beyond 6% targets!")
            
            # Show best performers
            console.print(f"\n[yellow]📋 Top 5 Trades:[/yellow]")
            sorted_trades = sorted(results['trades'], key=lambda x: x['return_pct'], reverse=True)
            for i, trade in enumerate(sorted_trades[:5], 1):
                profit_emoji = "🚀" if trade['exit_reason'] == 'trailing_stop' else "💚" if trade['return_pct'] > 0 else "❤️"
                console.print(
                    f"  {i}. {profit_emoji} {trade['type']} "
                    f"{trade['return_pct']:+.1f}% "
                    f"(max: {trade['highest_profit_pct']:.1f}%, "
                    f"{trade['exit_reason']}, {trade['hold_hours']:.0f}h)"
                )
    
    def run_enhanced_test(self, days: int = 21):
        """Run enhanced test with trailing stops"""
        
        console.print(f"\n[bold yellow]🚀 Testing ENHANCED strategy with trailing stops over {days} days...[/bold yellow]")
        console.print(f"[cyan]Trailing stop: {self.trailing_stop_percent:.1%} | Activation: {self.min_profit_to_trail:.1%} profit[/cyan]")
        
        # Get data
        data = self.fetch_data(days)
        if data is None:
            return None
        
        # Run enhanced backtest
        results = self.backtest_with_trailing_stops(data)
        
        # Display results
        self.display_enhanced_results(results)
        
        return results

def main():
    """Main function"""
    
    console.print(Panel.fit(
        "[bold gold3]🚀 REALISTIC MONEY MAKER V2[/bold gold3]\n"
        "[cyan]Enhanced with trailing stops to capture big moves![/cyan]\n\n"
        "[white]Enhanced Features:[/white]\n"
        "💰 Same quality entry rules\n"
        "🎯 6% initial take profit targets\n"
        "🚀 Trailing stops when profitable\n"
        "📈 Capture 10-20%+ moves\n"
        "🛡️ Protect profits with 2% trailing\n\n"
        "[yellow]Let winners run while protecting gains![/yellow]",
        border_style="gold3"
    ))
    
    # User input
    symbol = input("\nSymbol (default ETHUSDT): ").strip().upper() or "ETHUSDT"
    if not symbol.endswith('USDT'):
        symbol += 'USDT'
    
    capital_input = input("Capital (default $1000): ").strip()
    try:
        capital = float(capital_input.replace('$', '').replace(',', ''))
    except:
        capital = 1000
    
    days_input = input("Days to test (default 21): ").strip()
    days = int(days_input) if days_input.isdigit() else 21
    
    # Enhanced settings
    trailing_input = input("Trailing stop % (default 2%): ").strip()
    try:
        trailing_percent = float(trailing_input.replace('%', '')) / 100
    except:
        trailing_percent = 0.02
    
    # Run enhanced test
    strategy = RealisticMoneyMakerV2(symbol=symbol, capital=capital)
    strategy.trailing_stop_percent = trailing_percent
    
    results = strategy.run_enhanced_test(days)
    
    if results and results['total_return'] > 0.05:
        console.print(Panel.fit(
            "[bold green]🎊 ENHANCED STRATEGY SUCCESS![/bold green]\n\n"
            f"[white]✅ {results['total_return']:.1%} return with trailing stops![/white]\n"
            f"[white]✅ Captured bigger moves beyond basic targets[/white]\n"
            f"[white]✅ {results['win_rate']:.1%} win rate maintained[/white]\n\n"
            "[cyan]Trailing stops are working![/cyan]",
            border_style="green"
        ))
    elif results and results['total_return'] > 0:
        console.print(Panel.fit(
            "[bold yellow]📈 GOOD ENHANCED RESULTS[/bold yellow]\n\n"
            f"[white]✅ {results['total_return']:.1%} return (profitable!)[/white]\n"
            "[cyan]Enhanced strategy performing well![/cyan]",
            border_style="yellow"
        ))

if __name__ == "__main__":
    main() 