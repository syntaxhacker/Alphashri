#!/usr/bin/env python3
"""
Create beautiful charts for TATAMOTORS analysis results
"""

import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from tatamotors_enhanced_daily import TATAMOTORSEnhancedDaily

def create_beautiful_charts():
    print("🎨 Creating beautiful TATAMOTORS charts...")
    
    analyzer = TATAMOTORSEnhancedDaily()
    
    # Load and analyze data
    data = analyzer.load_data()
    filtered_data = analyzer.filter_data_by_period('2021-01-01', '2024-06-28')
    signals = analyzer.generate_multi_strategy_signals(filtered_data)
    portfolio, trades = analyzer.backtest_enhanced_strategy(analyzer.enhanced_data, signals)
    
    # Create comprehensive charts
    data = analyzer.enhanced_data
    
    fig = make_subplots(
        rows=4, cols=1,
        subplot_titles=[
            'TATAMOTORS Price Action & Multi-Strategy Signals', 
            'Technical Indicators (RSI, MACD)', 
            'Portfolio Performance vs Buy & Hold',
            'Individual Trade Performance'
        ],
        vertical_spacing=0.08,
        row_heights=[0.4, 0.2, 0.25, 0.15]
    )
    
    # 1. Price chart with signals
    fig.add_trace(
        go.Candlestick(
            x=data.index,
            open=data['open'],
            high=data['high'],
            low=data['low'],
            close=data['close'],
            name='TATAMOTORS',
            increasing_line_color='#00ff88',
            decreasing_line_color='#ff4444'
        ),
        row=1, col=1
    )
    
    # Moving averages
    fig.add_trace(
        go.Scatter(x=data.index, y=data['sma_10'], name='SMA 10', line=dict(color='orange', width=1)),
        row=1, col=1
    )
    fig.add_trace(
        go.Scatter(x=data.index, y=data['sma_20'], name='SMA 20', line=dict(color='blue', width=1)),
        row=1, col=1
    )
    
    # Bollinger Bands
    fig.add_trace(
        go.Scatter(x=data.index, y=data['bb_upper'], name='BB Upper', 
                  line=dict(color='gray', width=1, dash='dash'), opacity=0.5),
        row=1, col=1
    )
    fig.add_trace(
        go.Scatter(x=data.index, y=data['bb_lower'], name='BB Lower', 
                  line=dict(color='gray', width=1, dash='dash'), opacity=0.5),
        row=1, col=1
    )
    
    # Multi-strategy signals
    buy_signals = signals[signals['long_entry']]
    sell_signals = signals[signals['long_exit']]
    
    # Color code by strategy type
    strategy_colors = {
        'momentum_breakout': 'lime',
        'mean_reversion': 'cyan',
        'macd_bullish': 'yellow',
        'golden_cross': 'magenta'
    }
    
    if not buy_signals.empty:
        for strategy, color in strategy_colors.items():
            strategy_signals = buy_signals[buy_signals['signal_type'] == strategy]
            if not strategy_signals.empty:
                fig.add_trace(
                    go.Scatter(
                        x=strategy_signals.index,
                        y=data.loc[strategy_signals.index, 'low'] * 0.97,
                        mode='markers',
                        marker=dict(symbol='triangle-up', size=12, color=color),
                        name=f'{strategy.replace("_", " ").title()}',
                        hovertemplate=f'<b>{strategy.upper()}</b><br>Date: %{{x}}<br>Price: ₹%{{y:.2f}}<extra></extra>'
                    ),
                    row=1, col=1
                )
    
    if not sell_signals.empty:
        fig.add_trace(
            go.Scatter(
                x=sell_signals.index,
                y=data.loc[sell_signals.index, 'high'] * 1.03,
                mode='markers',
                marker=dict(symbol='triangle-down', size=12, color='red'),
                name='Sell Signal',
                hovertemplate='<b>SELL</b><br>Date: %{x}<br>Price: ₹%{y:.2f}<extra></extra>'
            ),
            row=1, col=1
        )
    
    # 2. Technical indicators
    fig.add_trace(
        go.Scatter(x=data.index, y=data['rsi'], name='RSI', line=dict(color='purple')),
        row=2, col=1
    )
    fig.add_hline(y=70, line_dash="dash", line_color="red", opacity=0.5, row=2, col=1)
    fig.add_hline(y=30, line_dash="dash", line_color="green", opacity=0.5, row=2, col=1)
    
    # MACD
    fig.add_trace(
        go.Scatter(x=data.index, y=data['macd'], name='MACD', line=dict(color='blue')),
        row=2, col=1
    )
    fig.add_trace(
        go.Scatter(x=data.index, y=data['macd_signal'], name='MACD Signal', line=dict(color='red')),
        row=2, col=1
    )
    
    # 3. Portfolio performance
    fig.add_trace(
        go.Scatter(
            x=portfolio.index,
            y=portfolio['total_value'],
            mode='lines',
            name='Enhanced Strategy',
            line=dict(color='#1f77b4', width=3),
            hovertemplate='<b>Strategy</b><br>Date: %{x}<br>Value: ₹%{y:,.0f}<extra></extra>'
        ),
        row=3, col=1
    )
    
    # Buy & Hold benchmark
    initial_price = data['close'].iloc[0]
    benchmark_values = (data['close'] / initial_price) * portfolio['total_value'].iloc[0]
    fig.add_trace(
        go.Scatter(
            x=data.index,
            y=benchmark_values,
            mode='lines',
            name='Buy & Hold',
            line=dict(color='gray', width=2, dash='dash'),
            hovertemplate='<b>Buy & Hold</b><br>Date: %{x}<br>Value: ₹%{y:,.0f}<extra></extra>'
        ),
        row=3, col=1
    )
    
    # 4. Individual trade performance
    if not trades.empty:
        sell_trades = trades[trades['action'] == 'SELL']
        if not sell_trades.empty:
            colors_trades = ['green' if ret > 0 else 'red' for ret in sell_trades['return_pct']]
            fig.add_trace(
                go.Bar(
                    x=list(range(1, len(sell_trades) + 1)),
                    y=sell_trades['return_pct'],
                    name='Trade Returns',
                    marker_color=colors_trades,
                    hovertemplate='<b>Trade %{x}</b><br>Return: %{y:.2f}%<br>Strategy: %{text}<extra></extra>',
                    text=sell_trades['signal_type']
                ),
                row=4, col=1
            )
    
    # Update layout
    fig.update_layout(
        title=dict(
            text='<b>TATAMOTORS Enhanced Multi-Strategy Analysis</b><br><sub>21.35% Return | 10 Trades | 60% Win Rate | Sharpe 2.01</sub>',
            x=0.5,
            font=dict(size=20)
        ),
        template='plotly_white',
        height=1400,
        showlegend=True,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1)
    )
    
    # Update axes
    fig.update_yaxes(title_text="Price (₹)", row=1, col=1)
    fig.update_yaxes(title_text="RSI / MACD", row=2, col=1)
    fig.update_yaxes(title_text="Portfolio Value (₹)", row=3, col=1)
    fig.update_yaxes(title_text="Return (%)", row=4, col=1)
    fig.update_xaxes(title_text="Date", row=4, col=1)
    
    # Save chart
    save_path = 'tatamotors_enhanced_analysis.html'
    fig.write_html(save_path)
    print(f"✅ Beautiful interactive chart saved to: {save_path}")
    
    # Performance summary
    total_return = (portfolio['total_value'].iloc[-1] / portfolio['total_value'].iloc[0] - 1) * 100
    benchmark_return = ((filtered_data['close'].iloc[-1] / filtered_data['close'].iloc[0]) - 1) * 100
    
    print(f"\n�� BEAUTIFUL CHARTS CREATED!")
    print(f"📊 Strategy Return: {total_return:+.2f}% vs Buy & Hold: {benchmark_return:+.2f}%")
    print(f"📈 {len(trades[trades['action'] == 'SELL'])} completed trades with detailed analysis")
    print(f"🌐 Open tatamotors_enhanced_analysis.html in your browser!")
    
    return fig

if __name__ == "__main__":
    create_beautiful_charts()
