from typing import Optional, List, Dict, Tuple
from rich.panel import Panel
from rich.console import Console
from tradingview_screener import Query, col
import concurrent.futures
from threading import Lock
from datetime import datetime, timedelta

import pandas as pd
import numpy as np

console = Console()


class SmartMoneyBreakoutChannels:
    """
    Smart Money Breakout Channels Indicator for TradingView integration
    
    Identifies consolidation zones and breakout signals with volume analysis
    """
    
    def __init__(self, 
                 overlap: bool = False,
                 strong_closes: bool = True,
                 normalization_length: int = 100,
                 box_detection_length: int = 14,
                 show_volume: bool = True,
                 volume_mode: str = "Comparison",
                 volume_scale: float = 0.5):
        
        self.overlap = overlap
        self.strong_closes = strong_closes
        self.normalization_length = normalization_length
        self.box_detection_length = box_detection_length
        self.show_volume = show_volume
        self.volume_mode = volume_mode
        self.volume_scale = volume_scale
        
        self.channels = []
        self.breakout_signals = []
    
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
    
    def detect_channels(self, df: pd.DataFrame) -> List[Dict]:
        """Detect consolidation channels"""
        upper_signal, lower_signal, vol = self.calculate_volatility_signals(df)
        channels = []
        
        upper_cross = (upper_signal > lower_signal) & (upper_signal.shift(1) <= lower_signal.shift(1))
        lower_cross = (lower_signal > upper_signal) & (lower_signal.shift(1) <= upper_signal.shift(1))
        
        i = 0
        while i < len(df) - 1:
            if lower_cross.iloc[i]:
                duration_bars = 1
                for j in range(i-1, max(0, i-200), -1):
                    if upper_cross.iloc[j]:
                        duration_bars = i - j
                        break
                
                if duration_bars > 10:
                    start_idx = i - duration_bars
                    end_idx = i
                    
                    channel_data = df.iloc[start_idx:end_idx+1]
                    h_level = channel_data['High'].max()
                    l_level = channel_data['Low'].min()
                    
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
                        'center': (h_level + l_level) / 2,
                        'range_percent': ((h_level - l_level) / l_level) * 100
                    }
                    
                    if self.overlap or self.can_create_channel(channel, channels):
                        channels.append(channel)
            i += 1
        
        return channels
    
    def can_create_channel(self, new_channel: Dict, existing_channels: List[Dict]) -> bool:
        """Check if new channel can be created without overlap"""
        for channel in existing_channels:
            if not channel['active']:
                continue
            
            if (new_channel['high'] > channel['low'] and 
                new_channel['low'] < channel['high']):
                return False
        return True
    
    def check_breakouts(self, df: pd.DataFrame, channels: List[Dict]) -> List[Dict]:
        """Check for breakouts from active channels"""
        breakouts = []
        
        for i, channel in enumerate(channels):
            if not channel['active']:
                continue
            
            for idx in range(max(channel['end_idx'], len(df) - 10), len(df)):
                if idx >= len(df):
                    continue
                    
                current_row = df.iloc[idx]
                
                if self.strong_closes:
                    price_check = (current_row['Open'] + current_row['Close']) / 2
                else:
                    price_check = current_row['Close']
                
                if price_check > channel['high'] and current_row['Close'] > channel['high']:
                    breakout = {
                        'type': 'bullish',
                        'support_level': channel['low'],
                        'resistance_level': channel['high'],
                        'breakout_price': current_row['Close'],
                        'breakout_bar_idx': idx,
                        'channel_idx': i,
                        'strength': (current_row['Close'] - channel['high']) / channel['high'] * 100,
                        'volume': current_row['Volume'],
                        'channel_duration': channel['end_idx'] - channel['start_idx'],
                        'consolidation_range': channel['range_percent']
                    }
                    breakouts.append(breakout)
                    channel['active'] = False
                    break
                
                elif price_check < channel['low'] and current_row['Close'] < channel['low']:
                    breakout = {
                        'type': 'bearish', 
                        'support_level': channel['low'],
                        'resistance_level': channel['high'],
                        'breakout_price': current_row['Close'],
                        'breakout_bar_idx': idx,
                        'channel_idx': i,
                        'strength': (channel['low'] - current_row['Close']) / channel['low'] * 100,
                        'volume': current_row['Volume'],
                        'channel_duration': channel['end_idx'] - channel['start_idx'],
                        'consolidation_range': channel['range_percent']
                    }
                    breakouts.append(breakout)
                    channel['active'] = False
                    break
        
        return breakouts
    
    def analyze_stock(self, df: pd.DataFrame) -> Dict:
        """Analyze a single stock for breakout patterns"""
        if len(df) < self.normalization_length:
            return {'channels': [], 'breakouts': [], 'active_channels': []}
        
        channels = self.detect_channels(df)
        breakouts = self.check_breakouts(df, channels)
        
        return {
            'channels': channels,
            'breakouts': breakouts,
            'active_channels': [ch for ch in channels if ch['active']],
            'total_channels': len(channels),
            'recent_breakouts': len(breakouts)
        }


def heavy_breakout(self) -> None:
    """Heavy Breakout Mode - Smart Money Consolidation Channel Breakouts"""
    console.print(Panel.fit("💥 HEAVY BREAKOUT: Smart Money Channel Analysis", style="bold red"))
    
    try:
        total_rows, df = (
            Query()
            .select(
                'name', 'ticker', 'close', 'open', 'high', 'low', 'volume', 'change',
                'relative_volume_10d_calc', 'RSI', 'Volatility.D', 'ATR',
                'market_cap_basic', 'update_mode'
            )
            .set_markets(self.market)
            .where(
                col('close') > 100,
                col('volume') > 500000,
                col('relative_volume_10d_calc') > 0.8,
                col('market_cap_basic') > 1e9,
                col('Volatility.D') > 0.015,
                col('ATR') > 2,
                col('exchange') == 'NSE'
            )
            .order_by('relative_volume_10d_calc', ascending=False)
            .limit(50)
            .get_scanner_data(cookies=self.cookies)
        )

        if df.empty:
            console.print("[yellow]No stocks found matching heavy breakout criteria[/yellow]")
            return

        console.print(f"[dim]Analyzing {len(df)} stocks for smart money consolidation patterns...[/dim]")
        
        breakout_analyzer = SmartMoneyBreakoutChannels(
            overlap=False,
            strong_closes=True,
            normalization_length=100,
            box_detection_length=8
        )
        
        heavy_breakout_stocks = []
        
        for _, row in df.iterrows():
            symbol = row['name']
            
            try:
                to_date = datetime.now().strftime('%Y-%m-%d')
                from_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                
                historical_data = self.upstox_api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',
                    interval=15,
                    to_date=to_date,
                    from_date=from_date
                )
                
                if historical_data is not None and len(historical_data) >= 20:
                    hist_df = historical_data.copy()
                    
                    if len(hist_df.columns) == 6:
                        hist_df.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                        hist_df = hist_df[['Open', 'High', 'Low', 'Close', 'Volume']]
                    elif len(hist_df.columns) == 5:
                        hist_df.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                    else:
                        console.print(f"[dim red]Unexpected column structure for {symbol}: {list(hist_df.columns)}[/dim red]")
                        continue
                    
                    numeric_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                    for column_name in numeric_columns:
                        hist_df[column_name] = pd.to_numeric(hist_df[column_name], errors='coerce')
                    
                    hist_df = hist_df.dropna()
                    
                    if len(hist_df) < 20:
                        console.print(f"[dim red]Insufficient clean data for {symbol} after conversion[/dim red]")
                        continue
                    
                    try:
                        analysis = breakout_analyzer.analyze_stock(hist_df)
                    except Exception as analyze_error:
                        console.print(f"[dim red]Analysis error for {symbol}: {analyze_error}[/dim red]")
                        continue
                    
                    breakout_score = 0
                    
                    active_channels = len(analysis['active_channels'])
                    if active_channels > 0:
                        breakout_score += active_channels * 30
                        
                        for channel in analysis['active_channels']:
                            if 0.5 <= channel['range_percent'] <= 3:
                                breakout_score += 25
                            elif 3 < channel['range_percent'] <= 5:
                                breakout_score += 15
                            duration = channel['end_idx'] - channel['start_idx']
                            if duration > 8:
                                breakout_score += 15
                            elif duration > 4:
                                breakout_score += 10
                    
                    recent_breakouts = len(analysis['breakouts'])
                    if recent_breakouts > 0:
                        breakout_score += recent_breakouts * 20
                        
                        for breakout in analysis['breakouts']:
                            if breakout.get('strength', 0) > 2:
                                breakout_score += 15
                    
                    vol_ratio = row.get('relative_volume_10d_calc', 1)
                    if vol_ratio > 1.5:
                        breakout_score += 20
                    elif vol_ratio > 1.2:
                        breakout_score += 10
                    
                    volatility = row.get('Volatility.D', 0)
                    if 0.02 <= volatility <= 0.05:
                        breakout_score += 15
                    
                    rsi = row.get('RSI', 50)
                    if 45 <= rsi <= 65:
                        breakout_score += 10
                    
                    if breakout_score >= 40:
                        stock_data = {
                            'symbol': symbol,
                            'price': row['close'],
                            'change': row.get('change', 0),
                            'volume': row['volume'],
                            'rel_volume': vol_ratio,
                            'rsi': rsi,
                            'volatility': volatility,
                            'breakout_score': breakout_score,
                            'active_channels': active_channels,
                            'recent_breakouts': recent_breakouts,
                            'analysis': analysis
                        }
                        heavy_breakout_stocks.append(stock_data)
                        
            except Exception as e:
                console.print(f"[dim red]Error analyzing {symbol}: {e}[/dim red]")
                continue
        
        heavy_breakout_stocks.sort(key=lambda x: x['breakout_score'], reverse=True)
        
        if heavy_breakout_stocks:
            display_data = []
            for stock in heavy_breakout_stocks[:15]:
                display_data.append({
                    'Symbol': stock['symbol'],
                    'Price': f"\u20b9{stock['price']:.2f}",
                    'Change%': f"{stock['change']:.2f}%",
                    'Vol Ratio': f"{stock['rel_volume']:.2f}x",
                    'RSI': float(stock['rsi']) if stock['rsi'] is not None else 50.0,
                    'Volatility': f"{stock['volatility']:.3f}",
                    'Score': f"{stock['breakout_score']:.0f}",
                    'Channels': stock['active_channels'],
                    'Breakouts': stock['recent_breakouts']
                })
            
            display_df = pd.DataFrame(display_data)
            self.display_table(display_df, "Heavy Breakout Candidates - Smart Money Analysis")
            
            console.print(f"\n[bold cyan]\U0001f3af TOP 3 DETAILED ANALYSIS WITH LEVELS:[/bold cyan]")
            for i, stock in enumerate(heavy_breakout_stocks[:3]):
                console.print(f"\n[bold yellow]{i+1}. {stock['symbol']} (Score: {stock['breakout_score']:.0f}) - Current: \u20b9{stock['price']:.2f}[/bold yellow]")
                
                analysis = stock['analysis']
                console.print(f"   \U0001f4ca Active Consolidation Channels: {len(analysis['active_channels'])}")
                console.print(f"   \U0001f680 Recent Breakout Events: {len(analysis['breakouts'])}")
                console.print(f"   \U0001f4c8 Volume: {stock['rel_volume']:.2f}x average")
                console.print(f"   \U0001f4c9 Current RSI: {stock['rsi']:.1f}")
                
                for j, channel in enumerate(analysis['active_channels'][:2]):
                    range_pct = channel['range_percent']
                    duration = channel['end_idx'] - channel['start_idx']
                    hours = duration * 0.25
                    console.print(f"   \U0001f3d7\ufe0f  Active Channel {j+1}:")
                    console.print(f"      \u2022 Support: \u20b9{channel['low']:.2f}")
                    console.print(f"      \u2022 Resistance: \u20b9{channel['high']:.2f}")
                    console.print(f"      \u2022 Range: {range_pct:.2f}% ({hours:.1f} hours)")
                
                for j, breakout in enumerate(analysis['breakouts'][-2:]):
                    strength = breakout.get('strength', 0)
                    breakout_type = breakout['type'].upper()
                    
                    bars_ago = len(analysis['breakouts']) - breakout['breakout_bar_idx'] if 'breakout_bar_idx' in breakout else 0
                    time_ago = bars_ago * 15
                    
                    console.print(f"   \U0001f6a8 Recent {breakout_type} Breakout:")
                    console.print(f"      \u2022 Support Level: \u20b9{breakout.get('support_level', 'N/A')}")
                    console.print(f"      \u2022 Resistance Level: \u20b9{breakout.get('resistance_level', 'N/A')}")
                    console.print(f"      \u2022 Breakout Price: \u20b9{breakout.get('breakout_price', 'N/A')}")
                    console.print(f"      \u2022 Strength: {strength:.2f}%")
                    console.print(f"      \u2022 Consolidation Range: {breakout.get('consolidation_range', 'N/A'):.2f}%")
                    if time_ago < 480:
                        console.print(f"      \u2022 Timing: ~{time_ago:.0f} minutes ago")
                    else:
                        console.print(f"      \u2022 Timing: Recent (within session)")
                
                console.print(f"   \U0001f50d [dim]Fetching live data for validation...[/dim]")
                
                try:
                    validation_data = self.upstox_api.fetch_historical_data_v3(
                        symbol=stock['symbol'],
                        unit='minutes',
                        interval=5,
                        to_date=datetime.now().strftime('%Y-%m-%d'),
                        from_date=(datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
                    )
                    
                    if validation_data is not None and len(validation_data) > 0:
                        latest_data = validation_data.tail(3)
                        
                        if len(latest_data.columns) == 6:
                            latest_data.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                            latest_data = latest_data[['Open', 'High', 'Low', 'Close', 'Volume']]
                        elif len(latest_data.columns) == 5:
                            latest_data.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                        
                        for col_name in ['Open', 'High', 'Low', 'Close', 'Volume']:
                            latest_data[col_name] = pd.to_numeric(latest_data[col_name], errors='coerce')
                        
                        current_price = latest_data['Close'].iloc[-1]
                        recent_high = latest_data['High'].max()
                        recent_low = latest_data['Low'].min()
                        avg_volume = latest_data['Volume'].mean()
                        
                        console.print(f"   \u2705 VALIDATION (Last 15 mins):")
                        console.print(f"      \u2022 Current Price: \u20b9{current_price:.2f}")
                        console.print(f"      \u2022 Recent High: \u20b9{recent_high:.2f}")
                        console.print(f"      \u2022 Recent Low: \u20b9{recent_low:.2f}")
                        console.print(f"      \u2022 Avg Volume: {avg_volume:,.0f}")
                        
                        if len(analysis['breakouts']) > 0:
                            last_breakout = analysis['breakouts'][-1]
                            resistance = last_breakout.get('resistance_level', 0)
                            support = last_breakout.get('support_level', 0)
                            
                            if last_breakout['type'] == 'bullish' and current_price > resistance:
                                console.print(f"      \u2022 \u2705 BULLISH BREAKOUT CONFIRMED: Current (\u20b9{current_price:.2f}) > Resistance (\u20b9{resistance:.2f})")
                            elif last_breakout['type'] == 'bearish' and current_price < support:
                                console.print(f"      \u2022 \u2705 BEARISH BREAKOUT CONFIRMED: Current (\u20b9{current_price:.2f}) < Support (\u20b9{support:.2f})")
                            else:
                                console.print(f"      \u2022 \u26a0\ufe0f  BREAKOUT STATUS: Price testing levels (S: \u20b9{support:.2f}, R: \u20b9{resistance:.2f})")
                        
                except Exception as validation_error:
                    console.print(f"      \u2022 \u274c Validation failed: {validation_error}")
                
                console.print("")
        
        else:
            console.print("[yellow]No stocks currently showing heavy breakout patterns[/yellow]")

        console.print("\n[bold yellow]\U0001f4a1 Heavy Breakout Strategy (Intraday 15min):[/bold yellow]")
        console.print("\u2022 Pattern: Smart money consolidation channels with breakout potential")
        console.print("\u2022 Entry: On volume breakout above/below consolidation range")
        console.print("\u2022 Logic: Institutional accumulation followed by directional move")
        console.print("\u2022 Stop Loss: Opposite side of consolidation channel")
        console.print("\u2022 Target: Measured move = Channel height projected")
        console.print("\u2022 Time Frame: Intraday 15min - hold for 1-4 hours typically")
        console.print("\u2022 Best Setup: 0.5-3% consolidation range with 1-2+ hour duration")
        console.print("\u2022 Data: 15-minute candles from last 7 days for pattern analysis")
        
    except Exception as e:
        console.print(f"[red]Error in heavy breakout analysis: {e}[/red]")
        import traceback
        console.print(f"[dim red]Full traceback: {traceback.format_exc()}[/dim red]")


def _add_heavy_breakout_analysis(self, df: pd.DataFrame) -> pd.DataFrame:
    """Add real-time heavy breakout analysis with parallel intraday data fetching"""
    
    console.print(f"[dim cyan]\U0001f680 Fetching 15min data for {len(df)} stocks in parallel...[/dim cyan]")
    
    breakout_analyzer = SmartMoneyBreakoutChannels(
        overlap=False,
        strong_closes=True,
        normalization_length=100,
        box_detection_length=8
    )
    
    breakout_results = {}
    results_lock = Lock()
    
    def analyze_single_stock(row):
        """Analyze a single stock for breakout patterns"""
        symbol = row['name']
        try:
            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=5)).strftime('%Y-%m-%d')
            
            historical_data = self.upstox_api.fetch_historical_data_v3(
                symbol=symbol,
                unit='minutes',
                interval=15,
                to_date=to_date,
                from_date=from_date
            )
            
            if historical_data is not None and len(historical_data) >= 20:
                hist_df = historical_data.copy()
                
                if len(hist_df.columns) == 6:
                    hist_df.columns = ['Timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']
                    hist_df = hist_df[['Open', 'High', 'Low', 'Close', 'Volume']]
                elif len(hist_df.columns) == 5:
                    hist_df.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
                
                for column_name in ['Open', 'High', 'Low', 'Close', 'Volume']:
                    hist_df[column_name] = pd.to_numeric(hist_df[column_name], errors='coerce')
                
                hist_df = hist_df.dropna()
                
                if len(hist_df) >= 20:
                    analysis = breakout_analyzer.analyze_stock(hist_df)
                    
                    breakout_score = 0
                    active_channels = len(analysis['active_channels'])
                    recent_breakouts = len(analysis['breakouts'])
                    
                    if active_channels > 0:
                        breakout_score += active_channels * 25
                        for channel in analysis['active_channels']:
                            if 0.5 <= channel['range_percent'] <= 3:
                                breakout_score += 20
                    
                    if recent_breakouts > 0:
                        breakout_score += recent_breakouts * 15
                        for breakout in analysis['breakouts']:
                            if breakout.get('strength', 0) > 1:
                                breakout_score += 10
                    
                    vol_ratio = row.get('relative_volume_10d_calc', 1)
                    if vol_ratio > 1.5:
                        breakout_score += 15
                    elif vol_ratio > 1.2:
                        breakout_score += 8
                    
                    with results_lock:
                        breakout_results[symbol] = {
                            'breakout_score': breakout_score,
                            'active_channels': active_channels,
                            'recent_breakouts': recent_breakouts,
                            'analysis': analysis,
                            'support_level': analysis['breakouts'][-1]['support_level'] if analysis['breakouts'] else None,
                            'resistance_level': analysis['breakouts'][-1]['resistance_level'] if analysis['breakouts'] else None,
                            'breakout_type': analysis['breakouts'][-1]['type'] if analysis['breakouts'] else None,
                            'breakout_strength': analysis['breakouts'][-1]['strength'] if analysis['breakouts'] else 0
                        }
                
        except Exception as e:
            console.print(f"[dim red]Error analyzing {symbol}: {str(e)[:50]}[/dim red]")
            with results_lock:
                breakout_results[symbol] = {
                    'breakout_score': 0,
                    'active_channels': 0,
                    'recent_breakouts': 0,
                    'analysis': None,
                    'support_level': None,
                    'resistance_level': None,
                    'breakout_type': None,
                    'breakout_strength': 0
                }
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = []
        for _, row in df.iterrows():
            future = executor.submit(analyze_single_stock, row)
            futures.append(future)
        
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            completed += 1
            if completed % 5 == 0:
                console.print(f"[dim]Completed: {completed}/{len(df)} stocks[/dim]")
    
    df['breakout_score'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_score', 0))
    df['active_channels'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('active_channels', 0))
    df['recent_breakouts'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('recent_breakouts', 0))
    df['support_level'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('support_level'))
    df['resistance_level'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('resistance_level'))
    df['breakout_type'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_type'))
    df['breakout_strength'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('breakout_strength', 0))
    df['full_analysis'] = df['name'].map(lambda x: breakout_results.get(x, {}).get('analysis'))
    
    console.print(f"[dim green]\u2705 Completed parallel analysis for {len(df)} stocks[/dim green]")
    
    return df
