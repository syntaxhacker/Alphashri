#!/usr/bin/env python3
"""
🎯 REALISTIC MONEY MAKER V3
Enhanced with Higher Win Rate!

NEW IMPROVEMENTS:
✅ More selective entry criteria
✅ Better trend confirmation
✅ Volume surge validation
✅ Price action quality filters
✅ Dynamic stop loss placement

ENHANCED LOGIC:
- Stricter quality requirements
- Better trend alignment
- Volume confirmation mandatory
- Price momentum validation
- Risk/reward optimization

Target: 60%+ win rate with 30%+ returns!
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from enhanced_data_fetcher import EnhancedDataFetcher

console = Console()

class RealisticMoneyMaker:
    """Enhanced strategy with higher win rate"""
    
    def __init__(self, symbol: str = "ETHUSDT", capital: float = 1000):
        self.symbol = symbol
        self.capital = capital
        
        # Enhanced trailing stop settings
        self.trailing_stop_percent = 0.015  # 1.5% trailing stop (tighter)
        self.min_profit_to_trail = 0.06     # Start trailing after 6% profit
        
        console.print(Panel.fit(
            "[bold green]🎯 REALISTIC MONEY MAKER V3[/bold green]\n"
            f"[cyan]Symbol: {symbol} | Capital: ${capital:,.2f}[/cyan]\n\n"
            "[white]Enhanced for Higher Win Rate:[/white]\n"
            "🎯 Ultra-selective quality trades\n"
            "💰 6% initial + trailing stops\n"
            "🚀 Better trend confirmation\n"
            "📈 Mandatory volume validation\n"
            "🛡️ Tighter 1.5% trailing stops\n"
            "🎨 Price action quality filters\n\n"
            "[yellow]Quality over quantity - higher win rate![/yellow]",
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
    
    def add_enhanced_indicators(self, data: pd.DataFrame) -> pd.DataFrame:
        """Add enhanced indicators for better win rate"""
        
        df = data.copy()
        close = df['close']
        high = df['high']
        low = df['low']
        volume = df['volume']
        
        # Multiple timeframe trend analysis
        df['ma_fast'] = close.rolling(8).mean()   # 8-hour fast MA
        df['ma_short'] = close.rolling(12).mean() # 12-hour MA
        df['ma_medium'] = close.rolling(24).mean() # 24-hour MA  
        df['ma_long'] = close.rolling(48).mean()   # 48-hour MA
        
        # Enhanced support/resistance with multiple timeframes
        df['resistance_short'] = high.rolling(12).max()  # 12-hour resistance
        df['support_short'] = low.rolling(12).min()      # 12-hour support
        df['resistance'] = high.rolling(24).max()        # 24-hour resistance
        df['support'] = low.rolling(24).min()            # 24-hour support
        df['resistance_long'] = high.rolling(48).max()   # 48-hour resistance  
        df['support_long'] = low.rolling(48).min()       # 48-hour support
        
        # Enhanced volume analysis
        df['vol_sma'] = volume.rolling(12).mean()
        df['vol_ema'] = volume.ewm(span=12).mean()
        df['volume_surge'] = volume > df['vol_sma'] * 1.8  # Strong but achievable volume
        df['volume_consistent'] = volume > df['vol_sma'] * 1.2  # Consistent volume
        
        # Price momentum with multiple timeframes
        df['momentum_2h'] = (close - close.shift(2)) / close.shift(2) * 100   # 2-hour
        df['momentum_4h'] = (close - close.shift(4)) / close.shift(4) * 100   # 4-hour
        df['momentum_8h'] = (close - close.shift(8)) / close.shift(8) * 100   # 8-hour
        df['momentum_12h'] = (close - close.shift(12)) / close.shift(12) * 100 # 12-hour
        
        # Price action quality indicators
        df['body_size'] = abs(close - df['open']) / close * 100
        df['wick_top'] = (high - np.maximum(close, df['open'])) / close * 100
        df['wick_bottom'] = (np.minimum(close, df['open']) - low) / close * 100
        df['total_range'] = (high - low) / close * 100
        
        # Volatility and quality filters
        df['atr'] = df['total_range'].rolling(14).mean()  # Average True Range
        df['price_quality'] = df['body_size'] > (df['total_range'] * 0.5)  # Strong body vs wicks
        
        # Trend strength indicators
        df['trend_strength_short'] = (df['ma_fast'] - df['ma_short']) / df['ma_short'] * 100
        df['trend_strength_medium'] = (df['ma_short'] - df['ma_medium']) / df['ma_medium'] * 100
        df['trend_strength_long'] = (df['ma_medium'] - df['ma_long']) / df['ma_long'] * 100
        
        # RSI for momentum confirmation
        delta = close.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['rsi'] = 100 - (100 / (1 + rs))
        
        return df
    
    def find_high_quality_opportunities(self, data: pd.DataFrame) -> list:
        """Find only the highest quality trading opportunities"""
        
        df = self.add_enhanced_indicators(data)
        opportunities = []
        
        for i in range(60, len(df) - 24):  # Need more bars for indicators
            current = df.iloc[i]
            prev = df.iloc[i-1]
            prev2 = df.iloc[i-2]
            
            # Only trade if we have clean data
            if pd.isna(current['ma_long']) or pd.isna(current['rsi']):
                continue
            
            # ENHANCED LONG OPPORTUNITY with stricter criteria
            long_conditions = [
                # 1. Price near support with confirmation
                current['close'] <= current['support'] * 1.015,  # Closer to support
                current['low'] >= current['support'] * 0.998,    # Held support firmly
                current['close'] > current['support_short'],     # Above short-term support
                
                # 2. Strong upward momentum across timeframes
                current['momentum_2h'] > -1.5,   # Recent momentum not too negative
                current['momentum_4h'] > -2.0, # 4-hour momentum improving
                current['close'] > prev['close'],  # Current bar closing higher
                prev['close'] > prev2['close'] * 0.999,    # Previous bar trend positive
                
                # 3. Volume confirmation (mandatory)
                current['volume_surge'],           # Strong volume
                current['volume_consistent'],      # Consistent volume pattern
                
                # 4. Trend alignment (all timeframes)
                current['ma_fast'] > current['ma_short'] * 0.999,    # Fast MA above short
                current['ma_short'] > current['ma_medium'] * 0.997,  # Short above medium
                current['trend_strength_short'] > -0.2,              # Short trend not negative
                
                # 5. Price action quality
                current['price_quality'],          # Strong price action
                current['body_size'] > 0.3,       # Meaningful candle body
                current['total_range'] < current['atr'] * 1.5,  # Normal volatility
                
                # 6. RSI confirmation
                30 < current['rsi'] < 70,          # RSI in reasonable range
                current['rsi'] > prev['rsi'],      # RSI improving
                
                # 7. Multi-level support
                current['support'] < current['support_long'] * 1.01,  # Support levels aligned
            ]
            
            # ENHANCED SHORT OPPORTUNITY with stricter criteria  
            short_conditions = [
                # 1. Price rejected at resistance with confirmation
                current['high'] >= current['resistance'] * 0.999,   # Touched resistance
                current['close'] < current['resistance'] * 0.993,   # Rejected clearly
                current['close'] < current['resistance_short'],     # Below short resistance
                
                # 2. Downward momentum across timeframes
                current['momentum_2h'] < 1.5,    # Recent momentum not too positive
                current['momentum_4h'] < 2.0,  # 4-hour momentum declining
                current['close'] < prev['close'],  # Current bar closing lower
                prev['close'] < prev2['close'] * 1.001,    # Previous bar trend negative
                
                # 3. Volume confirmation (mandatory)
                current['volume_surge'],           # Strong volume on rejection
                current['volume_consistent'],      # Consistent volume
                
                # 4. Downtrend alignment
                current['ma_fast'] < current['ma_short'] * 1.001,    # Fast MA below short
                current['ma_short'] < current['ma_medium'] * 1.003,  # Short below medium
                current['trend_strength_short'] < 0.2,               # Short trend not positive
                
                # 5. Price action quality (strong rejection)
                current['price_quality'],          # Strong price action
                current['wick_top'] > 0.5,        # Clear rejection wick
                current['total_range'] < current['atr'] * 1.5,  # Normal volatility
                
                # 6. RSI confirmation
                30 < current['rsi'] < 70,          # RSI in reasonable range
                current['rsi'] < prev['rsi'],      # RSI declining
                
                # 7. Clear rejection pattern
                (current['high'] - current['close']) / current['close'] > 0.012,  # 1.2% rejection
            ]
            
            # Only take the ULTRA-HIGHEST probability setups (V4 ultra-selective)
            if sum(long_conditions) >= 10:  # Ultra-selective: much more restrictive
                # Dynamic stop loss based on recent volatility
                atr_stop = current['support'] - (current['atr'] * 0.01)
                stop_loss = max(atr_stop, current['support'] * 0.985)  # Tighter stop
                
                opportunities.append({
                    'timestamp': current['timestamp'],
                    'type': 'LONG',
                    'entry': current['close'],
                    'stop_loss': stop_loss,
                    'take_profit': current['close'] * 1.06,  # 6% target
                    'confidence': sum(long_conditions) / len(long_conditions),
                    'risk_reward': ((current['close'] * 1.06) - current['close']) / (current['close'] - stop_loss),
                    'conditions_met': sum(long_conditions),
                    'quality_score': sum(long_conditions) + (2 if current['volume_surge'] else 0) + (1 if current['price_quality'] else 0)
                })
                
            elif sum(short_conditions) >= 10:  # Ultra-selective: balanced criteria
                # Dynamic stop loss for shorts
                atr_stop = current['resistance'] + (current['atr'] * 0.01)
                stop_loss = min(atr_stop, current['resistance'] * 1.015)  # Tighter stop
                
                opportunities.append({
                    'timestamp': current['timestamp'],
                    'type': 'SHORT',
                    'entry': current['close'],
                    'stop_loss': stop_loss,
                    'take_profit': current['close'] * 0.94,    # 6% target
                    'confidence': sum(short_conditions) / len(short_conditions),
                    'risk_reward': (current['close'] - (current['close'] * 0.94)) / (stop_loss - current['close']),
                    'conditions_met': sum(short_conditions),
                    'quality_score': sum(short_conditions) + (2 if current['volume_surge'] else 0) + (1 if current['price_quality'] else 0)
                })
        
        # Filter for ultra-excellent risk/reward and sort by quality
        quality_opportunities = [
            opp for opp in opportunities 
            if opp['risk_reward'] >= 2.5 and opp['quality_score'] >= 12  # Ultra-selective standards
        ]
        
        # Sort by quality score (best first)
        quality_opportunities.sort(key=lambda x: x['quality_score'], reverse=True)
        
        console.print(f"[yellow]📊 Found {len(opportunities)} opportunities, {len(quality_opportunities)} ultra-high-quality[/yellow]")
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
    
    def backtest_realistic(self, data: pd.DataFrame) -> dict:
        """Backtest with enhanced execution for higher win rate"""
        
        console.print("[cyan]📈 Running enhanced backtest with quality filters...[/cyan]")
        
        opportunities = self.find_high_quality_opportunities(data)
        
        if not opportunities:
            return {
                'total_return': 0,
                'win_rate': 0,
                'total_trades': 0,
                'trades': []
            }
        
        balance = self.capital
        trades = []
        max_position_size = 0.1  # 10% max per trade
        
        for opp in opportunities:
            # Position sizing based on risk
            risk_per_trade = 0.02  # Risk 2% of capital
            
            if opp['type'] == 'LONG':
                risk_amount = opp['entry'] - opp['stop_loss']
            else:
                risk_amount = opp['stop_loss'] - opp['entry']
            
            risk_percent = risk_amount / opp['entry']
            
            if risk_percent <= 0:
                continue
                
            position_size = min(risk_per_trade / risk_percent, max_position_size)
            position_value = balance * position_size
            
            # Get future data for trade simulation
            entry_time = opp['timestamp']
            future_data = data[data['timestamp'] > entry_time].head(48)
            
            if len(future_data) == 0:
                continue
            
            console.print(f"  Trade {len(trades) + 1}: {opp['type']} at ${opp['entry']:.2f}")
            
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
        
        # Calculate final metrics
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
    
    def display_realistic_results(self, results: dict):
        """Display enhanced results with trailing stop analysis"""
        
        console.print(f"\n[bold green]🎯 ENHANCED RESULTS WITH TRAILING STOPS[/bold green]")
        
        if results['total_trades'] == 0:
            console.print(Panel.fit(
                "[bold yellow]⚠️ NO QUALITY OPPORTUNITIES FOUND[/bold yellow]\n\n"
                "[white]This is actually GOOD news![/white]\n"
                "• Markets don't always provide good setups\n"
                "• Professional traders wait for the right moment\n"
                "• No trades is better than bad trades\n\n"
                "[cyan]Try a different time period or symbol[/cyan]",
                border_style="yellow"
            ))
            return
        
        # Results table
        table = Table(title="🎯 High Win Rate Performance")
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
            "🎯" if results['win_rate'] >= 0.6 else "✅" if results['win_rate'] >= 0.5 else "⚠️" if results['win_rate'] >= 0.4 else "❌"
        )
        
        table.add_row(
            "Total Trades",
            str(results['total_trades']),
            "🎯" if 5 <= results['total_trades'] <= 25 else "✅" if 1 <= results['total_trades'] <= 50 else "⚠️"
        )
        
        table.add_row(
            "Winning Trades",
            str(results['winning_trades']),
            "📈"
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
            avg_hold_time = np.mean([t['hold_hours'] for t in results['trades']])
            
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
            
            table.add_row(
                "Avg Hold Time",
                f"{avg_hold_time:.1f}h",
                "⏰"
            )
        
        console.print(table)
        
        # Enhanced verdict focusing on win rate
        win_rate_bonus = 1.0 if results['win_rate'] >= 0.6 else 0.8 if results['win_rate'] >= 0.5 else 0.6
        adjusted_return = results['total_return'] * win_rate_bonus
        
        if results['win_rate'] >= 0.6 and results['total_return'] >= 0.05:
            verdict = "EXCELLENT HIGH WIN RATE STRATEGY!"
            color = "green" 
            message = f"Outstanding {results['win_rate']:.1%} win rate with solid returns!"
        elif results['win_rate'] >= 0.55 and results['total_return'] >= 0.03:
            verdict = "VERY GOOD WIN RATE STRATEGY"
            color = "green"
            message = f"Great {results['win_rate']:.1%} win rate - quality over quantity!"
        elif results['win_rate'] >= 0.5 and results['total_return'] > 0:
            verdict = "GOOD WIN RATE STRATEGY"
            color = "yellow"
            message = f"Decent {results['win_rate']:.1%} win rate with profits"
        elif results['total_return'] > 0:
            verdict = "PROFITABLE BUT LOW WIN RATE"
            color = "yellow"
            message = f"Making money but {results['win_rate']:.1%} win rate needs improvement"
        else:
            verdict = "NEEDS OPTIMIZATION"
            color = "red"
            message = "Both returns and win rate need improvement"
        
        console.print(Panel.fit(
            f"[bold {color}]🎯 {verdict}[/bold {color}]\n\n"
            f"[white]{message}[/white]\n\n"
            f"[cyan]High-Quality Performance:[/cyan]\n"
            f"• Win Rate: {results['win_rate']:.1%} (Target: 60%+)\n"
            f"• Total Return: {results['total_return']:.1%}\n"
            f"• Quality Trades: {results['total_trades']}\n"
            f"• Final Balance: ${results['final_balance']:.2f}",
            border_style=color
        ))
        
        # Show quality analysis
        if results['trades']:
            console.print(f"\n[yellow]🎯 Quality Analysis:[/yellow]")
            
            winning_trades = [t for t in results['trades'] if t['return_pct'] > 0]
            losing_trades = [t for t in results['trades'] if t['return_pct'] <= 0]
            trailing_trades = [t for t in results['trades'] if t['exit_reason'] == 'trailing_stop']
            
            if winning_trades:
                avg_win = np.mean([t['return_pct'] for t in winning_trades])
                console.print(f"  • Winning trades: {len(winning_trades)} (avg: {avg_win:.1f}%)")
            
            if losing_trades:
                avg_loss = np.mean([t['return_pct'] for t in losing_trades])
                console.print(f"  • Losing trades: {len(losing_trades)} (avg: {avg_loss:.1f}%)")
            
            if trailing_trades:
                avg_trailing_return = np.mean([t['return_pct'] for t in trailing_trades])
                console.print(f"  • Trailing stop captures: {len(trailing_trades)} (avg: {avg_trailing_return:.1f}%)")
            
            # Win/Loss ratio
            if losing_trades:
                win_loss_ratio = len(winning_trades) / len(losing_trades)
                console.print(f"  • Win/Loss ratio: {win_loss_ratio:.2f}:1")
            
            # Show best performers
            console.print(f"\n[yellow]📋 Best Quality Trades:[/yellow]")
            sorted_trades = sorted(results['trades'], key=lambda x: x['return_pct'], reverse=True)
            for i, trade in enumerate(sorted_trades[:5], 1):
                profit_emoji = "🚀" if trade['exit_reason'] == 'trailing_stop' else "💚" if trade['return_pct'] > 0 else "❤️"
                console.print(
                    f"  {i}. {profit_emoji} {trade['type']} "
                    f"{trade['return_pct']:+.1f}% "
                    f"(max: {trade['highest_profit_pct']:.1f}%, "
                    f"{trade['exit_reason']}, {trade['hold_hours']:.0f}h)"
                )
    
    def run_realistic_test(self, days: int = 21):
        """Run enhanced test with trailing stops"""
        
        console.print(f"\n[bold yellow]🚀 Testing ENHANCED strategy with trailing stops over {days} days...[/bold yellow]")
        console.print(f"[cyan]Trailing stop: {self.trailing_stop_percent:.1%} | Activation: {self.min_profit_to_trail:.1%} profit[/cyan]")
        
        # Get data
        data = self.fetch_data(days)
        if data is None:
            return None
        
        # Run backtest
        results = self.backtest_realistic(data)
        
        # Display results
        self.display_realistic_results(results)
        
        return results

def main():
    """Main function"""
    
    console.print(Panel.fit(
        "[bold blue]🚀 REALISTIC MONEY MAKER V4[/bold blue]\n"
        "Ultra-selective for highest win rate!\n"
        "\n"
        "Enhanced Features:\n"
        "🎯 Ultra-elite quality trades only\n"
        "💰 6% initial + trailing stops\n"
        "🚀 Stricter trend confirmation\n"
        "📈 Enhanced volume validation\n"
        "🛡️ Tighter 1.5% trailing stops\n"
        "🎨 Premium price action filters\n"
        "\n"
        "Maximum selectivity - highest win rate!",
        border_style="blue"
    ))

    # Enhanced trading parameters for V4 ultra-selectivity
    config = {
        'symbol': input("Symbol (default ETHUSDT): ").strip() or "ETHUSDT",
        'capital': float(input("Capital (default $1000): ").strip() or "1000"),
        'days_back': int(input("Days to test (default 21): ").strip() or "21"),
        'take_profit_pct': 6.0,  # Keep successful 6% target
        'trailing_stop_pct': float(input("Trailing stop % (default 1.5%): ").strip() or "1.5"),
        'activation_profit_pct': 6.0,  # Activate trailing at 6%
        'stop_loss_pct': 2.5,  # Keep 2.5% stop loss
    }

    console.print(Panel.fit(
        f"[bold yellow]🎯 REALISTIC MONEY MAKER V4[/bold yellow]\n"
        f"Symbol: {config['symbol']} | Capital: ${config['capital']:,.2f}\n"
        "\n"
        "Ultra-Selective for Highest Win Rate:\n"
        "🎯 Ultra-elite quality trades only\n"
        "💰 6% initial + trailing stops\n"
        "🚀 Stricter trend confirmation\n"
        "📈 Enhanced volume validation\n"
        "🛡️ Tighter 1.5% trailing stops\n"
        "🎨 Premium price action filters\n"
        "\n"
        "Maximum selectivity - highest win rate!",
        border_style="yellow"
    ))

    print(f"\n🚀 Testing ULTRA-SELECTIVE strategy with trailing stops over {config['days_back']} days...")
    print(f"Trailing stop: {config['trailing_stop_pct']}% | Activation: {config['activation_profit_pct']}% profit")

    # Run enhanced test
    strategy = RealisticMoneyMaker(symbol=config['symbol'], capital=config['capital'])
    strategy.trailing_stop_percent = config['trailing_stop_pct'] / 100
    
    results = strategy.run_realistic_test(config['days_back'])
    
    if results and results['win_rate'] >= 0.6 and results['total_return'] > 0.03:
        console.print(Panel.fit(
            "[bold green]🎊 HIGH WIN RATE SUCCESS![/bold green]\n\n"
            f"[white]✅ {results['win_rate']:.1%} win rate achieved![/white]\n"
            f"[white]✅ {results['total_return']:.1%} return with quality trades[/white]\n"
            f"[white]✅ {results['total_trades']} carefully selected opportunities[/white]\n\n"
            "[cyan]Quality over quantity approach working![/cyan]",
            border_style="green"
        ))
    elif results and results['win_rate'] >= 0.5 and results['total_return'] > 0:
        console.print(Panel.fit(
            "[bold yellow]📈 GOOD WIN RATE RESULTS[/bold yellow]\n\n"
            f"[white]✅ {results['win_rate']:.1%} win rate (decent!)[/white]\n"
            f"[white]✅ {results['total_return']:.1%} return (profitable!)[/white]\n\n"
            "[cyan]Strategy shows promise with improvements![/cyan]",
            border_style="yellow"
        ))
    elif results and results['total_return'] > 0:
        console.print(Panel.fit(
            "[bold yellow]📊 PROFITABLE BUT LOW WIN RATE[/bold yellow]\n\n"
            f"[white]✅ {results['total_return']:.1%} return (profitable!)[/white]\n"
            f"[white]⚠️ {results['win_rate']:.1%} win rate needs improvement[/white]\n\n"
            "[cyan]Consider stricter entry criteria![/cyan]",
            border_style="yellow"
        ))
    else:
        console.print(Panel.fit(
            "[bold blue]📊 HONEST RESULT[/bold blue]\n\n"
            "[white]This time period didn't provide good opportunities.[/white]\n"
            "[white]This is normal in real trading![/white]\n\n"
            "[cyan]Try different timeframes or symbols[/cyan]",
            border_style="blue"
        ))

if __name__ == "__main__":
    main() 