import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd
import numpy as np
from datetime import datetime

class TradingCharts:
    def __init__(self):
        """Initialize TradingCharts with default settings"""
        self.colors = {
            'background': '#1e1e1e',
            'text': '#ffffff',
            'buy': '#00ff00',
            'sell': '#ff0000',
            'profit': '#00ff00',
            'loss': '#ff0000',
            'line': '#00ffff'
        }

    def create_trading_dashboard(self, trades_df: pd.DataFrame, price_data: pd.DataFrame) -> go.Figure:
        """Create a comprehensive trading dashboard"""
        # Create figure with secondary y-axis
        fig = make_subplots(
            rows=3, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.05,
            subplot_titles=('Price Action & Trades', 'Portfolio Value', 'Volume'),
            row_heights=[0.5, 0.3, 0.2]
        )

        # Add candlestick chart
        fig.add_trace(
            go.Candlestick(
                x=price_data.index,
                open=price_data['open'],
                high=price_data['high'],
                low=price_data['low'],
                close=price_data['close'],
                name='Price'
            ),
            row=1, col=1
        )

        # Add buy points
        buy_trades = trades_df[trades_df['action'] == 'BUY']
        fig.add_trace(
            go.Scatter(
                x=buy_trades.index,
                y=buy_trades['price'],
                mode='markers',
                name='Buy',
                marker=dict(
                    symbol='triangle-up',
                    size=12,
                    color=self.colors['buy'],
                    line=dict(width=2)
                )
            ),
            row=1, col=1
        )

        # Add sell points
        sell_trades = trades_df[trades_df['action'] == 'SELL']
        fig.add_trace(
            go.Scatter(
                x=sell_trades.index,
                y=sell_trades['price'],
                mode='markers',
                name='Sell',
                marker=dict(
                    symbol='triangle-down',
                    size=12,
                    color=self.colors['sell'],
                    line=dict(width=2)
                )
            ),
            row=1, col=1
        )

        # Add portfolio value
        fig.add_trace(
            go.Scatter(
                x=trades_df.index,
                y=trades_df['balance'],
                mode='lines',
                name='Portfolio Value',
                line=dict(color=self.colors['line'])
            ),
            row=2, col=1
        )

        # Add volume bars
        fig.add_trace(
            go.Bar(
                x=price_data.index,
                y=price_data['volume'],
                name='Volume'
            ),
            row=3, col=1
        )

        # Update layout
        fig.update_layout(
            title='Trading Dashboard',
            xaxis_title='Date',
            yaxis_title='Price',
            template='plotly_dark',
            height=1000,
            showlegend=True
        )

        return fig

    def create_trade_metrics(self, trades_df: pd.DataFrame) -> go.Figure:
        """Create a figure showing key trading metrics"""
        # Calculate metrics
        total_trades = len(trades_df)
        profitable_trades = len(trades_df[trades_df['pnl'] > 0])
        win_rate = (profitable_trades / total_trades) * 100 if total_trades > 0 else 0
        
        avg_profit = trades_df[trades_df['pnl'] > 0]['pnl'].mean() if profitable_trades > 0 else 0
        avg_loss = trades_df[trades_df['pnl'] < 0]['pnl'].mean() if len(trades_df[trades_df['pnl'] < 0]) > 0 else 0
        
        profit_factor = abs(trades_df[trades_df['pnl'] > 0]['pnl'].sum() / trades_df[trades_df['pnl'] < 0]['pnl'].sum()) if len(trades_df[trades_df['pnl'] < 0]) > 0 else float('inf')
        
        # Create metrics visualization with proper subplot types
        fig = make_subplots(
            rows=2, cols=2,
            specs=[
                [{"type": "domain"}, {"type": "xy"}],
                [{"type": "xy"}, {"type": "xy"}]
            ],
            subplot_titles=('Trade Outcomes', 'P&L Distribution', 'Cumulative Returns', 'Monthly Returns')
        )

        # Trade outcomes pie chart
        fig.add_trace(
            go.Pie(
                labels=['Profitable', 'Unprofitable'],
                values=[profitable_trades, total_trades - profitable_trades],
                name='Trade Outcomes',
                marker=dict(colors=[self.colors['profit'], self.colors['loss']])
            ),
            row=1, col=1
        )

        # P&L distribution histogram
        fig.add_trace(
            go.Histogram(
                x=trades_df['pnl'],
                name='P&L Distribution',
                nbinsx=20,
                marker_color=self.colors['line']
            ),
            row=1, col=2
        )

        # Cumulative returns line
        trades_df['cumulative_return'] = trades_df['return'].fillna(0).cumsum()
        fig.add_trace(
            go.Scatter(
                x=trades_df.index,
                y=trades_df['cumulative_return'],
                mode='lines',
                name='Cumulative Returns',
                line=dict(color=self.colors['line'])
            ),
            row=2, col=1
        )

        # Monthly returns bar
        monthly_returns = trades_df.resample('M')['return'].sum()
        colors = [self.colors['profit'] if x >= 0 else self.colors['loss'] for x in monthly_returns.values]
        fig.add_trace(
            go.Bar(
                x=monthly_returns.index,
                y=monthly_returns.values,
                name='Monthly Returns',
                marker_color=colors
            ),
            row=2, col=2
        )

        # Update layout
        fig.update_layout(
            title='Trading Metrics',
            template='plotly_dark',
            height=800,
            showlegend=True,
            annotations=[
                dict(
                    text=f"Win Rate: {win_rate:.1f}%<br>Profit Factor: {profit_factor:.2f}<br>" +
                         f"Avg Win: ${avg_profit:.2f}<br>Avg Loss: ${avg_loss:.2f}",
                    align='left',
                    showarrow=False,
                    xref='paper',
                    yref='paper',
                    x=0,
                    y=1.1,
                    bordercolor='white',
                    borderwidth=1,
                    bgcolor='rgba(0,0,0,0.5)'
                )
            ]
        )

        # Update axes labels
        fig.update_xaxes(title_text="P&L ($)", row=1, col=2)
        fig.update_yaxes(title_text="Frequency", row=1, col=2)
        
        fig.update_xaxes(title_text="Date", row=2, col=1)
        fig.update_yaxes(title_text="Cumulative Return (%)", row=2, col=1)
        
        fig.update_xaxes(title_text="Month", row=2, col=2)
        fig.update_yaxes(title_text="Monthly Return (%)", row=2, col=2)

        return fig 