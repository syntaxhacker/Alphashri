import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

class StockCharts:
    @staticmethod
    def create_bubble_chart(df, title, selected_symbols=None, **filters):
        """Market cap bubble chart with filters"""
        if df is None or df.empty:
            return go.Figure()
            
        # Apply filters
        for col, (min_val, max_val) in filters.items():
            if min_val is not None:
                df = df[df[col] >= min_val]
            if max_val is not None:
                df = df[df[col] <= max_val]
            
        # Highlight selected symbols
        if selected_symbols:
            df['selected'] = df['symbol'].isin(selected_symbols)
            color_col = 'selected'
        else:
            color_col = 'criteria_count'
            
        fig = px.scatter(
            df,
            x='returns_6m',
            y='profit_margin',
            size='market_cap_cr',
            color=color_col,
            hover_name='symbol',
            hover_data={
                'market_cap_cr': ':.0f',
                'roe': ':.1f',
                'revenue_growth': ':.1f',
                'debt_to_equity': ':.2f',
                'criteria_met': True
            },
            title=title,
            labels={
                'returns_6m': '6-Month Returns (%)',
                'profit_margin': 'Profit Margin (%)',
                'market_cap_cr': 'Market Cap (Cr)',
                'criteria_count': 'Criteria Met',
                'selected': 'Selected'
            }
        )
        
        fig.update_layout(
            template='plotly_dark',
            height=600,
            hovermode='closest'
        )
        return fig

    @staticmethod
    def create_parallel_coordinates(df, dimensions, title):
        """Parallel coordinates plot for multi-metric analysis"""
        if df is None or df.empty:
            return go.Figure()
            
        # Add symbol column to dimensions for hovering
        dimensions = ['symbol'] + dimensions
            
        fig = px.parallel_coordinates(
            df,
            dimensions=dimensions,
            color='criteria_count',
            title=title,
            labels={
                'symbol': 'Stock Symbol',
                'market_cap_cr': 'Market Cap (Cr)',
                'profit_margin': 'Profit Margin (%)',
                'roe': 'ROE (%)',
                'revenue_growth': 'Revenue Growth (%)',
                'returns_6m': '6M Returns (%)',
                'returns_1y': '1Y Returns (%)',
                'criteria_count': 'Criteria Met'
            }
        )
        
        fig.update_layout(
            template='plotly_dark', 
            height=600,
            hovermode='closest'
        )
        return fig

    @staticmethod
    def create_sector_analysis(df):
        """Create sector-wise analysis charts"""
        if df is None or df.empty or 'sector' not in df.columns:
            return go.Figure()
            
        # Create subplots
        fig = make_subplots(
            rows=2, cols=2,
            subplot_titles=(
                'Sector Distribution',
                'Sector-wise Returns',
                'Sector-wise Market Cap',
                'Sector Performance Matrix'
            ),
            specs=[[{'type': 'bar'}, {'type': 'box'}],
                  [{'type': 'bar'}, {'type': 'scatter'}]]
        )
        
        # 1. Sector Distribution
        sector_counts = df['sector'].value_counts()
        fig.add_trace(
            go.Bar(x=sector_counts.index, y=sector_counts.values, name='Count'),
            row=1, col=1
        )
        
        # 2. Sector-wise Returns
        fig.add_trace(
            go.Box(x=df['sector'], y=df['returns_6m'], name='6M Returns'),
            row=1, col=2
        )
        
        # 3. Sector-wise Market Cap
        sector_mcap = df.groupby('sector')['market_cap_cr'].mean().sort_values(ascending=True)
        fig.add_trace(
            go.Bar(
                x=sector_mcap.values,
                y=sector_mcap.index,
                orientation='h',
                name='Avg Market Cap'
            ),
            row=2, col=1
        )
        
        # 4. Sector Performance Matrix
        sector_metrics = df.groupby('sector').agg({
            'returns_6m': 'mean',
            'profit_margin': 'mean'
        }).reset_index()
        
        fig.add_trace(
            go.Scatter(
                x=sector_metrics['returns_6m'],
                y=sector_metrics['profit_margin'],
                mode='markers+text',
                text=sector_metrics['sector'],
                textposition='top center',
                name='Sector Performance'
            ),
            row=2, col=2
        )
        
        fig.update_layout(
            height=1000,
            showlegend=False,
            template='plotly_dark'
        )
        return fig

    @staticmethod
    def create_performance_metrics(df, selected_symbols=None):
        """Create performance metrics visualization"""
        if df is None or df.empty:
            return go.Figure()
            
        if selected_symbols:
            df = df[df['symbol'].isin(selected_symbols)]
            
        fig = make_subplots(
            rows=2, cols=2,
            subplot_titles=(
                'Returns Distribution',
                'Profitability vs Growth',
                'Market Cap Distribution',
                'Risk vs Return'
            )
        )
        
        # 1. Returns Distribution
        fig.add_trace(
            go.Box(y=df['returns_6m'], name='6M Returns'),
            row=1, col=1
        )
        fig.add_trace(
            go.Box(y=df['returns_1y'], name='1Y Returns'),
            row=1, col=1
        )
        
        # 2. Profitability vs Growth
        fig.add_trace(
            go.Scatter(
                x=df['profit_margin'],
                y=df['revenue_growth'],
                mode='markers+text',
                text=df['symbol'],
                textposition='top center',
                name='Stocks',
                hovertemplate=
                    '<b>%{text}</b><br>' +
                    'Profit Margin: %{x:.1f}%<br>' +
                    'Revenue Growth: %{y:.1f}%<br>' +
                    '<extra></extra>'
            ),
            row=1, col=2
        )
        
        # 3. Market Cap Distribution
        fig.add_trace(
            go.Histogram(
                x=df['market_cap_cr'],
                name='Market Cap',
                hovertemplate='Market Cap: ₹%{x:.0f}Cr<br>Count: %{y}<extra></extra>'
            ),
            row=2, col=1
        )
        
        # 4. Risk vs Return
        fig.add_trace(
            go.Scatter(
                x=df['debt_to_equity'],
                y=df['returns_1y'],
                mode='markers+text',
                text=df['symbol'],
                textposition='top center',
                name='Stocks',
                hovertemplate=
                    '<b>%{text}</b><br>' +
                    'Debt/Equity: %{x:.2f}<br>' +
                    '1Y Return: %{y:.1f}%<br>' +
                    '<extra></extra>'
            ),
            row=2, col=2
        )
        
        # Update layout with axis labels
        fig.update_xaxes(title_text="Returns (%)", row=1, col=1)
        fig.update_yaxes(title_text="Count", row=1, col=1)
        
        fig.update_xaxes(title_text="Profit Margin (%)", row=1, col=2)
        fig.update_yaxes(title_text="Revenue Growth (%)", row=1, col=2)
        
        fig.update_xaxes(title_text="Market Cap (Cr)", row=2, col=1)
        fig.update_yaxes(title_text="Count", row=2, col=1)
        
        fig.update_xaxes(title_text="Debt to Equity Ratio", row=2, col=2)
        fig.update_yaxes(title_text="1Y Returns (%)", row=2, col=2)
        
        fig.update_layout(
            height=1000,
            showlegend=True,
            template='plotly_dark',
            hovermode='closest'
        )
        return fig