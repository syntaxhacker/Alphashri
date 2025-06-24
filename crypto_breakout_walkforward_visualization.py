#!/usr/bin/env python3
"""
Beautiful Walk Forward Analysis Visualization for BTCUSDT
Using Crypto Breakout Strategy with rolling optimization and performance tracking
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta
import yfinance as yf
import warnings
from typing import Dict, List, Tuple
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.express as px
from strategies.breakout_strategy import BreakoutStrategy
from backtester.backtest_engine import BacktestEngine
import json

warnings.filterwarnings('ignore')

# Set style for beautiful plots
plt.style.use('seaborn-v0_8')
sns.set_palette("husl")

class CryptoWalkForwardAnalysis:
    """Beautiful walk forward analysis for crypto breakout strategy"""
    
    def __init__(self, symbol="BTC-USD", train_days=90, test_days=30, step_days=15):
        self.symbol = symbol
        self.train_days = train_days
        self.test_days = test_days  
        self.step_days = step_days
        
        # Results storage
        self.results = []
        self.optimization_history = []
        self.backtest_engine = BacktestEngine()
        
        # Performance metrics
        self.metrics_history = {
            'dates': [],
            'total_return': [],
            'sharpe_ratio': [],
            'max_drawdown': [],
            'win_rate': [],
            'profit_factor': [],
            'trades_count': [],
            'avg_trade_duration': [],
            'best_params': []
        }
        
    def fetch_data(self, period="2y"):
        """Fetch BTCUSDT data from Yahoo Finance"""
        print(f"🔄 Fetching {self.symbol} data for {period}...")
        
        try:
            ticker = yf.Ticker(self.symbol)
            data = ticker.history(period=period, interval="1h")
            
            if data.empty:
                raise ValueError("No data fetched")
                
            # Rename columns to match strategy expectations
            data.columns = [col.lower() for col in data.columns]
            data = data.dropna()
            
            print(f"✅ Fetched {len(data)} data points from {data.index[0]} to {data.index[-1]}")
            return data
            
        except Exception as e:
            print(f"❌ Error fetching data: {e}")
            return None
    
    def optimize_strategy(self, train_data: pd.DataFrame, n_calls=50) -> Dict:
        """Optimize strategy parameters on training data"""
        print(f"🔧 Optimizing strategy on {len(train_data)} training samples...")
        
        # Parameter space for breakout strategy
        param_ranges = {
            'lookback_periods': [3, 5, 10, 15, 20],
            'volume_multiplier': [0.8, 1.0, 1.2, 1.5, 2.0],
            'min_breakout_percent': [0.01, 0.02, 0.03, 0.05, 0.08],
            'sl_percent': [0.5, 0.8, 1.0, 1.5, 2.0],
            'tp_percent': [1.0, 1.5, 2.0, 3.0, 4.0],
            'trailing_stop_percent': [0.3, 0.5, 0.8, 1.0, 1.5]
        }
        
        best_params = None
        best_score = -float('inf')
        
        # Grid search optimization (simplified for speed)
        for lookback in param_ranges['lookback_periods']:
            for vol_mult in param_ranges['volume_multiplier']:
                for breakout_pct in param_ranges['min_breakout_percent']:
                    for sl in param_ranges['sl_percent']:
                        for tp in param_ranges['tp_percent']:
                            for trail in param_ranges['trailing_stop_percent']:
                                
                                # Test this parameter combination
                                params = {
                                    'lookback_periods': lookback,
                                    'volume_multiplier': vol_mult,
                                    'min_breakout_percent': breakout_pct,
                                    'sl_percent': sl,
                                    'tp_percent': tp,
                                    'trailing_stop_percent': trail
                                }
                                
                                try:
                                    strategy = BreakoutStrategy(**params)
                                    result = self.backtest_engine.run_backtest(
                                        train_data, strategy, initial_balance=10000
                                    )
                                    
                                    # Score based on risk-adjusted returns
                                    if result and 'sharpe_ratio' in result:
                                        score = result['sharpe_ratio']
                                        
                                        if score > best_score:
                                            best_score = score
                                            best_params = params
                                            
                                except Exception:
                                    continue
        
        print(f"✅ Best Sharpe ratio: {best_score:.3f}")
        return best_params or {
            'lookback_periods': 10,
            'volume_multiplier': 1.2,
            'min_breakout_percent': 0.03,
            'sl_percent': 1.0,
            'tp_percent': 2.0,
            'trailing_stop_percent': 0.8
        }
    
    def run_walk_forward_analysis(self, data: pd.DataFrame) -> List[Dict]:
        """Run comprehensive walk forward analysis"""
        print(f"🚀 Starting walk forward analysis...")
        print(f"📊 Train: {self.train_days} days, Test: {self.test_days} days, Step: {self.step_days} days")
        
        results = []
        total_periods = len(data)
        train_samples = int(self.train_days * 24)  # Convert days to hours
        test_samples = int(self.test_days * 24)
        step_samples = int(self.step_days * 24)
        
        start_idx = 0
        period_num = 0
        
        while start_idx + train_samples + test_samples < total_periods:
            period_num += 1
            print(f"\n📈 Period {period_num}: Training on samples {start_idx} to {start_idx + train_samples}")
            
            # Split data
            train_end = start_idx + train_samples
            test_start = train_end
            test_end = test_start + test_samples
            
            train_data = data.iloc[start_idx:train_end].copy()
            test_data = data.iloc[test_start:test_end].copy()
            
            # Optimize on training data
            best_params = self.optimize_strategy(train_data)
            
            # Test on out-of-sample data
            strategy = BreakoutStrategy(**best_params)
            test_result = self.backtest_engine.run_backtest(
                test_data, strategy, initial_balance=10000
            )
            
            if test_result:
                # Store results
                period_result = {
                    'period': period_num,
                    'train_start': train_data.index[0],
                    'train_end': train_data.index[-1],
                    'test_start': test_data.index[0],
                    'test_end': test_data.index[-1],
                    'best_params': best_params,
                    'performance': test_result
                }
                
                results.append(period_result)
                
                # Update metrics history
                self.metrics_history['dates'].append(test_data.index[-1])
                self.metrics_history['total_return'].append(test_result.get('total_return', 0))
                self.metrics_history['sharpe_ratio'].append(test_result.get('sharpe_ratio', 0))
                self.metrics_history['max_drawdown'].append(test_result.get('max_drawdown', 0))
                self.metrics_history['win_rate'].append(test_result.get('win_rate', 0))
                self.metrics_history['profit_factor'].append(test_result.get('profit_factor', 0))
                self.metrics_history['trades_count'].append(test_result.get('total_trades', 0))
                self.metrics_history['avg_trade_duration'].append(test_result.get('avg_trade_duration_hours', 0))
                self.metrics_history['best_params'].append(best_params)
                
                print(f"✅ Period {period_num} complete - Return: {test_result.get('total_return', 0):.2f}%")
            
            # Move to next period
            start_idx += step_samples
        
        print(f"\n🎉 Walk forward analysis complete! Analyzed {len(results)} periods")
        self.results = results
        return results
    
    def create_performance_dashboard(self):
        """Create beautiful interactive dashboard with Plotly"""
        if not self.results:
            print("❌ No results to visualize")
            return
            
        # Create subplots
        fig = make_subplots(
            rows=4, cols=2,
            subplot_titles=(
                'Cumulative Returns Over Time', 'Rolling Sharpe Ratio',
                'Maximum Drawdown Evolution', 'Win Rate Progression', 
                'Trade Count per Period', 'Profit Factor Timeline',
                'Parameter Stability', 'Risk-Return Scatter'
            ),
            specs=[[{}, {}], [{}, {}], [{}, {}], [{"colspan": 2}, None]],
            vertical_spacing=0.08
        )
        
        dates = self.metrics_history['dates']
        
        # 1. Cumulative Returns
        cumulative_returns = np.cumprod(1 + np.array(self.metrics_history['total_return'])/100) - 1
        fig.add_trace(
            go.Scatter(x=dates, y=cumulative_returns*100, name='Cumulative Return',
                      line=dict(color='#2E86AB', width=3), fill='tonexty'),
            row=1, col=1
        )
        
        # 2. Rolling Sharpe Ratio
        fig.add_trace(
            go.Scatter(x=dates, y=self.metrics_history['sharpe_ratio'], name='Sharpe Ratio',
                      line=dict(color='#A23B72', width=2)),
            row=1, col=2
        )
        
        # 3. Maximum Drawdown
        fig.add_trace(
            go.Scatter(x=dates, y=np.array(self.metrics_history['max_drawdown'])*100, 
                      name='Max Drawdown', line=dict(color='#F18F01', width=2),
                      fill='tozeroy'),
            row=2, col=1
        )
        
        # 4. Win Rate
        fig.add_trace(
            go.Scatter(x=dates, y=np.array(self.metrics_history['win_rate'])*100, 
                      name='Win Rate %', line=dict(color='#C73E1D', width=2)),
            row=2, col=2
        )
        
        # 5. Trade Count
        fig.add_trace(
            go.Bar(x=dates, y=self.metrics_history['trades_count'], name='Trades',
                   marker_color='#3F88C5'),
            row=3, col=1
        )
        
        # 6. Profit Factor
        fig.add_trace(
            go.Scatter(x=dates, y=self.metrics_history['profit_factor'], name='Profit Factor',
                      line=dict(color='#032B43', width=2)),
            row=3, col=2
        )
        
        # 7. Risk-Return Scatter
        fig.add_trace(
            go.Scatter(x=np.array(self.metrics_history['max_drawdown'])*100,
                      y=self.metrics_history['total_return'],
                      mode='markers', name='Risk-Return',
                      marker=dict(size=10, color=self.metrics_history['sharpe_ratio'],
                                colorscale='Viridis', showscale=True,
                                colorbar=dict(title="Sharpe Ratio"))),
            row=4, col=1
        )
        
        # Update layout
        fig.update_layout(
            title=dict(
                text='🚀 BTCUSDT Crypto Breakout Strategy - Walk Forward Analysis Dashboard',
                x=0.5, font=dict(size=20, color='#1f77b4')
            ),
            showlegend=False,
            height=1200,
            template='plotly_white',
            font=dict(size=12)
        )
        
        # Update axes
        fig.update_xaxes(title_text="Date", row=4, col=1)
        fig.update_yaxes(title_text="Max Drawdown %", row=4, col=1)
        fig.update_yaxes(title_text="Return %", row=4, col=1)
        
        return fig
    
    def create_parameter_heatmap(self):
        """Create heatmap showing parameter evolution"""
        if not self.results:
            return None
            
        # Extract parameter evolution
        param_names = list(self.results[0]['best_params'].keys())
        param_evolution = {param: [] for param in param_names}
        dates = []
        
        for result in self.results:
            dates.append(result['test_end'])
            for param in param_names:
                param_evolution[param].append(result['best_params'][param])
        
        # Create DataFrame for heatmap
        param_df = pd.DataFrame(param_evolution, index=dates)
        
        # Normalize for better visualization
        param_df_norm = (param_df - param_df.min()) / (param_df.max() - param_df.min())
        
        fig, ax = plt.subplots(figsize=(14, 8))
        sns.heatmap(param_df_norm.T, annot=True, fmt='.2f', cmap='RdYlBu_r', 
                   cbar_kws={'label': 'Normalized Parameter Value'}, ax=ax)
        
        plt.title('🔧 Strategy Parameter Evolution Over Time', fontsize=16, pad=20)
        plt.xlabel('Test Period End Date', fontsize=12)
        plt.ylabel('Strategy Parameters', fontsize=12)
        plt.xticks(rotation=45)
        plt.tight_layout()
        
        return fig
    
    def create_summary_statistics(self):
        """Create comprehensive summary statistics"""
        if not self.results:
            return None
            
        # Calculate overall statistics
        total_returns = self.metrics_history['total_return']
        sharpe_ratios = self.metrics_history['sharpe_ratio']
        max_drawdowns = self.metrics_history['max_drawdown']
        win_rates = self.metrics_history['win_rate']
        
        summary_stats = {
            'Total Periods': len(self.results),
            'Avg Return per Period': f"{np.mean(total_returns):.2f}%",
            'Std Return': f"{np.std(total_returns):.2f}%",
            'Best Period Return': f"{np.max(total_returns):.2f}%",
            'Worst Period Return': f"{np.min(total_returns):.2f}%",
            'Avg Sharpe Ratio': f"{np.mean(sharpe_ratios):.3f}",
            'Best Sharpe Ratio': f"{np.max(sharpe_ratios):.3f}",
            'Avg Max Drawdown': f"{np.mean(max_drawdowns)*100:.2f}%",
            'Worst Drawdown': f"{np.max(max_drawdowns)*100:.2f}%",
            'Avg Win Rate': f"{np.mean(win_rates)*100:.1f}%",
            'Positive Periods': f"{sum(1 for r in total_returns if r > 0)}/{len(total_returns)}",
            'Win Rate (Periods)': f"{sum(1 for r in total_returns if r > 0)/len(total_returns)*100:.1f}%"
        }
        
        return summary_stats
    
    def save_results(self, filename="walkforward_results.json"):
        """Save results to JSON file"""
        output_data = {
            'analysis_config': {
                'symbol': self.symbol,
                'train_days': self.train_days,
                'test_days': self.test_days,
                'step_days': self.step_days
            },
            'summary_statistics': self.create_summary_statistics(),
            'metrics_history': {
                'dates': [d.isoformat() for d in self.metrics_history['dates']],
                'total_return': self.metrics_history['total_return'],
                'sharpe_ratio': self.metrics_history['sharpe_ratio'],
                'max_drawdown': self.metrics_history['max_drawdown'],
                'win_rate': self.metrics_history['win_rate'],
                'profit_factor': self.metrics_history['profit_factor'],
                'trades_count': self.metrics_history['trades_count'],
                'best_params': self.metrics_history['best_params']
            }
        }
        
        with open(filename, 'w') as f:
            json.dump(output_data, f, indent=2, default=str)
        
        print(f"💾 Results saved to {filename}")

def run_crypto_walkforward_analysis():
    """Main function to run the complete walk forward analysis"""
    
    print("""
    🚀 CRYPTO BREAKOUT STRATEGY - WALK FORWARD ANALYSIS 🚀
    =====================================================
    
    📊 Analyzing BTCUSDT with rolling optimization
    🔧 Strategy: Momentum Breakout with Volume Confirmation
    📈 Period: Last 2 years of hourly data
    
    """)
    
    # Initialize analysis
    analyzer = CryptoWalkForwardAnalysis(
        symbol="BTC-USD",
        train_days=90,   # 3 months training
        test_days=30,    # 1 month testing  
        step_days=15     # 2 weeks step forward
    )
    
    # Fetch data
    data = analyzer.fetch_data(period="2y")
    if data is None:
        print("❌ Failed to fetch data")
        return
    
    # Run walk forward analysis
    results = analyzer.run_walk_forward_analysis(data)
    
    if not results:
        print("❌ No results generated")
        return
    
    # Create visualizations
    print("\n🎨 Creating beautiful visualizations...")
    
    # Interactive dashboard
    dashboard = analyzer.create_performance_dashboard()
    if dashboard:
        dashboard.write_html("crypto_walkforward_dashboard.html")
        print("✅ Interactive dashboard saved as 'crypto_walkforward_dashboard.html'")
        dashboard.show()
    
    # Parameter heatmap
    heatmap_fig = analyzer.create_parameter_heatmap()
    if heatmap_fig:
        heatmap_fig.savefig("parameter_evolution_heatmap.png", dpi=300, bbox_inches='tight')
        print("✅ Parameter heatmap saved as 'parameter_evolution_heatmap.png'")
        plt.show()
    
    # Print summary statistics
    summary = analyzer.create_summary_statistics()
    if summary:
        print(f"""
        
    📊 WALK FORWARD ANALYSIS SUMMARY
    ===============================
    """)
        for key, value in summary.items():
            print(f"    {key:.<25} {value}")
    
    # Save results
    analyzer.save_results("crypto_walkforward_results.json")
    
    print(f"""
    
    🎉 ANALYSIS COMPLETE! 
    ==================
    
    📁 Files Generated:
    • crypto_walkforward_dashboard.html (Interactive Dashboard)
    • parameter_evolution_heatmap.png (Parameter Stability Chart)
    • crypto_walkforward_results.json (Raw Results Data)
    
    💡 Key Insights:
    • Tested {len(results)} different market periods
    • Average return per period: {np.mean(analyzer.metrics_history['total_return']):.2f}%
    • Best Sharpe ratio achieved: {np.max(analyzer.metrics_history['sharpe_ratio']):.3f}
    • Strategy adaptability score: {len([r for r in analyzer.metrics_history['total_return'] if r > 0])/len(analyzer.metrics_history['total_return'])*100:.1f}%
    
    """)

if __name__ == "__main__":
    run_crypto_walkforward_analysis() 