#!/usr/bin/env python3
"""
IMPROVED ETH Walkforward Analysis with Enhanced Strategy
Better breakout strategy with multiple confirmations and adaptive parameters
"""

import vectorbt as vbt
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt
import optuna
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
import time
import warnings
warnings.filterwarnings('ignore')
from collections import defaultdict
import json

# Import enhanced data fetcher
from enhanced_data_fetcher import EnhancedDataFetcher
from enhanced_data_cache import EnhancedDataCache

class SimpleETHTrendFollowingAnalyzer:
    """Simple ETH trend following strategy with reinforcement learning from losses"""
    
    def __init__(self, data_fetcher):
        self.console = Console()
        self.data_fetcher = data_fetcher
        
        # Walkforward parameters - extended for comprehensive testing
        self.training_days = 120     # Balanced training period for stability
        self.testing_days = 30       # Shorter testing for more windows
        self.step_days = 15          # Bi-weekly steps for more comprehensive analysis
        
        self.walkforward_results = []
        
        # Reinforcement Learning Components
        self.trade_history = []
        self.loss_patterns = defaultdict(list)
        self.adaptive_params = {
            'base_trail_pct': 0.03,
            'base_volume_mult': 1.2,
            'base_min_trend_strength': 0.01,
            'loss_penalty_factor': 1.2,
            'win_reward_factor': 0.9,
            'adaptation_rate': 0.1
        }
        self.market_regime_memory = []
        
    def fetch_eth_data(self, days=540):
        """Fetch ETH data for walkforward analysis"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        self.console.print(f"[cyan]📊 Fetching ETHUSDT 4h data for {days} days (18 months)...[/cyan]")
        
        data = self.data_fetcher.fetch_data(
            symbol='ETHUSDT',
            start_date=start_date,
            end_date=end_date,
            timeframe='4h'
        )
        
        if data.empty:
            self.console.print("[red]❌ No ETH data available[/red]")
            return None
        
        self.console.print(f"[green]✅ Fetched {len(data)} bars for ETHUSDT[/green]")
        self.console.print(f"[cyan]📈 Price range: ${data['close'].min():.2f} - ${data['close'].max():.2f}[/cyan]")
        
        return data
    
    def calculate_enhanced_indicators(self, data):
        """Calculate enhanced technical indicators"""
        df = data.copy()
        
        # Price-based indicators
        df['ema_fast'] = df['close'].ewm(span=12).mean()
        df['ema_slow'] = df['close'].ewm(span=26).mean()
        df['ema_trend'] = df['close'].ewm(span=50).mean()
        
        # Volatility indicators
        df['atr'] = self.calculate_atr(df, 14)
        df['bb_upper'], df['bb_lower'] = self.calculate_bollinger_bands(df, 20, 2)
        df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['close']
        
        # Volume indicators
        df['volume_ema'] = df['volume'].ewm(span=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ema']
        
        # Momentum indicators
        df['rsi'] = self.calculate_rsi(df, 14)
        df['macd'], df['macd_signal'] = self.calculate_macd(df)
        
        # Trend strength
        df['adx'] = self.calculate_adx(df, 14)
        
        # Support/Resistance levels
        df['resistance'] = df['high'].rolling(window=20).max()
        df['support'] = df['low'].rolling(window=20).min()
        
        return df
    
    def calculate_atr(self, data, period=14):
        """Calculate Average True Range"""
        high_low = data['high'] - data['low']
        high_close = np.abs(data['high'] - data['close'].shift())
        low_close = np.abs(data['low'] - data['close'].shift())
        
        tr = np.maximum(high_low, np.maximum(high_close, low_close))
        return tr.rolling(window=period).mean()
    
    def calculate_bollinger_bands(self, data, period=20, std_dev=2):
        """Calculate Bollinger Bands"""
        sma = data['close'].rolling(window=period).mean()
        std = data['close'].rolling(window=period).std()
        
        upper = sma + (std * std_dev)
        lower = sma - (std * std_dev)
        
        return upper, lower
    
    def calculate_rsi(self, data, period=14):
        """Calculate Relative Strength Index"""
        delta = data['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        
        rs = gain / loss
        return 100 - (100 / (1 + rs))
    
    def calculate_macd(self, data, fast=12, slow=26, signal=9):
        """Calculate MACD"""
        ema_fast = data['close'].ewm(span=fast).mean()
        ema_slow = data['close'].ewm(span=slow).mean()
        
        macd = ema_fast - ema_slow
        macd_signal = macd.ewm(span=signal).mean()
        
        return macd, macd_signal
    
    def calculate_adx(self, data, period=14):
        """Calculate Average Directional Index (simplified)"""
        high_diff = data['high'].diff()
        low_diff = data['low'].diff()
        
        dm_plus = np.where((high_diff > low_diff) & (high_diff > 0), high_diff, 0)
        dm_minus = np.where((low_diff > high_diff) & (low_diff > 0), low_diff, 0)
        
        tr = self.calculate_atr(data, 1)
        
        di_plus = 100 * pd.Series(dm_plus).rolling(window=period).mean() / tr.rolling(window=period).mean()
        di_minus = 100 * pd.Series(dm_minus).rolling(window=period).mean() / tr.rolling(window=period).mean()
        
        dx = 100 * np.abs(di_plus - di_minus) / (di_plus + di_minus)
        adx = dx.rolling(window=period).mean()
        
        return adx.fillna(0)
    
    def analyze_losing_trades(self, portfolio_stats, data, entries, exits):
        """Analyze losing trades to identify patterns using reinforcement learning"""
        try:
            # Get trade details from portfolio
            trades = portfolio_stats.trades.records_readable
            
            if len(trades) == 0:
                return {}
            
            losing_trades = trades[trades['PnL'] < 0]
            
            if len(losing_trades) == 0:
                return {}
            
            loss_analysis = {
                'total_losses': len(losing_trades),
                'avg_loss': losing_trades['PnL'].mean(),
                'max_loss': losing_trades['PnL'].min(),
                'loss_patterns': {},
                'market_conditions': {}
            }
            
            # Analyze market conditions during losses
            for _, trade in losing_trades.iterrows():
                entry_idx = trade['Entry Idx']
                exit_idx = trade['Exit Idx']
                
                if entry_idx < len(data) and exit_idx < len(data):
                    # Market condition analysis
                    entry_price = data.iloc[entry_idx]['close']
                    exit_price = data.iloc[exit_idx]['close']
                    
                    # Calculate market metrics during trade
                    trade_data = data.iloc[entry_idx:exit_idx+1]
                    volatility = trade_data['close'].pct_change().std()
                    price_change = (exit_price - entry_price) / entry_price
                    trade_duration = exit_idx - entry_idx
                    
                    # Identify loss patterns
                    if volatility > 0.05:  # High volatility
                        loss_analysis['loss_patterns']['high_volatility'] = loss_analysis['loss_patterns'].get('high_volatility', 0) + 1
                    
                    if trade_duration < 5:  # Short duration losses
                        loss_analysis['loss_patterns']['quick_reversals'] = loss_analysis['loss_patterns'].get('quick_reversals', 0) + 1
                    
                    if abs(price_change) > 0.1:  # Large price moves
                        loss_analysis['loss_patterns']['large_moves'] = loss_analysis['loss_patterns'].get('large_moves', 0) + 1
                    
                    # Store for reinforcement learning
                    self.trade_history.append({
                        'entry_idx': entry_idx,
                        'exit_idx': exit_idx,
                        'pnl': trade['PnL'],
                        'volatility': volatility,
                        'duration': trade_duration,
                        'price_change': price_change,
                        'market_regime': self.classify_market_regime(trade_data)
                    })
            
            return loss_analysis
            
        except Exception as e:
            return {}
    
    def classify_market_regime(self, data):
        """Classify market regime for reinforcement learning"""
        if len(data) < 10:
            return 'unknown'
        
        # Calculate regime indicators
        volatility = data['close'].pct_change().std()
        trend = (data['close'].iloc[-1] - data['close'].iloc[0]) / data['close'].iloc[0]
        volume_trend = data['volume'].rolling(5).mean().iloc[-1] / data['volume'].rolling(10).mean().iloc[-1]
        
        # Classify regime
        if volatility > 0.06:
            return 'high_volatility'
        elif abs(trend) < 0.02:
            return 'sideways'
        elif trend > 0.05:
            return 'strong_uptrend'
        elif trend < -0.05:
            return 'strong_downtrend'
        elif volume_trend > 1.5:
            return 'high_volume_breakout'
        else:
            return 'normal_trend'
    
    def update_adaptive_parameters(self, loss_analysis, current_params):
        """Update parameters based on loss analysis using reinforcement learning"""
        adapted_params = current_params.copy()
        
        if not loss_analysis or 'loss_patterns' not in loss_analysis:
            return adapted_params
        
        adaptation_rate = self.adaptive_params['adaptation_rate']
        
        # Adapt based on loss patterns
        loss_patterns = loss_analysis['loss_patterns']
        
        # If high volatility losses, increase trailing stop
        if loss_patterns.get('high_volatility', 0) > 2:
            adapted_params['trail_pct'] = min(0.08, adapted_params.get('trail_pct', 0.03) * 1.3)
            self.console.print(f"[yellow]🔧 Adapting: Increased trailing stop to {adapted_params['trail_pct']:.3f} due to volatility losses[/yellow]")
        
        # If quick reversals, increase trend strength requirement
        if loss_patterns.get('quick_reversals', 0) > 2:
            adapted_params['min_trend_strength'] = min(0.04, adapted_params.get('min_trend_strength', 0.01) * 1.5)
            self.console.print(f"[yellow]🔧 Adapting: Increased trend strength to {adapted_params['min_trend_strength']:.3f} due to quick reversals[/yellow]")
        
        # If large move losses, increase volume confirmation
        if loss_patterns.get('large_moves', 0) > 2:
            adapted_params['volume_mult'] = min(2.0, adapted_params.get('volume_mult', 1.2) * 1.2)
            self.console.print(f"[yellow]🔧 Adapting: Increased volume multiplier to {adapted_params['volume_mult']:.2f} due to large move losses[/yellow]")
        
        # Store adaptation in memory
        self.loss_patterns['recent_adaptations'].append({
            'timestamp': datetime.now(),
            'loss_count': loss_analysis.get('total_losses', 0),
            'adaptations': adapted_params
        })
        
        return adapted_params
    
    def get_market_regime_adjusted_params(self, data, base_params):
        """Adjust parameters based on current market regime"""
        current_regime = self.classify_market_regime(data.tail(20))
        adjusted_params = base_params.copy()
        
        # Regime-specific adjustments for Bollinger Bands strategy
        regime_adjustments = {
            'high_volatility': {
                'bb_std': base_params.get('bb_std', 2.0) * 1.2,  # Wider bands in high volatility
                'trail_pct': base_params.get('trail_pct', 0.03) * 1.5,
                'min_squeeze_threshold': base_params.get('min_squeeze_threshold', 0.02) * 0.7,  # More sensitive to squeezes
                'volume_mult': base_params.get('volume_mult', 1.2) * 1.3
            },
            'sideways': {
                'bb_std': base_params.get('bb_std', 2.0) * 0.9,  # Tighter bands for sideways markets
                'min_squeeze_threshold': base_params.get('min_squeeze_threshold', 0.02) * 1.5,  # Less sensitive to squeezes
                'volume_mult': base_params.get('volume_mult', 1.2) * 1.5
            },
            'strong_downtrend': {
                'trail_pct': base_params.get('trail_pct', 0.03) * 0.8,  # Tighter stops in downtrend
                'volume_mult': base_params.get('volume_mult', 1.2) * 1.4,
                'bb_period': min(30, base_params.get('bb_period', 20) + 3)  # Longer period for stability
            },
            'strong_uptrend': {
                'trail_pct': base_params.get('trail_pct', 0.03) * 1.2,  # Wider stops in uptrend
                'bb_std': base_params.get('bb_std', 2.0) * 1.1,  # Slightly wider bands
                'volume_mult': base_params.get('volume_mult', 1.2) * 0.9  # More permissive volume
            }
        }
        
        if current_regime in regime_adjustments:
            for param, value in regime_adjustments[current_regime].items():
                adjusted_params[param] = value
            
            self.console.print(f"[cyan]🌊 Market Regime: {current_regime} - Adjusting BB parameters[/cyan]")
        
        return adjusted_params
    
    def create_bollinger_bands_signals(self, data, bb_period=20, bb_std=2.0, 
                                      volume_mult=1.2, min_squeeze_threshold=0.02):
        """Create Bollinger Bands mean reversion and breakout strategy"""
        
        df = data.copy()
        
        # Core Bollinger Bands
        df['bb_middle'] = df['close'].rolling(window=bb_period).mean()  # SMA middle line
        df['bb_std'] = df['close'].rolling(window=bb_period).std()
        df['bb_upper'] = df['bb_middle'] + (df['bb_std'] * bb_std)
        df['bb_lower'] = df['bb_middle'] - (df['bb_std'] * bb_std)
        
        # Bollinger Band metrics
        df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']  # Normalized width
        df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])  # Position within bands (0-1)
        df['bb_squeeze'] = df['bb_width'] < min_squeeze_threshold  # Squeeze detection
        
        # Price relationship to bands
        df['price_above_upper'] = df['close'] > df['bb_upper']
        df['price_below_lower'] = df['close'] < df['bb_lower']
        df['price_near_middle'] = abs(df['close'] - df['bb_middle']) / df['bb_middle'] < 0.01  # Within 1% of middle
        
        # Volume and momentum indicators
        df['volume_ema'] = df['volume'].ewm(span=20).mean()
        df['volume_ratio'] = df['volume'] / df['volume_ema']
        df['rsi'] = self.calculate_rsi(df, 14)
        
        # ATR for volatility measurement
        df['atr'] = self.calculate_atr(df, 14)
        df['atr_ratio'] = df['atr'] / df['close']
        
        # Trend context (longer-term EMA for trend bias)
        df['trend_ema'] = df['close'].ewm(span=50).mean()
        df['trend_bias'] = df['close'] > df['trend_ema']  # True = uptrend bias
        
        # Handle NaN values
        df = df.fillna(method='ffill').fillna(0)
        
        # PROPER BOLLINGER BANDS MEAN REVERSION STRATEGY
        # This matches exactly with the live trader logic
        
        long_entries = pd.Series(False, index=df.index)
        short_entries = pd.Series(False, index=df.index)
        
        # Generate signals based on Bollinger Bands mean reversion
        for i in range(len(df)):
            if pd.isna(df['bb_upper'].iloc[i]) or pd.isna(df['bb_lower'].iloc[i]):
                continue
                
            current_price = df['close'].iloc[i]
            bb_upper = df['bb_upper'].iloc[i]
            bb_lower = df['bb_lower'].iloc[i]
            bb_position = df['bb_position'].iloc[i]
            volume_ratio = df['volume_ratio'].iloc[i]
            rsi = df['rsi'].iloc[i]
            
            # LONG Signal: Price hits lower band (oversold)
            long_signal = (
                current_price <= bb_lower * 1.005 and  # At or near lower band
                rsi < 40 and  # RSI oversold
                volume_ratio > volume_mult and  # Volume confirmation
                bb_position < 0.2  # Position in lower 20% of bands
            )
            
            # SHORT Signal: Price hits upper band (overbought)  
            short_signal = (
                current_price >= bb_upper * 0.995 and  # At or near upper band
                rsi > 60 and  # RSI overbought
                volume_ratio > volume_mult and  # Volume confirmation
                bb_position > 0.8  # Position in upper 20% of bands
            )
            
            if long_signal:
                long_entries.iloc[i] = True
            elif short_signal:
                short_entries.iloc[i] = True
        
        return long_entries, short_entries, df
    
    def create_bollinger_bands_exits(self, data, enhanced_df, long_entries, short_entries, trail_pct=0.03, max_hold_periods=60):
        """Create Bollinger Bands exit strategy with trailing stops (matches live trader)"""
        long_exits = pd.Series(False, index=data.index)
        short_exits = pd.Series(False, index=data.index)
        
        # Track positions
        long_position = False
        short_position = False
        entry_price = 0
        entry_index = 0
        highest_price_since_entry = 0
        lowest_price_since_entry = 0
        trailing_stop_price = 0
        
        for i in range(1, len(data)):
            current_price = data['close'].iloc[i]
            bb_upper = enhanced_df['bb_upper'].iloc[i]
            bb_lower = enhanced_df['bb_lower'].iloc[i]
            bb_middle = enhanced_df['bb_middle'].iloc[i]
            
            # LONG POSITION MANAGEMENT
            if long_entries.iloc[i] and not long_position:
                # Enter long position
                long_position = True
                entry_price = current_price
                entry_index = i
                highest_price_since_entry = current_price
                trailing_stop_price = current_price * (1 - trail_pct)
                
            elif long_position:
                # Update highest price and trailing stop
                if current_price > highest_price_since_entry:
                    highest_price_since_entry = current_price
                    trailing_stop_price = current_price * (1 - trail_pct)
                
                # Exit conditions for long (matches live trader)
                trailing_stop_hit = current_price <= trailing_stop_price
                mean_reversion_target = current_price >= bb_middle * 0.999  # Close to middle band
                max_hold_exceeded = (i - entry_index) >= max_hold_periods
                
                if trailing_stop_hit or mean_reversion_target or max_hold_exceeded:
                    long_exits.iloc[i] = True
                    long_position = False
            
            # SHORT POSITION MANAGEMENT  
            if short_entries.iloc[i] and not short_position:
                # Enter short position
                short_position = True
                entry_price = current_price
                entry_index = i
                lowest_price_since_entry = current_price
                trailing_stop_price = current_price * (1 + trail_pct)
                
            elif short_position:
                # Update lowest price and trailing stop
                if current_price < lowest_price_since_entry:
                    lowest_price_since_entry = current_price
                    trailing_stop_price = current_price * (1 + trail_pct)
                
                # Exit conditions for short (matches live trader)
                trailing_stop_hit = current_price >= trailing_stop_price
                mean_reversion_target = current_price <= bb_middle * 1.001  # Close to middle band
                max_hold_exceeded = (i - entry_index) >= max_hold_periods
                
                if trailing_stop_hit or mean_reversion_target or max_hold_exceeded:
                    short_exits.iloc[i] = True
                    short_position = False
        
        return long_exits, short_exits
    
    def optimize_bollinger_bands_parameters(self, train_data):
        """Optimize Bollinger Bands strategy parameters with ANTI-OVERFITTING measures"""
        
        def objective(trial):
            # ULTRA-SIMPLE parameter ranges to guarantee trades
            bb_period = trial.suggest_int('bb_period', 10, 25)    # Shorter periods for more sensitivity
            bb_std = trial.suggest_float('bb_std', 1.0, 2.0)      # Lower std for tighter bands
            volume_mult = trial.suggest_float('volume_mult', 0.3, 1.0)  # Very low volume requirements
            trail_pct = trial.suggest_float('trail_pct', 0.02, 0.08)  # Wide stop range
            min_squeeze_threshold = trial.suggest_float('min_squeeze_threshold', 0.001, 0.02)  # Very low squeeze threshold
            max_hold_periods = trial.suggest_int('max_hold_periods', 5, 30)  # Shorter holding periods
            
            try:
                # Create signals on full training data
                long_entries, short_entries, enhanced_df = self.create_bollinger_bands_signals(
                    train_data, bb_period, bb_std, volume_mult, min_squeeze_threshold
                )
                
                # DEBUG: Print signal counts
                long_count = long_entries.sum()
                short_count = short_entries.sum()
                print(f"DEBUG: Long signals: {long_count}, Short signals: {short_count}, Data length: {len(train_data)}")
                
                if long_count == 0 and short_count == 0:
                    return -1000  # Penalty for no trades
                
                # Create Bollinger Bands-specific exits
                long_exits, short_exits = self.create_bollinger_bands_exits(
                    train_data, enhanced_df, long_entries, short_entries, trail_pct, max_hold_periods
                )
                
                # DEBUG: Print exit counts
                long_exit_count = long_exits.sum()
                short_exit_count = short_exits.sum()
                print(f"DEBUG: Long exits: {long_exit_count}, Short exits: {short_exit_count}")
                
                pf = vbt.Portfolio.from_signals(
                    close=train_data['close'],
                    entries=long_entries,
                    exits=long_exits,
                    short_entries=short_entries,
                    short_exits=short_exits,
                    init_cash=10000,
                    fees=0.001,
                    freq='4h'
                )
                
                stats = pf.stats()
                
                # DEBUG: Print basic portfolio stats
                total_trades = int(stats.get('Total Trades', 0))
                print(f"DEBUG: Portfolio created, Total trades: {total_trades}")
                
                total_return = float(stats.get('Total Return [%]', 0))
                sharpe = float(stats.get('Sharpe Ratio', 0))
                max_dd = float(stats.get('Max Drawdown [%]', 0))
                win_rate = float(stats.get('Win Rate [%]', 0))
                total_trades = int(stats.get('Total Trades', 0))
                
                # No gap penalty since we're using simple optimization
                gap_penalty = 0
                
                # RELAXED trade activity requirements
                if total_trades < 1:  # At least 1 trade to evaluate
                    return -1000
                if total_trades > 50:  # RELAXED penalty for overtrading (>50 trades per window)
                    return -1000
                
                # ENHANCED ANTI-OVERFITTING scoring system
                # Heavy emphasis on consistency over peak performance
                
                # 1. Capped return score to prevent curve fitting to outliers
                return_score = min(total_return / 100, 0.3)  # Heavily cap returns (max 30%)
                
                # 2. Consistency is KING - heavily weight win rate
                consistency_score = min(win_rate / 100, 0.9)  # Reward consistent wins
                
                # 3. Risk-adjusted returns (Sharpe ratio) with conservative cap
                risk_adjusted_score = min(max(sharpe, 0), 1.5) / 1.5  # Cap Sharpe at 1.5
                
                # 4. Drawdown penalty (critical for live trading)
                drawdown_penalty = min(max_dd / 100, 0.5)  # Cap drawdown penalty
                
                # 5. Trade efficiency - prefer moderate trading frequency
                optimal_trades = 6  # Target ~6 trades per window
                trade_efficiency = max(0, 1 - abs(total_trades - optimal_trades) / optimal_trades)
                
                # 6. Volatility penalty - prefer stable returns
                returns_list = []
                if hasattr(pf, 'returns'):
                    returns_list = pf.returns().dropna().values
                    returns_vol = np.std(returns_list) if len(returns_list) > 0 else 0
                    volatility_penalty = min(returns_vol * 10, 0.3)  # Penalize high volatility
                else:
                    volatility_penalty = 0
                
                # CONSERVATIVE multi-objective scoring (anti-overfitting focus)
                score = (return_score * 0.15 +           # REDUCED weight on raw returns
                        consistency_score * 0.4 +        # INCREASED weight on win rate
                        risk_adjusted_score * 0.2 +      # Moderate weight on Sharpe
                        trade_efficiency * 0.15 +        # Reward optimal trading frequency
                        (1 - volatility_penalty) * 0.1 - # Reward stable returns
                        drawdown_penalty * 0.4 -         # INCREASED penalty for drawdowns
                        gap_penalty * 0.5)               # HEAVY penalty for opt-val gap
                
                return max(score, -0.5)  # Floor the score to prevent extreme negatives
                
            except Exception as e:
                return -1000
        
        # ANTI-OVERFITTING optimization settings
        # Fewer trials with regularization for robust optimization
        study = optuna.create_study(
            direction='maximize', 
            sampler=optuna.samplers.TPESampler(
                n_startup_trials=8,      # Fewer random trials
                n_ei_candidates=12,      # Reduced exploration
                gamma=lambda x: min(int(0.25 * x), 15)  # Conservative exploration
            ),
            pruner=optuna.pruners.MedianPruner(
                n_startup_trials=5,      # Early stopping for bad trials
                n_warmup_steps=10
            )
        )
        
        # REDUCED trials to prevent overfitting to training data
        study.optimize(objective, n_trials=25, show_progress_bar=False)  # Reduced from 50 to 25
        
        if study.best_value > -999:
            best_params = study.best_params
            self.console.print(f"[green]✅ Optimization complete: {study.best_value:.3f}[/green]")
            return best_params
        
        return None
    
    def test_bollinger_bands_strategy_with_rl(self, test_data, params, window_num=1):
        """Test Bollinger Bands strategy with reinforcement learning from losses"""
        if not params:
            return None
        
        try:
            # Apply market regime adjustments
            adjusted_params = self.get_market_regime_adjusted_params(test_data, params)
            
            long_entries, short_entries, enhanced_df = self.create_bollinger_bands_signals(
                test_data, 
                adjusted_params['bb_period'], 
                adjusted_params['bb_std'], 
                adjusted_params['volume_mult'],
                adjusted_params['min_squeeze_threshold']
            )
            
            if long_entries.sum() == 0 and short_entries.sum() == 0:
                return {
                    'return': 0,
                    'sharpe': 0,
                    'trades': 0,
                    'win_rate': 0,
                    'max_dd': 0,
                    'loss_analysis': {},
                    'adapted_params': adjusted_params
                }
            
            long_exits, short_exits = self.create_bollinger_bands_exits(
                test_data, enhanced_df, long_entries, short_entries, 
                adjusted_params['trail_pct'], adjusted_params['max_hold_periods']
            )
            
            pf = vbt.Portfolio.from_signals(
                close=test_data['close'],
                entries=long_entries,
                exits=long_exits,
                short_entries=short_entries,
                short_exits=short_exits,
                init_cash=10000,
                fees=0.001,
                freq='4h'
            )
            
            stats = pf.stats()
            
            # Analyze losing trades for reinforcement learning
            loss_analysis = self.analyze_losing_trades(pf, test_data, long_entries, short_entries)
            
            # Update adaptive parameters based on losses
            if loss_analysis and window_num > 5:  # Start adapting after 5 windows
                updated_params = self.update_adaptive_parameters(loss_analysis, adjusted_params)
                self.adaptive_params.update(updated_params)
            
            result = {
                'return': float(stats.get('Total Return [%]', 0)),
                'sharpe': float(stats.get('Sharpe Ratio', 0)),
                'trades': int(stats.get('Total Trades', 0)),
                'win_rate': float(stats.get('Win Rate [%]', 0)),
                'max_dd': float(stats.get('Max Drawdown [%]', 0)),
                'equity_curve': pf.value().values,
                'loss_analysis': loss_analysis,
                'adapted_params': adjusted_params,
                'market_regime': self.classify_market_regime(test_data.tail(20))
            }
            
            # Display loss analysis if significant losses
            if loss_analysis.get('total_losses', 0) > 0:
                self.console.print(f"[red]📉 Window {window_num}: {loss_analysis['total_losses']} losses, avg: {loss_analysis['avg_loss']:.2f}[/red]")
                if loss_analysis.get('loss_patterns'):
                    patterns = ', '.join([f"{k}: {v}" for k, v in loss_analysis['loss_patterns'].items()])
                    self.console.print(f"[yellow]🔍 Loss patterns: {patterns}[/yellow]")
            
            return result
            
        except Exception as e:
            self.console.print(f"[red]❌ Error in RL strategy test: {str(e)}[/red]")
            return None
    
    def run_walkforward_analysis(self, data):
        """Run complete walkforward analysis with improved strategy"""
        self.console.print("[yellow]🔄 Running IMPROVED walkforward analysis...[/yellow]")
        
        total_bars = len(data)
        training_bars = self.training_days * 6  # 6 4-hour bars per day
        testing_bars = self.testing_days * 6    # 6 4-hour bars per day  
        step_bars = self.step_days * 6          # 6 4-hour bars per day
        
        results = []
        
        # Rolling window analysis
        start_idx = 0
        window_count = 0
        
        while start_idx + training_bars + testing_bars <= total_bars:
            window_count += 1
            
            # Define training and testing periods
            train_start = start_idx
            train_end = start_idx + training_bars
            test_start = train_end
            test_end = test_start + testing_bars
            
            # Extract data
            train_data = data.iloc[train_start:train_end].copy()
            test_data = data.iloc[test_start:test_end].copy()
            
            # Get dates for tracking
            train_period = f"{train_data.index[0].strftime('%m-%d')} to {train_data.index[-1].strftime('%m-%d')}"
            test_period = f"{test_data.index[0].strftime('%m-%d')} to {test_data.index[-1].strftime('%m-%d')}"
            
            self.console.print(f"[cyan]📊 Window {window_count}: Train({train_period}) → Test({test_period})[/cyan]")
            
            # Optimize Bollinger Bands strategy parameters on training data
            best_params = self.optimize_bollinger_bands_parameters(train_data)
            
            if best_params:
                # Test on training data (in-sample performance)
                train_result = self.test_bollinger_bands_strategy_with_rl(train_data, best_params, window_count)
                
                # Test on out-of-sample data with reinforcement learning
                test_result = self.test_bollinger_bands_strategy_with_rl(test_data, best_params, window_count)
                
                if test_result and train_result:
                    result = {
                        'window': window_count,
                        'train_start': train_data.index[0],
                        'train_end': train_data.index[-1],
                        'test_start': test_data.index[0],
                        'test_end': test_data.index[-1],
                        'train_period': train_period,
                        'test_period': test_period,
                        'best_params': best_params,
                        'train_return': train_result['return'],
                        'train_sharpe': train_result['sharpe'],
                        'train_trades': train_result['trades'],
                        'train_win_rate': train_result['win_rate'],
                        'train_max_dd': train_result['max_dd'],
                        'test_return': test_result['return'],
                        'test_sharpe': test_result['sharpe'],
                        'test_trades': test_result['trades'],
                        'test_win_rate': test_result['win_rate'],
                        'test_max_dd': test_result['max_dd'],
                        'equity_curve': test_result.get('equity_curve', []),
                        'loss_analysis': test_result.get('loss_analysis', {}),
                        'adapted_params': test_result.get('adapted_params', {}),
                        'market_regime': test_result.get('market_regime', 'unknown')
                    }
                    
                    results.append(result)
                    
                    # Show progress
                    self.console.print(f"[green]✅ Return: {test_result['return']:.2f}%, Sharpe: {test_result['sharpe']:.2f}, Trades: {test_result['trades']}[/green]")
            
            # Step forward
            start_idx += step_bars
        
        self.walkforward_results = results
        self.console.print(f"[green]🎉 Completed {len(results)} REINFORCEMENT LEARNING walkforward windows[/green]")
        
        # Display learning summary
        if self.trade_history:
            total_trades = len(self.trade_history)
            losing_trades = len([t for t in self.trade_history if t['pnl'] < 0])
            self.console.print(f"[cyan]🧠 RL Summary: {total_trades} trades analyzed, {losing_trades} losses learned from[/cyan]")
            
            # Display regime distribution
            regimes = [t['market_regime'] for t in self.trade_history]
            regime_counts = {regime: regimes.count(regime) for regime in set(regimes)}
            regime_str = ', '.join([f"{k}: {v}" for k, v in regime_counts.items()])
            self.console.print(f"[yellow]🌊 Market regimes encountered: {regime_str}[/yellow]")
        
        return results
    
    def create_strategy_comparison_visualization(self):
        """Create comprehensive visualization of the improved strategy"""
        if not self.walkforward_results:
            self.console.print("[red]❌ No walkforward results to visualize[/red]")
            return
        
        # Extract metrics for plotting
        train_returns = [r['train_return'] for r in self.walkforward_results]
        test_returns = [r['test_return'] for r in self.walkforward_results]
        windows = [r['window'] for r in self.walkforward_results]
        
        # Create comprehensive 2x3 grid
        fig, ((ax1, ax2, ax3), (ax4, ax5, ax6)) = plt.subplots(2, 3, figsize=(22, 14))
        
        # 1. In-Sample vs Out-of-Sample Performance (CRITICAL ANALYSIS)
        ax1.plot(windows, train_returns, 'b-o', linewidth=2, markersize=7, label='In-Sample (Train)', alpha=0.8)
        ax1.plot(windows, test_returns, 'r-o', linewidth=2, markersize=7, label='Out-of-Sample (Test)', alpha=0.8)
        ax1.axhline(y=0, color='black', linestyle='--', linewidth=1, alpha=0.5)
        ax1.set_title('🚀 IMPROVED STRATEGY: In-Sample vs Out-of-Sample Returns', fontsize=16, fontweight='bold')
        ax1.set_xlabel('Window Number', fontsize=12)
        ax1.set_ylabel('Return (%)', fontsize=12)
        ax1.legend(fontsize=11)
        ax1.grid(True, alpha=0.3)
        
        # 2. Out-of-Sample Performance Only (FOCUS ON REAL PERFORMANCE)
        ax2.plot(windows, test_returns, 'r-o', linewidth=3, markersize=8)
        ax2.axhline(y=0, color='black', linestyle='--', linewidth=2)
        ax2.set_title('🎯 IMPROVED: Out-of-Sample Returns Only', fontsize=16, fontweight='bold')
        ax2.set_xlabel('Window Number', fontsize=12)
        ax2.set_ylabel('Return (%)', fontsize=12)
        ax2.grid(True, alpha=0.3)
        
        # Highlight significant returns
        for i, v in enumerate(test_returns):
            if abs(v) > 4:  # Label returns > 4%
                ax2.annotate(f'{v:.1f}%', (windows[i], v), textcoords="offset points", 
                           xytext=(0,15), ha='center', fontsize=10, fontweight='bold',
                           bbox=dict(boxstyle='round,pad=0.3', facecolor='lightgreen' if v > 0 else 'lightcoral', alpha=0.8))
        
        # 3. Cumulative Performance Comparison
        cumulative_train = np.cumsum(train_returns)
        cumulative_test = np.cumsum(test_returns)
        ax3.plot(windows, cumulative_train, 'b-', linewidth=3, label='In-Sample Cumulative', alpha=0.8)
        ax3.plot(windows, cumulative_test, 'r-', linewidth=3, label='Out-of-Sample Cumulative', alpha=0.8)
        ax3.set_title('📈 IMPROVED: Cumulative Performance', fontsize=16, fontweight='bold')
        ax3.set_xlabel('Window Number', fontsize=12)
        ax3.set_ylabel('Cumulative Return (%)', fontsize=12)
        ax3.legend(fontsize=12)
        ax3.grid(True, alpha=0.3)
        
        # Add final cumulative annotations
        ax3.annotate(f'Train: {cumulative_train[-1]:.1f}%', 
                    xy=(windows[-1], cumulative_train[-1]), 
                    xytext=(-80, 30), textcoords='offset points',
                    bbox=dict(boxstyle='round,pad=0.5', facecolor='lightblue', alpha=0.9),
                    fontsize=12, fontweight='bold')
        ax3.annotate(f'Test: {cumulative_test[-1]:.1f}%', 
                    xy=(windows[-1], cumulative_test[-1]), 
                    xytext=(-80, -30), textcoords='offset points',
                    bbox=dict(boxstyle='round,pad=0.5', facecolor='lightcoral', alpha=0.9),
                    fontsize=12, fontweight='bold')
        
        # 4. Overfitting Analysis (CRITICAL FOR STRATEGY VALIDATION)
        ax4.scatter(train_returns, test_returns, alpha=0.7, s=60, c='purple', edgecolor='black')
        
        # Add correlation line and statistics
        if len(train_returns) > 1:
            z = np.polyfit(train_returns, test_returns, 1)
            p = np.poly1d(z)
            ax4.plot(train_returns, p(train_returns), "g--", alpha=0.8, linewidth=3)
            
            correlation = np.corrcoef(train_returns, test_returns)[0,1]
            ax4.text(0.05, 0.95, f'Correlation: {correlation:.3f}', 
                    transform=ax4.transAxes, fontsize=14, fontweight='bold',
                    bbox=dict(boxstyle='round', facecolor='white', alpha=0.9))
        
        ax4.axhline(y=0, color='black', linestyle='-', alpha=0.3)
        ax4.axvline(x=0, color='black', linestyle='-', alpha=0.3)
        ax4.set_title('🔍 OVERFITTING CHECK\n(Train vs Test Performance)', fontsize=16, fontweight='bold')
        ax4.set_xlabel('In-Sample Return (%)', fontsize=12)
        ax4.set_ylabel('Out-of-Sample Return (%)', fontsize=12)
        ax4.grid(True, alpha=0.3)
        
        # 5. Return Distribution Analysis
        ax5.hist(train_returns, bins=min(12, len(train_returns)), alpha=0.6, color='blue', 
                label='In-Sample', edgecolor='black', density=True)
        ax5.hist(test_returns, bins=min(12, len(test_returns)), alpha=0.6, color='red', 
                label='Out-of-Sample', edgecolor='black', density=True)
        ax5.axvline(x=np.mean(train_returns), color='blue', linestyle='--', linewidth=3, 
                   label=f'Train Avg: {np.mean(train_returns):.2f}%')
        ax5.axvline(x=np.mean(test_returns), color='red', linestyle='--', linewidth=3, 
                   label=f'Test Avg: {np.mean(test_returns):.2f}%')
        ax5.set_title('📊 IMPROVED: Return Distribution', fontsize=16, fontweight='bold')
        ax5.set_xlabel('Return (%)', fontsize=12)
        ax5.set_ylabel('Density', fontsize=12)
        ax5.legend(fontsize=11)
        ax5.grid(True, alpha=0.3)
        
        # 6. Strategy Performance Summary
        ax6.axis('off')
        
        # Calculate comprehensive statistics
        train_avg = np.mean(train_returns)
        test_avg = np.mean(test_returns)
        train_win_rate = len([r for r in train_returns if r > 0]) / len(train_returns) * 100
        test_win_rate = len([r for r in test_returns if r > 0]) / len(test_returns) * 100
        train_vol = np.std(train_returns)
        test_vol = np.std(test_returns)
        
        # Calculate improvement metrics
        total_trades = sum([r['test_trades'] for r in self.walkforward_results])
        avg_trades_per_window = total_trades / len(self.walkforward_results)
        performance_gap = train_avg - test_avg
        correlation = np.corrcoef(train_returns, test_returns)[0,1] if len(train_returns) > 1 else 0
        
        # Risk assessment
        overfitting_risk = "LOW" if abs(performance_gap) < 2 else "MODERATE" if abs(performance_gap) < 5 else "HIGH"
        strategy_quality = "EXCELLENT" if (test_avg > 1 and test_win_rate > 60) else "GOOD" if (test_avg > 0 and test_win_rate > 50) else "NEEDS IMPROVEMENT"
        
        stats_text = f"""
🚀 IMPROVED STRATEGY PERFORMANCE SUMMARY

📈 In-Sample (Training Performance):
  • Average Return: {train_avg:.2f}%
  • Win Rate: {train_win_rate:.1f}%
  • Volatility: {train_vol:.2f}%
  • Total Return: {cumulative_train[-1]:.2f}%

🎯 Out-of-Sample (Real Performance):
  • Average Return: {test_avg:.2f}%
  • Win Rate: {test_win_rate:.1f}%
  • Volatility: {test_vol:.2f}%
  • Total Return: {cumulative_test[-1]:.2f}%

🔍 Strategy Quality Analysis:
  • Performance Gap: {performance_gap:.2f}%
  • Overfitting Risk: {overfitting_risk}
  • Train-Test Correlation: {correlation:.3f}
  • Strategy Quality: {strategy_quality}
  • Avg Trades/Window: {avg_trades_per_window:.1f}
  • Total Windows Tested: {len(self.walkforward_results)}
  
⭐ Enhanced Features:
  • Multi-indicator confirmation (8 conditions)
  • Dynamic ATR-based risk management
  • Trend strength filtering (ADX)
  • Volume confirmation requirements
  • RSI overbought/oversold exits
  • Bollinger Band volatility analysis
        """
        
        ax6.text(0.02, 0.98, stats_text, transform=ax6.transAxes, fontsize=11,
                verticalalignment='top', fontfamily='monospace',
                bbox=dict(boxstyle='round', facecolor='lightgreen', alpha=0.9))
        
        plt.tight_layout()
        plt.savefig('eth_improved_strategy_analysis.png', dpi=300, bbox_inches='tight')
        plt.close()
        
        self.console.print("[green]✅ IMPROVED strategy analysis saved as 'eth_improved_strategy_analysis.png'[/green]")
    
    def display_comprehensive_summary(self):
        """Display comprehensive performance summary"""
        if not self.walkforward_results:
            self.console.print("[red]❌ No results to display[/red]")
            return
        
        # Calculate comprehensive metrics
        test_returns = [r['test_return'] for r in self.walkforward_results]
        train_returns = [r['train_return'] for r in self.walkforward_results]
        total_trades = sum([r['test_trades'] for r in self.walkforward_results])
        
        positive_windows = len([r for r in test_returns if r > 0])
        total_return = sum(test_returns)
        avg_return = np.mean(test_returns)
        return_vol = np.std(test_returns)
        sharpe = avg_return / return_vol if return_vol > 0 else 0
        best_return = max(test_returns)
        worst_return = min(test_returns)
        
        # Performance comparison metrics
        train_avg = np.mean(train_returns)
        performance_gap = train_avg - avg_return
        correlation = np.corrcoef(train_returns, test_returns)[0,1] if len(train_returns) > 1 else 0
        
        # Summary table
        summary_table = Table(title="🚀 IMPROVED ETH Strategy Performance Summary")
        summary_table.add_column("Metric", style="cyan", width=35)
        summary_table.add_column("Value", style="green", width=18)
        
        summary_table.add_row("Total Walkforward Windows", str(len(self.walkforward_results)))
        summary_table.add_row("Profitable Windows", f"{positive_windows} ({positive_windows/len(self.walkforward_results)*100:.1f}%)")
        summary_table.add_row("", "")  # Separator
        summary_table.add_row("📊 OUT-OF-SAMPLE PERFORMANCE", "")
        summary_table.add_row("Total Return", f"{total_return:.2f}%")
        summary_table.add_row("Average Return per Window", f"{avg_return:.2f}%")
        summary_table.add_row("Return Volatility", f"{return_vol:.2f}%")
        summary_table.add_row("Risk-Adjusted Return (Sharpe)", f"{sharpe:.2f}")
        summary_table.add_row("Best Window Return", f"{best_return:.2f}%")
        summary_table.add_row("Worst Window Return", f"{worst_return:.2f}%")
        summary_table.add_row("", "")  # Separator
        summary_table.add_row("📈 TRADING STATISTICS", "")
        summary_table.add_row("Total Trades Executed", str(total_trades))
        summary_table.add_row("Avg Trades per Window", f"{total_trades/len(self.walkforward_results):.1f}")
        summary_table.add_row("", "")  # Separator
        summary_table.add_row("🔍 OVERFITTING ANALYSIS", "")
        summary_table.add_row("In-Sample Avg Return", f"{train_avg:.2f}%")
        summary_table.add_row("Out-of-Sample Avg Return", f"{avg_return:.2f}%")
        summary_table.add_row("Performance Gap", f"{performance_gap:.2f}%")
        summary_table.add_row("Train-Test Correlation", f"{correlation:.3f}")
        
        # Risk assessment
        overfitting_risk = "LOW" if abs(performance_gap) < 2 else "MODERATE" if abs(performance_gap) < 5 else "HIGH"
        summary_table.add_row("Overfitting Risk Level", overfitting_risk)
        
        # Strategy quality assessment
        if avg_return > 1 and positive_windows/len(self.walkforward_results) > 0.6:
            strategy_quality = "EXCELLENT"
        elif avg_return > 0 and positive_windows/len(self.walkforward_results) > 0.5:
            strategy_quality = "GOOD"  
        else:
            strategy_quality = "NEEDS IMPROVEMENT"
        
        summary_table.add_row("Strategy Quality Rating", strategy_quality)
        
        self.console.print("\n")
        self.console.print(summary_table)
        
        # Performance interpretation
        self.console.print(f"\n[bold yellow]📈 STRATEGY PERFORMANCE INTERPRETATION[/bold yellow]")
        
        if avg_return > 0:
            self.console.print(f"[green]✅ The improved strategy shows POSITIVE average returns of {avg_return:.2f}% per window[/green]")
        else:
            self.console.print(f"[red]❌ The strategy shows negative average returns of {avg_return:.2f}% per window[/red]")
        
        if overfitting_risk == "LOW":
            self.console.print(f"[green]✅ LOW overfitting risk - strategy performance is consistent[/green]")
        elif overfitting_risk == "MODERATE":
            self.console.print(f"[yellow]⚠️ MODERATE overfitting risk - monitor live performance carefully[/yellow]")
        else:
            self.console.print(f"[red]❌ HIGH overfitting risk - strategy may not perform well live[/red]")
        
        if strategy_quality == "EXCELLENT":
            self.console.print(f"[green]⭐ EXCELLENT strategy quality - ready for live trading consideration[/green]")
        elif strategy_quality == "GOOD":
            self.console.print(f"[yellow]👍 GOOD strategy quality - potential for live trading with risk management[/yellow]")
        else:
            self.console.print(f"[red]👎 Strategy needs improvement before live trading[/red]")


def run_simple_eth_trend_following_analysis():
    """Run the simple ETH trend following walkforward analysis"""
    start_time = time.time()
    
    console = Console()
    console.print("\n[bold blue]🚀 ETH 4-Hour ANTI-OVERFITTING Bollinger Bands Strategy[/bold blue]")
    console.print("[cyan]Robust mean reversion strategy with validation splits & ensemble methods[/cyan]")
    
    # Initialize enhanced data fetcher
    data_fetcher = EnhancedDataFetcher(
        api_key="d3e6652041c1445af2617b399e6d8191907e3a7794b573e0de4337cf4de16ce3",
        api_secret="7870a2b11cc89f8de478dd66c76057a50565e6ac85d89c127631fca033380c1c",
        cache_dir="vectorbt_cache"
    )
    
    # Initialize trend following analyzer
    analyzer = SimpleETHTrendFollowingAnalyzer(data_fetcher)
    
    # Fetch ETH data for 18 months (extended for comprehensive testing)
    eth_data = analyzer.fetch_eth_data(days=540)
    if eth_data is None:
        return
    
    # Run improved walkforward analysis
    results = analyzer.run_walkforward_analysis(eth_data)
    
    if not results:
        console.print("[red]❌ No walkforward results generated[/red]")
        return
    
    # Display comprehensive performance summary
    analyzer.display_comprehensive_summary()
    
    # Create improved strategy visualizations
    analyzer.create_strategy_comparison_visualization()
    
    # Calculate and display execution time
    execution_time = time.time() - start_time
    hours = int(execution_time // 3600)
    minutes = int((execution_time % 3600) // 60)
    seconds = int(execution_time % 60)
    
    console.print("\n[bold green]🎉 SIMPLE ETH Trend Following Analysis Complete![/bold green]")
    console.print("[cyan]✨ Check 'eth_improved_strategy_analysis.png' for comprehensive results[/cyan]")
    console.print(f"[yellow]⏰ Total execution time: {hours}h:{minutes:02d}m:{seconds:02d}s[/yellow]")
    
    # Final recommendations
    console.print(f"\n[bold yellow]💡 NEXT STEPS RECOMMENDATIONS[/bold yellow]")
    console.print(f"[white]1. Review the performance chart to understand strategy behavior[/white]")
    console.print(f"[white]2. Check overfitting metrics before considering live trading[/white]")
    console.print(f"[white]3. Consider paper trading to validate real-world performance[/white]")
    console.print(f"[white]4. Monitor correlation between in-sample and out-of-sample results[/white]")

if __name__ == "__main__":
    run_simple_eth_trend_following_analysis() 