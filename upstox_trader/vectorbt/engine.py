#!/usr/bin/env python3
"""
Trading Engine Module
Handles backtesting, portfolio simulation, and trade execution logic
Decoupled from strategies and reporting
"""

import pandas as pd
import numpy as np
import vectorbt as vbt
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import warnings
warnings.filterwarnings('ignore')

# Set VectorBT frequency globally for 15-min intraday
vbt.settings.array_wrapper['freq'] = '15min'


class TradingEngine:
    """
    Core trading engine for backtesting and portfolio simulation
    Handles trade execution, risk management, and performance calculation
    """
    
    def __init__(self, initial_capital: float = 10000, fees: float = 0.0003):
        self.initial_capital = initial_capital
        self.fees = fees
        self.results_cache = {}
    
    def run_backtest(self, data: pd.DataFrame, buy_signals: pd.Series, 
                    sell_signals: pd.Series, symbol: str) -> Dict:
        """
        Run VectorBT backtest with given signals
        
        Args:
            data: OHLCV data
            buy_signals: Boolean series for buy signals
            sell_signals: Boolean series for sell signals  
            symbol: Stock symbol
            
        Returns:
            Dictionary with backtest results
        """
        try:
            close_data = data['close']
            
            # Ensure signals align with close data
            buy_aligned = buy_signals.reindex(close_data.index, fill_value=False)
            sell_aligned = sell_signals.reindex(close_data.index, fill_value=False)
            
            # Run VectorBT portfolio simulation
            portfolio = vbt.Portfolio.from_signals(
                close_data,
                buy_aligned,
                sell_aligned,
                init_cash=self.initial_capital,
                fees=self.fees
            )
            
            # Calculate performance metrics
            total_return = portfolio.total_return() * 100
            total_pnl = (portfolio.final_value() - self.initial_capital)
            sharpe_ratio = portfolio.sharpe_ratio()
            max_drawdown = portfolio.max_drawdown() * 100
            win_rate = portfolio.trades.win_rate() * 100 if portfolio.trades.count() > 0 else 0
            total_trades = portfolio.trades.count()
            avg_trade_duration = portfolio.trades.duration.mean() if total_trades > 0 else 0
            
            # Additional metrics
            profit_factor = self._calculate_profit_factor(portfolio)
            calmar_ratio = self._calculate_calmar_ratio(portfolio)
            
            result = {
                'symbol': symbol,
                'status': 'SUCCESS',
                'data_period': f"{data.index[0]} to {data.index[-1]}",
                'total_return': float(total_return) if not np.isnan(total_return) else 0.0,
                'total_pnl': float(total_pnl) if not np.isnan(total_pnl) else 0.0,
                'final_value': float(portfolio.final_value()),
                'sharpe_ratio': float(sharpe_ratio) if not np.isnan(sharpe_ratio) else 0.0,
                'max_drawdown': float(max_drawdown) if not np.isnan(max_drawdown) else 0.0,
                'win_rate': float(win_rate) if not np.isnan(win_rate) else 0.0,
                'total_trades': int(total_trades),
                'buy_signals': int(buy_signals.sum()),
                'sell_signals': int(sell_signals.sum()),
                'avg_trade_duration': float(avg_trade_duration),
                'profit_factor': profit_factor,
                'calmar_ratio': calmar_ratio,
                'portfolio': portfolio  # Store for detailed analysis
            }
            
            return result
            
        except Exception as e:
            return {
                'symbol': symbol,
                'status': 'FAILED',
                'error': str(e)
            }
    
    def _calculate_profit_factor(self, portfolio) -> float:
        """Calculate profit factor (gross profit / gross loss)"""
        try:
            if portfolio.trades.count() == 0:
                return 0.0
            
            winning_trades = portfolio.trades.pnl[portfolio.trades.pnl > 0]
            losing_trades = portfolio.trades.pnl[portfolio.trades.pnl < 0]
            
            gross_profit = winning_trades.sum()
            gross_loss = abs(losing_trades.sum())
            
            if gross_loss == 0:
                return float('inf') if gross_profit > 0 else 0.0
            
            return gross_profit / gross_loss
        except:
            return 0.0
    
    def _calculate_calmar_ratio(self, portfolio) -> float:
        """Calculate Calmar ratio (annual return / max drawdown)"""
        try:
            annual_return = portfolio.total_return() * 252  # Approximate annualization
            max_dd = portfolio.max_drawdown()
            
            if max_dd == 0:
                return float('inf') if annual_return > 0 else 0.0
            
            return annual_return / max_dd
        except:
            return 0.0
    
    def batch_backtest(self, data_dict: Dict[str, pd.DataFrame], 
                      signals_dict: Dict[str, Tuple[pd.Series, pd.Series]]) -> List[Dict]:
        """
        Run backtests for multiple symbols in batch
        
        Args:
            data_dict: Dictionary of {symbol: OHLCV_data}
            signals_dict: Dictionary of {symbol: (buy_signals, sell_signals)}
            
        Returns:
            List of backtest results
        """
        results = []
        
        for symbol in data_dict.keys():
            if symbol in signals_dict:
                data = data_dict[symbol]
                buy_signals, sell_signals = signals_dict[symbol]
                
                result = self.run_backtest(data, buy_signals, sell_signals, symbol)
                results.append(result)
        
        return results
    
    def optimize_parameters(self, data: pd.DataFrame, strategy, 
                          param_ranges: Dict, symbol: str) -> Dict:
        """
        Simple grid search parameter optimization
        
        Args:
            data: OHLCV data
            strategy: Strategy instance
            param_ranges: Dictionary of parameter ranges to test
            symbol: Stock symbol
            
        Returns:
            Best parameters and results
        """
        best_result = None
        best_params = None
        best_pnl = float('-inf')
        
        # Generate parameter combinations
        param_combinations = self._generate_param_combinations(param_ranges)
        
        for params in param_combinations[:20]:  # Limit to 20 combinations
            # Update strategy parameters
            strategy.update_parameters(**params)
            
            # Calculate indicators and generate signals
            indicators = strategy.calculate_indicators(data)
            buy_signals, sell_signals = strategy.generate_signals(indicators)
            
            # Run backtest
            result = self.run_backtest(data, buy_signals, sell_signals, symbol)
            
            if result['status'] == 'SUCCESS' and result['total_pnl'] > best_pnl:
                best_pnl = result['total_pnl']
                best_result = result
                best_params = params.copy()
        
        return {
            'best_params': best_params,
            'best_result': best_result,
            'optimization_symbol': symbol
        }
    
    def _generate_param_combinations(self, param_ranges: Dict) -> List[Dict]:
        """Generate parameter combinations for optimization"""
        import itertools
        
        keys = list(param_ranges.keys())
        values = list(param_ranges.values())
        
        combinations = []
        for combo in itertools.product(*values):
            combinations.append(dict(zip(keys, combo)))
        
        return combinations


class RiskManager:
    """
    Risk management module for position sizing and risk controls
    """
    
    def __init__(self, max_position_size: float = 1.0, max_daily_loss: float = 0.02,
                 max_drawdown: float = 0.1):
        self.max_position_size = max_position_size  # As fraction of capital
        self.max_daily_loss = max_daily_loss  # 2% daily loss limit
        self.max_drawdown = max_drawdown  # 10% total drawdown limit
    
    def calculate_position_size(self, capital: float, price: float, 
                              volatility: float = None) -> int:
        """Calculate position size based on risk parameters"""
        max_amount = capital * self.max_position_size
        position_size = int(max_amount / price)
        
        # Apply volatility adjustment if provided
        if volatility and volatility > 0.02:  # High volatility
            position_size = int(position_size * 0.5)  # Reduce size
        
        return max(1, position_size)
    
    def check_risk_limits(self, current_pnl: float, capital: float, 
                         current_drawdown: float) -> Dict[str, bool]:
        """Check if risk limits are breached"""
        daily_loss_pct = current_pnl / capital
        
        return {
            'daily_loss_ok': daily_loss_pct > -self.max_daily_loss,
            'drawdown_ok': current_drawdown < self.max_drawdown,
            'can_trade': (daily_loss_pct > -self.max_daily_loss and 
                         current_drawdown < self.max_drawdown)
        }


class PerformanceAnalyzer:
    """
    Performance analysis and metrics calculation
    """
    
    @staticmethod
    def calculate_metrics(results: List[Dict]) -> Dict:
        """Calculate aggregate performance metrics"""
        successful_results = [r for r in results if r['status'] == 'SUCCESS']
        
        if not successful_results:
            return {'status': 'NO_SUCCESSFUL_TRADES'}
        
        total_pnl = sum(r['total_pnl'] for r in successful_results)
        total_trades = sum(r['total_trades'] for r in successful_results)
        avg_return = np.mean([r['total_return'] for r in successful_results])
        avg_sharpe = np.mean([r['sharpe_ratio'] for r in successful_results])
        avg_win_rate = np.mean([r['win_rate'] for r in successful_results])
        avg_max_dd = np.mean([r['max_drawdown'] for r in successful_results])
        
        profitable_stocks = len([r for r in successful_results if r['total_pnl'] > 0])
        
        return {
            'total_pnl': total_pnl,
            'total_trades': total_trades,
            'avg_return': avg_return,
            'avg_sharpe': avg_sharpe,
            'avg_win_rate': avg_win_rate,
            'avg_max_dd': avg_max_dd,
            'profitable_stocks': profitable_stocks,
            'total_stocks': len(successful_results),
            'success_rate': profitable_stocks / len(successful_results) * 100
        }
    
    @staticmethod
    def rank_results(results: List[Dict], sort_by: str = 'total_pnl') -> List[Dict]:
        """Rank results by specified metric"""
        successful_results = [r for r in results if r['status'] == 'SUCCESS']
        
        reverse_sort = sort_by in ['total_pnl', 'total_return', 'sharpe_ratio', 'win_rate']
        
        return sorted(successful_results, 
                     key=lambda x: x.get(sort_by, 0), 
                     reverse=reverse_sort)
    
    @staticmethod
    def generate_summary(results: List[Dict], strategy_name: str, 
                        timeframe: str, days: int) -> Dict:
        """Generate comprehensive summary of results"""
        metrics = PerformanceAnalyzer.calculate_metrics(results)
        ranked_results = PerformanceAnalyzer.rank_results(results)
        failed_results = [r for r in results if r['status'] == 'FAILED']
        
        return {
            'strategy_name': strategy_name,
            'timeframe': timeframe,
            'analysis_period': days,
            'execution_time': datetime.now().isoformat(),
            'summary_metrics': metrics,
            'top_performers': ranked_results[:5],  # Top 5
            'worst_performers': ranked_results[-5:],  # Bottom 5
            'failed_symbols': [r['symbol'] for r in failed_results],
            'total_symbols_analyzed': len(results)
        }