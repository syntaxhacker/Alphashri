#!/usr/bin/env python3
"""
🚀 SUPER FAST ML STRATEGY
Ultra-lightweight ML that learns in under 30 seconds!

FEATURES:
- Simple decision trees
- Fast feature engineering
- Quick learning cycles
- Immediate results
"""

import sys
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# Simple ML
try:
    from sklearn.tree import DecisionTreeClassifier
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import accuracy_score
    HAS_ML = True
except ImportError:
    HAS_ML = False

# Rich output
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# Data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher

console = Console()

class SuperFastML:
    """Ultra-fast ML trading strategy"""
    
    def __init__(self, symbol: str = "ETHUSDT"):
        self.symbol = symbol
        self.target_return = 0.01  # 1% target (very achievable)
        self.target_win_rate = 0.51  # 51% target (very achievable)
        
        console.print(Panel.fit(
            "[bold blue]🚀 SUPER FAST ML INITIALIZED[/bold blue]\n"
            f"[cyan]Symbol: {symbol}[/cyan]\n\n"
            "[white]Lightning Setup:[/white]\n"
            "• Target: 1% return (achievable!)\n"
            "• Target: 51% win rate (achievable!)\n"
            "• Learning time: <30 seconds\n"
            "• Simple decision trees\n\n"
            "[yellow]⚡ Built for speed and reliability![/yellow]",
            border_style="blue"
        ))
    
    def fetch_data_fast(self, days: int = 30) -> pd.DataFrame:
        """Super fast data fetch"""
        
        console.print(f"[yellow]📊 Fetching {days} days...[/yellow]", end=" ")
        
        fetcher = EnhancedDataFetcher(
            api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
            api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
        )
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        data = fetcher.fetch_data(self.symbol, start_date, end_date, '15m')
        
        if data is not None:
            data.reset_index(inplace=True)
            data.rename(columns={'index': 'timestamp'}, inplace=True)
            console.print(f"[green]✅ {len(data):,} bars[/green]")
            return data
        
        console.print("[red]❌ Failed[/red]")
        return None
    
    def create_simple_features(self, data: pd.DataFrame) -> tuple:
        """Create super simple, reliable features"""
        
        console.print("[cyan]🔧 Creating features...[/cyan]", end=" ")
        
        close = data['close'].values
        volume = data['volume'].values
        
        features = []
        labels = []
        
        # Use only last 500 bars for speed
        start_idx = max(20, len(close) - 500)
        
        for i in range(start_idx, len(close) - 5):
            # Simple features (always 6 features)
            row = [
                # 1. Recent return
                (close[i] - close[i-5]) / close[i-5],
                
                # 2. Short vs long MA
                (np.mean(close[i-3:i+1]) - np.mean(close[i-10:i+1])) / close[i],
                
                # 3. Price position in range
                (close[i] - np.min(close[i-10:i+1])) / (np.max(close[i-10:i+1]) - np.min(close[i-10:i+1]) + 1e-8),
                
                # 4. Volatility
                np.std(close[i-10:i+1]) / close[i],
                
                # 5. Volume ratio
                min(volume[i] / (np.mean(volume[i-5:i+1]) + 1e-8), 3.0),
                
                # 6. Momentum
                (close[i] - close[i-1]) / close[i-1]
            ]
            
            features.append(row)
            
            # Create label (future return)
            future_return = (close[i+3] - close[i]) / close[i]
            
            if future_return > 0.005:  # 0.5% threshold
                labels.append(1)  # BUY
            elif future_return < -0.005:
                labels.append(2)  # SELL
            else:
                labels.append(0)  # HOLD
        
        console.print(f"[green]✅ {len(features)} samples[/green]")
        return np.array(features), np.array(labels)
    
    def train_fast_models(self, X: np.ndarray, y: np.ndarray) -> dict:
        """Train super fast models"""
        
        console.print("[cyan]🧠 Training models...[/cyan]", end=" ")
        
        # Split train/test
        split = int(len(X) * 0.8)
        X_train, X_test = X[:split], X[split:]
        y_train, y_test = y[:split], y[split:]
        
        # Train simple models
        models = {}
        
        # Decision Tree (fastest)
        dt = DecisionTreeClassifier(max_depth=8, random_state=42)
        dt.fit(X_train, y_train)
        dt_score = dt.score(X_test, y_test)
        models['decision_tree'] = {'model': dt, 'score': dt_score}
        
        # Random Forest (still fast)
        rf = RandomForestClassifier(n_estimators=20, max_depth=6, random_state=42)
        rf.fit(X_train, y_train)
        rf_score = rf.score(X_test, y_test)
        models['random_forest'] = {'model': rf, 'score': rf_score}
        
        # Pick best model
        best_name = 'decision_tree' if dt_score > rf_score else 'random_forest'
        best_model = models[best_name]['model']
        best_score = models[best_name]['score']
        
        console.print(f"[green]✅ Best: {best_name} ({best_score:.1%})[/green]")
        
        return {
            'model': best_model,
            'score': best_score,
            'X_test': X_test,
            'y_test': y_test,
            'name': best_name
        }
    
    def backtest_fast(self, model, X_test: np.ndarray, data: pd.DataFrame) -> dict:
        """Super fast backtest"""
        
        console.print("[cyan]📈 Fast backtest...[/cyan]", end=" ")
        
        # Use last portion of data for testing
        test_start = len(data) - len(X_test) - 5
        test_data = data.iloc[test_start:].copy()
        
        predictions = model.predict(X_test)
        
        # Simulate trading
        balance = 10000
        position = None
        entry_price = 0
        trades = []
        
        close_prices = test_data['close'].values
        
        for i, pred in enumerate(predictions[:-3]):  # Leave buffer
            if i >= len(close_prices) - 3:
                break
                
            current_price = close_prices[i]
            
            # Trading logic
            if pred == 1 and position != 'long':  # BUY signal
                if position == 'short':
                    # Close short
                    trade_return = (entry_price - current_price) / entry_price
                    balance *= (1 + trade_return)
                    trades.append(('short', trade_return))
                
                position = 'long'
                entry_price = current_price
                
            elif pred == 2 and position != 'short':  # SELL signal
                if position == 'long':
                    # Close long
                    trade_return = (current_price - entry_price) / entry_price
                    balance *= (1 + trade_return)
                    trades.append(('long', trade_return))
                
                position = 'short'
                entry_price = current_price
        
        # Close final position
        if position and len(close_prices) > 0:
            final_price = close_prices[-1]
            if position == 'long':
                trade_return = (final_price - entry_price) / entry_price
            else:
                trade_return = (entry_price - final_price) / entry_price
            
            balance *= (1 + trade_return)
            trades.append((position, trade_return))
        
        # Calculate metrics
        total_return = (balance - 10000) / 10000
        total_trades = len(trades)
        winning_trades = len([t for t in trades if t[1] > 0])
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        console.print(f"[green]✅ {total_return:.1%} return, {win_rate:.1%} win rate[/green]")
        
        return {
            'total_return': total_return,
            'win_rate': win_rate,
            'total_trades': total_trades,
            'trades': trades
        }
    
    def run_super_fast_learning(self, days: int = 30) -> dict:
        """Complete fast learning in under 30 seconds"""
        
        console.print(f"\n[bold green]🚀 SUPER FAST ML LEARNING STARTED[/bold green]")
        
        start_time = datetime.now()
        
        # 1. Fetch data (5 seconds)
        data = self.fetch_data_fast(days)
        if data is None:
            return {'error': 'No data'}
        
        # 2. Create features (2 seconds)
        X, y = self.create_simple_features(data)
        
        if len(X) < 50:
            console.print("[red]❌ Not enough data for learning[/red]")
            return {'error': 'Insufficient data'}
        
        # 3. Train models (10 seconds)
        training_results = self.train_fast_models(X, y)
        
        # 4. Backtest (5 seconds)
        backtest_results = self.backtest_fast(
            training_results['model'], 
            training_results['X_test'], 
            data
        )
        
        # 5. Analyze results
        elapsed = (datetime.now() - start_time).total_seconds()
        
        success = (backtest_results['total_return'] >= self.target_return and 
                  backtest_results['win_rate'] >= self.target_win_rate)
        
        # Display results
        self.display_super_fast_results(training_results, backtest_results, elapsed, success)
        
        return {
            'success': success,
            'training': training_results,
            'backtest': backtest_results,
            'elapsed_seconds': elapsed
        }
    
    def display_super_fast_results(self, training: dict, backtest: dict, elapsed: float, success: bool):
        """Display super fast results"""
        
        console.print(f"\n[bold green]⚡ SUPER FAST RESULTS[/bold green]")
        
        # Performance table
        table = Table(title="🚀 Lightning ML Performance")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", style="green")
        table.add_column("Target", style="yellow")
        table.add_column("Status", justify="center")
        
        table.add_row(
            "Model Accuracy",
            f"{training['score']:.1%}",
            "60%+",
            "✅" if training['score'] >= 0.6 else "⚠️"
        )
        
        table.add_row(
            "Total Return",
            f"{backtest['total_return']:.1%}",
            f"{self.target_return:.1%}",
            "✅" if backtest['total_return'] >= self.target_return else "❌"
        )
        
        table.add_row(
            "Win Rate",
            f"{backtest['win_rate']:.1%}",
            f"{self.target_win_rate:.1%}",
            "✅" if backtest['win_rate'] >= self.target_win_rate else "❌"
        )
        
        table.add_row(
            "Total Trades",
            str(backtest['total_trades']),
            "5+",
            "✅" if backtest['total_trades'] >= 5 else "⚠️"
        )
        
        table.add_row(
            "Learning Time",
            f"{elapsed:.1f}s",
            "<30s",
            "✅" if elapsed < 30 else "⚠️"
        )
        
        console.print(table)
        
        # Final verdict
        color = "green" if success else "yellow"
        status = "PROFITABLE STRATEGY READY!" if success else "NEEDS PARAMETER TUNING"
        
        console.print(Panel.fit(
            f"[bold {color}]⚡ SUPER FAST ML: {status}[/bold {color}]\n\n"
            f"[white]Model: {training['name']} ({training['score']:.1%} accuracy)[/white]\n"
            f"[white]Performance: {backtest['total_return']:.1%} return, {backtest['win_rate']:.1%} win rate[/white]\n"
            f"[white]Speed: {elapsed:.1f} seconds (target: <30s)[/white]\n"
            f"[white]Trades: {backtest['total_trades']} signals generated[/white]\n\n"
            f"[cyan]✨ {'This strategy is ready to trade!' if success else 'Try different parameters or timeframes'}[/cyan]",
            border_style=color
        ))

def main():
    """Main function"""
    
    if not HAS_ML:
        console.print("[red]❌ Install: pip install scikit-learn[/red]")
        return
    
    console.print(Panel.fit(
        "[bold gold3]⚡ SUPER FAST ML STRATEGY[/bold gold3]\n"
        "[cyan]Machine learning that learns in under 30 seconds![/cyan]\n\n"
        "[white]Ultra-Fast Features:[/white]\n"
        "🚀 <30 second learning time\n"
        "🎯 Simple decision trees\n"
        "✅ 1% return target (achievable)\n"
        "📊 Instant backtesting\n"
        "🏆 Immediate results",
        border_style="gold3"
    ))
    
    # User input
    symbol = input("\nSymbol (default ETHUSDT): ").strip().upper() or "ETHUSDT"
    if not symbol.endswith('USDT'):
        symbol += 'USDT'
    
    days_input = input("Training days (default 30): ").strip()
    days = int(days_input) if days_input.isdigit() else 30
    
    # Run super fast strategy
    strategy = SuperFastML(symbol=symbol)
    
    console.print(f"\n[bold yellow]⚡ Starting super fast learning on {symbol}...[/bold yellow]")
    console.print(f"[white]Expected completion: <30 seconds[/white]")
    
    try:
        results = strategy.run_super_fast_learning(days)
        
        if 'error' in results:
            console.print(f"[red]❌ {results['error']}[/red]")
        else:
            if results['success']:
                console.print(Panel.fit(
                    "[bold green]🎊 SUCCESS! PROFITABLE STRATEGY CREATED![/bold green]\n\n"
                    f"[white]✅ Learning completed in {results['elapsed_seconds']:.1f} seconds[/white]\n"
                    f"[white]✅ Strategy meets profitability targets[/white]\n"
                    f"[white]✅ Ready for live trading[/white]\n\n"
                    "[cyan]⚡ This is the fastest way to create a profitable ML strategy![/cyan]",
                    border_style="green"
                ))
            else:
                console.print(Panel.fit(
                    "[bold yellow]⚠️ STRATEGY CREATED (needs tuning)[/bold yellow]\n\n"
                    f"[white]✅ Learning completed in {results['elapsed_seconds']:.1f} seconds[/white]\n"
                    f"[white]⚠️ Doesn't quite meet targets yet[/white]\n"
                    f"[white]💡 Try different timeframes or parameters[/white]\n\n"
                    "[cyan]Still much faster than other approaches![/cyan]",
                    border_style="yellow"
                ))
    
    except Exception as e:
        console.print(f"[red]❌ Error: {str(e)}[/red]")

if __name__ == "__main__":
    main() 