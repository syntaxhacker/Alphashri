#!/usr/bin/env python3
"""
FOMO Stock Pattern Analyzer
==========================

This script analyzes the top FOMO stocks using Upstox intraday data
to detect key technical patterns in 1-minute candle data.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from config_and_utils.free_indian_apis import UpstoxAPI
    from config import UPSTOX_CONFIG
    from symbol_validator import SymbolValidator
    UPSTOX_AVAILABLE = True
    print("✅ Upstox API available")
except ImportError as e:
    UPSTOX_AVAILABLE = False
    print(f"⚠️ Upstox API not available: {e}")

# Initialize symbol validator
symbol_validator = SymbolValidator()

def get_fomo_stocks():
    """Return the top FOMO stocks from the scan results"""
    # These are the stocks from your FOMO scan
    return [
        "JKPAPER", "ECLERX", "ACE", "RATEGAIN", "SAFARI",
        "PRICOLLTD", "ACMESOLAR", "NEWGEN", "KIRLOSBROS", "APOLLO"
    ]

def convert_symbol_for_upstox(symbol):
    """Convert symbol to Upstox format with proper validation"""
    # Clean the symbol first - remove exchange prefixes
    cleaned_symbol = symbol_validator.clean_symbol(symbol)
    return cleaned_symbol

def fetch_intraday_data(api, symbol, days=1):
    """Fetch 1-minute intraday data for a symbol"""
    try:
        # Use the exact same call as our successful test
        df = api.fetch_intraday_data_v3(
            symbol=symbol, 
            unit='minutes', 
            interval=1
        )
        
        if df is not None and not df.empty:
            print(f"✅ Fetched {len(df)} 1-min candles for {symbol}")
            return df
        else:
            print(f"⚠️ No data returned for {symbol}")
            return None
            
    except Exception as e:
        print(f"❌ Error fetching data for {symbol}: {e}")
        return None

def calculate_technical_indicators(df):
    """Calculate technical indicators for pattern detection"""
    if df is None or df.empty:
        return df
    
    # Make a copy to avoid modifying the original
    df = df.copy()
    
    # Simple Moving Averages
    df['SMA_5'] = df['close'].rolling(window=5).mean()
    df['SMA_20'] = df['close'].rolling(window=20).mean()
    
    # Exponential Moving Averages
    df['EMA_5'] = df['close'].ewm(span=5).mean()
    df['EMA_20'] = df['close'].ewm(span=20).mean()
    
    # Volume Moving Average
    df['Volume_MA'] = df['volume'].rolling(window=20).mean()
    
    # RSI
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    df['RSI'] = 100 - (100 / (1 + rs))
    
    # Bollinger Bands
    df['BB_Middle'] = df['close'].rolling(window=20).mean()
    bb_std = df['close'].rolling(window=20).std()
    df['BB_Upper'] = df['BB_Middle'] + (bb_std * 2)
    df['BB_Lower'] = df['BB_Middle'] - (bb_std * 2)
    
    # Price change percentage
    df['price_change_pct'] = df['close'].pct_change() * 100
    
    # Volume ratio
    df['volume_ratio'] = df['volume'] / df['Volume_MA']
    
    return df

def detect_volume_breakout(df, lookback_period=10, volume_threshold=2.0):
    """Detect volume breakout patterns"""
    if df is None or len(df) < lookback_period:
        return False, {}
    
    # Get the latest data point
    latest = df.iloc[-1]
    previous = df.iloc[-2] if len(df) > 1 else None
    
    # Check for volume breakout (convert to scalar values)
    volume_ratio = float(latest['volume_ratio']) if 'volume_ratio' in latest else 0
    volume_breakout = volume_ratio > volume_threshold
    
    # Check for price confirmation (upward movement)
    price_confirmation = False
    if previous is not None:
        price_confirmation = float(latest['close']) > float(latest['open'])
    
    # Check for gap up or strong move
    gap_up = False
    strong_move = False
    if previous is not None:
        gap_up = float(latest['open']) > float(previous['high'])
        price_change_pct = float(latest['close'] - latest['open']) / float(latest['open']) * 100
        strong_move = price_change_pct > 1.0
    
    is_breakout = volume_breakout and (price_confirmation or gap_up or strong_move)
    
    return is_breakout, {
        'volume_ratio': volume_ratio,
        'volume_breakout': volume_breakout,
        'price_confirmation': price_confirmation,
        'gap_up': gap_up,
        'strong_move': strong_move,
        'current_price': float(latest['close']),
        'volume': int(latest['volume'])
    }

def detect_ma_crossover(df):
    """Detect moving average crossover patterns"""
    if df is None or len(df) < 20:
        return False, {}
    
    # Get the latest two data points
    latest = df.iloc[-1]
    previous = df.iloc[-2]
    
    # Check for 5-period EMA crossing above 20-period EMA (convert to scalar values)
    current_ema_5 = float(latest['EMA_5']) if 'EMA_5' in latest else 0
    current_ema_20 = float(latest['EMA_20']) if 'EMA_20' in latest else 0
    previous_ema_5 = float(previous['EMA_5']) if 'EMA_5' in previous else 0
    previous_ema_20 = float(previous['EMA_20']) if 'EMA_20' in previous else 0
    
    # Check for crossover
    current_crossover = current_ema_5 > current_ema_20
    previous_position = previous_ema_5 <= previous_ema_20
    
    # Bullish crossover (golden cross)
    bullish_crossover = current_crossover and previous_position
    
    # Check for 5-period EMA crossing below 20-period EMA (bearish)
    bearish_crossover = not current_crossover and previous_position
    
    return bullish_crossover or bearish_crossover, {
        'bullish_crossover': bullish_crossover,
        'bearish_crossover': bearish_crossover,
        'ema_5': current_ema_5,
        'ema_20': current_ema_20,
        'crossover_type': 'Bullish' if bullish_crossover else ('Bearish' if bearish_crossover else 'None')
    }

def detect_bollinger_band_interaction(df):
    """Detect Bollinger Band interactions"""
    if df is None or len(df) < 20:
        return False, {}
    
    latest = df.iloc[-1]
    previous = df.iloc[-2] if len(df) > 1 else None
    
    # Convert to scalar values
    close_price = float(latest['close'])
    bb_upper = float(latest['BB_Upper']) if 'BB_Upper' in latest else close_price
    bb_lower = float(latest['BB_Lower']) if 'BB_Lower' in latest else close_price
    rsi = float(latest['RSI']) if 'RSI' in latest else 50
    previous_rsi = float(previous['RSI']) if previous is not None and 'RSI' in previous else rsi
    
    # Check if price is touching upper/lower Bollinger Band
    upper_band_touch = close_price > bb_upper * 0.99  # Within 1% of upper band
    lower_band_touch = close_price < bb_lower * 1.01  # Within 1% of lower band
    
    # Check for band penetration
    upper_band_penetration = close_price > bb_upper
    lower_band_penetration = close_price < bb_lower
    
    # Check if it's a potential reversal
    potential_reversal = False
    if previous is not None:
        # From overbought to potential reversal
        if rsi > 70 and previous_rsi > rsi:
            potential_reversal = True
        # From oversold to potential reversal
        elif rsi < 30 and previous_rsi < rsi:
            potential_reversal = True
    
    return upper_band_touch or lower_band_touch, {
        'upper_band_touch': upper_band_touch,
        'lower_band_touch': lower_band_touch,
        'upper_band_penetration': upper_band_penetration,
        'lower_band_penetration': lower_band_penetration,
        'potential_reversal': potential_reversal,
        'rsi': rsi,
        'price_position': 'Upper' if upper_band_touch else ('Lower' if lower_band_touch else 'Middle')
    }

def analyze_stock_patterns(api, symbol):
    """Analyze patterns for a single stock"""
    print(f"\n{'='*60}")
    print(f"Analyzing patterns for: {symbol}")
    print(f"{'='*60}")
    
    # Fetch intraday data
    df = fetch_intraday_data(api, symbol)
    
    if df is None or df.empty:
        print(f"❌ No data available for {symbol}")
        return
    
    # Calculate technical indicators
    df = calculate_technical_indicators(df)
    
    # Detect patterns
    volume_breakout, vol_data = detect_volume_breakout(df)
    ma_crossover, ma_data = detect_ma_crossover(df)
    bb_interaction, bb_data = detect_bollinger_band_interaction(df)
    
    # Display results
    latest_price = float(df['close'].iloc[-1])
    latest_volume = int(df['volume'].iloc[-1])
    latest_volume_ratio = float(df['volume_ratio'].iloc[-1]) if 'volume_ratio' in df.columns else 0
    
    print(f"📊 Current Price: ₹{latest_price:.2f}")
    print(f"📊 Current Volume: {latest_volume:,}")
    print(f"📊 Volume Ratio: {latest_volume_ratio:.2f}x")
    
    # Volume Breakout Analysis
    print(f"\n🔍 Volume Breakout Analysis:")
    if vol_data.get('volume_breakout', False):
        print(f"   🚀 VOLUME BREAKOUT DETECTED!")
        print(f"   - Volume Ratio: {vol_data['volume_ratio']:.2f}x (threshold: 2.0x)")
        if vol_data.get('gap_up', False):
            print(f"   - Gap Up Detected")
        if vol_data.get('strong_move', False):
            print(f"   - Strong Price Move Detected")
        if vol_data.get('price_confirmation', False):
            print(f"   - Positive Price Confirmation")
    else:
        print(f"   ❌ No volume breakout detected")
        print(f"   - Volume Ratio: {vol_data['volume_ratio']:.2f}x (threshold: 2.0x)")
    
    # Moving Average Crossover Analysis
    print(f"\n🔍 Moving Average Crossover Analysis:")
    if ma_data.get('bullish_crossover', False):
        print(f"   🟢 BULLISH Crossover Detected!")
        print(f"   - EMA(5): {ma_data['ema_5']:.2f}")
        print(f"   - EMA(20): {ma_data['ema_20']:.2f}")
    elif ma_data.get('bearish_crossover', False):
        print(f"   🔴 BEARISH Crossover Detected!")
        print(f"   - EMA(5): {ma_data['ema_5']:.2f}")
        print(f"   - EMA(20): {ma_data['ema_20']:.2f}")
    else:
        print(f"   ⚪ No crossover detected")
        print(f"   - EMA(5): {ma_data['ema_5']:.2f}")
        print(f"   - EMA(20): {ma_data['ema_20']:.2f}")
    
    # Bollinger Band Analysis
    print(f"\n🔍 Bollinger Band Analysis:")
    if bb_data.get('upper_band_penetration', False):
        print(f"   ⚠️  UPPER BAND PENETRATION!")
        if bb_data.get('potential_reversal', False):
            print(f"   - Potential Reversal Signal (RSI: {bb_data['rsi']:.1f})")
    elif bb_data.get('lower_band_penetration', False):
        print(f"   ⚠️  LOWER BAND PENETRATION!")
        if bb_data.get('potential_reversal', False):
            print(f"   - Potential Reversal Signal (RSI: {bb_data['rsi']:.1f})")
    elif bb_data.get('upper_band_touch', False):
        print(f"   📍 Touching Upper Band")
    elif bb_data.get('lower_band_touch', False):
        print(f"   📍 Touching Lower Band")
    else:
        print(f"   📊 Price in middle band")
    
    print(f"   - RSI: {bb_data['rsi']:.1f}")
    print(f"   - Price Position: {bb_data['price_position']}")

def main():
    """Main function to analyze FOMO stock patterns"""
    if not UPSTOX_AVAILABLE:
        print("❌ Upstox API not available. Cannot proceed with analysis.")
        return
    
    # Initialize Upstox API
    try:
        api = UpstoxAPI(
            api_key=UPSTOX_CONFIG.get('api_key'),
            api_secret=UPSTOX_CONFIG.get('api_secret')
        )
        
        if not api.authenticate():
            print("❌ Failed to authenticate with Upstox API")
            return
            
        print("✅ Successfully authenticated with Upstox API")
        
    except Exception as e:
        print(f"❌ Error initializing Upstox API: {e}")
        return
    
    # Get FOMO stocks
    fomo_stocks = get_fomo_stocks()
    print(f"🎯 Analyzing {len(fomo_stocks)} top FOMO stocks")
    
    # Analyze patterns for each stock
    for symbol in fomo_stocks:
        try:
            analyze_stock_patterns(api, symbol)
        except Exception as e:
            print(f"❌ Error analyzing {symbol}: {e}")
            continue
    
    print(f"\n{'='*60}")
    print("✅ Pattern analysis complete!")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()