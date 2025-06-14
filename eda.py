# Import required libraries
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-GUI backend
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import talib as ta
from datetime import datetime, timedelta
import warnings
import os
warnings.filterwarnings('ignore')

# Set style for better visualizations
plt.style.use('default')  # Use default style first
sns.set_theme(style="whitegrid")  # Apply seaborn theme
plt.rcParams['figure.figsize'] = [12, 8]
plt.rcParams['figure.dpi'] = 100
plt.rcParams['axes.grid'] = True
plt.rcParams['grid.alpha'] = 0.3

# --------------------------------------------------
# 1. Load and Prepare Data
# --------------------------------------------------

def add_technical_indicators(df):
    """Add technical indicators using the ta library."""
    df = df.copy()

    # Initialize ta indicators
    import ta

    # Trend Indicators
    # Bollinger Bands
    bb = ta.volatility.BollingerBands(df['close'])
    df['BB_upper'] = bb.bollinger_hband()
    df['BB_middle'] = bb.bollinger_mavg()
    df['BB_lower'] = bb.bollinger_lband()

    # Moving Averages
    df['SMA_20'] = ta.trend.sma_indicator(df['close'], window=20)
    df['SMA_50'] = ta.trend.sma_indicator(df['close'], window=50)
    df['EMA_20'] = ta.trend.ema_indicator(df['close'], window=20)

    # MACD
    macd = ta.trend.MACD(df['close'])
    df['MACD'] = macd.macd()
    df['MACD_signal'] = macd.macd_signal()
    df['MACD_hist'] = macd.macd_diff()

    # Momentum Indicators
    # RSI
    df['RSI'] = ta.momentum.RSIIndicator(df['close']).rsi()

    # Stochastic RSI
    stoch_rsi = ta.momentum.StochRSIIndicator(df['close'])
    df['StochRSI_k'] = stoch_rsi.stochrsi_k()
    df['StochRSI_d'] = stoch_rsi.stochrsi_d()

    # Volatility Indicators
    # ATR
    df['ATR'] = ta.volatility.AverageTrueRange(df['high'], df['low'], df['close']).average_true_range()

    # Volume Indicators
    # Calculate Volume SMA manually
    df['Volume_SMA_20'] = df['volume'].rolling(window=20).mean()
    df['Volume_ratio'] = df['volume'] / df['Volume_SMA_20']

    # MFI (Money Flow Index)
    df['MFI'] = ta.volume.money_flow_index(df['high'], df['low'], df['close'], df['volume'])

    # Additional Indicators
    # ADX (Average Directional Index)
    adx = ta.trend.ADXIndicator(df['high'], df['low'], df['close'])
    df['ADX'] = adx.adx()
    df['ADX_pos'] = adx.adx_pos()
    df['ADX_neg'] = adx.adx_neg()

    # Commodity Channel Index
    df['CCI'] = ta.trend.cci(df['high'], df['low'], df['close'])

    # Williams %R
    df['Williams_R'] = ta.momentum.WilliamsRIndicator(df['high'], df['low'], df['close']).williams_r()

    # Returns and Volatility
    df['returns'] = df['close'].pct_change()
    df['log_returns'] = np.log(df['close']).diff()
    df['volatility'] = df['returns'].rolling(window=20).std() * np.sqrt(365 * 24 * 4)  # Annualized

    # Clean up any infinite values
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    return df

def load_data(symbol='NIFTY50', min_periods=30, filter_current_week=True):
    """
    Load and prepare trading data with technical indicators.

    Args:
        symbol (str): Trading pair symbol
        min_periods (int): Minimum number of periods to load for calculating indicators
        filter_current_week (bool): Whether to filter for just the current week's data
    """
    from pathlib import Path
    import yfinance as yf
    
    # Current date for filtering
    today = datetime.now()
    start_of_week = today - timedelta(days=today.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Try to load data from historical_data directory first
    data_files = list(Path('historical_data').glob(f'{symbol}_data_*.csv'))

    df = None

    if data_files:
    # Load the most recent file
    latest_file = max(data_files, key=lambda x: x.stat().st_mtime)

    # Read CSV with proper parsing
    df = pd.read_csv(
        latest_file,
        parse_dates=['timestamp']
    )

    # Sort by timestamp and set as index
    df.sort_values('timestamp', inplace=True)
    df.set_index('timestamp', inplace=True)
        
        print(f"Loaded data from {latest_file}")
    else:
        # If no local data, download from Yahoo Finance
        print(f"No local data found for {symbol}, downloading from Yahoo Finance...")
        try:
            if symbol == 'NIFTY50':
                # Yahoo Finance uses different symbol for Nifty 50
                yf_symbol = "^NSEI"
            else:
                yf_symbol = symbol
                
            # Download data - last 30 days
            df = yf.download(
                yf_symbol, 
                start=today - timedelta(days=30),
                end=today + timedelta(days=1),
                interval="1d"  # Use daily data as hourly might not be available
            )
            
            # Rename columns to match our format
            df.columns = [col.lower() for col in df.columns]
            if 'adj close' in df.columns:
                df.rename(columns={'adj close': 'close'}, inplace=True)
        except Exception as e:
            print(f"Error downloading data: {e}")
            df = None
    
    # If we couldn't get any data, generate synthetic data
    if df is None or len(df) == 0:
        print("Using synthetic data for demonstration...")
        # Generate synthetic data - using 100 days to ensure enough data for indicators
        start_date = today - timedelta(days=100)
        dates = pd.date_range(start=start_date, periods=100, freq='D')
        
        # Create a DataFrame with synthetic price data
        np.random.seed(42)  # For reproducibility
        
        # Start with a base price and add random movements
        base_price = 22000  # Starting price for Nifty
        daily_volatility = 0.01  # 1% daily volatility
        
        # Generate random daily returns
        returns = np.random.normal(0.0005, daily_volatility, len(dates))  # Slight upward bias
        
        # Calculate prices from returns
        prices = base_price * (1 + np.cumsum(returns))
        
        # Generate OHLC data
        intraday_vol = daily_volatility / 2
        df = pd.DataFrame({
            'open': prices * (1 + np.random.normal(0, intraday_vol, len(dates))),
            'high': prices * (1 + np.abs(np.random.normal(0, intraday_vol*2, len(dates)))),
            'low': prices * (1 - np.abs(np.random.normal(0, intraday_vol*2, len(dates)))),
            'close': prices,
            'volume': np.random.randint(100000, 10000000, len(dates))
        }, index=dates)
        
        # Make sure high is the highest and low is the lowest
        for i in range(len(df)):
            df.loc[df.index[i], 'high'] = max(df.loc[df.index[i], ['open', 'high', 'close']])
            df.loc[df.index[i], 'low'] = min(df.loc[df.index[i], ['open', 'low', 'close']])
    
    # Filter for current week if requested, but only after technical indicators are calculated
    # We need sufficient data for indicator calculation

    # Add technical indicators
    df = add_technical_indicators(df)

    # Now filter for current week if requested
    if filter_current_week:
        # Get the start of the current week
        df_filtered = df[df.index >= start_of_week]
        if len(df_filtered) > 0:
            df = df_filtered
        else:
            # If no data for current week, just use the most recent 5 days
            df = df.iloc[-5:]
            print("No data for current week, using most recent data instead")

    # Drop NaN values from the beginning of the dataset
    df = df.dropna()

    print(f"\nLoaded data shape: {df.shape}")
    print(f"Date range: {df.index.min()} to {df.index.max()}")
    print("\nTechnical indicators available:")
    print(", ".join([col for col in df.columns if col not in ['open', 'high', 'low', 'close', 'volume',
                    'close_time', 'quote_asset_volume', 'number_of_trades',
                    'taker_buy_base_asset_volume', 'taker_buy_quote_asset_volume', 'ignore']]))

    return df

# --------------------------------------------------
# 2. Basic Price Analysis
# --------------------------------------------------

def plot_candlestick_volume(df, save_fig=True, fig_name='nifty_price_action.html'):
    """Create an enhanced candlestick chart with volume and key indicators"""
    # Define an appealing professional color scheme
    colors = {
        'primary': '#2c3e50',   # Dark blue
        'secondary': '#3498db', # Light blue
        'accent': '#2ecc71',    # Green
        'warning': '#e74c3c',   # Red
        'neutral': '#ecf0f1',   # Light gray
        'candle_up': '#26a69a', # Green for up candles
        'candle_down': '#ef5350', # Red for down candles
        'volume_up': 'rgba(38, 166, 154, 0.3)', # Transparent green
        'volume_down': 'rgba(239, 83, 80, 0.3)', # Transparent red
        'band_upper': 'rgba(231, 76, 60, 0.7)', # Red with transparency
        'band_middle': 'rgba(52, 152, 219, 0.7)', # Blue with transparency
        'band_lower': 'rgba(46, 204, 113, 0.7)'  # Green with transparency
    }

    # Create figure with secondary y-axis
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True,
                        vertical_spacing=0.03, subplot_titles=('Price Action & Bollinger Bands', 'Volume Analysis'),
                        row_heights=[0.7, 0.3])

    # Add candlestick with improved colors
    fig.add_trace(go.Candlestick(
        x=df.index,
                                open=df['open'],
                                high=df['high'],
                                low=df['low'],
                                close=df['close'],
        name='Price',
        increasing_line_color=colors['candle_up'],
        decreasing_line_color=colors['candle_down'],
        showlegend=True),
        row=1, col=1
    )

    # Add Bollinger Bands with better visuals
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['BB_upper'],
        line=dict(color=colors['band_upper'], width=1.5, dash='solid'),
        name='Upper Band',
        fill=None),
        row=1, col=1
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['BB_middle'],
        line=dict(color=colors['band_middle'], width=1.5),
        name='Middle Band'),
        row=1, col=1
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['BB_lower'],
        line=dict(color=colors['band_lower'], width=1.5, dash='solid'),
        name='Lower Band',
        fill='tonexty',  # Fill area between traces
        fillcolor='rgba(242, 242, 242, 0.2)'),
        row=1, col=1
    )
    
    # Add key SMAs for trend identification
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['SMA_20'],
        line=dict(color='#f39c12', width=1.5, dash='solid'),  # Orange
        name='SMA (20)'),
        row=1, col=1
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['SMA_50'],
        line=dict(color='#8e44ad', width=1.5, dash='solid'),  # Purple
        name='SMA (50)'),
        row=1, col=1
    )

    # Volume bars with color based on price direction
    volume_colors = []
    for i in range(len(df)):
        if i > 0 and df['close'].iloc[i] > df['close'].iloc[i-1]:
            volume_colors.append(colors['volume_up'])
        else:
            volume_colors.append(colors['volume_down'])
    
    fig.add_trace(go.Bar(
        x=df.index,
                        y=df['volume'],
        marker_color=volume_colors,
                        name='Volume'),
        row=2, col=1
    )

    # Add volume moving average for reference
    fig.add_trace(go.Scatter(
        x=df.index,
                            y=df['volume'].rolling(20).mean(),
        line=dict(color='rgba(0,0,0,0.5)', width=2),
                            name='Volume MA(20)'),
        row=2, col=1
    )
    
    # Calculate and display volume strength relative to average
    rel_volume = df['volume'] / df['volume'].rolling(20).mean()
    high_volume_idx = rel_volume > 1.5  # Identify high volume bars (>150% of average)
    
    # Add high volume markers
    if high_volume_idx.any():
        fig.add_trace(go.Scatter(
            x=df.index[high_volume_idx],
            y=df['volume'][high_volume_idx],
            mode='markers',
            marker=dict(
                symbol='triangle-up',
                size=10,
                color='rgba(255, 215, 0, 0.7)',  # Gold color
                line=dict(width=1, color='rgba(0,0,0,0.5)')
            ),
            name='High Volume'),
            row=2, col=1
        )
    
    # Add price change annotations
    # Calculate daily returns
    df['daily_return'] = df['close'].pct_change() * 100
    
    # Find significant price moves (>1.5%)
    significant_moves = (abs(df['daily_return']) > 1.5) & (df.index >= df.index[-10])
    
    # Add markers for significant price moves
    if significant_moves.any():
        positive_moves = (df['daily_return'] > 1.5) & (df.index >= df.index[-10])
        negative_moves = (df['daily_return'] < -1.5) & (df.index >= df.index[-10])
        
        if positive_moves.any():
            fig.add_trace(go.Scatter(
                x=df.index[positive_moves],
                y=df['high'][positive_moves] + (df['high'].max() - df['low'].min()) * 0.02,
                mode='markers+text',
                marker=dict(
                    symbol='triangle-up',
                    size=12,
                    color=colors['accent'],
                ),
                text=[f"+{r:.1f}%" for r in df['daily_return'][positive_moves]],
                textposition='top center',
                name='Strong Rally'),
                row=1, col=1
            )
        
        if negative_moves.any():
            fig.add_trace(go.Scatter(
                x=df.index[negative_moves],
                y=df['low'][negative_moves] - (df['high'].max() - df['low'].min()) * 0.02,
                mode='markers+text',
                marker=dict(
                    symbol='triangle-down',
                    size=12,
                    color=colors['warning'],
                ),
                text=[f"{r:.1f}%" for r in df['daily_return'][negative_moves]],
                textposition='bottom center',
                name='Sharp Decline'),
                row=1, col=1
            )

    # Add range slider and buttons for better navigation
    fig.update_layout(
        height=800,
        title={
            'text': 'Nifty 50 - Price Action with Bollinger Bands and Volume',
            'y': 0.98,
            'x': 0.5,
            'xanchor': 'center',
            'yanchor': 'top',
            'font': {'size': 20, 'color': colors['primary']}
        },
        hovermode='x unified',
        showlegend=True,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
            font=dict(size=10)
        ),
        xaxis=dict(
            rangeselector=dict(
                buttons=list([
                    dict(count=1, label="1D", step="day", stepmode="backward"),
                    dict(count=5, label="5D", step="day", stepmode="backward"),
                    dict(count=1, label="1M", step="month", stepmode="backward"),
                    dict(step="all")
                ]),
                bgcolor='rgba(0,0,0,0.05)',
                font=dict(color=colors['primary'])
            ),
            rangeslider=dict(visible=True, thickness=0.05),
            type="date"
        ),
        # Make the graph look more professional
        template='none',  # Clean template
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=50, r=30, t=100, b=50),
    )

    # Update axes with grid lines for better readability
    fig.update_xaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)'
    )
    
    fig.update_yaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)'
    )

    # Update y-axes labels
    fig.update_yaxes(title_text="Price", row=1, col=1)
    fig.update_yaxes(title_text="Volume", row=2, col=1)

    # Add current price annotation
    current_price = df['close'].iloc[-1]
    prev_price = df['close'].iloc[-2] if len(df) > 1 else df['close'].iloc[-1]
    price_change = ((current_price - prev_price) / prev_price) * 100
    
    change_color = colors['accent'] if price_change >= 0 else colors['warning']
    change_text = f"+{price_change:.2f}%" if price_change >= 0 else f"{price_change:.2f}%"
    
    fig.add_annotation(
        x=df.index[-1],
        y=current_price,
        text=f"Price: {current_price:.2f} ({change_text})",
        showarrow=True,
        arrowhead=2,
        arrowcolor=change_color,
        arrowsize=1,
        arrowwidth=1,
        ax=80,
        ay=-30,
        font=dict(size=12, color=change_color),
        bgcolor='rgba(255,255,255,0.8)',
        bordercolor=change_color,
        borderwidth=1,
        row=1, col=1
    )

    if save_fig:
        os.makedirs('figures', exist_ok=True)
        fig.write_html(f'figures/{fig_name}')
        print(f"Saved figure to figures/{fig_name}")
    else:
        fig.show()
    
    return fig

# --------------------------------------------------
# 3. Technical Indicators Analysis
# --------------------------------------------------

def plot_technical_indicators(df, save_fig=True, fig_name='nifty_technical_indicators.html'):
    # Create a more appealing figure with enhanced colors
    fig = make_subplots(rows=3, cols=2, specs=[[{}, {}], [{}, {}], [{"colspan": 2}, None]],
                       subplot_titles=('Price & Moving Averages', 'Bollinger Bands',
                                     'RSI', 'MACD', 'Volatility & Volume'),
                       vertical_spacing=0.1, horizontal_spacing=0.08)

    # Define a professional color scheme
    colors = {
        'primary': '#2c3e50',   # Dark blue
        'secondary': '#3498db', # Light blue
        'accent': '#2ecc71',    # Green
        'warning': '#e74c3c',   # Red
        'neutral': '#ecf0f1',   # Light gray
        'candle_up': '#26a69a', # Green for up candles
        'candle_down': '#ef5350', # Red for down candles
        'volume_up': 'rgba(38, 166, 154, 0.3)', # Transparent green
        'volume_down': 'rgba(239, 83, 80, 0.3)', # Transparent red
        'ma_fast': '#f39c12',   # Orange for fast MA
        'ma_slow': '#8e44ad',   # Purple for slow MA
        'band_upper': 'rgba(231, 76, 60, 0.7)', # Red with transparency
        'band_middle': 'rgba(52, 152, 219, 0.7)', # Blue with transparency
        'band_lower': 'rgba(46, 204, 113, 0.7)'  # Green with transparency
    }

    # Price & Moving Averages with enhanced visualization
    fig.add_trace(go.Candlestick(
        x=df.index, 
        open=df['open'],
        high=df['high'], 
        low=df['low'], 
        close=df['close'],
        name='Price',
        increasing_line_color=colors['candle_up'],
        decreasing_line_color=colors['candle_down']), 
        row=1, col=1
    )
    
    # Add moving averages
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['SMA_20'],
        line=dict(color=colors['ma_fast'], width=1.5), 
        name='SMA 20'), 
        row=1, col=1
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['SMA_50'],
        line=dict(color=colors['ma_slow'], width=1.5), 
        name='SMA 50'), 
        row=1, col=1
    )
    
    # Add EMA for comparison
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['EMA_20'],
        line=dict(color=colors['secondary'], width=1.5, dash='dash'), 
        name='EMA 20'), 
        row=1, col=1
    )

    # Bollinger Bands with enhanced visualization
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['close'],
        line=dict(color=colors['primary'], width=1.5), 
        name='Close Price'), 
        row=1, col=2
    )
    
    # Add Bollinger Bands with better visual distinction
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['BB_upper'],
        line=dict(color=colors['band_upper'], width=1.5), 
        name='Upper Band',
        fill=None), 
        row=1, col=2
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['BB_middle'],
        line=dict(color=colors['band_middle'], width=1.5), 
        name='Middle Band'), 
        row=1, col=2
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['BB_lower'],
        line=dict(color=colors['band_lower'], width=1.5), 
        name='Lower Band',
        fill='tonexty',  # Fill area between traces
        fillcolor='rgba(242, 242, 242, 0.2)'), 
        row=1, col=2
    )

    # RSI with improved visualization
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['RSI'],
        line=dict(color=colors['primary'], width=2), 
        name='RSI'), 
        row=2, col=1
    )
    
    # Add overbought/oversold zones with colored backgrounds
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=[70] * len(df),
        line=dict(color=colors['warning'], width=1, dash='dash'), 
        name='Overbought'), 
        row=2, col=1
    )
    
    # Add a colored zone for the overbought region
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=[100] * len(df),
        line=dict(color='rgba(0,0,0,0)'),
        showlegend=False,
        hoverinfo='none'), 
        row=2, col=1
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=[70] * len(df),
        line=dict(color='rgba(0,0,0,0)'),
        fill='tonexty', 
        fillcolor='rgba(231, 76, 60, 0.1)',
        showlegend=False,
        hoverinfo='none'), 
        row=2, col=1
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=[30] * len(df),
        line=dict(color=colors['accent'], width=1, dash='dash'), 
        name='Oversold'), 
        row=2, col=1
    )
    
    # Add a colored zone for the oversold region
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=[0] * len(df),
        line=dict(color='rgba(0,0,0,0)'),
        fill='tonexty', 
        fillcolor='rgba(46, 204, 113, 0.1)',
        showlegend=False,
        hoverinfo='none'), 
        row=2, col=1
    )
    
    # Add 50 level for neutral zone
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=[50] * len(df),
        line=dict(color='gray', width=1, dash='dot'), 
        name='Neutral',
        showlegend=False), 
        row=2, col=1
    )

    # MACD with enhanced visualization
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['MACD'],
        line=dict(color=colors['primary'], width=1.5), 
        name='MACD'), 
        row=2, col=2
    )
    
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['MACD_signal'],
        line=dict(color=colors['secondary'], width=1.5), 
        name='Signal'), 
        row=2, col=2
    )
    
    # Create color array for MACD histogram
    macd_colors = np.where(df['MACD_hist'] >= 0, colors['candle_up'], colors['candle_down'])
    
    # Emphasize histogram bars where MACD crosses signal line
    histogram_width = 2
    cross_points = (df['MACD_hist'] * df['MACD_hist'].shift(1)) <= 0
    emphasized_colors = np.where(cross_points, 'rgba(255, 215, 0, 0.8)', macd_colors)  # Gold color for crosses
    
    fig.add_trace(go.Bar(
        x=df.index, 
        y=df['MACD_hist'],
        marker_color=emphasized_colors,
        name='MACD Histogram'), 
        row=2, col=2
    )
    
    # Add a zero line for reference
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=[0] * len(df),
        line=dict(color='gray', width=1, dash='dot'),
        showlegend=False), 
        row=2, col=2
    )

    # Volatility & Volume with correlations
    # Combine volatility and volume to see correlations
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['volatility'],
        line=dict(color=colors['primary'], width=2), 
        name='Volatility',
        yaxis='y3'), 
        row=3, col=1
    )
    
    # Add ATR for comparison
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['ATR'],
        line=dict(color=colors['ma_fast'], width=2), 
        name='ATR',
        yaxis='y3'), 
        row=3, col=1
    )
    
    # Create color array for volume bars
    volume_colors = []
    for i in range(len(df)):
        if i > 0 and df['close'].iloc[i] > df['close'].iloc[i-1]:
            volume_colors.append(colors['volume_up'])
        else:
            volume_colors.append(colors['volume_down'])
    
    # Create a secondary y-axis for volume
    fig.add_trace(go.Bar(
        x=df.index, 
        y=df['volume'],
        marker_color=volume_colors,
        name='Volume',
        yaxis='y4'), 
        row=3, col=1
    )
    
    # Add volume moving average
    fig.add_trace(go.Scatter(
        x=df.index, 
        y=df['Volume_SMA_20'],
        line=dict(color='rgba(0,0,0,0.5)', width=1.5), 
        name='Volume MA(20)',
        yaxis='y4'), 
        row=3, col=1
    )

    # Update layout for better visualization
    fig.update_layout(
        height=800,
        title={
            'text': 'Nifty 50 - Advanced Technical Analysis Dashboard',
            'y': 0.98,
            'x': 0.5,
            'xanchor': 'center',
            'yanchor': 'top',
            'font': {'size': 20, 'color': colors['primary']}
        },
        hovermode='x unified',
        showlegend=True,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
            font=dict(size=10)
        ),
        template='none',  # Clean template
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=50, r=30, t=100, b=50),
        
        # Custom axis for volatility and volume overlay
        yaxis3=dict(
            title='Volatility',
            side='left',
            overlaying='y',
            anchor='x',
            showgrid=True,
            gridcolor='rgba(0,0,0,0.1)'
        ),
        yaxis4=dict(
            title='Volume',
            side='right',
            overlaying='y3',
            anchor='x',
            showgrid=False,
            rangemode='nonnegative'
        )
    )

    # Update axes for better visualization
    fig.update_xaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)'
    )
    
    fig.update_yaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)'
    )
    
    # Special styling for RSI range
    fig.update_yaxes(range=[0, 100], row=2, col=1)
    
    # Add annotations for current values
    current_price = df['close'].iloc[-1]
    current_rsi = df['RSI'].iloc[-1]
    current_macd = df['MACD'].iloc[-1]
    current_signal = df['MACD_signal'].iloc[-1]
    
    # Price annotation
    fig.add_annotation(
        x=df.index[-1],
        y=current_price,
        text=f"Price: {current_price:.2f}",
        showarrow=True,
        arrowhead=2,
        arrowcolor=colors['primary'],
        arrowsize=1,
        arrowwidth=1,
        ax=50,
        ay=-30,
        font=dict(size=10, color=colors['primary']),
        bgcolor='rgba(255,255,255,0.8)',
        bordercolor=colors['primary'],
        borderwidth=1,
        row=1, col=1
    )
    
    # RSI annotation
    rsi_color = colors['accent'] if current_rsi < 30 else colors['warning'] if current_rsi > 70 else colors['primary']
    fig.add_annotation(
        x=df.index[-1],
        y=current_rsi,
        text=f"RSI: {current_rsi:.2f}",
        showarrow=True,
        arrowhead=2,
        arrowcolor=rsi_color,
        arrowsize=1,
        arrowwidth=1,
        ax=50,
        ay=0,
        font=dict(size=10, color=rsi_color),
        bgcolor='rgba(255,255,255,0.8)',
        bordercolor=rsi_color,
        borderwidth=1,
        row=2, col=1
    )
    
    # MACD annotation
    macd_color = colors['accent'] if current_macd > current_signal else colors['warning']
    fig.add_annotation(
        x=df.index[-1],
        y=current_macd,
        text=f"MACD: {current_macd:.4f}",
        showarrow=True,
        arrowhead=2,
        arrowcolor=macd_color,
        arrowsize=1,
        arrowwidth=1,
        ax=50,
        ay=0,
        font=dict(size=10, color=macd_color),
        bgcolor='rgba(255,255,255,0.8)',
        bordercolor=macd_color,
        borderwidth=1,
        row=2, col=2
    )
    
    if save_fig:
        os.makedirs('figures', exist_ok=True)
        fig.write_html(f'figures/{fig_name}')
        print(f"Saved figure to figures/{fig_name}")
    else:
        fig.show()
    
    return fig

# --------------------------------------------------
# 4. Volatility Analysis
# --------------------------------------------------

def plot_volatility_analysis(df, save_fig=True, fig_name='nifty_volatility.html'):
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True,
                       subplot_titles=('Volatility Regimes', 'Intraday Volatility Pattern'))

    # Volatility regimes
    # Handle categorical data properly by creating a color mapping directly
    try:
        # Try to create quantiles, but handle errors gracefully
        bins = pd.qcut(df['volatility'].replace([np.inf, -np.inf], np.nan).dropna(), 4, 
                     labels=['Low', 'Moderate', 'High', 'Extreme'])
        df['volatility_label'] = bins
        
        # Fill NaNs with a string value
        df['volatility_label'] = df['volatility_label'].astype(str)
        df.loc[df['volatility_label'] == 'nan', 'volatility_label'] = 'Unknown'
        
        # Create color list
        colors_dict = {'Low': 'green', 'Moderate': 'yellow', 'High': 'orange', 'Extreme': 'red', 'Unknown': 'gray'}
        color_list = [colors_dict.get(val, 'gray') for val in df['volatility_label']]
    except Exception as e:
        print(f"Error in volatility quantile calculation: {e}")
        # Just use a gradient based on volatility value instead
        color_scale = px.colors.sequential.Plasma
        norm_volatility = (df['volatility'] - df['volatility'].min()) / (df['volatility'].max() - df['volatility'].min())
        color_list = [px.colors.sample_colorscale(color_scale, v)[0] if not pd.isna(v) else 'gray' for v in norm_volatility]
    
    # Create scatter plot
    fig.add_trace(go.Scatter(x=df.index, y=df['volatility'],
                           mode='markers', marker=dict(color=color_list),
                           name='Volatility Regime'), row=1, col=1)

    # Intraday pattern
    if len(df) > 0 and hasattr(df.index, 'hour'):
    hour_vol = df.groupby(df.index.hour)['volatility'].mean()
    fig.add_trace(go.Bar(x=hour_vol.index, y=hour_vol,
                       marker_color='purple', name='Hourly Volatility'), row=2, col=1)

    fig.update_layout(height=800, title_text="Nifty 50 - Volatility Analysis (Current Week)")
    
    if save_fig:
        os.makedirs('figures', exist_ok=True)
        fig.write_html(f'figures/{fig_name}')
        print(f"Saved figure to figures/{fig_name}")
    else:
    fig.show()

    return fig

# --------------------------------------------------
# 5. Market Regime Analysis
# --------------------------------------------------

def detect_market_regime(df):
    df = df.copy()

    # Calculate volatility if not already calculated
    if 'volatility' not in df.columns:
    df['volatility'] = df['returns'].rolling(window=20).std()

    # Calculate trend strength using price changes
    df['trend'] = abs(df['close'].pct_change(20))

    # Define regime thresholds
    vol_threshold = df['volatility'].quantile(0.7)
    trend_threshold = df['trend'].quantile(0.7)

    # Classify market regimes
    conditions = [
        (df['trend'] >= trend_threshold) & (df['volatility'] >= vol_threshold),
        (df['trend'] >= trend_threshold) & (df['volatility'] < vol_threshold),
        (df['trend'] < trend_threshold) & (df['volatility'] >= vol_threshold),
        (df['trend'] < trend_threshold) & (df['volatility'] < vol_threshold)
    ]
    choices = ['STRONG_TREND', 'WEAK_TREND', 'VOLATILE_RANGE', 'QUIET_RANGE']
    df['regime'] = np.select(conditions, choices, default='QUIET_RANGE')

    return df

def plot_market_regimes(df, save_fig=True, fig_name='nifty_regimes.html'):
    """Create an enhanced market regime analysis visualization"""
    # Define a professional color scheme
    colors = {
        'primary': '#2c3e50',   # Dark blue
        'secondary': '#3498db', # Light blue
        'accent': '#2ecc71',    # Green
        'warning': '#e74c3c',   # Red
        'neutral': '#ecf0f1',   # Light gray
        'STRONG_TREND': '#e74c3c',  # Bright red
        'WEAK_TREND': '#f39c12',    # Orange
        'VOLATILE_RANGE': '#8e44ad', # Purple
        'QUIET_RANGE': '#3498db'     # Blue
    }
    
    # Create a copy of the dataframe and detect regimes
df_regime = detect_market_regime(df)

    # Create a plotly figure with subplots
    fig = make_subplots(
        rows=3, 
        cols=1, 
        shared_xaxes=True,
        subplot_titles=(
            'Price with Market Regimes', 
            'Regime Distribution',
            'Trend & Volatility Analysis'
        ),
        row_heights=[0.5, 0.2, 0.3],
        vertical_spacing=0.1
    )

    # Price plot with regime background
    # First, group consecutive regimes
    regime_changes = df_regime['regime'].ne(df_regime['regime'].shift()).cumsum()
    regime_groups = df_regime.groupby(regime_changes)
    
    # For each regime group, create a rectangle shape
    shapes = []
    annotations = []
    
    for _, group in regime_groups:
        regime = group['regime'].iloc[0]
        start_idx = group.index[0]
        end_idx = group.index[-1]
        
        # Add a shaped background for this regime
        shapes.append(
            dict(
                type="rect",
                xref="x",
                yref="paper",
                x0=start_idx,
                x1=end_idx,
                y0=0,
                y1=1,
                fillcolor=f"rgba({int(colors[regime][1:3], 16)}, {int(colors[regime][3:5], 16)}, {int(colors[regime][5:7], 16)}, 0.1)",
                line=dict(width=0),
                layer="below"
            )
        )
        
        # Add an annotation for long regime periods (3 or more days)
        if len(group) >= 3:
            annotations.append(
                dict(
                    x=group.index[len(group)//2],  # Middle of the regime
                    y=1.05,  # Above the chart
                    xref="x",
                    yref="paper",
                    text=regime.replace("_", " "),
                    showarrow=False,
                    font=dict(
                        color=colors[regime],
                        size=10
                    ),
                    bgcolor="rgba(255, 255, 255, 0.8)",
                    bordercolor=colors[regime],
                    borderwidth=1,
                    borderpad=2,
                    align="center"
                )
            )
    
    # Add a line for the closing price
    fig.add_trace(
        go.Scatter(
            x=df_regime.index, 
            y=df_regime['close'],
            line=dict(color=colors['primary'], width=2),
            name='Close Price'
        ),
        row=1, col=1
    )
    
    # Add markers for regime points - one for each regime to appear in legend
    for regime in colors.keys():
        if regime in ['primary', 'secondary', 'accent', 'warning', 'neutral']:
            continue
            
        mask = df_regime['regime'] == regime
        if mask.any():
            # Only plot first point for legend
            first_point_idx = df_regime[mask].index[0]
            fig.add_trace(
                go.Scatter(
                    x=[first_point_idx],
                    y=[df_regime.loc[first_point_idx, 'close']],
                    mode='markers',
                    marker=dict(
                        color=colors[regime],
                        size=10,
                        symbol='circle',
                        line=dict(color='white', width=1)
                    ),
                    name=regime.replace("_", " "),
                    showlegend=True
                ),
                row=1, col=1
            )
    
    # Regime distribution - horizontal bar chart with percentages
    regime_counts = df_regime['regime'].value_counts()
    regime_pcts = df_regime['regime'].value_counts(normalize=True) * 100
    
    # Sort regimes for visual appeal
    sorted_regimes = regime_counts.sort_values(ascending=True).index
    
    # Create combined labels with counts and percentages
    labels = [f"{regime.replace('_', ' ')} ({count} bars, {pct:.1f}%)" 
              for regime, count, pct in zip(sorted_regimes, 
                                           regime_counts[sorted_regimes], 
                                           regime_pcts[sorted_regimes])]
    
    fig.add_trace(
        go.Bar(
            y=labels,
            x=regime_counts[sorted_regimes],
            orientation='h',
            marker_color=[colors[x] for x in sorted_regimes],
            text=[f"{x:.1f}%" for x in regime_pcts[sorted_regimes]],
            textposition='auto',
            hoverinfo='text',
            hovertext=[f"{regime}: {count} bars ({pct:.1f}%)" 
                      for regime, count, pct in zip(sorted_regimes, 
                                                 regime_counts[sorted_regimes], 
                                                 regime_pcts[sorted_regimes])]
        ),
        row=2, col=1
    )
    
    # Add trend and volatility analysis as scatter plot
    fig.add_trace(
        go.Scatter(
            x=df_regime['trend'],
            y=df_regime['volatility'],
            mode='markers',
            marker=dict(
                color=[colors[r] for r in df_regime['regime']],
                size=10,
                opacity=0.7,
                line=dict(color='white', width=1)
            ),
            text=[f"Date: {idx.strftime('%Y-%m-%d')}<br>Regime: {r}<br>Trend: {t:.4f}<br>Volatility: {v:.4f}" 
                 for idx, r, t, v in zip(df_regime.index, 
                                      df_regime['regime'], 
                                      df_regime['trend'], 
                                      df_regime['volatility'])],
            hoverinfo='text',
            name='Trend vs Volatility'
        ),
        row=3, col=1
    )
    
    # Add dividing lines for regime quadrants
    # Get thresholds used in regime detection
    vol_threshold = df_regime['volatility'].quantile(0.7)
    trend_threshold = df_regime['trend'].quantile(0.7)
    
    # Add vertical and horizontal lines for thresholds
    fig.add_shape(
        type="line",
        x0=trend_threshold,
        x1=trend_threshold,
        y0=0,
        y1=df_regime['volatility'].max() * 1.1,
        line=dict(color="rgba(0,0,0,0.3)", width=1, dash="dot"),
        row=3, col=1
    )
    
    fig.add_shape(
        type="line",
        x0=0,
        x1=df_regime['trend'].max() * 1.1,
        y0=vol_threshold,
        y1=vol_threshold,
        line=dict(color="rgba(0,0,0,0.3)", width=1, dash="dot"),
        row=3, col=1
    )
    
    # Add quadrant labels
    quadrants = [
        {"x": trend_threshold * 1.1, "y": vol_threshold * 1.1, "text": "STRONG_TREND", "color": colors['STRONG_TREND']},
        {"x": trend_threshold * 1.1, "y": vol_threshold * 0.5, "text": "WEAK_TREND", "color": colors['WEAK_TREND']},
        {"x": trend_threshold * 0.5, "y": vol_threshold * 1.1, "text": "VOLATILE_RANGE", "color": colors['VOLATILE_RANGE']},
        {"x": trend_threshold * 0.5, "y": vol_threshold * 0.5, "text": "QUIET_RANGE", "color": colors['QUIET_RANGE']}
    ]
    
    for q in quadrants:
        fig.add_annotation(
            x=q["x"],
            y=q["y"],
            text=q["text"].replace("_", " "),
            showarrow=False,
            font=dict(color=q["color"], size=10),
            row=3, col=1
        )

    # Update layout for better visualization
    fig.update_layout(
        height=900,
        title={
            'text': 'Nifty 50 - Advanced Market Regime Analysis',
            'y': 0.98,
            'x': 0.5,
            'xanchor': 'center',
            'yanchor': 'top',
            'font': {'size': 20, 'color': colors['primary']}
        },
        shapes=shapes,  # Add the regime background shapes
        annotations=annotations,  # Add regime labels
        showlegend=True,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
            font=dict(size=10)
        ),
        # Make the graph look more professional
        template='none',  # Clean template
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        margin=dict(l=80, r=30, t=100, b=50),
        hovermode='closest'
    )
    
    # Customize axes
    fig.update_xaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)',
        row=1, col=1
    )
    
    fig.update_yaxes(
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)',
        row=1, col=1
    )
    
    # Customize the distribution axis
    fig.update_xaxes(
        title="Number of Bars",
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)',
        row=2, col=1
    )
    
    # Customize trend/volatility plot axes
    fig.update_xaxes(
        title="Trend Strength",
        range=[0, df_regime['trend'].max() * 1.1],
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)',
        row=3, col=1
    )
    
    fig.update_yaxes(
        title="Volatility",
        range=[0, df_regime['volatility'].max() * 1.1],
        showgrid=True,
        gridwidth=1,
        gridcolor='rgba(0,0,0,0.1)',
        zeroline=False,
        showline=True,
        linewidth=1,
        linecolor='rgba(0,0,0,0.2)',
        row=3, col=1
    )
    
    # Add a title for each row
    fig.update_yaxes(title_text="Price", row=1, col=1)
    fig.update_yaxes(title_text="Regimes", row=2, col=1)

    if save_fig:
        os.makedirs('figures', exist_ok=True)
        fig.write_html(f'figures/{fig_name}')
        print(f"Saved figure to figures/{fig_name}")
    else:
fig.show()

    # Print regime statistics
    print("\nRegime Statistics:")
    regime_stats = pd.DataFrame({
        'Count': df_regime['regime'].value_counts(),
        'Percentage': df_regime['regime'].value_counts(normalize=True) * 100,
    })
    regime_stats['Percentage'] = regime_stats['Percentage'].round(2)
    print(regime_stats)
    
    return fig

# --------------------------------------------------
# 6. Generate Summary Report
# --------------------------------------------------

def generate_summary_report(df):
    """Generate a summary report for the current week's analysis"""
    
    # Calculate basic statistics
    last_close = df['close'].iloc[-1]
    first_close = df['close'].iloc[0]
    weekly_return = (last_close / first_close - 1) * 100
    
    max_price = df['high'].max()
    min_price = df['low'].min()
    
    # RSI, MACD signals
    current_rsi = df['RSI'].iloc[-1]
    rsi_signal = "Overbought" if current_rsi > 70 else "Oversold" if current_rsi < 30 else "Neutral"
    
    current_macd = df['MACD'].iloc[-1]
    current_signal = df['MACD_signal'].iloc[-1]
    macd_signal = "Bullish" if current_macd > current_signal else "Bearish"
    
    # Bollinger Band position
    current_close = df['close'].iloc[-1]
    upper_band = df['BB_upper'].iloc[-1]
    lower_band = df['BB_lower'].iloc[-1]
    
    if current_close > upper_band:
        bb_signal = "Above upper band (potential overbought)"
    elif current_close < lower_band:
        bb_signal = "Below lower band (potential oversold)"
    else:
        bb_signal = "Within bands (neutral)"
    
    # Prepare summary text
    summary = f"""
    # Nifty 50 - Weekly Analysis Summary
    
    ## Price Action
    - **Weekly Return**: {weekly_return:.2f}%
    - **Current Price**: {last_close:.2f}
    - **Weekly Range**: {min_price:.2f} - {max_price:.2f}
    
    ## Technical Signals
    - **RSI (14)**: {current_rsi:.2f} - {rsi_signal}
    - **MACD**: {macd_signal}
    - **Bollinger Bands**: {bb_signal}
    
    ## Market Regime
    - Predominant regime analysis shown in the Market Regime chart
    
    ## Key Levels to Watch
    - **Support**: {min_price:.2f}
    - **Resistance**: {max_price:.2f}
    - **BB Upper**: {upper_band:.2f}
    - **BB Lower**: {lower_band:.2f}
    
    ## Overall Sentiment
    - {generate_overall_sentiment(df)}
    """
    
    # Save summary to file
    os.makedirs('reports', exist_ok=True)
    with open('reports/nifty_weekly_summary.md', 'w') as f:
        f.write(summary)
    
    print("\nSummary Report:")
    print(summary)
    
    return summary

def generate_overall_sentiment(df):
    """Generate an overall market sentiment based on technical indicators"""
    
    # Get latest values
    current_rsi = df['RSI'].iloc[-1]
    current_macd = df['MACD'].iloc[-1]
    current_signal = df['MACD_signal'].iloc[-1]
    current_close = df['close'].iloc[-1]
    upper_band = df['BB_upper'].iloc[-1]
    lower_band = df['BB_lower'].iloc[-1]
    
    # Count bullish and bearish signals
    bullish_signals = 0
    bearish_signals = 0
    
    # RSI signal
    if current_rsi > 50:
        bullish_signals += 1
    else:
        bearish_signals += 1
    
    # MACD signal
    if current_macd > current_signal:
        bullish_signals += 1
    else:
        bearish_signals += 1
    
    # Bollinger Band signal
    if current_close > (upper_band + lower_band) / 2:
        bullish_signals += 1
    else:
        bearish_signals += 1
    
    # Determine sentiment
    if bullish_signals > bearish_signals:
        return "Bullish - More technical indicators showing positive signals"
    elif bearish_signals > bullish_signals:
        return "Bearish - More technical indicators showing negative signals"
    else:
        return "Neutral - Mixed signals from technical indicators"

# --------------------------------------------------
# Main Execution
# --------------------------------------------------

if __name__ == "__main__":
    print("Performing Nifty 50 EDA for current week...")
    
    # Load data
    df = load_data(symbol='NIFTY50', filter_current_week=True)
    
    # Check if we have enough data
    if len(df) < 5:
        print("Not enough data for the current week. Loading last 5 days instead...")
        df = load_data(symbol='NIFTY50', filter_current_week=False)
        # Filter to last 5 days
        df = df.iloc[-120:]  # Assuming 24 candles per day
    
    # Create analysis figures
    print("\nGenerating analysis charts...")
    price_fig = plot_candlestick_volume(df)
    tech_fig = plot_technical_indicators(df)
    vol_fig = plot_volatility_analysis(df)
    regime_fig = plot_market_regimes(df)
    
    # Generate summary report
    summary = generate_summary_report(df)
    
    print("\nAnalysis complete! All figures saved to 'figures/' directory")
    print("Summary report saved to 'reports/nifty_weekly_summary.md'")