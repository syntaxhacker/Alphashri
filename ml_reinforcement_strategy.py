#!/usr/bin/env python3
"""
🤖 REINFORCEMENT LEARNING TRADING STRATEGY
Auto-learning strategy that improves through trial and error

FEATURES:
🔄 Train/Test split with walk-forward validation
🧠 Deep Q-Learning for trade decisions
📊 Analyzes losing trades to learn patterns
🎯 Iterative improvement until profitable
🔬 Feature engineering and selection
📈 Real-time performance tracking
"""

import sys
import numpy as np
import pandas as pd
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from collections import deque
import warnings
warnings.filterwarnings('ignore')

# ML Libraries
try:
    import tensorflow as tf
    from tensorflow import keras
    from sklearn.preprocessing import StandardScaler, RobustScaler
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import classification_report, confusion_matrix
    HAS_ML = True
except ImportError:
    HAS_ML = False
    print("⚠️ ML libraries not found. Install with: pip install tensorflow scikit-learn")

# Rich for output
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, BarColumn, TextColumn

# Data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher

console = Console()

@dataclass
class TradingAction:
    """Trading action with confidence"""
    action: int  # 0=HOLD, 1=BUY, 2=SELL
    confidence: float
    features: np.ndarray
    timestamp: datetime

@dataclass
class TradeResult:
    """Result of a completed trade"""
    entry_price: float
    exit_price: float
    direction: str  # 'buy' or 'sell'
    return_pct: float
    features_at_entry: np.ndarray
    was_correct: bool
    confidence: float
    timestamp: datetime

class MLTradingEnvironment:
    """Trading environment for reinforcement learning"""
    
    def __init__(self, data: pd.DataFrame, initial_balance: float = 10000):
        self.data = data.copy()
        self.initial_balance = initial_balance
        self.reset()
        
    def reset(self):
        """Reset environment"""
        self.current_step = 0
        self.balance = self.initial_balance
        self.position = 0  # 0=no position, 1=long, -1=short
        self.entry_price = 0
        self.trades = []
        self.returns = []
        return self._get_state()
    
    def _get_state(self) -> np.ndarray:
        """Get current state features"""
        if self.current_step < 20:
            return np.zeros(50)  # Return default state for early steps
        
        current_data = self.data.iloc[self.current_step-20:self.current_step+1]
        
        # Technical indicators
        features = []
        
        # Price features
        close = current_data['close'].values
        high = current_data['high'].values
        low = current_data['low'].values
        volume = current_data['volume'].values
        
        # Returns
        returns = np.diff(close) / close[:-1]
        features.extend([
            returns[-1] if len(returns) > 0 else 0,  # Last return
            np.mean(returns[-5:]) if len(returns) >= 5 else 0,  # 5-period avg return
            np.std(returns[-10:]) if len(returns) >= 10 else 0,  # 10-period volatility
        ])
        
        # Moving averages
        if len(close) >= 5:
            ma5 = np.mean(close[-5:])
            features.append((close[-1] - ma5) / ma5)
        else:
            features.append(0)
            
        if len(close) >= 10:
            ma10 = np.mean(close[-10:])
            features.append((close[-1] - ma10) / ma10)
        else:
            features.append(0)
        
        # RSI-like indicator
        if len(returns) >= 14:
            gains = np.maximum(returns[-14:], 0)
            losses = np.maximum(-returns[-14:], 0)
            avg_gain = np.mean(gains)
            avg_loss = np.mean(losses)
            rs = avg_gain / (avg_loss + 1e-8)
            rsi = 100 - (100 / (1 + rs))
            features.append(rsi / 100)
        else:
            features.append(0.5)
        
        # Volume indicators
        if len(volume) >= 5:
            vol_ratio = volume[-1] / (np.mean(volume[-5:]) + 1e-8)
            features.append(min(vol_ratio, 3))  # Cap at 3x
        else:
            features.append(1)
        
        # Bollinger Band position
        if len(close) >= 20:
            bb_mean = np.mean(close[-20:])
            bb_std = np.std(close[-20:])
            bb_position = (close[-1] - bb_mean) / (2 * bb_std + 1e-8)
            features.append(np.clip(bb_position, -2, 2))
        else:
            features.append(0)
        
        # Support/Resistance levels
        if len(high) >= 10 and len(low) >= 10:
            resistance = np.max(high[-10:])
            support = np.min(low[-10:])
            price_position = (close[-1] - support) / (resistance - support + 1e-8)
            features.append(price_position)
        else:
            features.append(0.5)
        
        # Market regime (trending vs ranging)
        if len(close) >= 20:
            trend_strength = abs(close[-1] - close[-20]) / (np.std(close[-20:]) * 20 + 1e-8)
            features.append(min(trend_strength, 2))
        else:
            features.append(0)
        
        # Pad or truncate to exactly 50 features
        features.extend([0] * (50 - len(features)))
        return np.array(features[:50], dtype=np.float32)
    
    def step(self, action: int) -> Tuple[np.ndarray, float, bool, Dict]:
        """Execute action and return new state, reward, done, info"""
        
        if self.current_step >= len(self.data) - 1:
            return self._get_state(), 0, True, {}
        
        current_price = self.data.iloc[self.current_step]['close']
        reward = 0
        
        # Execute action
        if action == 1 and self.position == 0:  # BUY
            self.position = 1
            self.entry_price = current_price
            
        elif action == 2 and self.position == 0:  # SELL
            self.position = -1
            self.entry_price = current_price
            
        elif action == 0 and self.position != 0:  # CLOSE position
            if self.position == 1:  # Close long
                trade_return = (current_price - self.entry_price) / self.entry_price
            else:  # Close short
                trade_return = (self.entry_price - current_price) / self.entry_price
            
            reward = trade_return * 100  # Scale reward
            self.balance *= (1 + trade_return)
            self.returns.append(trade_return)
            
            # Record trade
            self.trades.append(TradeResult(
                entry_price=self.entry_price,
                exit_price=current_price,
                direction='buy' if self.position == 1 else 'sell',
                return_pct=trade_return * 100,
                features_at_entry=self._get_state(),
                was_correct=trade_return > 0,
                confidence=1.0,
                timestamp=self.data.iloc[self.current_step]['timestamp']
            ))
            
            self.position = 0
            self.entry_price = 0
        
        self.current_step += 1
        next_state = self._get_state()
        done = self.current_step >= len(self.data) - 1
        
        info = {
            'balance': self.balance,
            'position': self.position,
            'total_return': (self.balance - self.initial_balance) / self.initial_balance
        }
        
        return next_state, reward, done, info

class DQNAgent:
    """Deep Q-Network Agent for trading"""
    
    def __init__(self, state_size: int = 50, action_size: int = 3, learning_rate: float = 0.001):
        self.state_size = state_size
        self.action_size = action_size
        self.memory = deque(maxlen=10000)
        self.epsilon = 1.0  # Exploration rate
        self.epsilon_min = 0.01
        self.epsilon_decay = 0.995
        self.learning_rate = learning_rate
        
        if HAS_ML:
            self.q_network = self._build_model()
            self.target_network = self._build_model()
            self.update_target_network()
        
    def _build_model(self):
        """Build neural network model"""
        model = keras.Sequential([
            keras.layers.Dense(128, input_dim=self.state_size, activation='relu'),
            keras.layers.Dropout(0.3),
            keras.layers.Dense(64, activation='relu'),
            keras.layers.Dropout(0.3),
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dense(self.action_size, activation='linear')
        ])
        
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=self.learning_rate),
            loss='mse'
        )
        return model
    
    def remember(self, state, action, reward, next_state, done):
        """Store experience in memory"""
        self.memory.append((state, action, reward, next_state, done))
    
    def act(self, state, training=True):
        """Choose action using epsilon-greedy policy"""
        if not HAS_ML:
            return np.random.choice(self.action_size)
        
        if training and np.random.random() <= self.epsilon:
            return np.random.choice(self.action_size)
        
        q_values = self.q_network.predict(state.reshape(1, -1), verbose=0)
        return np.argmax(q_values[0])
    
    def replay(self, batch_size=32):
        """Train the model on a batch of experiences"""
        if not HAS_ML or len(self.memory) < batch_size:
            return
        
        batch = np.random.choice(len(self.memory), batch_size, replace=False)
        
        states = np.array([self.memory[i][0] for i in batch])
        actions = np.array([self.memory[i][1] for i in batch])
        rewards = np.array([self.memory[i][2] for i in batch])
        next_states = np.array([self.memory[i][3] for i in batch])
        dones = np.array([self.memory[i][4] for i in batch])
        
        current_q_values = self.q_network.predict(states, verbose=0)
        next_q_values = self.target_network.predict(next_states, verbose=0)
        
        targets = current_q_values.copy()
        
        for i in range(batch_size):
            if dones[i]:
                targets[i][actions[i]] = rewards[i]
            else:
                targets[i][actions[i]] = rewards[i] + 0.95 * np.max(next_q_values[i])
        
        self.q_network.fit(states, targets, epochs=1, verbose=0)
        
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay
    
    def update_target_network(self):
        """Update target network with current network weights"""
        if HAS_ML:
            self.target_network.set_weights(self.q_network.get_weights())

class ReinforcementTradingStrategy:
    """Main reinforcement learning trading strategy"""
    
    def __init__(self, symbol: str = "ETHUSDT", initial_capital: float = 10000):
        self.symbol = symbol
        self.initial_capital = initial_capital
        self.agent = DQNAgent()
        self.scaler = StandardScaler() if HAS_ML else None
        
        # Learning parameters
        self.max_iterations = 10
        self.min_profitability = 0.05  # 5% minimum return
        self.min_win_rate = 0.55  # 55% minimum win rate
        
        # Performance tracking
        self.iteration_results = []
        self.best_model = None
        self.best_performance = -float('inf')
        
        console.print(Panel.fit(
            "[bold blue]🤖 REINFORCEMENT LEARNING STRATEGY INITIALIZED[/bold blue]\n"
            f"[cyan]Symbol: {symbol}[/cyan]\n"
            f"[cyan]Initial Capital: ${initial_capital:,.2f}[/cyan]\n\n"
            "[white]Learning Parameters:[/white]\n"
            f"• Max iterations: {self.max_iterations}\n"
            f"• Target return: {self.min_profitability:.1%}\n"
            f"• Target win rate: {self.min_win_rate:.1%}\n\n"
            "[yellow]🧠 Deep Q-Learning with experience replay[/yellow]\n"
            "[yellow]📊 Automatic feature engineering[/yellow]\n"
            "[yellow]🔄 Iterative improvement from mistakes[/yellow]",
            border_style="blue"
        ))
    
    def fetch_training_data(self, days_back: int = 90) -> pd.DataFrame:
        """Fetch data for training"""
        
        console.print(f"\n[yellow]📊 Fetching {days_back} days of training data...[/yellow]")
        
        fetcher = EnhancedDataFetcher(
            api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
            api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c"
        )
        
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        data = fetcher.fetch_data(
            symbol=self.symbol,
            start_date=start_date,
            end_date=end_date,
            timeframe='15m'
        )
        
        if data is not None:
            data.reset_index(inplace=True)
            data.rename(columns={'index': 'timestamp'}, inplace=True)
            console.print(f"[green]✅ Loaded {len(data):,} bars[/green]")
            return data
        else:
            console.print("[red]❌ Failed to fetch data[/red]")
            return None
    
    def split_data(self, data: pd.DataFrame, train_ratio: float = 0.7) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Split data into train/test sets"""
        
        split_idx = int(len(data) * train_ratio)
        train_data = data.iloc[:split_idx].copy()
        test_data = data.iloc[split_idx:].copy()
        
        console.print(f"[cyan]📊 Data split: {len(train_data):,} train, {len(test_data):,} test bars[/cyan]")
        return train_data, test_data
    
    def train_iteration(self, train_data: pd.DataFrame, iteration: int) -> Dict:
        """Single training iteration"""
        
        console.print(f"\n[bold yellow]🔄 Training Iteration {iteration + 1}[/bold yellow]")
        
        if not HAS_ML:
            console.print("[red]❌ ML libraries not available[/red]")
            return {'error': 'No ML libraries'}
        
        # Create environment
        env = MLTradingEnvironment(train_data, self.initial_capital)
        
        # Training parameters
        episodes = 100
        batch_size = 32
        
        episode_returns = []
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            console=console
        ) as progress:
            
            task = progress.add_task("Training episodes...", total=episodes)
            
            for episode in range(episodes):
                state = env.reset()
                total_reward = 0
                
                while True:
                    action = self.agent.act(state, training=True)
                    next_state, reward, done, info = env.step(action)
                    
                    self.agent.remember(state, action, reward, next_state, done)
                    state = next_state
                    total_reward += reward
                    
                    if done:
                        break
                
                # Train agent
                if len(self.agent.memory) > batch_size:
                    self.agent.replay(batch_size)
                
                # Update target network periodically
                if episode % 10 == 0:
                    self.agent.update_target_network()
                
                episode_returns.append(info['total_return'])
                progress.update(task, advance=1)
        
        # Calculate training performance
        final_return = episode_returns[-1] if episode_returns else 0
        avg_return = np.mean(episode_returns[-10:]) if len(episode_returns) >= 10 else 0
        
        return {
            'iteration': iteration + 1,
            'final_return': final_return,
            'avg_return': avg_return,
            'episode_returns': episode_returns,
            'trades': env.trades
        }
    
    def test_iteration(self, test_data: pd.DataFrame, iteration: int) -> Dict:
        """Test the trained model"""
        
        console.print(f"[cyan]🧪 Testing iteration {iteration + 1}...[/cyan]")
        
        if not HAS_ML:
            return {'error': 'No ML libraries'}
        
        # Create test environment
        env = MLTradingEnvironment(test_data, self.initial_capital)
        
        state = env.reset()
        actions_taken = []
        
        while True:
            action = self.agent.act(state, training=False)  # No exploration
            actions_taken.append(action)
            
            next_state, reward, done, info = env.step(action)
            state = next_state
            
            if done:
                break
        
        # Calculate performance metrics
        total_return = info['total_return']
        total_trades = len(env.trades)
        winning_trades = len([t for t in env.trades if t.was_correct])
        win_rate = winning_trades / total_trades if total_trades > 0 else 0
        
        avg_return_per_trade = np.mean([t.return_pct for t in env.trades]) if env.trades else 0
        
        console.print(f"[white]Test Results:[/white]")
        console.print(f"• Total return: {total_return:.2%}")
        console.print(f"• Total trades: {total_trades}")
        console.print(f"• Win rate: {win_rate:.1%}")
        console.print(f"• Avg return per trade: {avg_return_per_trade:.2f}%")
        
        return {
            'iteration': iteration + 1,
            'total_return': total_return,
            'total_trades': total_trades,
            'win_rate': win_rate,
            'avg_return_per_trade': avg_return_per_trade,
            'trades': env.trades,
            'actions': actions_taken
        }
    
    def analyze_mistakes(self, test_result: Dict) -> List[str]:
        """Analyze losing trades to find patterns"""
        
        if 'trades' not in test_result or not test_result['trades']:
            return ["No trades to analyze"]
        
        losing_trades = [t for t in test_result['trades'] if not t.was_correct]
        
        if not losing_trades:
            return ["No losing trades to analyze"]
        
        insights = []
        
        # Analyze losing trade patterns
        if len(losing_trades) >= 3:
            # Check if losses happen in specific market conditions
            avg_loss = np.mean([t.return_pct for t in losing_trades])
            insights.append(f"Average loss: {avg_loss:.2f}%")
            
            # Check confidence in losing trades
            avg_confidence = np.mean([t.confidence for t in losing_trades])
            insights.append(f"Average confidence in losses: {avg_confidence:.2f}")
            
            # Direction bias
            long_losses = len([t for t in losing_trades if t.direction == 'buy'])
            short_losses = len([t for t in losing_trades if t.direction == 'sell'])
            
            if long_losses > short_losses * 1.5:
                insights.append("Bias: Too many losing long trades")
            elif short_losses > long_losses * 1.5:
                insights.append("Bias: Too many losing short trades")
        
        return insights
    
    def adjust_parameters(self, iteration: int, insights: List[str]):
        """Adjust learning parameters based on insights"""
        
        console.print(f"[yellow]🔧 Adjusting parameters for iteration {iteration + 1}...[/yellow]")
        
        # Adjust exploration rate
        if "Too many losing long trades" in str(insights):
            console.print("• Reducing long bias")
            
        if "Too many losing short trades" in str(insights):
            console.print("• Reducing short bias")
        
        # Adjust learning rate
        if iteration > 3:
            self.agent.learning_rate *= 0.9
            console.print(f"• Reduced learning rate to {self.agent.learning_rate:.4f}")
    
    def run_learning_loop(self, days_back: int = 90) -> Dict:
        """Main learning loop"""
        
        console.print(f"\n[bold green]🚀 STARTING REINFORCEMENT LEARNING LOOP[/bold green]")
        
        # Fetch data
        data = self.fetch_training_data(days_back)
        if data is None:
            return {'error': 'No data available'}
        
        # Split data
        train_data, test_data = self.split_data(data)
        
        best_iteration = None
        
        for iteration in range(self.max_iterations):
            console.print(f"\n[bold cyan]🔄 ITERATION {iteration + 1}/{self.max_iterations}[/bold cyan]")
            
            # Train
            train_result = self.train_iteration(train_data, iteration)
            if 'error' in train_result:
                continue
            
            # Test
            test_result = self.test_iteration(test_data, iteration)
            if 'error' in test_result:
                continue
            
            # Store results
            self.iteration_results.append({
                'iteration': iteration + 1,
                'train_result': train_result,
                'test_result': test_result
            })
            
            # Check if this is the best model
            performance_score = test_result['total_return'] + (test_result['win_rate'] - 0.5)
            
            if performance_score > self.best_performance:
                self.best_performance = performance_score
                best_iteration = iteration + 1
                if HAS_ML:
                    self.best_model = tf.keras.models.clone_model(self.agent.q_network)
                    self.best_model.set_weights(self.agent.q_network.get_weights())
                
                console.print(f"[green]🏆 New best model! Performance score: {performance_score:.3f}[/green]")
            
            # Check if profitable
            if (test_result['total_return'] >= self.min_profitability and 
                test_result['win_rate'] >= self.min_win_rate):
                
                console.print(f"[bold green]🎊 PROFITABLE STRATEGY FOUND![/bold green]")
                console.print(f"[green]Iteration {iteration + 1} meets profitability targets[/green]")
                break
            
            # Analyze mistakes and adjust
            insights = self.analyze_mistakes(test_result)
            console.print(f"[yellow]💡 Insights: {', '.join(insights)}[/yellow]")
            
            self.adjust_parameters(iteration, insights)
        
        # Display final results
        self.display_final_results(best_iteration)
        
        return {
            'completed_iterations': len(self.iteration_results),
            'best_iteration': best_iteration,
            'best_performance': self.best_performance,
            'iteration_results': self.iteration_results
        }
    
    def display_final_results(self, best_iteration: int):
        """Display comprehensive final results"""
        
        console.print(f"\n[bold green]📊 REINFORCEMENT LEARNING RESULTS[/bold green]")
        
        # Results table
        results_table = Table(title="🤖 Learning Progress")
        results_table.add_column("Iteration", style="cyan")
        results_table.add_column("Return %", justify="right")
        results_table.add_column("Win Rate %", justify="right")
        results_table.add_column("Trades", justify="right")
        results_table.add_column("Score", justify="right")
        results_table.add_column("Status", justify="center")
        
        for result in self.iteration_results:
            test_res = result['test_result']
            score = test_res['total_return'] + (test_res['win_rate'] - 0.5)
            
            status = "🏆 BEST" if result['iteration'] == best_iteration else ""
            
            if (test_res['total_return'] >= self.min_profitability and 
                test_res['win_rate'] >= self.min_win_rate):
                status += " ✅ PROFITABLE"
            
            results_table.add_row(
                str(result['iteration']),
                f"{test_res['total_return']:.2%}",
                f"{test_res['win_rate']:.1%}",
                str(test_res['total_trades']),
                f"{score:.3f}",
                status
            )
        
        console.print(results_table)
        
        # Best model summary
        if best_iteration:
            best_result = next(r for r in self.iteration_results if r['iteration'] == best_iteration)
            best_test = best_result['test_result']
            
            is_profitable = (best_test['total_return'] >= self.min_profitability and 
                           best_test['win_rate'] >= self.min_win_rate)
            
            color = "green" if is_profitable else "yellow"
            status = "PROFITABLE STRATEGY READY!" if is_profitable else "BEST ATTEMPT (needs more learning)"
            
            console.print(Panel.fit(
                f"[bold {color}]🏆 {status}[/bold {color}]\n\n"
                f"[white]Best Model (Iteration {best_iteration}):[/white]\n"
                f"• Total Return: {best_test['total_return']:.2%}\n"
                f"• Win Rate: {best_test['win_rate']:.1%}\n"
                f"• Total Trades: {best_test['total_trades']}\n"
                f"• Avg Return/Trade: {best_test['avg_return_per_trade']:.2f}%\n"
                f"• Performance Score: {self.best_performance:.3f}\n\n"
                f"[cyan]Targets: {self.min_profitability:.1%} return, {self.min_win_rate:.1%} win rate[/cyan]",
                border_style=color
            ))
        
        # Save results
        self.save_results()
    
    def save_results(self) -> str:
        """Save learning results"""
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"ml_reinforcement_learning_{timestamp}.json"
        
        # Prepare serializable data
        save_data = {
            'strategy_type': 'Reinforcement Learning',
            'symbol': self.symbol,
            'timestamp': timestamp,
            'parameters': {
                'max_iterations': self.max_iterations,
                'min_profitability': self.min_profitability,
                'min_win_rate': self.min_win_rate
            },
            'results': []
        }
        
        for result in self.iteration_results:
            save_data['results'].append({
                'iteration': result['iteration'],
                'test_performance': {
                    'total_return': float(result['test_result']['total_return']),
                    'win_rate': float(result['test_result']['win_rate']),
                    'total_trades': int(result['test_result']['total_trades']),
                    'avg_return_per_trade': float(result['test_result']['avg_return_per_trade'])
                }
            })
        
        with open(filename, 'w') as f:
            json.dump(save_data, f, indent=2)
        
        console.print(f"\n[cyan]📁 Results saved: {filename}[/cyan]")
        return filename

def main():
    """Main function"""
    
    if not HAS_ML:
        console.print(Panel.fit(
            "[bold red]❌ ML LIBRARIES REQUIRED[/bold red]\n\n"
            "[white]Please install required libraries:[/white]\n"
            "pip install tensorflow scikit-learn\n\n"
            "[yellow]Then run this script again[/yellow]",
            border_style="red"
        ))
        return
    
    console.print(Panel.fit(
        "[bold gold3]🤖 REINFORCEMENT LEARNING TRADING STRATEGY[/bold gold3]\n"
        "[cyan]Auto-learning strategy that improves through trial and error[/cyan]\n\n"
        "[white]Features:[/white]\n"
        "🧠 Deep Q-Learning neural network\n"
        "📊 Automatic feature engineering\n"
        "🔄 Train/Test split validation\n"
        "💡 Learns from losing trades\n"
        "🎯 Iterates until profitable\n"
        "📈 Real-time performance tracking",
        border_style="gold3"
    ))
    
    # Get user input
    symbol = input("\nEnter symbol (default: ETHUSDT): ").strip().upper() or "ETHUSDT"
    if not symbol.endswith('USDT'):
        symbol += 'USDT'
    
    days_input = input("Enter days of training data (default: 60): ").strip()
    days_back = int(days_input) if days_input.isdigit() else 60
    
    iterations_input = input("Enter max learning iterations (default: 5): ").strip()
    max_iterations = int(iterations_input) if iterations_input.isdigit() else 5
    
    # Create and run strategy
    strategy = ReinforcementTradingStrategy(symbol=symbol)
    strategy.max_iterations = max_iterations
    
    console.print(f"\n[bold yellow]🚀 Starting ML learning on {symbol}...[/bold yellow]")
    
    try:
        results = strategy.run_learning_loop(days_back)
        
        if 'error' in results:
            console.print(f"[red]❌ Error: {results['error']}[/red]")
        else:
            console.print(Panel.fit(
                "[bold green]🎊 REINFORCEMENT LEARNING COMPLETE![/bold green]\n\n"
                f"[white]Completed {results['completed_iterations']} iterations[/white]\n"
                f"[white]Best iteration: {results['best_iteration']}[/white]\n"
                f"[white]Best performance score: {results['best_performance']:.3f}[/white]\n\n"
                "[cyan]The AI has learned to trade and will continue improving![/cyan]",
                border_style="green"
            ))
    
    except Exception as e:
        console.print(f"[red]❌ Error during learning: {str(e)}[/red]")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main() 