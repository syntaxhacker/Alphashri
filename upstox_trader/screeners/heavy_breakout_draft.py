import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.colors import LinearSegmentedColormap
from typing import List, Tuple, Dict, Optional
import warnings
warnings.filterwarnings('ignore')

class SmartMoneyBreakoutChannels:
    """
    Smart Money Breakout Channels Indicator
    
    Identifies consolidation zones and breakout signals with volume analysis
    """
    
    def __init__(self, 
                 overlap: bool = False,
                 strong_closes: bool = True,
                 normalization_length: int = 100,
                 box_detection_length: int = 14,
                 show_volume: bool = True,
                 volume_mode: str = "Comparison",  # "Volume", "Comparison", "Delta"
                 volume_scale: float = 0.5):
        
        self.overlap = overlap
        self.strong_closes = strong_closes
        self.normalization_length = normalization_length
        self.box_detection_length = box_detection_length
        self.show_volume = show_volume
        self.volume_mode = volume_mode
        self.volume_scale = volume_scale
        
        # Storage for channels
        self.channels = []
        self.breakout_signals = []
        
    def rolling_window_stats(self, series: pd.Series, window: int) -> Tuple[pd.Series, pd.Series]:
        """Calculate rolling min and max"""
        return series.rolling(window=window).min(), series.rolling(window=window).max()
    
    def normalize_price(self, df: pd.DataFrame) -> pd.Series:
        """Normalize price between 0 and 1 based on recent range"""
        low_min = df['Low'].rolling(window=self.normalization_length).min()
        high_max = df['High'].rolling(window=self.normalization_length).max()
        normalized = (df['Close'] - low_min) / (high_max - low_min)
        return normalized.fillna(0)
    
    def calculate_volatility_signals(self, df: pd.DataFrame) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """Calculate volatility-based signals for channel detection"""
        normalized_price = self.normalize_price(df)
        vol = normalized_price.rolling(window=14).std()
        
        # Find highest and lowest volatility bars
        length = self.box_detection_length
        upper_signal = vol.rolling(window=length + 1).apply(
            lambda x: (np.argmax(x) + length) / length if len(x) == length + 1 else np.nan,
            raw=True
        )
        
        lower_signal = vol.rolling(window=length + 1).apply(
            lambda x: (np.argmin(x) + length) / length if len(x) == length + 1 else np.nan,
            raw=True
        )
        
        return upper_signal, lower_signal, vol
    
    def detect_channels(self, df: pd.DataFrame) -> List[Dict]:
        """Detect consolidation channels"""
        upper_signal, lower_signal, vol = self.calculate_volatility_signals(df)
        channels = []
        
        # Track crossovers
        upper_cross = (upper_signal > lower_signal) & (upper_signal.shift(1) <= lower_signal.shift(1))
        lower_cross = (lower_signal > upper_signal) & (lower_signal.shift(1) <= upper_signal.shift(1))
        
        i = 0
        while i < len(df) - 1:
            if lower_cross.iloc[i]:
                # Find the duration since last upper cross
                duration_bars = 1
                for j in range(i-1, max(0, i-200), -1):
                    if upper_cross.iloc[j]:
                        duration_bars = i - j
                        break
                
                if duration_bars > 10:  # Minimum channel duration
                    start_idx = i - duration_bars
                    end_idx = i
                    
                    # Calculate channel boundaries
                    channel_data = df.iloc[start_idx:end_idx+1]
                    h_level = channel_data['High'].max()
                    l_level = channel_data['Low'].min()
                    
                    # Calculate ATR for buffer zones
                    atr = self.calculate_atr(df.iloc[max(0, start_idx-self.box_detection_length):end_idx+1])
                    vol_buffer = atr / 2
                    
                    channel = {
                        'start_idx': start_idx,
                        'end_idx': end_idx,
                        'high': h_level,
                        'low': l_level,
                        'atr': atr,
                        'vol_buffer': vol_buffer,
                        'active': True,
                        'center': (h_level + l_level) / 2
                    }
                    
                    # Check for overlap if needed
                    if self.overlap or self.can_create_channel(channel, channels):
                        channels.append(channel)
            
            i += 1
        
        return channels
    
    def can_create_channel(self, new_channel: Dict, existing_channels: List[Dict]) -> bool:
        """Check if new channel can be created without overlap"""
        for channel in existing_channels:
            if not channel['active']:
                continue
            
            # Check for overlap
            if (new_channel['high'] > channel['low'] and 
                new_channel['low'] < channel['high']):
                return False
        return True
    
    def calculate_atr(self, df: pd.DataFrame, period: int = 14) -> float:
        """Calculate Average True Range"""
        if len(df) < 2:
            return 0.1
        
        high = df['High']
        low = df['Low']
        close_prev = df['Close'].shift(1)
        
        tr1 = high - low
        tr2 = abs(high - close_prev)
        tr3 = abs(low - close_prev)
        
        true_range = np.maximum(tr1, np.maximum(tr2, tr3))
        atr = true_range.rolling(window=min(period, len(df))).mean().iloc[-1]
        
        return atr if not np.isnan(atr) else 0.1
    
    def check_breakouts(self, df: pd.DataFrame, channels: List[Dict]) -> List[Dict]:
        """Check for breakouts from active channels"""
        breakouts = []
        
        for i, channel in enumerate(channels):
            if not channel['active']:
                continue
            
            # Update channel end to current bar
            channel['end_idx'] = len(df) - 1
            
            # Get current price for breakout check
            current_row = df.iloc[-1]
            
            if self.strong_closes:
                # Use average of open and close (candle body center)
                price_check = (current_row['Open'] + current_row['Close']) / 2
            else:
                # Use close price
                price_check = current_row['Close']
            
            # Check for bullish breakout
            if price_check > channel['high']:
                breakout = {
                    'type': 'bullish',
                    'price': channel['low'],  # Support becomes target
                    'bar_idx': len(df) - 1,
                    'channel_idx': i
                }
                breakouts.append(breakout)
                channel['active'] = False
            
            # Check for bearish breakout
            elif price_check < channel['low']:
                breakout = {
                    'type': 'bearish',
                    'price': channel['high'],  # Resistance becomes target
                    'bar_idx': len(df) - 1,
                    'channel_idx': i
                }
                breakouts.append(breakout)
                channel['active'] = False
        
        return breakouts
    
    def calculate_volume_data(self, df: pd.DataFrame) -> Dict:
        """Calculate volume data for analysis"""
        volume_data = {
            'volume': df.get('Volume', pd.Series(index=df.index, data=0)),
            'up_volume': pd.Series(index=df.index, data=0),
            'down_volume': pd.Series(index=df.index, data=0),
            'volume_delta': pd.Series(index=df.index, data=0)
        }
        
        if 'Volume' in df.columns:
            # Estimate up/down volume based on price movement
            price_change = df['Close'] - df['Open']
            volume_data['up_volume'] = np.where(price_change > 0, df['Volume'], 0)
            volume_data['down_volume'] = np.where(price_change < 0, df['Volume'], 0)
            volume_data['volume_delta'] = volume_data['up_volume'] - volume_data['down_volume']
        
        return volume_data
    
    def analyze(self, df: pd.DataFrame) -> Dict:
        """Main analysis function"""
        # Ensure required columns
        required_cols = ['Open', 'High', 'Low', 'Close']
        for col in required_cols:
            if col not in df.columns:
                raise ValueError(f"Missing required column: {col}")
        
        # Detect channels
        channels = self.detect_channels(df)
        
        # Check for breakouts
        breakouts = self.check_breakouts(df, channels)
        
        # Calculate volume data
        volume_data = self.calculate_volume_data(df)
        
        # Store results
        self.channels = channels
        self.breakout_signals = breakouts
        
        return {
            'channels': channels,
            'breakouts': breakouts,
            'volume_data': volume_data,
            'active_channels': [ch for ch in channels if ch['active']]
        }
    
    def plot(self, df: pd.DataFrame, results: Dict = None, figsize: Tuple[int, int] = (15, 10)):
        """Plot the indicator with channels and breakouts"""
        if results is None:
            results = self.analyze(df)
        
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=figsize, height_ratios=[3, 1])
        
        # Plot price data
        ax1.plot(df.index, df['Close'], linewidth=1, alpha=0.8, label='Close Price')
        
        # Plot channels
        for i, channel in enumerate(results['channels']):
            start_idx = channel['start_idx']
            end_idx = min(channel['end_idx'], len(df) - 1)
            
            if start_idx >= len(df) or end_idx >= len(df):
                continue
            
            width = end_idx - start_idx
            height = channel['high'] - channel['low']
            
            # Main channel box
            rect = patches.Rectangle(
                (start_idx, channel['low']), width, height,
                linewidth=1, edgecolor='gray', facecolor='lightblue', alpha=0.3
            )
            ax1.add_patch(rect)
            
            # Upper resistance zone (red)
            upper_rect = patches.Rectangle(
                (start_idx, channel['high'] - channel['vol_buffer']), 
                width, channel['vol_buffer'],
                linewidth=0, facecolor='red', alpha=0.2
            )
            ax1.add_patch(upper_rect)
            
            # Lower support zone (green)
            lower_rect = patches.Rectangle(
                (start_idx, channel['low']), 
                width, channel['vol_buffer'],
                linewidth=0, facecolor='green', alpha=0.2
            )
            ax1.add_patch(lower_rect)
            
            # Center line
            ax1.axhline(y=channel['center'], xmin=start_idx/len(df), xmax=end_idx/len(df), 
                       color='gray', linestyle='--', alpha=0.5)
        
        # Plot breakout signals
        for breakout in results['breakouts']:
            bar_idx = breakout['bar_idx']
            if bar_idx < len(df):
                if breakout['type'] == 'bullish':
                    ax1.scatter(bar_idx, df.iloc[bar_idx]['Close'], 
                              marker='^', s=100, color='green', label='Bullish Breakout')
                else:
                    ax1.scatter(bar_idx, df.iloc[bar_idx]['Close'], 
                              marker='v', s=100, color='red', label='Bearish Breakout')
        
        ax1.set_title('Smart Money Breakout Channels')
        ax1.set_ylabel('Price')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        
        # Plot volume
        if 'Volume' in df.columns and self.show_volume:
            volume_data = results['volume_data']
            
            if self.volume_mode == "Volume":
                ax2.bar(df.index, volume_data['volume'], alpha=0.6, color='blue')
                ax2.set_ylabel('Volume')
            
            elif self.volume_mode == "Comparison":
                ax2.bar(df.index, volume_data['up_volume'], alpha=0.6, color='green', label='Up Volume')
                ax2.bar(df.index, -volume_data['down_volume'], alpha=0.6, color='red', label='Down Volume')
                ax2.set_ylabel('Up/Down Volume')
                ax2.legend()
            
            elif self.volume_mode == "Delta":
                colors = ['green' if x >= 0 else 'red' for x in volume_data['volume_delta']]
                ax2.bar(df.index, volume_data['volume_delta'], alpha=0.6, color=colors)
                ax2.axhline(y=0, color='black', linestyle='-', alpha=0.3)
                ax2.set_ylabel('Volume Delta')
        
        ax2.set_xlabel('Time')
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        return fig

# Example usage and testing function
def create_sample_data(n_bars: int = 500) -> pd.DataFrame:
    """Create sample OHLCV data for testing"""
    np.random.seed(42)
    
    # Generate price data with consolidation periods
    base_price = 100
    prices = [base_price]
    volumes = []
    
    for i in range(n_bars):
        # Create consolidation periods
        if 50 <= i <= 100 or 200 <= i <= 280 or 350 <= i <= 420:
            # Consolidation: smaller price movements
            change = np.random.normal(0, 0.005) * prices[-1]
        else:
            # Trending: larger price movements
            change = np.random.normal(0.001, 0.015) * prices[-1]
        
        new_price = max(prices[-1] + change, 1)  # Prevent negative prices
        prices.append(new_price)
        
        # Generate volume (higher during breakouts)
        if 100 < i < 110 or 280 < i < 290 or 420 < i < 430:
            volume = np.random.randint(800, 1500)  # High volume during breakouts
        else:
            volume = np.random.randint(200, 800)   # Normal volume
        volumes.append(volume)
    
    prices = prices[1:]  # Remove initial price
    
    # Create OHLC data
    df = pd.DataFrame(index=range(n_bars))
    df['Close'] = prices
    
    # Generate Open, High, Low from Close
    df['Open'] = df['Close'].shift(1).fillna(prices[0])
    
    # Create realistic High/Low based on Close and Open
    df['High'] = df[['Open', 'Close']].max(axis=1) + np.random.exponential(0.5, n_bars)
    df['Low'] = df[['Open', 'Close']].min(axis=1) - np.random.exponential(0.5, n_bars)
    
    df['Volume'] = volumes
    
    return df

# Example usage
if __name__ == "__main__":
    # Create sample data
    df = create_sample_data(500)
    
    # Initialize indicator
    indicator = SmartMoneyBreakoutChannels(
        overlap=False,
        strong_closes=True,
        normalization_length=100,
        box_detection_length=14,
        show_volume=True,
        volume_mode="Comparison"
    )
    
    # Analyze data
    results = indicator.analyze(df)
    
    # Print results
    print(f"Detected {len(results['channels'])} channels")
    print(f"Found {len(results['breakouts'])} breakouts")
    print(f"Active channels: {len(results['active_channels'])}")
    
    # Plot results
    fig = indicator.plot(df, results)
    plt.show()
    
    # Print channel details
    for i, channel in enumerate(results['channels']):
        print(f"\nChannel {i+1}:")
        print(f"  Range: {channel['start_idx']} - {channel['end_idx']}")
        print(f"  Price Range: {channel['low']:.2f} - {channel['high']:.2f}")
        print(f"  Active: {channel['active']}")
    
    # Print breakout details
    for i, breakout in enumerate(results['breakouts']):
        print(f"\nBreakout {i+1}:")
        print(f"  Type: {breakout['type']}")
        print(f"  Bar Index: {breakout['bar_idx']}")
        print(f"  Target Price: {breakout['price']:.2f}")