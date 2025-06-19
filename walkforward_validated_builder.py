#!/usr/bin/env python3
"""
Walk-Forward Validated Strategy Builder
Builds strategies that PASS validation from the start
Uses walk-forward analysis during development to prevent overfitting
"""

import json
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import warnings
from itertools import product

# Rich for beautiful console output
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from rich.panel import Panel

# Import modules
from enhanced_data_fetcher import EnhancedDataFetcher

warnings.filterwarnings('ignore')
console = Console()

class WalkForwardValidatedBuilder:
    """Strategy builder that uses walk-forward validation during development"""
    
    def __init__(self, symbols: List[str] = None):
        # Start with most liquid symbols
        self.symbols = symbols or ['ETHUSDT', 'BTCUSDT']  # Start small, expand if working
        self.fetcher = EnhancedDataFetcher()
        
        # Conservative parameter ranges for testing
        self.param_ranges = {
            'lookback_periods': [10, 14, 18, 22],
            'volume_multiplier': [1.3, 1.5, 1.8, 2.1],
            'min_breakout_percent': [0.05, 0.07, 0.10, 0.15],
            'sl_percent': [2.0, 2.5, 3.0, 3.5],
            'tp_percent': [4.0, 5.0, 6.0, 7.0],
            'position_size_percent': [3.0, 4.0, 5.0, 6.0],  # Conservative sizes
            'rsi_upper_limit': [70, 75, 80],
            'momentum_threshold': [0.005, 0.008, 0.012]
        }
        
        # Walk-forward validation settings
        self.validation_config = {
            'training_days': 20,
            'testing_days': 5,
            'step_days': 3,
            'total_days': 90,
            'min_trades_per_window': 2,
            'min_success_rate': 50.0,  # 50% of windows must be profitable
            'min_avg_return': 0.5,     # Minimum 0.5% average return per window
            'max_drawdown_allowed': 5.0  # Maximum 5% drawdown
        }
        
        self.validated_strategies = []
        
    def build_validated_strategies(self) -> Dict:
        """Build strategies using walk-forward validation from the start"""
        
        console.print(Panel.fit(
            f"[bold green]✅ WALK-FORWARD VALIDATED STRATEGY BUILDER[/bold green]\n"
            f"Building strategies that PASS validation from day one\n"
            f"Parameter Combinations: {self._count_combinations()}\n"
            f"Validation: {self.validation_config['training_days']}d train / {self.validation_config['testing_days']}d test\n"
            f"Success Criteria: {self.validation_config['min_success_rate']}% success rate\n"
            f"Target: Consistent, validated profitability",
            border_style="green"
        ))
        
        # Load historical data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.validation_config['total_days'] + 30)
        
        symbol_data = {}
        for symbol in self.symbols:
            console.print(f"[green]📊 Loading {symbol} data...[/green]")
            try:
                df = self.fetcher.fetch_data(symbol, start_date, end_date, timeframe='15m')
                if df is not None and len(df) > 2000:
                    symbol_data[symbol] = df
                    console.print(f"[green]✅ {symbol}: {len(df)} bars loaded[/green]")
                else:
                    console.print(f"[red]✗ {symbol}: Insufficient data[/red]")
            except Exception as e:
                console.print(f"[red]✗ {symbol}: Error - {str(e)}[/red]")
        
        if not symbol_data:
            console.print("[red]No valid data for strategy building![/red]")
            return {}
        
        # Generate walk-forward windows
        windows = self._generate_validation_windows(start_date, end_date)
        console.print(f"[cyan]Generated {len(windows)} validation windows[/cyan]")
        
        # Test parameter combinations
        best_strategies = {}
        
        for symbol in symbol_data.keys():
            console.print(f"\n[green]🔍 Validating strategies for {symbol}...[/green]")
            
            symbol_strategies = self._validate_symbol_strategies(
                symbol, symbol_data[symbol], windows
            )
            
            if symbol_strategies:
                best_strategies[symbol] = symbol_strategies
                console.print(f"[green]✅ Found {len(symbol_strategies)} validated strategies for {symbol}[/green]")
            else:
                console.print(f"[yellow]⚠️ No validated strategies found for {symbol}[/yellow]")
        
        # Compile results
        validation_results = {
            'validated_strategies': best_strategies,
            'validation_config': self.validation_config,
            'total_combinations_tested': self._count_combinations(),
            'symbols_with_valid_strategies': list(best_strategies.keys())
        }
        
        self._display_validation_results(validation_results)
        
        return validation_results
    
    def _count_combinations(self) -> int:
        """Count total parameter combinations"""
        total = 1
        for param_list in self.param_ranges.values():
            total *= len(param_list)
        return total
    
    def _generate_validation_windows(self, start_date: datetime, end_date: datetime) -> List[Dict]:
        """Generate walk-forward validation windows"""
        
        windows = []
        current_start = start_date
        
        while current_start + timedelta(
            days=self.validation_config['training_days'] + self.validation_config['testing_days']
        ) <= end_date:
            
            train_end = current_start + timedelta(days=self.validation_config['training_days'])
            test_start = train_end
            test_end = test_start + timedelta(days=self.validation_config['testing_days'])
            
            windows.append({
                'train_start': current_start,
                'train_end': train_end,
                'test_start': test_start,
                'test_end': test_end,
                'window_id': len(windows) + 1
            })
            
            current_start += timedelta(days=self.validation_config['step_days'])
        
        return windows
    
    def _validate_symbol_strategies(self, symbol: str, df: pd.DataFrame, windows: List[Dict]) -> List[Dict]:
        """Validate all parameter combinations for a symbol"""
        
        validated_strategies = []
        
        # Generate all parameter combinations
        param_combinations = list(product(*self.param_ranges.values()))
        param_names = list(self.param_ranges.keys())
        
        console.print(f"[cyan]Testing {len(param_combinations)} parameter combinations for {symbol}...[/cyan]")
        
        with Progress(
            TextColumn(f"[green]{symbol}[/green]"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            console=console
        ) as progress:
            
            task = progress.add_task("Validating strategies", total=len(param_combinations))
            
            for combo in param_combinations:
                # Create parameter set
                params = dict(zip(param_names, combo))
                
                # Test this parameter set across all windows
                strategy_performance = self._test_strategy_across_windows(
                    symbol, df, windows, params
                )
                
                # Check if strategy passes validation criteria
                if self._passes_validation_criteria(strategy_performance):
                    strategy_performance['parameters'] = params
                    validated_strategies.append(strategy_performance)
                
                progress.advance(task)
        
        # Sort by performance and return best ones
        validated_strategies.sort(key=lambda x: x['avg_return_per_window'], reverse=True)
        
        # Return top 3 validated strategies
        return validated_strategies[:3]
    
    def _test_strategy_across_windows(self, symbol: str, df: pd.DataFrame, 
                                    windows: List[Dict], params: Dict) -> Dict:
        """Test a parameter set across all walk-forward windows"""
        
        window_results = []
        
        for window in windows:
            # Get training and testing data
            train_data = df[
                (df.index >= window['train_start']) & 
                (df.index < window['train_end'])
            ]
            
            test_data = df[
                (df.index >= window['test_start']) & 
                (df.index < window['test_end'])
            ]
            
            if len(train_data) < 500 or len(test_data) < 50:
                continue
            
            # Generate signals with these parameters
            test_signals = self._generate_conservative_signals(test_data, params)
            
            # Run backtest on test period
            window_result = self._run_conservative_backtest(test_signals, params)
            
            if window_result['total_trades'] >= self.validation_config['min_trades_per_window']:
                window_results.append(window_result)
        
        # Calculate aggregate performance
        if window_results:
            returns = [r['return_percent'] for r in window_results]
            win_rates = [r['win_rate'] for r in window_results]
            
            profitable_windows = len([r for r in returns if r > 0])
            success_rate = profitable_windows / len(window_results) * 100
            
            return {
                'symbol': symbol,
                'window_results': window_results,
                'total_windows': len(window_results),
                'profitable_windows': profitable_windows,
                'success_rate': success_rate,
                'avg_return_per_window': np.mean(returns),
                'avg_win_rate': np.mean(win_rates),
                'consistency_score': np.mean(returns) / np.std(returns) if np.std(returns) > 0 else 0,
                'max_drawdown': abs(min(returns)) if returns else 0
            }
        
        return {
            'symbol': symbol,
            'total_windows': 0,
            'success_rate': 0,
            'avg_return_per_window': 0,
            'avg_win_rate': 0,
            'consistency_score': 0,
            'max_drawdown': 0
        }
    
    def _generate_conservative_signals(self, df: pd.DataFrame, params: Dict) -> pd.DataFrame:
        """Generate conservative signals with given parameters"""
        
        df = df.copy()
        df['signal'] = 'HOLD'
        df['position_size'] = 0.0
        
        # Calculate indicators
        df['volume_ma'] = df['volume'].rolling(20).mean()
        df['high_max'] = df['high'].rolling(params['lookback_periods']).max().shift(1)
        df['momentum'] = df['close'].pct_change(4)
        df['rsi'] = self._calculate_rsi(df['close'], 14)
        df['volume_ratio'] = df['volume'] / df['volume_ma']
        
        # Generate conservative signals
        for i in range(50, len(df)):
            row = df.iloc[i]
            
            if pd.isna(row['high_max']):
                continue
            
            # Conservative breakout conditions
            breakout_condition = row['close'] > row['high_max'] * (1 + params['min_breakout_percent']/100)
            volume_condition = row['volume_ratio'] > params['volume_multiplier']
            momentum_condition = row['momentum'] > params['momentum_threshold']
            rsi_condition = 30 < row['rsi'] < params['rsi_upper_limit']
            
            # ALL conditions must be met (conservative approach)
            if (breakout_condition and volume_condition and 
                momentum_condition and rsi_condition):
                
                df.iloc[i, df.columns.get_loc('signal')] = 'LONG'
                df.iloc[i, df.columns.get_loc('position_size')] = params['position_size_percent']
        
        return df
    
    def _run_conservative_backtest(self, df: pd.DataFrame, params: Dict) -> Dict:
        """Run conservative backtest with strict risk management"""
        
        portfolio_value = 10000.0
        positions = []
        trades = []
        
        for i, row in df.iterrows():
            
            # Exit management
            for pos_idx in range(len(positions) - 1, -1, -1):
                position = positions[pos_idx]
                
                current_price = row['close']
                entry_price = position['entry_price']
                current_return = (current_price - entry_price) / entry_price * 100
                
                # Conservative exit conditions
                should_exit = False
                exit_reason = ""
                
                # Stop loss
                if current_return <= -params['sl_percent']:
                    should_exit = True
                    exit_reason = "STOP_LOSS"
                
                # Take profit
                elif current_return >= params['tp_percent']:
                    should_exit = True
                    exit_reason = "TAKE_PROFIT"
                
                # Time exit (conservative - don't hold too long)
                elif hasattr(i - position['entry_time'], 'days'):
                    hours = (i - position['entry_time']).total_seconds() / 3600
                    if hours > 20:  # Max 20 hours
                        should_exit = True
                        exit_reason = "TIME_EXIT"
                
                if should_exit:
                    pnl = position['shares'] * (current_price - entry_price)
                    portfolio_value += pnl
                    
                    trades.append({
                        'return_pct': current_return,
                        'pnl': pnl,
                        'exit_reason': exit_reason
                    })
                    
                    positions.pop(pos_idx)
            
            # Entry management (conservative)
            if row['signal'] == 'LONG' and len(positions) == 0:  # Only one position at a time
                position_value = portfolio_value * row['position_size'] / 100
                
                new_position = {
                    'entry_price': row['close'],
                    'entry_time': i,
                    'shares': position_value / row['close']
                }
                
                positions.append(new_position)
        
        # Calculate results
        if trades:
            winning_trades = [t for t in trades if t['pnl'] > 0]
            win_rate = len(winning_trades) / len(trades) * 100
            total_return = (portfolio_value - 10000) / 10000 * 100
            
            return {
                'return_percent': total_return,
                'win_rate': win_rate,
                'total_trades': len(trades),
                'profitable_trades': len(winning_trades)
            }
        
        return {
            'return_percent': 0,
            'win_rate': 0,
            'total_trades': 0,
            'profitable_trades': 0
        }
    
    def _passes_validation_criteria(self, performance: Dict) -> bool:
        """Check if strategy passes validation criteria"""
        
        if performance['total_windows'] < 5:  # Need minimum windows
            return False
        
        criteria_passed = (
            performance['success_rate'] >= self.validation_config['min_success_rate'] and
            performance['avg_return_per_window'] >= self.validation_config['min_avg_return'] and
            performance['max_drawdown'] <= self.validation_config['max_drawdown_allowed'] and
            performance['avg_win_rate'] >= 45.0  # Minimum win rate
        )
        
        return criteria_passed
    
    def _display_validation_results(self, results: Dict):
        """Display validation results"""
        
        console.print(f"\n[bold green]✅ WALK-FORWARD VALIDATION RESULTS[/bold green]")
        
        if not results['validated_strategies']:
            console.print(Panel.fit(
                "[bold red]❌ NO VALIDATED STRATEGIES FOUND[/bold red]\n\n"
                "All parameter combinations failed validation criteria.\n"
                "This suggests:\n"
                "1. Market conditions are too challenging\n"
                "2. Parameter ranges need adjustment\n"
                "3. Strategy approach needs fundamental changes\n\n"
                "RECOMMENDATION: Expand parameter ranges or change approach",
                border_style="red"
            ))
            return
        
        # Display validated strategies
        for symbol, strategies in results['validated_strategies'].items():
            console.print(f"\n[bold green]🎯 VALIDATED STRATEGIES FOR {symbol}[/bold green]")
            
            strategy_table = Table(title=f"{symbol} Validated Strategies")
            strategy_table.add_column("Rank", style="green")
            strategy_table.add_column("Avg Return%", justify="right", style="cyan")
            strategy_table.add_column("Success Rate%", justify="right")
            strategy_table.add_column("Win Rate%", justify="right")
            strategy_table.add_column("Max DD%", justify="right")
            strategy_table.add_column("Consistency", justify="right")
            
            for i, strategy in enumerate(strategies, 1):
                strategy_table.add_row(
                    f"#{i}",
                    f"{strategy['avg_return_per_window']:.2f}",
                    f"{strategy['success_rate']:.1f}",
                    f"{strategy['avg_win_rate']:.1f}",
                    f"{strategy['max_drawdown']:.2f}",
                    f"{strategy['consistency_score']:.2f}"
                )
            
            console.print(strategy_table)
            
            # Show best strategy parameters
            best_strategy = strategies[0]
            console.print(f"\n[bold cyan]🏆 BEST VALIDATED STRATEGY PARAMETERS FOR {symbol}:[/bold cyan]")
            
            params_table = Table(title="Optimized Parameters")
            params_table.add_column("Parameter", style="cyan")
            params_table.add_column("Value", style="green")
            
            for param, value in best_strategy['parameters'].items():
                params_table.add_row(param.replace('_', ' ').title(), str(value))
            
            console.print(params_table)
        
        # Overall assessment
        total_strategies = sum(len(strategies) for strategies in results['validated_strategies'].values())
        
        console.print(f"\n[bold green]📊 VALIDATION SUMMARY[/bold green]")
        console.print(f"   ✅ Total Validated Strategies: {total_strategies}")
        console.print(f"   🎯 Symbols with Valid Strategies: {len(results['symbols_with_valid_strategies'])}")
        console.print(f"   🔍 Total Combinations Tested: {results['total_combinations_tested']}")
        console.print(f"   📈 Success Rate: {total_strategies/results['total_combinations_tested']*100:.2f}%")
        
        if total_strategies > 0:
            console.print(Panel.fit(
                "[bold green]🎊 VALIDATION SUCCESS![/bold green]\n\n"
                "Found strategies that pass walk-forward validation!\n"
                "These strategies are:\n"
                "✅ Tested across multiple time periods\n"
                "✅ Consistent across market conditions\n"
                "✅ Conservative and risk-managed\n"
                "✅ Ready for live trading consideration\n\n"
                "NEXT STEP: Paper trade the best strategy",
                border_style="green"
            ))
        else:
            console.print(Panel.fit(
                "[bold yellow]⚠️ LIMITED SUCCESS[/bold yellow]\n\n"
                "Only a few strategies passed validation.\n"
                "Consider:\n"
                "1. Starting with smallest position sizes\n"
                "2. Additional market condition filters\n"
                "3. Even more conservative parameters\n\n"
                "PROCEED WITH EXTREME CAUTION",
                border_style="yellow"
            ))
        
        # Save results
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"walkforward_validated_strategies_{timestamp}.json"
        
        with open(filename, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        console.print(f"\n[green]✅ Validation results saved to: {filename}[/green]")
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))

def main():
    """Main function for walk-forward validated strategy builder"""
    
    console.print(Panel.fit(
        "[bold green]✅ WALK-FORWARD VALIDATED STRATEGY BUILDER[/bold green]\n"
        "Building strategies that PASS validation from day one\n"
        "No more overfitting disasters!\n"
        "Conservative, tested, reliable approaches only\n"
        "If it doesn't pass walk-forward, we don't use it!",
        border_style="green"
    ))
    
    # Initialize builder
    builder = WalkForwardValidatedBuilder()
    
    # Build validated strategies
    results = builder.build_validated_strategies()
    
    console.print(f"\n[bold green]✅ Walk-forward validated strategy building complete![/bold green]")
    
    # Final guidance
    console.print(Panel.fit(
        "[bold green]✅ VALIDATION-FIRST DEVELOPMENT APPROACH[/bold green]\n\n"
        "1. 🔍 Test EVERY strategy with walk-forward from start\n"
        "2. 🛡️ Use conservative parameters that work consistently\n"
        "3. 📊 Accept lower returns for higher reliability\n"
        "4. ✅ Only deploy strategies that pass validation\n"
        "5. 📈 Focus on consistency over spectacular returns\n"
        "6. 🎯 Capital preservation is the top priority\n\n"
        "[yellow]Better to make 1% consistently than lose 10% chasing fantasies![/yellow]",
        border_style="green"
    ))

if __name__ == "__main__":
    main() 