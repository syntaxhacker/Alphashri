#!/usr/bin/env python3
"""
Animated Institutional Order Flow Analysis
==========================================

Creates an animated visualization showing how institutional order flow,
accumulation patterns, and trading signals evolved over time.

Generates MP4 video showing day-by-day progression.

Usage:
    python analyze_order_flow_animated.py SUNDARMFIN --days 60 --fps 2
    python analyze_order_flow_animated.py SUNDARMFIN --days 100 --interval 30
"""

import sys
import os
import argparse
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
import warnings
warnings.filterwarnings('ignore')

import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib.gridspec import GridSpec
import seaborn as sns
from PIL import Image
import cv2

# Set style
plt.style.use('seaborn-v0_8-darkgrid')
plt.rcParams['figure.facecolor'] = '#f8f9fa'
plt.rcParams['axes.facecolor'] = '#ffffff'

# Add project root to path
_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.abspath(os.path.join(_script_dir, '..'))
sys.path.insert(0, _project_root)

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

console = Console()


# ============================================================================
# INDICATOR CALCULATION FUNCTIONS (Copied to avoid import issues)
# ============================================================================

def calculate_vwap(df: pd.DataFrame) -> pd.Series:
    """Calculate Volume Weighted Average Price (VWAP)."""
    typical_price = (df['high'] + df['low'] + df['close']) / 3
    vwap = (typical_price * df['volume']).cumsum() / df['volume'].cumsum()
    return vwap


def detect_volume_anomalies(df: pd.DataFrame, window: int = 20, threshold: float = 2.5) -> pd.DataFrame:
    """Detect volume anomalies using rolling statistics."""
    # Make sure we're working with the dataframe properly
    df = df.copy()

    # Reset index to avoid DatetimeIndex issues
    was_indexed = hasattr(df.index, 'name')
    if was_indexed:
        df_index = df.index
        df = df.reset_index(drop=True)

    # Rolling volume statistics
    vol_series = df['volume']
    df['vol_mean'] = vol_series.rolling(window=window).mean()
    df['vol_std'] = vol_series.rolling(window=window).std()

    # Z-score
    df['vol_zscore'] = (df['volume'] - df['vol_mean']) / df['vol_std']

    # Anomaly flag
    df['is_anomaly'] = df['vol_zscore'] > threshold

    # Anomaly magnitude
    df['anomaly_score'] = df['vol_zscore'].where(df['is_anomaly'], 0)

    # Restore index if it had one
    if was_indexed:
        df.index = df_index

    return df


def detect_order_blocks(df: pd.DataFrame, min_size: int = 50000) -> pd.DataFrame:
    """Detect order blocks - periods of heavy buying/selling."""
    df = df.copy()
    df['price_change'] = df['close'].diff()
    df['volume_consecutive'] = 0

    in_block = False
    block_count = 0

    for i in range(len(df)):
        if df.iloc[i]['volume'] > min_size:
            if not in_block:
                in_block = True
                block_count = 1
            else:
                block_count += 1
            df.iloc[i, df.columns.get_loc('volume_consecutive')] = block_count
        else:
            in_block = False
            block_count = 0

    return df


def calculate_order_flow_imbalance(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate order flow imbalance using candle analysis."""
    df = df.copy()
    df['range'] = df['high'] - df['low']
    df['range'] = df['range'].replace(0, df['range'].mean())

    df['buy_pressure'] = ((df['close'] - df['low']) / df['range']) * df['volume']
    df['sell_pressure'] = ((df['high'] - df['close']) / df['range']) * df['volume']
    df['total_pressure'] = df['buy_pressure'] + df['sell_pressure']
    df['ofi'] = df['buy_pressure'] / df['total_pressure']

    return df


def detect_institutional_accumulation(df: pd.DataFrame, lookback: int = 30) -> pd.DataFrame:
    """Detect institutional accumulation patterns."""
    df = df.copy()
    df['acc_score'] = 0

    df['price_momentum'] = df['close'].pct_change(lookback)
    df['vol_above_avg'] = df['volume'] > df['volume'].rolling(lookback).mean()
    df['strong_buying'] = df['ofi'] > 0.6

    for i in range(lookback, len(df)):
        score = 0

        if df.iloc[i]['price_momentum'] > 0:
            score += min(20, df.iloc[i]['price_momentum'] * 100)

        if df.iloc[i]['vol_above_avg']:
            vol_ratio = df.iloc[i]['volume'] / df.iloc[i]['vol_mean']
            score += min(30, (vol_ratio - 1) * 30)

        if df.iloc[i]['strong_buying']:
            ofi_bonus = (df.iloc[i]['ofi'] - 0.6) * 75
            score += min(30, ofi_bonus)

        consecutive = df.iloc[i]['volume_consecutive']
        if consecutive > 0:
            score += min(20, consecutive * 2)

        df.iloc[i, df.columns.get_loc('acc_score')] = score

    return df


def find_52w_context(df: pd.DataFrame, current_price: float) -> dict:
    """Find where current price is relative to 52-week high."""
    df['52w_high'] = df['high'].rolling(window=252, min_periods=50).max()

    recent_52w = df['52w_high'].iloc[-1]
    distance_pct = ((recent_52w - current_price) / current_price) * 100

    return {
        '52w_high': recent_52w,
        'distance_pct': distance_pct,
        'is_near_52w': distance_pct < 3.0
    }



def fetch_historical_data_chunked(symbol: str, days: int = 100, interval: int = 30):
    """
    Fetch historical data in chunks for animation.

    Returns complete dataframe with all historical data.
    """
    try:
        api = TradingAPIFactory.create_from_config('upstox', quiet=True)
    except ValueError as e:
        console.print(f"[red]❌ {e}[/red]")
        return None

    instrument_key = api.get_instrument_key(symbol)
    if not instrument_key:
        console.print(f"[red]❌ Symbol {symbol} not found[/red]")
        return None

    # Calculate date range with DYNAMIC buffer
    # Trading days are ~5/7 of calendar days, so we need extra buffer
    # Buffer scales with days but has minimum of 20 days
    buffer_days = max(20, int(days * 2 / 5))  # 40% extra, minimum 20 days
    calendar_days_to_request = days + buffer_days

    to_date = datetime.now().strftime('%Y-%m-%d')
    from_date = (datetime.now() - timedelta(days=calendar_days_to_request)).strftime('%Y-%m-%d')

    expected_trading_days = max(1, int(days * 5 / 7))  # Approximate trading days

    console.print(f"[yellow]⏳ Fetching data from {from_date} to {to_date}...[/yellow]")
    console.print(f"[dim](Requesting {calendar_days_to_request} calendar days to get ~{expected_trading_days} trading days)[/dim]\n")

    try:
        df = api.fetch_historical_data_v3(
            symbol=symbol,
            unit='minutes',
            interval=interval,
            from_date=from_date,
            to_date=to_date
        )
    except Exception as e:
        console.print(f"[red]❌ Error: {str(e)[:100]}[/red]")
        return None

    if df is None or df.empty:
        console.print(f"[red]❌ No data found[/red]")
        return None

    console.print(f"[dim]📊 Raw data loaded: {len(df):,} candles[/dim]")

    # Filter to actual requested period (last X trading days, not calendar days)
    # Get the last N trading days with DYNAMIC calculation
    df['date'] = df.index.date
    df = df.sort_index()

    # Get unique dates in descending order
    unique_dates_desc = sorted(df['date'].unique(), reverse=True)

    # Target trading days with small buffer (5 extra days for safety)
    # This buffer is small since we already have buffer in the API request
    target_trading_days = max(5, int(days * 5 / 7) + 5)

    if len(unique_dates_desc) > target_trading_days:
        cutoff_date = unique_dates_desc[target_trading_days]
        df = df[df['date'] > cutoff_date]

    console.print(f"[green]✅ Loaded {len(df):,} candles ({interval}-minute interval)[/green]\n")

    # Debug: Show date range
    if len(df) > 0:
        console.print(f"[dim]📅 Date range: {df.index[0].date()} to {df.index[-1].date()}[/dim]")
        console.print(f"[dim]📊 Calendar days spanned: {(df.index[-1] - df.index[0]).days}[/dim]")

    # Group by date and show actual trading days
    unique_dates = sorted(df['date'].unique())
    console.print(f"[dim]📈 Actual trading days in data: {len(unique_dates)}[/dim]\n")

    # Ensure all required columns exist
    required_cols = ['open', 'high', 'low', 'close', 'volume']
    missing_cols = [col for col in required_cols if col not in df.columns]
    if missing_cols:
        console.print(f"[red]❌ Missing columns: {missing_cols}[/red]")
        console.print(f"[red]Available columns: {list(df.columns)}[/red]")
        return None

    # Remove the temporary date column
    df = df.drop(columns=['date'])

    return df


def create_animated_frame(df_current: pd.DataFrame, symbol: str, frame_num: int,
                          total_frames: int, historical_signals: list):
    """
    Create a single animated frame showing cumulative analysis up to current point.

    Args:
        df_current: Data up to current frame (with all indicators pre-calculated)
        symbol: Stock symbol
        frame_num: Current frame number
        total_frames: Total number of frames
        historical_signals: List of past trading signals

    Returns:
        matplotlib figure for this frame
    """

    fig = plt.figure(figsize=(16, 12))
    gs = GridSpec(4, 2, figure=fig, hspace=0.3, wspace=0.3, height_ratios=[3, 2, 2, 1.5])

    # Add timestamp to title
    current_date = df_current.index[-1].strftime('%Y-%m-%d')
    fig.suptitle(f'{symbol} - Institutional Order Flow Animation\n'
                 f'Date: {current_date} | Frame: {frame_num}/{total_frames}',
                 fontsize=14, fontweight='bold', y=0.98)

    # Get context (all indicators already calculated)
    current_price = df_current['close'].iloc[-1]

    # Find 52W context
    df_current['52w_high'] = df_current['high'].rolling(window=252, min_periods=20).max()
    recent_52w = df_current['52w_high'].iloc[-1]
    distance_pct = ((recent_52w - current_price) / current_price) * 100

    context = {
        '52w_high': recent_52w,
        'distance_pct': distance_pct,
        'is_near_52w': distance_pct < 3.0
    }

    # ===============================
    # Subplot 1: Main Price Chart (Top, spans both columns)
    # ===============================
    ax1 = fig.add_subplot(gs[0, :])

    # Plot price
    ax1.plot(df_current.index, df_current['close'], color='#2196f3',
            linewidth=2, label='Close Price', alpha=0.8)

    # VWAP
    ax1.plot(df_current.index, df_current['vwap'], color='#9c27b0',
            linewidth=2, label='VWAP', linestyle='--', alpha=0.7)

    # 52-week high line
    ax1.axhline(y=context['52w_high'], color='green', linestyle=':',
               linewidth=2, alpha=0.7, label=f"52W High: ₹{context['52w_high']:.2f}")

    # Highlight volume anomalies
    anomalies = df_current[df_current['is_anomaly']]
    if len(anomalies) > 0:
        ax1.scatter(anomalies.index, anomalies['close'], color='#ff9800',
                   s=150, alpha=0.8, marker='^', zorder=5,
                   edgecolors='black', linewidths=1, label=f'Anomalies: {len(anomalies)}')

    ax1.set_ylabel('Price (₹)', fontsize=11, fontweight='bold')
    ax1.legend(loc='upper left', fontsize=9, framealpha=0.9)
    ax1.grid(True, alpha=0.3)

    # Current price annotation
    ax1.annotate(f'₹{current_price:.2f}',
                xy=(df_current.index[-1], current_price),
                xytext=(10, 0), textcoords='offset points',
                fontsize=11, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.5', facecolor='yellow', alpha=0.8),
                arrowprops=dict(arrowstyle='->', color='black', lw=2))

    # ===============================
    # Subplot 2: Volume Bars
    # ===============================
    ax2 = fig.add_subplot(gs[1, 0])

    colors_vol = ['#26a69a' if df_current['close'].iloc[i] >= df_current['open'].iloc[i]
                 else '#ef5350' for i in range(len(df_current))]
    ax2.bar(df_current.index, df_current['volume'], color=colors_vol, alpha=0.6, width=0.8)

    if len(anomalies) > 0:
        ax2.bar(anomalies.index, anomalies['volume'], color='#ff9800',
               alpha=0.8, width=0.8)

    ax2.axhline(y=df_current['volume'].mean(), color='blue', linestyle='--',
               linewidth=1.5, alpha=0.7, label=f'Avg: {df_current["volume"].mean():,.0f}')
    ax2.set_ylabel('Volume', fontsize=11, fontweight='bold')
    ax2.legend(fontsize=9)
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(plt.matplotlib.dates.DateFormatter('%b %d'))

    # ===============================
    # Subplot 3: Order Flow Imbalance
    # ===============================
    ax3 = fig.add_subplot(gs[1, 1])

    ax3.fill_between(df_current.index, df_current['ofi'], 0.5,
                    where=(df_current['ofi'] >= 0.5), color='green', alpha=0.3)
    ax3.fill_between(df_current.index, df_current['ofi'], 0.5,
                    where=(df_current['ofi'] < 0.4), color='red', alpha=0.3)
    ax3.plot(df_current.index, df_current['ofi'], color='purple', linewidth=2, alpha=0.8)
    ax3.axhline(y=0.5, color='black', linestyle='-', linewidth=1, alpha=0.5)

    # Current OFI value
    current_ofi = df_current['ofi'].iloc[-1]
    ax3.annotate(f'OFI: {current_ofi:.2f}',
                xy=(df_current.index[-1], current_ofi),
                xytext=(5, 5), textcoords='offset points',
                fontsize=10, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.3', facecolor='lightblue', alpha=0.8))

    ax3.set_ylabel('OFI (0-1)', fontsize=11, fontweight='bold')
    ax3.set_ylim(0, 1)
    ax3.grid(True, alpha=0.3)
    ax3.xaxis.set_major_formatter(plt.matplotlib.dates.DateFormatter('%b %d'))

    # ===============================
    # Subplot 4: Accumulation Score
    # ===============================
    ax4 = fig.add_subplot(gs[2, 0])

    ax4.plot(df_current.index, df_current['acc_score'], color='darkgreen',
            linewidth=2, alpha=0.8)
    ax4.fill_between(df_current.index, df_current['acc_score'], 60,
                    where=(df_current['acc_score'] >= 60), color='green', alpha=0.3)
    ax4.axhline(y=60, color='green', linestyle='--', linewidth=2, alpha=0.7)

    current_acc = df_current['acc_score'].iloc[-1]
    ax4.annotate(f'Acc: {current_acc:.1f}',
                xy=(df_current.index[-1], current_acc),
                xytext=(5, 5), textcoords='offset points',
                fontsize=10, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.3', facecolor='lightgreen', alpha=0.8))

    ax4.set_ylabel('Acc Score', fontsize=11, fontweight='bold')
    ax4.grid(True, alpha=0.3)
    ax4.xaxis.set_major_formatter(plt.matplotlib.dates.DateFormatter('%b %d'))

    # ===============================
    # Subplot 5: Signal Timeline
    # ===============================
    ax5 = fig.add_subplot(gs[2, 1])

    # Plot historical signals
    if len(historical_signals) > 0:
        dates = [s['date'] for s in historical_signals]
        actions = [s['action'] for s in historical_signals]

        # Convert actions to numbers for plotting
        action_map = {'ENTER': 3, 'WAIT': 2, 'AVOID': 1}
        action_nums = [action_map.get(a, 0) for a in actions]

        # Plot as colored points
        colors_sig = []
        for action in actions:
            if action == 'ENTER':
                colors_sig.append('#2ecc71')
            elif action == 'WAIT':
                colors_sig.append('#f39c12')
            else:
                colors_sig.append('#e74c3c')

        ax5.scatter(dates, action_nums, c=colors_sig, s=100, alpha=0.7,
                   edgecolors='black', linewidths=1, zorder=5)

        # Add legend for signals
        from matplotlib.patches import Patch
        legend_elements = [
            Patch(facecolor='#2ecc71', label='ENTER'),
            Patch(facecolor='#f39c12', label='WAIT'),
            Patch(facecolor='#e74c3c', label='AVOID')
        ]
        ax5.legend(handles=legend_elements, loc='upper left', fontsize=8)

    ax5.set_ylim(0.5, 3.5)
    ax5.set_yticks([1, 2, 3])
    ax5.set_yticklabels(['AVOID', 'WAIT', 'ENTER'])
    ax5.set_ylabel('Signal', fontsize=11, fontweight='bold')
    ax5.grid(True, alpha=0.3, axis='y')
    ax5.xaxis.set_major_formatter(plt.matplotlib.dates.DateFormatter('%b %d'))

    # ===============================
    # Subplot 6: Current Signal Panel (Bottom)
    # ===============================
    ax6 = fig.add_subplot(gs[3, :])
    ax6.axis('off')

    # Generate current signal manually (avoid calling function that needs specific columns)
    recent_data = df_current.tail(30)

    # Calculate signal components
    strong_signals = 0
    weak_signals = 0
    bad_signals = 0

    # Distance check
    if context['distance_pct'] <= 3.0:
        strong_signals += 1
        dist_reason = f"✅ Dist: {context['distance_pct']:.1f}%"
    elif context['distance_pct'] <= 5.0:
        weak_signals += 1
        dist_reason = f"⚠️ Dist: {context['distance_pct']:.1f}%"
    else:
        bad_signals += 1
        dist_reason = f"❌ Dist: {context['distance_pct']:.1f}%"

    # Accumulation score check
    max_acc = recent_data['acc_score'].max()
    if max_acc > 60:
        strong_signals += 1
        acc_reason = f"✅ Acc Score: {max_acc:.0f}"
    elif max_acc > 40:
        weak_signals += 1
        acc_reason = f"⚠️ Acc Score: {max_acc:.0f}"
    else:
        bad_signals += 1
        acc_reason = f"❌ Acc Score: {max_acc:.0f}"

    # Volume anomaly check
    has_anomaly = recent_data['is_anomaly'].any()
    if has_anomaly:
        strong_signals += 1
        anom_reason = f"✅ Volume anomaly detected"
    else:
        bad_signals += 1
        anom_reason = f"❌ No recent big orders"

    # OFI check
    current_ofi = df_current['ofi'].iloc[-1]
    if current_ofi > 0.6:
        strong_signals += 1
        ofi_reason = f"✅ OFI: {current_ofi:.2f}"
    elif current_ofi > 0.5:
        weak_signals += 1
        ofi_reason = f"⚠️ OFI: {current_ofi:.2f}"
    else:
        bad_signals += 1
        ofi_reason = f"❌ OFI: {current_ofi:.2f}"

    # VWAP check
    vwap = df_current['vwap'].iloc[-1]
    if current_price > vwap:
        strong_signals += 1
        vwap_reason = f"✅ Above VWAP"
    else:
        bad_signals += 1
        vwap_reason = f"❌ Below VWAP"

    # Determine action
    if bad_signals >= 2:
        action = "AVOID"
        confidence = "HIGH"
    elif weak_signals >= 3:
        action = "WAIT"
        confidence = "MED"
    elif strong_signals >= 4:
        action = "ENTER"
        confidence = "HIGH"
    elif strong_signals >= 3 and bad_signals == 0:
        action = "ENTER"
        confidence = "MED"
    elif strong_signals >= 2:
        action = "WAIT"
        confidence = "LOW"
    else:
        action = "AVOID"
        confidence = "HIGH"

    reasons = [dist_reason, acc_reason, anom_reason, ofi_reason, vwap_reason]

    # Signal color
    signal_colors = {'ENTER': '#2ecc71', 'WAIT': '#f39c12', 'AVOID': '#e74c3c'}
    signal_color = signal_colors.get(action, '#95a5a6')

    # Build summary text
    summary_text = f"""
    CURRENT TRADING SIGNAL: {action} ({confidence} Confidence) |
    Distance to 52W: {context['distance_pct']:.2f}% | Current Price: ₹{current_price:.2f} | VWAP: ₹{vwap:.2f}
    Volume Anomalies: {df_current['is_anomaly'].sum()} | Max Acc Score: {df_current['acc_score'].max():.1f}
    SIGNAL REASONS: {" | ".join(reasons)}
    """

    ax6.text(0.5, 0.5, summary_text, ha='center', va='center',
            fontsize=11, family='monospace',
            bbox=dict(boxstyle='round', facecolor=signal_color, alpha=0.3, pad=1),
            transform=ax6.transAxes)

    plt.tight_layout()

    return fig, action, confidence


def create_animation(symbol: str, df: pd.DataFrame, output_file: str,
                     fps: int = 2, frames_per_day: int = 1, interval: int = 30):
    """
    Create animated video showing evolution of order flow over time.

    Args:
        symbol: Stock symbol
        df: Complete historical dataframe
        output_file: Output video filename (MP4)
        fps: Frames per second for video
        frames_per_day: Number of frames to generate per trading day
        interval: Data interval in minutes (15 or 30)
    """

    console.print(f"\n[bold cyan]🎬 Creating animation for {symbol}...[/bold cyan]\n")

    # Calculate minimum candles needed (2 trading days worth of data)
    # Assuming 6 trading hours per day
    candles_per_day = int((6 * 60) / interval)  # ~12 for 30min, ~24 for 15min
    min_candles = candles_per_day * 2  # Minimum 2 trading days

    # Pre-calculate ALL indicators on the full dataframe
    console.print("[dim]📊 Pre-calculating indicators for entire dataset...[/dim]")

    # Debug: Print dataframe info
    console.print(f"[dim]  DataFrame type: {type(df)}[/dim]")
    console.print(f"[dim]  DataFrame shape: {df.shape}[/dim]")
    console.print(f"[dim]  DataFrame index type: {type(df.index)}[/dim]")
    console.print(f"[dim]  Has volume column: {'volume' in df.columns}[/dim]")

    # Ensure numeric types
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    # Calculate VWAP first
    df['vwap'] = calculate_vwap(df)

    # Volume anomalies
    df['vol_mean'] = df['volume'].rolling(window=20).mean()
    df['vol_std'] = df['volume'].rolling(window=20).std()
    df['vol_zscore'] = (df['volume'] - df['vol_mean']) / df['vol_std']
    df['is_anomaly'] = df['vol_zscore'] > 2.5
    df['anomaly_score'] = df['vol_zscore'].where(df['is_anomaly'], 0)

    # Order flow
    df['range'] = df['high'] - df['low']
    df['range'] = df['range'].replace(0, df['range'].mean())
    df['buy_pressure'] = ((df['close'] - df['low']) / df['range']) * df['volume']
    df['sell_pressure'] = ((df['high'] - df['close']) / df['range']) * df['volume']
    df['total_pressure'] = df['buy_pressure'] + df['sell_pressure']
    df['ofi'] = df['buy_pressure'] / df['total_pressure']

    # Accumulation
    df['acc_score'] = 0
    for i in range(30, len(df)):
        score = 0
        if i > 0:
            price_mom = (df['close'].iloc[i] - df['close'].iloc[i-30]) / df['close'].iloc[i-30] * 100
            if price_mom > 0:
                score += min(20, price_mom)

        vol_mean = df['volume'].rolling(30).mean().iloc[i]
        if df['volume'].iloc[i] > vol_mean:
            score += min(30, ((df['volume'].iloc[i] / vol_mean) - 1) * 30)

        if df['ofi'].iloc[i] > 0.6:
            score += min(30, (df['ofi'].iloc[i] - 0.6) * 75)

        df.iloc[i, df.columns.get_loc('acc_score')] = score

    console.print("[green]✅ Indicators calculated[/green]\n")

    # Group by date and sample frames
    df['date'] = df.index.date
    unique_dates = sorted(df['date'].unique())

    console.print(f"[dim]📅 Total unique dates: {len(unique_dates)}[/dim]")
    console.print(f"[dim]🎞️  Frames to generate: {len(unique_dates)}[/dim]\n")

    # Create frames directory
    frames_dir = f"frames_{symbol}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    os.makedirs(frames_dir, exist_ok=True)

    historical_signals = []
    frame_files = []
    total_frames = len(unique_dates)

    # Generate frames
    with console.status("[bold yellow]📸 Generating animation frames...[/bold yellow]"):
        for frame_num, date in enumerate(unique_dates):
            # Get data up to this date
            df_up_to_date = df[df['date'] <= date].copy()

            # Skip if not enough data (need minimum candles for indicators)
            if len(df_up_to_date) < min_candles:
                continue

            # Create frame and get signal
            fig, action, confidence = create_animated_frame(df_up_to_date, symbol, frame_num + 1,
                                                             total_frames, historical_signals)

            historical_signals.append({
                'date': df_up_to_date.index[-1],
                'action': action,
                'confidence': confidence
            })

            # Save frame
            frame_file = os.path.join(frames_dir, f"frame_{frame_num:04d}.png")
            fig.savefig(frame_file, dpi=100, bbox_inches='tight', facecolor='white')
            plt.close(fig)

            frame_files.append(frame_file)

            # Progress
            if (frame_num + 1) % 5 == 0:
                console.print(f"  [dim]Generated {frame_num + 1}/{total_frames} frames[/dim]")

    console.print(f"[green]✅ Generated {len(frame_files)} frames[/green]\n")

    # Create video from frames using ffmpeg (more reliable than cv2.VideoWriter)
    console.print(f"[cyan]🎬 Creating video from frames (FPS: {fps})...[/cyan]\n")

    # Get frame size for info display
    first_frame = cv2.imread(frame_files[0])
    height, width, layers = first_frame.shape

    import subprocess
    try:
        # Use ffmpeg directly (more reliable than cv2.VideoWriter)
        cmd = [
            'ffmpeg', '-y', '-framerate', str(fps),
            '-i', os.path.join(frames_dir, 'frame_%04d.png'),
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-pix_fmt', 'yuv420p', '-vf', 'scale=1920:-2', output_file
        ]

        console.print(f"[dim]  Running ffmpeg (this may take a moment)...[/dim]\n")

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode == 0:
            console.print(f"\n[bold green]✅ Animation saved:[/bold green] {output_file}\n")
        else:
            console.print(f"[red]❌ ffmpeg failed:[/red]")
            console.print(f"[red]{result.stderr}[/red]")
            # Try fallback with cv2
            console.print("[yellow]Attempting fallback with cv2.VideoWriter...[/yellow]")
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            video = cv2.VideoWriter(output_file, fourcc, fps, (width, height))
            for frame_file in frame_files:
                frame = cv2.imread(frame_file)
                video.write(frame)
            video.release()
            console.print(f"\n[bold green]✅ Animation saved (via cv2):[/bold green] {output_file}\n")
    except FileNotFoundError:
        console.print("[yellow]⚠️ ffmpeg not found, using cv2.VideoWriter fallback[/yellow]")
        # Fallback to cv2.VideoWriter
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        video = cv2.VideoWriter(output_file, fourcc, fps, (width, height))

        frames_written = 0
        with console.status("[bold yellow]⏳ Rendering video...[/bold yellow]"):
            for i, frame_file in enumerate(frame_files):
                frame = cv2.imread(frame_file)
                if frame is not None:
                    video.write(frame)
                    frames_written += 1

                if (i + 1) % 10 == 0:
                    console.print(f"  [dim]Processed {i + 1}/{len(frame_files)} frames[/dim]")

        video.release()
        console.print(f"\n[green]  Wrote {frames_written} frames to video[/green]\n")
        console.print(f"\n[bold green]✅ Animation saved:[/bold green] {output_file}\n")

    # Cleanup frames
    console.print(f"[dim]🧹 Cleaning up frames...[/dim]")
    import shutil
    shutil.rmtree(frames_dir)

    # Print video info
    file_size = os.path.getsize(output_file) / (1024 * 1024)
    console.print(f"[dim]📹 Video info:[/dim]")
    console.print(f"[dim]   - Duration: ~{len(frame_files)/fps:.1f} seconds[/dim]")
    console.print(f"[dim]   - File size: {file_size:.1f} MB[/dim]")
    console.print(f"[dim]   - Resolution: {width}x{height}[/dim]\n")

    return output_file


def main():
    parser = argparse.ArgumentParser(
        description="Animated Institutional Order Flow Analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python analyze_order_flow_animated.py SUNDARMFIN
  python analyze_order_flow_animated.py SUNDARMFIN --days 60 --fps 3
  python analyze_order_flow_animated.py SUNDARMFIN --days 100 --interval 15
        """
    )

    parser.add_argument('symbol', type=str, help='Stock symbol (e.g., SUNDARMFIN)')
    parser.add_argument('--days', '-d', type=int, default=60,
                       help='Number of days to animate (default: 60)')
    parser.add_argument('--interval', '-i', type=int, default=30,
                       help='Data interval in minutes: 15 or 30 (default: 30)')
    parser.add_argument('--fps', type=int, default=2,
                       help='Video FPS (default: 2, slower = smoother)')
    parser.add_argument('--frames-per-day', type=int, default=1,
                       help='Frames per trading day (default: 1)')

    args = parser.parse_args()

    # Validate interval
    if args.interval not in [15, 30]:
        console.print("[red]❌ Interval must be 15 or 30 minutes (Upstox API limitation)[/red]")
        return

    symbol = args.symbol.upper()

    console.print(f"""
[bold cyan]╔════════════════════════════════════════════════════════════╗[/bold cyan]
[bold cyan]║     ANIMATED ORDER FLOW ANALYSIS - {symbol:<22} ║[/bold cyan]
[bold cyan]╚════════════════════════════════════════════════════════════╝[/bold cyan]

[bold]Configuration:[/bold]
  Duration: {args.days} days
  Interval: {args.interval}-minute
  FPS: {args.fps}
  Output: {symbol}_orderflow_animation_{datetime.now().strftime('%Y%m%d')}.mp4
    """)

    # Fetch historical data
    df = fetch_historical_data_chunked(symbol, days=args.days, interval=args.interval)

    if df is None:
        return

    # Generate animation
    timestamp = datetime.now().strftime('%Y%m%d')
    output_file = f"{symbol}_orderflow_animation_{timestamp}.mp4"

    create_animation(symbol, df, output_file, fps=args.fps,
                    frames_per_day=args.frames_per_day, interval=args.interval)

    console.print(f"[bold green]🎉 Animation complete![/bold green]\n")
    console.print(f"[dim]You can open the video file in any video player.[/dim]\n")


if __name__ == "__main__":
    main()
