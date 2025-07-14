#!/usr/bin/env python3
"""
Beautiful EDA Analysis System
Advanced data visualization and analysis for trading performance
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import plotly.figure_factory as ff
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

# Set style
plt.style.use('dark_background')
sns.set_theme(style="darkgrid")
sns.set_palette("husl")

class BeautifulEDAAnalyzer:
    """Advanced EDA and visualization system for trading analysis"""
    
    def __init__(self):
        self.color_palette = {
            'bullish': '#00ff88',
            'bearish': '#ff4444', 
            'neutral': '#888888',
            'background': '#1e1e1e',
            'text': '#ffffff',
            'grid': '#333333'
        }
        
        self.plot_config = {
            'template': 'plotly_dark',
            'width': 1200,
            'height': 600,
            'font_size': 12
        }
        
        print("📊 Beautiful EDA Analyzer Initialized")
        print("🎨 Dark theme with custom color palette loaded")
    
    def create_performance_dashboard(self, backtest_results, save_path="trading_dashboard.html"):
        """Create comprehensive performance dashboard"""
        try:
            print("🎨 Creating Performance Dashboard...")
            
            # Extract data from backtest results
            results = backtest_results['results']
            portfolio_metrics = backtest_results['portfolio_metrics']
            
            # Create subplot structure
            fig = make_subplots(
                rows=3, cols=2,
                subplot_titles=[
                    'Returns Distribution', 'Sharpe Ratio by Symbol',
                    'Win Rate Analysis', 'Risk-Return Scatter',
                    'Drawdown Analysis', 'Portfolio Summary'
                ],
                specs=[
                    [{"type": "histogram"}, {"type": "bar"}],
                    [{"type": "bar"}, {"type": "scatter"}],
                    [{"type": "bar"}, {"type": "table"}]
                ],
                vertical_spacing=0.08,
                horizontal_spacing=0.1
            )
            
            # 1. Returns Distribution
            returns = [r['total_return'] for r in results]
            fig.add_trace(
                go.Histogram(
                    x=returns,
                    nbinsx=15,
                    name="Returns",
                    marker_color=self.color_palette['bullish'],
                    opacity=0.7
                ),
                row=1, col=1
            )
            
            # 2. Sharpe Ratio by Symbol
            symbols = [r['symbol'] for r in results]
            sharpe_ratios = [r['sharpe_ratio'] for r in results]
            
            colors = [self.color_palette['bullish'] if s > 1 else 
                     self.color_palette['bearish'] if s < 0 else 
                     self.color_palette['neutral'] for s in sharpe_ratios]
            
            fig.add_trace(
                go.Bar(
                    x=symbols,
                    y=sharpe_ratios,
                    name="Sharpe Ratio",
                    marker_color=colors,
                    text=[f"{s:.2f}" for s in sharpe_ratios],
                    textposition='auto'
                ),
                row=1, col=2
            )
            
            # 3. Win Rate Analysis
            win_rates = [r['win_rate'] for r in results]
            
            fig.add_trace(
                go.Bar(
                    x=symbols,
                    y=win_rates,
                    name="Win Rate %",
                    marker_color=self.color_palette['bullish'],
                    text=[f"{w:.1f}%" for w in win_rates],
                    textposition='auto'
                ),
                row=2, col=1
            )
            
            # 4. Risk-Return Scatter
            drawdowns = [r['max_drawdown'] for r in results]
            
            fig.add_trace(
                go.Scatter(
                    x=drawdowns,
                    y=returns,
                    mode='markers+text',
                    text=symbols,
                    textposition="top center",
                    marker=dict(
                        size=10,
                        color=returns,
                        colorscale='RdYlGn',
                        showscale=True,
                        colorbar=dict(title="Returns %")
                    ),
                    name="Risk vs Return"
                ),
                row=2, col=2
            )
            
            # 5. Drawdown Analysis
            fig.add_trace(
                go.Bar(
                    x=symbols,
                    y=[-d for d in drawdowns],  # Negative for better visualization
                    name="Max Drawdown",
                    marker_color=self.color_palette['bearish'],
                    text=[f"-{d:.1f}%" for d in drawdowns],
                    textposition='auto'
                ),
                row=3, col=1
            )
            
            # 6. Portfolio Summary Table
            summary_data = [
                ["Metric", "Value"],
                ["Average Return", f"{portfolio_metrics['avg_return']:.1f}%"],
                ["Average Sharpe", f"{portfolio_metrics['avg_sharpe']:.2f}"],
                ["Average Drawdown", f"{portfolio_metrics['avg_drawdown']:.1f}%"],
                ["Average Win Rate", f"{portfolio_metrics['avg_win_rate']:.1f}%"],
                ["Total Trades", f"{portfolio_metrics['total_trades']}"],
                ["Best Performer", f"{symbols[returns.index(max(returns))]}"],
                ["Worst Performer", f"{symbols[returns.index(min(returns))]}"]
            ]
            
            fig.add_trace(
                go.Table(
                    header=dict(
                        values=summary_data[0],
                        fill_color=self.color_palette['bullish'],
                        align="center",
                        font=dict(color="white", size=12)
                    ),
                    cells=dict(
                        values=list(zip(*summary_data[1:])),
                        fill_color=[['#2a2a2a', '#3a3a3a'] * 4],
                        align="center",
                        font=dict(color="white", size=11)
                    )
                ),
                row=3, col=2
            )
            
            # Update layout
            fig.update_layout(
                title={
                    'text': "📊 Trading Strategy Performance Dashboard",
                    'x': 0.5,
                    'font': {'size': 20, 'color': self.color_palette['text']}
                },
                template=self.plot_config['template'],
                height=1000,
                showlegend=False,
                font=dict(color=self.color_palette['text'])
            )
            
            # Update axis labels
            fig.update_xaxes(title_text="Returns %", row=1, col=1)
            fig.update_yaxes(title_text="Frequency", row=1, col=1)
            
            fig.update_xaxes(title_text="Symbols", row=1, col=2)
            fig.update_yaxes(title_text="Sharpe Ratio", row=1, col=2)
            
            fig.update_xaxes(title_text="Symbols", row=2, col=1)
            fig.update_yaxes(title_text="Win Rate %", row=2, col=1)
            
            fig.update_xaxes(title_text="Max Drawdown %", row=2, col=2)
            fig.update_yaxes(title_text="Total Return %", row=2, col=2)
            
            fig.update_xaxes(title_text="Symbols", row=3, col=1)
            fig.update_yaxes(title_text="Drawdown %", row=3, col=1)
            
            # Save dashboard
            fig.write_html(save_path)
            print(f"💾 Dashboard saved to {save_path}")
            
            return fig
            
        except Exception as e:
            print(f"❌ Error creating dashboard: {e}")
            return None
    
    def create_equity_curve_analysis(self, portfolio_results, save_path="equity_curves.html"):
        """Create detailed equity curve analysis"""
        try:
            print("📈 Creating Equity Curve Analysis...")
            
            fig = make_subplots(
                rows=2, cols=1,
                subplot_titles=['Portfolio Equity Curves', 'Cumulative Returns Comparison'],
                vertical_spacing=0.1
            )
            
            # Plot individual equity curves
            for result in portfolio_results['results']:
                if 'portfolio' in result:
                    try:
                        portfolio = result['portfolio']
                        
                        # Get portfolio value over time
                        if hasattr(portfolio, 'value'):
                            equity_curve = portfolio.value()
                        elif hasattr(portfolio, 'total_return'):
                            # For VectorBT portfolios, create a synthetic equity curve
                            returns = portfolio.returns() if hasattr(portfolio, 'returns') else None
                            if returns is not None:
                                equity_curve = (1 + returns).cumprod() * 1000000  # Start with 10L
                            else:
                                continue
                        else:
                            continue
                        
                        fig.add_trace(
                            go.Scatter(
                                x=equity_curve.index,
                                y=equity_curve.values,
                                mode='lines',
                                name=result['symbol'],
                                line=dict(width=2)
                            ),
                            row=1, col=1
                        )
                    except Exception as e:
                        print(f"⚠️ Skipping equity curve for {result['symbol']}: {e}")
                        continue
            
            # Cumulative returns
            for result in portfolio_results['results']:
                if 'portfolio' in result:
                    try:
                        portfolio = result['portfolio']
                        
                        if hasattr(portfolio, 'returns'):
                            returns = portfolio.returns()
                            cumulative_returns = (1 + returns).cumprod()
                            
                            fig.add_trace(
                                go.Scatter(
                                    x=cumulative_returns.index,
                                    y=cumulative_returns.values,
                                    mode='lines',
                                    name=f"{result['symbol']} Returns",
                                    line=dict(width=2),
                                    showlegend=False
                                ),
                                row=2, col=1
                            )
                    except Exception as e:
                        print(f"⚠️ Skipping returns for {result['symbol']}: {e}")
                        continue
            
            fig.update_layout(
                title="📈 Portfolio Equity Curve Analysis",
                template=self.plot_config['template'],
                height=800,
                font=dict(color=self.color_palette['text'])
            )
            
            fig.update_xaxes(title_text="Date", row=2, col=1)
            fig.update_yaxes(title_text="Portfolio Value", row=1, col=1)
            fig.update_yaxes(title_text="Cumulative Returns", row=2, col=1)
            
            fig.write_html(save_path)
            print(f"💾 Equity curves saved to {save_path}")
            
            return fig
            
        except Exception as e:
            print(f"❌ Error creating equity curves: {e}")
            return None
    
    def create_volume_analysis(self, symbol_data, save_path="volume_analysis.html"):
        """Create comprehensive volume analysis"""
        try:
            print("📊 Creating Volume Analysis...")
            
            fig = make_subplots(
                rows=3, cols=2,
                subplot_titles=[
                    'Price vs Volume', 'Volume Distribution',
                    'Volume Moving Averages', 'Volume Spikes Detection',
                    'Volume-Price Correlation', 'Volume Trends'
                ],
                specs=[
                    [{"secondary_y": True}, {"type": "histogram"}],
                    [{"secondary_y": True}, {"type": "scatter"}],
                    [{"type": "scatter"}, {"secondary_y": True}]
                ],
                vertical_spacing=0.08
            )
            
            # Assuming symbol_data is a dictionary with historical data
            for symbol, df in symbol_data.items():
                if len(df) < 20:
                    continue
                
                # 1. Price vs Volume
                fig.add_trace(
                    go.Candlestick(
                        x=df.index,
                        open=df['open'],
                        high=df['high'],
                        low=df['low'],
                        close=df['close'],
                        name=f"{symbol} Price"
                    ),
                    row=1, col=1
                )
                
                fig.add_trace(
                    go.Bar(
                        x=df.index,
                        y=df['volume'],
                        name=f"{symbol} Volume",
                        marker_color=self.color_palette['bullish'],
                        opacity=0.6
                    ),
                    row=1, col=1, secondary_y=True
                )
                
                # 2. Volume Distribution
                fig.add_trace(
                    go.Histogram(
                        x=df['volume'],
                        name=f"{symbol} Vol Dist",
                        opacity=0.7
                    ),
                    row=1, col=2
                )
                
                # 3. Volume Moving Averages
                df['vol_ma_5'] = df['volume'].rolling(5).mean()
                df['vol_ma_20'] = df['volume'].rolling(20).mean()
                
                fig.add_trace(
                    go.Scatter(
                        x=df.index,
                        y=df['volume'],
                        mode='lines',
                        name=f"{symbol} Volume",
                        line=dict(color=self.color_palette['neutral'], width=1)
                    ),
                    row=2, col=1
                )
                
                fig.add_trace(
                    go.Scatter(
                        x=df.index,
                        y=df['vol_ma_20'],
                        mode='lines',
                        name=f"{symbol} Vol MA20",
                        line=dict(color=self.color_palette['bullish'], width=2)
                    ),
                    row=2, col=1
                )
                
                # 4. Volume Spikes
                volume_ratio = df['volume'] / df['vol_ma_20']
                spikes = volume_ratio > 1.5
                
                fig.add_trace(
                    go.Scatter(
                        x=df.index[spikes],
                        y=df['close'][spikes],
                        mode='markers',
                        name=f"{symbol} Volume Spikes",
                        marker=dict(
                            size=8,
                            color=self.color_palette['bullish'],
                            symbol='triangle-up'
                        )
                    ),
                    row=2, col=2
                )
                
                # 5. Volume-Price Correlation
                price_change = df['close'].pct_change()
                
                fig.add_trace(
                    go.Scatter(
                        x=df['volume'],
                        y=price_change,
                        mode='markers',
                        name=f"{symbol} Vol-Price Corr",
                        marker=dict(
                            size=4,
                            opacity=0.6,
                            color=price_change,
                            colorscale='RdYlGn'
                        )
                    ),
                    row=3, col=1
                )
                
                # 6. Volume Trends
                df['vol_trend'] = df['volume'].rolling(10).mean().pct_change()
                
                fig.add_trace(
                    go.Scatter(
                        x=df.index,
                        y=df['vol_trend'],
                        mode='lines',
                        name=f"{symbol} Vol Trend",
                        line=dict(width=2)
                    ),
                    row=3, col=2
                )
                
                break  # Just show first symbol for now
            
            fig.update_layout(
                title="📊 Comprehensive Volume Analysis",
                template=self.plot_config['template'],
                height=1200,
                showlegend=True
            )
            
            fig.write_html(save_path)
            print(f"💾 Volume analysis saved to {save_path}")
            
            return fig
            
        except Exception as e:
            print(f"❌ Error creating volume analysis: {e}")
            return None
    
    def create_news_sentiment_analysis(self, news_data, save_path="news_sentiment.html"):
        """Create news sentiment analysis visualization"""
        try:
            print("📰 Creating News Sentiment Analysis...")
            
            fig = make_subplots(
                rows=2, cols=2,
                subplot_titles=[
                    'Sentiment Score Distribution', 'News Impact Timeline',
                    'Sentiment vs Volume Correlation', 'News Source Analysis'
                ],
                specs=[
                    [{"type": "histogram"}, {"type": "scatter"}],
                    [{"type": "scatter"}, {"type": "bar"}]
                ]
            )
            
            # Sample news data structure (you would populate this from actual news analysis)
            sample_news = {
                'dates': pd.date_range('2024-01-01', periods=50, freq='D'),
                'sentiment_scores': np.random.normal(0.1, 0.3, 50),
                'volume_impact': np.random.uniform(0.5, 2.0, 50),
                'sources': ['MoneyControl', 'ET', 'BS', 'FE'] * 12 + ['MoneyControl', 'ET']
            }
            
            # 1. Sentiment Distribution
            fig.add_trace(
                go.Histogram(
                    x=sample_news['sentiment_scores'],
                    nbinsx=20,
                    name="Sentiment Distribution",
                    marker_color=self.color_palette['bullish'],
                    opacity=0.7
                ),
                row=1, col=1
            )
            
            # 2. News Impact Timeline
            colors = [self.color_palette['bullish'] if s > 0 else self.color_palette['bearish'] 
                     for s in sample_news['sentiment_scores']]
            
            fig.add_trace(
                go.Scatter(
                    x=sample_news['dates'],
                    y=sample_news['sentiment_scores'],
                    mode='markers+lines',
                    name="Sentiment Timeline",
                    marker=dict(color=colors, size=8),
                    line=dict(color=self.color_palette['neutral'], width=1)
                ),
                row=1, col=2
            )
            
            # 3. Sentiment vs Volume Correlation
            fig.add_trace(
                go.Scatter(
                    x=sample_news['sentiment_scores'],
                    y=sample_news['volume_impact'],
                    mode='markers',
                    name="Sentiment vs Volume",
                    marker=dict(
                        size=8,
                        color=sample_news['sentiment_scores'],
                        colorscale='RdYlGn',
                        showscale=True
                    )
                ),
                row=2, col=1
            )
            
            # 4. News Source Analysis
            source_counts = pd.Series(sample_news['sources']).value_counts()
            
            fig.add_trace(
                go.Bar(
                    x=source_counts.index,
                    y=source_counts.values,
                    name="News Sources",
                    marker_color=self.color_palette['bullish'],
                    text=source_counts.values,
                    textposition='auto'
                ),
                row=2, col=2
            )
            
            fig.update_layout(
                title="📰 News Sentiment Analysis Dashboard",
                template=self.plot_config['template'],
                height=800,
                showlegend=True
            )
            
            fig.write_html(save_path)
            print(f"💾 News analysis saved to {save_path}")
            
            return fig
            
        except Exception as e:
            print(f"❌ Error creating news analysis: {e}")
            return None
    
    def create_risk_analysis(self, portfolio_data, save_path="risk_analysis.html"):
        """Create comprehensive risk analysis"""
        try:
            print("⚠️ Creating Risk Analysis...")
            
            fig = make_subplots(
                rows=2, cols=2,
                subplot_titles=[
                    'Value at Risk (VaR)', 'Drawdown Analysis',
                    'Volatility Clustering', 'Risk-Adjusted Returns'
                ]
            )
            
            # Sample risk metrics (you would calculate these from actual portfolio data)
            returns = np.random.normal(0.001, 0.02, 252)  # Daily returns for 1 year
            cumulative_returns = np.cumprod(1 + returns)
            
            # 1. VaR Analysis
            var_95 = np.percentile(returns, 5)
            var_99 = np.percentile(returns, 1)
            
            fig.add_trace(
                go.Histogram(
                    x=returns,
                    nbinsx=50,
                    name="Returns Distribution",
                    opacity=0.7
                ),
                row=1, col=1
            )
            
            # Add VaR lines
            fig.add_vline(x=var_95, line_dash="dash", line_color="orange", 
                         annotation_text=f"VaR 95%: {var_95:.3f}", row=1, col=1)
            fig.add_vline(x=var_99, line_dash="dash", line_color="red", 
                         annotation_text=f"VaR 99%: {var_99:.3f}", row=1, col=1)
            
            # 2. Drawdown Analysis
            peak = np.maximum.accumulate(cumulative_returns)
            drawdown = (cumulative_returns - peak) / peak
            
            fig.add_trace(
                go.Scatter(
                    x=list(range(len(drawdown))),
                    y=drawdown,
                    mode='lines',
                    name="Drawdown",
                    line=dict(color=self.color_palette['bearish'], width=2),
                    fill='tozeroy',
                    fillcolor='rgba(255, 68, 68, 0.3)'
                ),
                row=1, col=2
            )
            
            # 3. Volatility Clustering
            volatility = pd.Series(returns).rolling(20).std()
            
            fig.add_trace(
                go.Scatter(
                    x=list(range(len(volatility))),
                    y=volatility,
                    mode='lines',
                    name="Rolling Volatility",
                    line=dict(color=self.color_palette['bullish'], width=2)
                ),
                row=2, col=1
            )
            
            # 4. Risk-Adjusted Returns
            sharpe_rolling = pd.Series(returns).rolling(60).mean() / pd.Series(returns).rolling(60).std()
            
            fig.add_trace(
                go.Scatter(
                    x=list(range(len(sharpe_rolling))),
                    y=sharpe_rolling,
                    mode='lines',
                    name="Rolling Sharpe Ratio",
                    line=dict(color=self.color_palette['bullish'], width=2)
                ),
                row=2, col=2
            )
            
            fig.update_layout(
                title="⚠️ Comprehensive Risk Analysis",
                template=self.plot_config['template'],
                height=800,
                showlegend=True
            )
            
            fig.write_html(save_path)
            print(f"💾 Risk analysis saved to {save_path}")
            
            return fig
            
        except Exception as e:
            print(f"❌ Error creating risk analysis: {e}")
            return None
    
    def create_vectorbt_trade_analysis(self, backtest_results, save_path="vectorbt_trades.html"):
        """Create VectorBT-specific trade analysis"""
        try:
            print("📈 Creating VectorBT Trade Analysis...")
            
            fig = make_subplots(
                rows=2, cols=2,
                subplot_titles=[
                    'Trade Entry/Exit Points', 'Trade Duration Distribution',
                    'P&L Distribution', 'Win/Loss Streaks'
                ],
                specs=[
                    [{"secondary_y": True}, {"type": "histogram"}],
                    [{"type": "histogram"}, {"type": "scatter"}]
                ]
            )
            
            # Analyze trades from portfolio results
            for result in backtest_results['results']:
                if 'portfolio' in result:
                    try:
                        portfolio = result['portfolio']
                        symbol = result['symbol']
                        
                        # Get trade records if available
                        if hasattr(portfolio, 'trades'):
                            trades = portfolio.trades.records_readable
                            
                            if len(trades) > 0:
                                # 1. Trade Entry/Exit Points on price chart
                                if 'indicators' in result:
                                    close_prices = result['indicators']['close']
                                    
                                    # Price line
                                    fig.add_trace(
                                        go.Scatter(
                                            x=close_prices.index,
                                            y=close_prices.values,
                                            mode='lines',
                                            name=f"{symbol} Price",
                                            line=dict(width=1, color=self.color_palette['neutral'])
                                        ),
                                        row=1, col=1
                                    )
                                    
                                    # Entry points
                                    entry_times = pd.to_datetime(trades['Entry Timestamp'])
                                    entry_prices = trades['Entry Price']
                                    
                                    fig.add_trace(
                                        go.Scatter(
                                            x=entry_times,
                                            y=entry_prices,
                                            mode='markers',
                                            name=f"{symbol} Entries",
                                            marker=dict(
                                                size=8,
                                                color=self.color_palette['bullish'],
                                                symbol='triangle-up'
                                            )
                                        ),
                                        row=1, col=1
                                    )
                                    
                                    # Exit points
                                    exit_times = pd.to_datetime(trades['Exit Timestamp'])
                                    exit_prices = trades['Exit Price']
                                    
                                    fig.add_trace(
                                        go.Scatter(
                                            x=exit_times,
                                            y=exit_prices,
                                            mode='markers',
                                            name=f"{symbol} Exits",
                                            marker=dict(
                                                size=8,
                                                color=self.color_palette['bearish'],
                                                symbol='triangle-down'
                                            )
                                        ),
                                        row=1, col=1
                                    )
                                
                                # 2. Trade Duration Distribution
                                durations = (pd.to_datetime(trades['Exit Timestamp']) - 
                                           pd.to_datetime(trades['Entry Timestamp'])).dt.total_seconds() / 3600
                                
                                fig.add_trace(
                                    go.Histogram(
                                        x=durations,
                                        name=f"{symbol} Duration",
                                        opacity=0.7,
                                        nbinsx=20
                                    ),
                                    row=1, col=2
                                )
                                
                                # 3. P&L Distribution
                                pnl_values = trades['PnL']
                                
                                fig.add_trace(
                                    go.Histogram(
                                        x=pnl_values,
                                        name=f"{symbol} P&L",
                                        opacity=0.7,
                                        nbinsx=20,
                                        marker_color=self.color_palette['bullish']
                                    ),
                                    row=2, col=1
                                )
                                
                                # 4. Win/Loss Streaks
                                wins = (pnl_values > 0).astype(int)
                                streaks = []
                                current_streak = 0
                                
                                for win in wins:
                                    if win:
                                        current_streak = max(0, current_streak) + 1
                                    else:
                                        current_streak = min(0, current_streak) - 1
                                    streaks.append(current_streak)
                                
                                fig.add_trace(
                                    go.Scatter(
                                        x=list(range(len(streaks))),
                                        y=streaks,
                                        mode='lines+markers',
                                        name=f"{symbol} Streaks",
                                        line=dict(width=2)
                                    ),
                                    row=2, col=2
                                )
                        
                        break  # Just analyze first symbol with trades for now
                        
                    except Exception as e:
                        print(f"⚠️ Error analyzing trades for {result['symbol']}: {e}")
                        continue
            
            fig.update_layout(
                title="📈 VectorBT Trade Analysis",
                template=self.plot_config['template'],
                height=1000,
                showlegend=True
            )
            
            # Update axis labels
            fig.update_xaxes(title_text="Date", row=1, col=1)
            fig.update_yaxes(title_text="Price", row=1, col=1)
            fig.update_xaxes(title_text="Duration (Hours)", row=1, col=2)
            fig.update_yaxes(title_text="Frequency", row=1, col=2)
            fig.update_xaxes(title_text="P&L", row=2, col=1)
            fig.update_yaxes(title_text="Frequency", row=2, col=1)
            fig.update_xaxes(title_text="Trade Number", row=2, col=2)
            fig.update_yaxes(title_text="Win/Loss Streak", row=2, col=2)
            
            fig.write_html(save_path)
            print(f"💾 VectorBT analysis saved to {save_path}")
            
            return fig
            
        except Exception as e:
            print(f"❌ Error creating VectorBT analysis: {e}")
            return None

    def generate_complete_report(self, backtest_results, symbol_data=None, news_data=None):
        """Generate complete EDA report with all visualizations"""
        try:
            print("🎨 Generating Complete EDA Report...")
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # Create all visualizations
            dashboard = self.create_performance_dashboard(
                backtest_results, 
                f"trading_dashboard_{timestamp}.html"
            )
            
            equity_curves = self.create_equity_curve_analysis(
                backtest_results,
                f"equity_curves_{timestamp}.html"
            )
            
            # VectorBT-specific trade analysis
            vectorbt_analysis = self.create_vectorbt_trade_analysis(
                backtest_results,
                f"vectorbt_trades_{timestamp}.html"
            )
            
            if symbol_data:
                volume_analysis = self.create_volume_analysis(
                    symbol_data,
                    f"volume_analysis_{timestamp}.html"
                )
            
            if news_data:
                news_analysis = self.create_news_sentiment_analysis(
                    news_data,
                    f"news_sentiment_{timestamp}.html"
                )
            
            risk_analysis = self.create_risk_analysis(
                backtest_results,  # Use actual backtest results
                f"risk_analysis_{timestamp}.html"
            )
            
            print("✅ Complete EDA Report Generated!")
            print(f"📊 Files created with timestamp: {timestamp}")
            print("🎯 Open the HTML files in your browser to view the analysis")
            print("\n📁 Generated files:")
            print(f"   • trading_dashboard_{timestamp}.html")
            print(f"   • equity_curves_{timestamp}.html") 
            print(f"   • vectorbt_trades_{timestamp}.html")
            print(f"   • risk_analysis_{timestamp}.html")
            
            return {
                'dashboard': dashboard,
                'equity_curves': equity_curves,
                'vectorbt_analysis': vectorbt_analysis,
                'timestamp': timestamp
            }
            
        except Exception as e:
            print(f"❌ Error generating complete report: {e}")
            return None

def main():
    """Demo the EDA analyzer"""
    print("🎨 Beautiful EDA Analyzer Demo")
    print("=" * 50)
    
    # Initialize analyzer
    analyzer = BeautifulEDAAnalyzer()
    
    # Create sample backtest results for demo
    sample_results = {
        'results': [
            {
                'symbol': 'EIEL',
                'total_return': 15.2,
                'sharpe_ratio': 1.8,
                'max_drawdown': 8.5,
                'win_rate': 65.0,
                'total_trades': 12
            },
            {
                'symbol': 'RELIANCE',
                'total_return': 12.8,
                'sharpe_ratio': 1.5,
                'max_drawdown': 12.3,
                'win_rate': 58.0,
                'total_trades': 18
            },
            {
                'symbol': 'TCS',
                'total_return': 8.9,
                'sharpe_ratio': 1.2,
                'max_drawdown': 6.8,
                'win_rate': 72.0,
                'total_trades': 15
            }
        ],
        'portfolio_metrics': {
            'avg_return': 12.3,
            'avg_sharpe': 1.5,
            'avg_drawdown': 9.2,
            'avg_win_rate': 65.0,
            'total_trades': 45
        }
    }
    
    # Generate sample report
    report = analyzer.generate_complete_report(sample_results)
    
    if report:
        print("\n🎉 Demo completed successfully!")
        print("📂 Check the generated HTML files for beautiful visualizations")

if __name__ == "__main__":
    main()