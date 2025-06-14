import os
import sys
import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
import logging
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
import matplotlib.pyplot as plt

# Add parent directory to path to import from project root
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from data_cache import DataCache

# Import our synthetic data generator
from .data_generator import SyntheticDataGenerator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'nifty_intraday_bot.log'))
    ]
)
logger = logging.getLogger('data_fetcher')

class NiftyDataFetcher:
    """Class to fetch and prepare Nifty intraday data for backtesting"""
    
    def __init__(self, cache_dir='nifty_intraday_bot/data/cache', use_synthetic_data=True):
        """Initialize the data fetcher with cache support"""
        self.cache = DataCache(cache_dir=cache_dir)
        self.default_intervals = ['5m', '15m', '30m', '1h']
        self.use_synthetic_data = use_synthetic_data
        
        # Create cache directory if it doesn't exist
        os.makedirs(cache_dir, exist_ok=True)
        logger.info(f"Initialized NiftyDataFetcher with cache at {cache_dir}")
    
    def fetch_intraday_data(self, symbol="^NSEI", interval="5m", period="3mo", preprocess=True):
        """
        Fetch intraday data for the given symbol
        
        Args:
            symbol (str): Symbol to fetch data for (default: ^NSEI for Nifty 50)
            interval (str): Data interval ('1m', '5m', '15m', '30m', '1h')
            period (str): Period to fetch ('1d', '5d', '1mo', '3mo', '6mo', '1y')
            preprocess (bool): Whether to preprocess the data (add technical indicators, etc.)
            
        Returns:
            pandas.DataFrame: DataFrame with intraday data
        """
        logger.info(f"Fetching {interval} data for {symbol} over {period} period")
        
        # Calculate date range based on period
        end_date = datetime.now()
        if period == '1d':
            start_date = end_date - timedelta(days=1)
            days = 1
        elif period == '5d':
            start_date = end_date - timedelta(days=5)
            days = 5
        elif period == '1mo':
            start_date = end_date - timedelta(days=30)
            days = 30
        elif period == '3mo':
            start_date = end_date - timedelta(days=90)
            days = 90
        elif period == '6mo':
            start_date = end_date - timedelta(days=180)
            days = 180
        elif period == '1y':
            start_date = end_date - timedelta(days=365)
            days = 365
        else:
            start_date = end_date - timedelta(days=90)  # Default to 3 months
            days = 90
        
        # Try to get from cache first
        cache_key = f"{symbol}_{interval}"
        df = self.cache.get_data(cache_key, start_date, end_date)
        
        if df is not None:
            logger.info(f"Using cached data for {symbol} from {start_date} to {end_date}")
        else:
            try:
                logger.info(f"Downloading fresh data for {symbol} from {start_date} to {end_date}")
                # yfinance for intraday data
                df = yf.download(symbol, interval=interval, period=period)
                
                if df is None or df.empty:
                    logger.error(f"No data fetched for {symbol}")
                    if self.use_synthetic_data:
                        logger.info(f"Generating synthetic data for {symbol}")
                        
                        # Determine base price based on symbol
                        if symbol == "^NSEI":  # Nifty 50
                            base_price = 20000.0
                        elif symbol == "^BSESN":  # Sensex
                            base_price = 65000.0
                        elif symbol == "RELIANCE.NS":  # Reliance Industries
                            base_price = 2500.0
                        elif symbol == "TCS.NS":  # Tata Consultancy Services
                            base_price = 3500.0
                        elif symbol == "INFY.NS":  # Infosys
                            base_price = 1500.0
                        else:
                            base_price = 1000.0  # Default for other stocks
                        
                        # Generate synthetic data
                        generator = SyntheticDataGenerator(base_price=base_price, volatility=0.015)
                        df = generator.generate_intraday_data(interval=interval, days=days)
                    else:
                        return None
                
                # Ensure timestamp is in index
                if 'Datetime' in df.columns:
                    df.set_index('Datetime', inplace=True)
                    
                # Standardize column names (lowercase)
                df.columns = [col.lower() for col in df.columns]
                
                # Cache the data
                reset_df = df.reset_index()
                if 'index' in reset_df.columns:
                    reset_df.rename(columns={'index': 'timestamp'}, inplace=True)
                elif df.index.name:
                    reset_df.rename(columns={df.index.name: 'timestamp'}, inplace=True)
                
                self.cache.save_data(cache_key, reset_df, start_date, end_date)
                
                # Set the index back
                if 'timestamp' in df.columns:
                    df.set_index('timestamp', inplace=True)
                    
            except Exception as e:
                logger.error(f"Error fetching data for {symbol}: {str(e)}")
                
                if self.use_synthetic_data:
                    logger.info(f"Generating synthetic data for {symbol} after error")
                    
                    # Determine base price based on symbol
                    if symbol == "^NSEI":  # Nifty 50
                        base_price = 20000.0
                    elif symbol == "^BSESN":  # Sensex
                        base_price = 65000.0
                    elif symbol == "RELIANCE.NS":  # Reliance Industries
                        base_price = 2500.0
                    elif symbol == "TCS.NS":  # Tata Consultancy Services
                        base_price = 3500.0
                    elif symbol == "INFY.NS":  # Infosys
                        base_price = 1500.0
                    else:
                        base_price = 1000.0  # Default for other stocks
                    
                    # Generate synthetic data
                    generator = SyntheticDataGenerator(base_price=base_price, volatility=0.015)
                    df = generator.generate_intraday_data(interval=interval, days=days)
                else:
                    return None
        
        # Preprocess the data if requested
        if preprocess and df is not None and not df.empty:
            df = self.preprocess_data(df)
        
        return df
    
    def fetch_multi_timeframe_data(self, symbol="^NSEI", intervals=None, period="3mo"):
        """
        Fetch data for multiple timeframes for the same symbol
        
        Args:
            symbol (str): Symbol to fetch data for
            intervals (list): List of intervals to fetch
            period (str): Period to fetch
            
        Returns:
            dict: Dictionary mapping intervals to DataFrames
        """
        if intervals is None:
            intervals = self.default_intervals
        
        data_dict = {}
        for interval in intervals:
            logger.info(f"Fetching {interval} data for {symbol}")
            df = self.fetch_intraday_data(symbol, interval, period)
            if df is not None and not df.empty:
                data_dict[interval] = df
            else:
                logger.warning(f"Failed to fetch {interval} data for {symbol}")
        
        return data_dict
    
    def preprocess_data(self, df):
        """
        Preprocess the data for strategy testing
        
        Args:
            df (pandas.DataFrame): Raw DataFrame with OHLCV data
            
        Returns:
            pandas.DataFrame: Preprocessed DataFrame with technical indicators
        """
        logger.info(f"Preprocessing data with shape {df.shape}")
        
        # Make a copy to avoid modifying the original
        df = df.copy()
        
        # Add basic technical indicators
        # 1. Moving averages
        for ma_period in [5, 10, 20, 50, 200]:
            df[f'sma_{ma_period}'] = df['close'].rolling(window=ma_period).mean()
            df[f'ema_{ma_period}'] = df['close'].ewm(span=ma_period, adjust=False).mean()
            
        # 2. Bollinger Bands
        df['middle_band'] = df['close'].rolling(window=20).mean()
        df['std_dev'] = df['close'].rolling(window=20).std()
        df['upper_band'] = df['middle_band'] + (df['std_dev'] * 2)
        df['lower_band'] = df['middle_band'] - (df['std_dev'] * 2)
        
        # 3. RSI (Relative Strength Index)
        delta = df['close'].diff()
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)
        
        avg_gain = gain.rolling(window=14).mean()
        avg_loss = loss.rolling(window=14).mean()
        
        rs = avg_gain / avg_loss
        df['rsi'] = 100 - (100 / (1 + rs))
        
        # 4. MACD (Moving Average Convergence Divergence)
        df['ema_12'] = df['close'].ewm(span=12, adjust=False).mean()
        df['ema_26'] = df['close'].ewm(span=26, adjust=False).mean()
        df['macd'] = df['ema_12'] - df['ema_26']
        df['macd_signal'] = df['macd'].ewm(span=9, adjust=False).mean()
        df['macd_hist'] = df['macd'] - df['macd_signal']
        
        # 5. Add returns calculations
        df['returns'] = df['close'].pct_change()
        df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
        
        # 6. Add volatility calculation
        df['volatility'] = df['returns'].rolling(window=20).std() * np.sqrt(252)
        
        # 7. Add ADX (Average Directional Index)
        # First calculate +DI and -DI
        high_change = df['high'].diff()
        low_change = -df['low'].diff()
        
        plus_dm = high_change.where((high_change > low_change) & (high_change > 0), 0)
        minus_dm = low_change.where((low_change > high_change) & (low_change > 0), 0)
        
        tr = pd.DataFrame([
            df['high'] - df['low'],
            abs(df['high'] - df['close'].shift(1)),
            abs(df['low'] - df['close'].shift(1))
        ]).max()
        
        plus_di = 100 * (plus_dm.rolling(window=14).mean() / tr.rolling(window=14).mean())
        minus_di = 100 * (minus_dm.rolling(window=14).mean() / tr.rolling(window=14).mean())
        
        dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
        df['adx'] = dx.rolling(window=14).mean()
        
        # 8. Add ATR (Average True Range)
        df['atr'] = tr.rolling(window=14).mean()
        
        # 9. Add Stochastic Oscillator
        low_14 = df['low'].rolling(window=14).min()
        high_14 = df['high'].rolling(window=14).max()
        
        df['stoch_k'] = 100 * ((df['close'] - low_14) / (high_14 - low_14))
        df['stoch_d'] = df['stoch_k'].rolling(window=3).mean()
        
        # Drop NaN values from the beginning due to rolling windows
        logger.info(f"Dropping NaN values. Before: {df.shape[0]} rows")
        df = df.dropna()
        logger.info(f"After: {df.shape[0]} rows")
        
        return df
    
    def visualize_data(self, df, interval, title=None):
        """
        Visualize the fetched data
        
        Args:
            df (pandas.DataFrame): DataFrame with OHLCV data
            interval (str): Data interval
            title (str): Plot title
        """
        if df is None or df.empty:
            logger.warning("No data to visualize")
            return
            
        # Create a larger figure
        plt.figure(figsize=(15, 10))
        
        # Plot OHLC data
        plt.subplot(3, 1, 1)
        plt.plot(df.index, df['close'], label='Close Price')
        plt.plot(df.index, df['sma_20'], label='SMA 20', linestyle='--')
        plt.plot(df.index, df['upper_band'], label='Upper BB', alpha=0.6)
        plt.plot(df.index, df['lower_band'], label='Lower BB', alpha=0.6)
        plt.fill_between(df.index, df['upper_band'], df['lower_band'], alpha=0.1)
        plt.title(title or f'Nifty Intraday Data ({interval})')
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        # Plot volume
        plt.subplot(3, 1, 2)
        plt.bar(df.index, df['volume'], width=0.6, alpha=0.7)
        plt.title('Volume')
        plt.grid(True, alpha=0.3)
        
        # Plot RSI
        plt.subplot(3, 1, 3)
        plt.plot(df.index, df['rsi'], label='RSI')
        plt.axhline(y=70, color='r', linestyle='--', alpha=0.5, label='Overbought')
        plt.axhline(y=30, color='g', linestyle='--', alpha=0.5, label='Oversold')
        plt.axhline(y=50, color='k', linestyle='--', alpha=0.2)
        plt.title('RSI (14)')
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        plt.tight_layout()
        
        # Save the visualization
        os.makedirs('nifty_intraday_bot/results/visualizations', exist_ok=True)
        plt.savefig(f'nifty_intraday_bot/results/visualizations/nifty_{interval}_{datetime.now().strftime("%Y%m%d")}.png')
        logger.info(f"Saved visualization to nifty_intraday_bot/results/visualizations/nifty_{interval}_{datetime.now().strftime('%Y%m%d')}.png")
        
        plt.close()

# Direct usage example
if __name__ == "__main__":
    # Create data fetcher
    fetcher = NiftyDataFetcher()
    
    # Fetch 3 months of intraday data for Nifty 50 at different intervals
    intervals = ['5m', '15m', '30m', '1h']
    period = '3mo'
    
    print(f"Fetching {period} of Nifty 50 intraday data at intervals: {', '.join(intervals)}")
    
    data_dict = fetcher.fetch_multi_timeframe_data(symbol="^NSEI", intervals=intervals, period=period)
    
    # Show summary statistics for each interval
    for interval, df in data_dict.items():
        if df is not None and not df.empty:
            print(f"\n{interval} data summary:")
            print(f"- Date range: {df.index.min()} to {df.index.max()}")
            print(f"- Trading days: {df.index.date.nunique()}")
            print(f"- Total candles: {len(df)}")
            print(f"- Price range: {df['low'].min():.2f} - {df['high'].max():.2f}")
            
            # Visualize the data
            fetcher.visualize_data(df, interval)
    
    print("\nData fetching complete. Visualizations saved to nifty_intraday_bot/results/visualizations/") 