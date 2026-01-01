#!/usr/bin/env python3
"""
Institutional Order Flow Analysis for 52-Week High Breakout
===========================================================

Analyzes 1-minute data to detect:
- Large institutional orders (volume anomalies)
- Order flow imbalances
- VWAP execution levels
- Accumulation/distribution patterns
- Correlation with 52W high approaches

Usage:
    python analyze_order_flow_52w.py SUNDARMFIN
    python analyze_order_flow_52w.py SUNDARMFIN --days 7
    python analyze_order_flow_52w.py SUNDARMFIN --min-volume 50000
"""

import sys
import os
import argparse
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box
import warnings
warnings.filterwarnings('ignore')

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.gridspec import GridSpec
import seaborn as sns
from matplotlib.patches import Rectangle
import matplotlib.patches as mpatches

# Set style for beautiful plots
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")
plt.rcParams['figure.facecolor'] = '#f8f9fa'
plt.rcParams['axes.facecolor'] = '#ffffff'
plt.rcParams['text.color'] = '#2c3e50'
plt.rcParams['axes.labelcolor'] = '#2c3e50'
plt.rcParams['xtick.color'] = '#2c3e50'
plt.rcParams['ytick.color'] = '#2c3e50'
plt.rcParams['grid.alpha'] = 0.3
plt.rcParams['font.size'] = 10

# Add project root to path
_script_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.abspath(os.path.join(_script_dir, '..'))
sys.path.insert(0, _project_root)

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory

console = Console()


def calculate_vwap(df: pd.DataFrame) -> pd.Series:
    """
    Calculate Volume Weighted Average Price (VWAP).

    VWAP = Sum(Price * Volume) / Sum(Volume)
    Institutional algo orders often target VWAP levels.
    """
    typical_price = (df['high'] + df['low'] + df['close']) / 3
    vwap = (typical_price * df['volume']).cumsum() / df['volume'].cumsum()
    return vwap


def detect_volume_anomalies(df: pd.DataFrame, window: int = 20, threshold: float = 2.5) -> pd.DataFrame:
    """
    Detect volume anomalies using rolling statistics.

    Large orders = Volume > (Mean + threshold * StdDev)

    Returns DataFrame with anomaly flags and anomaly scores.
    """
    # Rolling volume statistics
    df['vol_mean'] = df['volume'].rolling(window=window).mean()
    df['vol_std'] = df['volume'].rolling(window=window).std()

    # Z-score: How many standard deviations above/below mean
    df['vol_zscore'] = (df['volume'] - df['vol_mean']) / df['vol_std']

    # Anomaly flag
    df['is_anomaly'] = df['vol_zscore'] > threshold

    # Anomaly magnitude (for ranking)
    df['anomaly_score'] = df['vol_zscore'].where(df['is_anomaly'], 0)

    return df


def detect_order_blocks(df: pd.DataFrame, min_size: int = 50000) -> pd.DataFrame:
    """
    Detect order blocks - periods of heavy buying/selling.

    Order Block = Consecutive minutes with high volume + directional move.
    """
    df['price_change'] = df['close'].diff()
    df['volume_consecutive'] = 0

    # Count consecutive high-volume bars
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
    """
    Calculate order flow imbalance using candle analysis.

    Buying Pressure = (Close - Low) / (High - Low) * Volume
    Selling Pressure = (High - Close) / (High - Low) * Volume

    Imbalance > 0.6 = Strong buying (institutional accumulation)
    Imbalance < 0.4 = Strong selling (distribution)
    """
    df['range'] = df['high'] - df['low']
    df['range'] = df['range'].replace(0, df['range'].mean())  # Avoid divide by zero

    # Buying pressure (close near high = buying)
    df['buy_pressure'] = ((df['close'] - df['low']) / df['range']) * df['volume']

    # Selling pressure (close near low = selling)
    df['sell_pressure'] = ((df['high'] - df['close']) / df['range']) * df['volume']

    # Total volume for normalization
    df['total_pressure'] = df['buy_pressure'] + df['sell_pressure']

    # Order flow imbalance (0 to 1)
    df['ofi'] = df['buy_pressure'] / df['total_pressure']

    return df


def detect_institutional_accumulation(df: pd.DataFrame, lookback: int = 30) -> pd.DataFrame:
    """
    Detect institutional accumulation patterns.

    Signs of accumulation:
    1. Price stable or rising
    2. Volume above average
    3. Order flow imbalance > 0.6 (strong buying)
    4. Multiple consecutive high-volume bars
    """
    df['acc_score'] = 0

    # Price rising (positive momentum)
    df['price_momentum'] = df['close'].pct_change(lookback)

    # Volume above average (institutional size)
    df['vol_above_avg'] = df['volume'] > df['volume'].rolling(lookback).mean()

    # Strong order flow (accumulation)
    df['strong_buying'] = df['ofi'] > 0.6

    # Calculate accumulation score
    for i in range(lookback, len(df)):
        score = 0

        # Price momentum (20 points)
        if df.iloc[i]['price_momentum'] > 0:
            score += min(20, df.iloc[i]['price_momentum'] * 100)

        # Volume above average (30 points)
        if df.iloc[i]['vol_above_avg']:
            vol_ratio = df.iloc[i]['volume'] / df.iloc[i]['vol_mean']
            score += min(30, (vol_ratio - 1) * 30)

        # Order flow imbalance (30 points)
        if df.iloc[i]['strong_buying']:
            ofi_bonus = (df.iloc[i]['ofi'] - 0.6) * 75  # 0.6->0 pts, 1.0->30 pts
            score += min(30, ofi_bonus)

        # Consecutive high volume (20 points)
        consecutive = df.iloc[i]['volume_consecutive']
        if consecutive > 0:
            score += min(20, consecutive * 2)

        df.iloc[i, df.columns.get_loc('acc_score')] = score

    return df


def find_52w_context(df: pd.DataFrame, current_price: float) -> dict:
    """
    Find where current price is relative to 52-week high.
    """
    df['52w_high'] = df['high'].rolling(window=252, min_periods=50).max()

    recent_52w = df['52w_high'].iloc[-1]
    distance_pct = ((recent_52w - current_price) / current_price) * 100

    return {
        '52w_high': recent_52w,
        'distance_pct': distance_pct,
        'is_near_52w': distance_pct < 3.0
    }


def analyze_big_orders(df: pd.DataFrame, top_n: int = 10) -> pd.DataFrame:
    """
    Extract and analyze the biggest orders (volume spikes).
    """
    # Filter anomalies only
    anomalies = df[df['is_anomaly']].copy()

    if len(anomalies) == 0:
        return pd.DataFrame()

    # Sort by anomaly score (magnitude)
    anomalies = anomalies.sort_values('anomaly_score', ascending=False)

    # Add context
    anomalies['price_move'] = anomalies['close'].pct_change()
    anomalies['ofi_signal'] = anomalies['ofi'].apply(
        lambda x: '🟢 STRONG BUY' if x > 0.6 else ('🔴 STRONG SELL' if x < 0.4 else '⚪ NEUTRAL')
    )

    # Select columns for display
    display_cols = [
        'timestamp', 'close', 'volume', 'vol_zscore', 'anomaly_score',
        'ofi', 'ofi_signal', 'acc_score', 'volume_consecutive'
    ]

    return anomalies[display_cols].head(top_n)


def generate_entry_signal(df: pd.DataFrame, context: dict) -> dict:
    """
    Generate entry signal based on institutional activity alignment.

    Signal Criteria:
    1. Near 52W high (<3%)
    2. Recent accumulation (score > 50 in last 30 mins)
    3. Volume anomaly in last hour
    4. Order flow imbalance > 0.6
    5. Price above VWAP
    """
    recent_data = df.tail(30)  # Last 30 minutes

    signal = {
        'action': 'WAIT',
        'confidence': 'LOW',
        'reasons': []
    }

    # Check 1: Distance to 52W
    if context['is_near_52w']:
        signal['reasons'].append(f"✅ Near 52W ({context['distance_pct']:.1f}%)")
    else:
        signal['reasons'].append(f"⚠️  Far from 52W ({context['distance_pct']:.1f}%)")

    # Check 2: Recent accumulation
    recent_acc_score = recent_data['acc_score'].max()
    if recent_acc_score > 60:
        signal['reasons'].append(f"✅ Strong accumulation (Score: {recent_acc_score:.0f})")
    elif recent_acc_score > 40:
        signal['reasons'].append(f"⚠️  Moderate accumulation (Score: {recent_acc_score:.0f})")
    else:
        signal['reasons'].append(f"❌ Weak accumulation (Score: {recent_acc_score:.0f})")

    # Check 3: Recent volume anomaly
    recent_anomaly = recent_data['is_anomaly'].any()
    if recent_anomaly:
        max_anomaly = recent_data['anomaly_score'].max()
        signal['reasons'].append(f"✅ Big orders detected (Z-score: {max_anomaly:.1f})")
    else:
        signal['reasons'].append("❌ No recent big orders")

    # Check 4: Order flow imbalance
    recent_ofi = recent_data['ofi'].iloc[-1]
    if recent_ofi > 0.6:
        signal['reasons'].append(f"✅ Strong buying pressure (OFI: {recent_ofi:.2f})")
    elif recent_ofi > 0.5:
        signal['reasons'].append(f"⚠️  Moderate buying (OFI: {recent_ofi:.2f})")
    else:
        signal['reasons'].append(f"❌ Weak/neutral flow (OFI: {recent_ofi:.2f})")

    # Check 5: Price vs VWAP
    current_price = df['close'].iloc[-1]
    current_vwap = df['vwap'].iloc[-1]
    if current_price > current_vwap:
        signal['reasons'].append(f"✅ Above VWAP ({current_vwap:.2f})")
    else:
        signal['reasons'].append(f"❌ Below VWAP ({current_vwap:.2f})")

    # Determine signal
    strong_signals = sum(1 for r in signal['reasons'] if r.startswith('✅'))
    weak_signals = sum(1 for r in signal['reasons'] if r.startswith('⚠️'))
    bad_signals = sum(1 for r in signal['reasons'] if r.startswith('❌'))

    if strong_signals >= 4:
        signal['action'] = 'ENTER'
        signal['confidence'] = 'HIGH'
    elif strong_signals >= 3 and bad_signals == 0:
        signal['action'] = 'ENTER'
        signal['confidence'] = 'MED'
    elif weak_signals >= 3:
        signal['action'] = 'WAIT'
        signal['confidence'] = 'MED'
    elif bad_signals >= 3:
        signal['action'] = 'AVOID'
        signal['confidence'] = 'HIGH'

    return signal


def create_comprehensive_eda(symbol: str, df: pd.DataFrame, big_orders: pd.DataFrame,
                             context: dict, signal: dict, save_dir: str = "."):
    """
    Create comprehensive EDA visualizations for institutional order flow analysis.

    Generates 6 beautiful plots covering all aspects of the analysis.
    """

    console.print("[cyan]📊 Generating EDA visualizations...[/cyan]")

    # Create output directory
    os.makedirs(save_dir, exist_ok=True)

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    base_filename = f"{save_dir}/{symbol}_orderflow_eda_{timestamp}"

    # ============================================================================
    # PLOT 1: Price, Volume, VWAP & Order Flow (Main Chart)
    # ============================================================================
    fig, axes = plt.subplots(4, 1, figsize=(16, 10), sharex=True,
                             gridspec_kw={'height_ratios': [3, 1.5, 1, 1], 'hspace': 0.05})

    # Colors
    color_up = '#26a69a'
    color_down = '#ef5350'
    color_volume_spike = '#ff9800'
    color_vwap = '#9c27b0'

    # Subplot 1: Price & VWAP
    ax1 = axes[0]
    ax1.plot(df.index, df['close'], color='#2196f3', linewidth=1.5, label='Close Price', alpha=0.7)
    ax1.plot(df.index, df['vwap'], color=color_vwap, linewidth=2, label='VWAP', linestyle='--')

    # Highlight volume anomalies
    anomalies = df[df['is_anomaly']]
    if len(anomalies) > 0:
        ax1.scatter(anomalies.index, anomalies['close'], color=color_volume_spike,
                   s=100, alpha=0.6, marker='^', label=f'Volume Anomaly ({len(anomalies)})',
                   edgecolors='black', linewidths=0.5, zorder=5)

    # 52-week high line
    ax1.axhline(y=context['52w_high'], color='green', linestyle=':',
               linewidth=2, alpha=0.7, label=f"52W High: ₹{context['52w_high']:.2f}")

    # Current price annotation
    current_price = df['close'].iloc[-1]
    ax1.annotate(f'₹{current_price:.2f}',
                xy=(df.index[-1], current_price),
                xytext=(10, 0), textcoords='offset points',
                fontsize=10, fontweight='bold',
                bbox=dict(boxstyle='round,pad=0.5', facecolor='yellow', alpha=0.7),
                arrowprops=dict(arrowstyle='->', color='black'))

    ax1.set_ylabel('Price (₹)', fontsize=11, fontweight='bold')
    ax1.set_title(f'{symbol} - Institutional Order Flow Analysis', fontsize=14, fontweight='bold',
                 pad=15)
    ax1.legend(loc='upper left', fontsize=9, framealpha=0.9)
    ax1.grid(True, alpha=0.3)

    # Subplot 2: Volume Bars with Anomalies
    ax2 = axes[1]
    colors = [color_up if df['close'].iloc[i] >= df['open'].iloc[i] else color_down
              for i in range(len(df))]
    ax2.bar(df.index, df['volume'], color=colors, alpha=0.6, width=0.8)

    # Highlight anomalies
    if len(anomalies) > 0:
        ax2.bar(anomalies.index, anomalies['volume'], color=color_volume_spike,
               alpha=0.8, width=0.8, label='Anomaly')

    # Average volume line
    ax2.axhline(y=df['volume'].mean(), color='blue', linestyle='--',
               linewidth=1.5, alpha=0.7, label=f'Avg Vol: {df["volume"].mean():,.0f}')

    ax2.set_ylabel('Volume', fontsize=11, fontweight='bold')
    ax2.legend(loc='upper left', fontsize=9, framealpha=0.9)
    ax2.grid(True, alpha=0.3)

    # Subplot 3: Order Flow Imbalance (OFI)
    ax3 = axes[2]
    ax3.fill_between(df.index, df['ofi'], 0.5, where=(df['ofi'] >= 0.5),
                    color='green', alpha=0.3, label='Strong Buy (≥0.6)')
    ax3.fill_between(df.index, df['ofi'], 0.5, where=(df['ofi'] < 0.4),
                    color='red', alpha=0.3, label='Strong Sell (≤0.4)')
    ax3.plot(df.index, df['ofi'], color='purple', linewidth=1.5, alpha=0.8)
    ax3.axhline(y=0.5, color='black', linestyle='-', linewidth=1, alpha=0.5)

    ax3.set_ylabel('OFI', fontsize=11, fontweight='bold')
    ax3.set_ylim(0, 1)
    ax3.legend(loc='upper left', fontsize=9, framealpha=0.9)
    ax3.grid(True, alpha=0.3)

    # Subplot 4: Accumulation Score
    ax4 = axes[3]
    ax4.fill_between(df.index, df['acc_score'], 60, where=(df['acc_score'] >= 60),
                    color='green', alpha=0.4, label='Strong (≥60)')
    ax4.fill_between(df.index, df['acc_score'], 60, where=(df['acc_score'] < 60),
                    color='orange', alpha=0.3, label='Moderate (<60)')
    ax4.plot(df.index, df['acc_score'], color='darkgreen', linewidth=2, alpha=0.8)
    ax4.axhline(y=60, color='green', linestyle='--', linewidth=1.5, alpha=0.7)

    ax4.set_ylabel('Acc Score', fontsize=11, fontweight='bold')
    ax4.set_xlabel('Time', fontsize=11, fontweight='bold')
    ax4.legend(loc='upper left', fontsize=9, framealpha=0.9)
    ax4.grid(True, alpha=0.3)

    # Format x-axis
    for ax in axes:
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
        ax.xaxis.set_major_locator(mdates.AutoDateLocator())

    plt.tight_layout()
    plot1_file = f"{base_filename}_main.png"
    plt.savefig(plot1_file, dpi=150, bbox_inches='tight', facecolor='white')
    console.print(f"  [green]✓[/green] {plot1_file}")
    plt.close()

    # ============================================================================
    # PLOT 2: Volume Distribution & Z-Score Analysis
    # ============================================================================
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    # 2.1: Volume Histogram
    ax1 = axes[0, 0]
    ax1.hist(df['volume'], bins=50, color='skyblue', alpha=0.7, edgecolor='black')

    # Mark anomalies
    if len(anomalies) > 0:
        ax1.axvline(x=anomalies['volume'].min(), color='red', linestyle='--',
                  linewidth=2, label=f'Anomaly Threshold: {anomalies["volume"].min():,.0f}')

    ax1.set_xlabel('Volume', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Frequency', fontsize=11, fontweight='bold')
    ax1.set_title('Volume Distribution', fontsize=12, fontweight='bold')
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3)

    # 2.2: Z-Score Time Series
    ax2 = axes[0, 1]
    ax2.plot(df.index, df['vol_zscore'], color='blue', linewidth=1.5, alpha=0.7)
    ax2.axhline(y=2.5, color='red', linestyle='--', linewidth=2, label='Threshold (2.5σ)')
    ax2.fill_between(df.index, df['vol_zscore'], 2.5, where=(df['vol_zscore'] >= 2.5),
                    color='red', alpha=0.3)

    # Annotate biggest spikes
    top_spikes = df.nlargest(5, 'vol_zscore')
    for idx, row in top_spikes.iterrows():
        ax2.annotate(f"{row['vol_zscore']:.1f}σ",
                    xy=(idx, row['vol_zscore']),
                    xytext=(5, 5), textcoords='offset points',
                    fontsize=8, fontweight='bold',
                    bbox=dict(boxstyle='round,pad=0.3', facecolor='yellow', alpha=0.7))

    ax2.set_xlabel('Time', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Z-Score (σ)', fontsize=11, fontweight='bold')
    ax2.set_title('Volume Z-Score Over Time', fontsize=12, fontweight='bold')
    ax2.legend(fontsize=9)
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))

    # 2.3: Z-Score Distribution
    ax3 = axes[1, 0]
    ax3.hist(df['vol_zscore'], bins=50, color='lightcoral', alpha=0.7, edgecolor='black')
    ax3.axvline(x=2.5, color='red', linestyle='--', linewidth=2, label='Threshold (2.5σ)')
    ax3.axvline(x=df['vol_zscore'].mean(), color='blue', linestyle='-',
               linewidth=2, label=f"Mean: {df['vol_zscore'].mean():.2f}σ")

    ax3.set_xlabel('Z-Score (σ)', fontsize=11, fontweight='bold')
    ax3.set_ylabel('Frequency', fontsize=11, fontweight='bold')
    ax3.set_title('Z-Score Distribution', fontsize=12, fontweight='bold')
    ax3.legend(fontsize=9)
    ax3.grid(True, alpha=0.3)

    # 2.4: Volume vs Price Scatter
    ax4 = axes[1, 1]
    scatter = ax4.scatter(df['volume'], df['close'],
                         c=df['vol_zscore'], cmap='RdYlGn_r',
                         s=50, alpha=0.6, edgecolors='black', linewidths=0.3)

    # Colorbar
    cbar = plt.colorbar(scatter, ax=ax4)
    cbar.set_label('Z-Score', fontsize=10, fontweight='bold')

    # Highlight anomalies
    if len(anomalies) > 0:
        ax4.scatter(anomalies['volume'], anomalies['close'],
                   s=150, marker='o', facecolors='none',
                   edgecolors='red', linewidths=2, label='Anomalies')

    ax4.set_xlabel('Volume', fontsize=11, fontweight='bold')
    ax4.set_ylabel('Close Price', fontsize=11, fontweight='bold')
    ax4.set_title('Volume vs Price (Colored by Z-Score)', fontsize=12, fontweight='bold')
    ax4.legend(fontsize=9)
    ax4.grid(True, alpha=0.3)

    plt.tight_layout()
    plot2_file = f"{base_filename}_volume_analysis.png"
    plt.savefig(plot2_file, dpi=150, bbox_inches='tight', facecolor='white')
    console.print(f"  [green]✓[/green] {plot2_file}")
    plt.close()

    # ============================================================================
    # PLOT 3: Order Flow Deep Dive
    # ============================================================================
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    # 3.1: Buy vs Sell Pressure
    ax1 = axes[0, 0]
    ax1.fill_between(df.index, df['buy_pressure'], 0,
                    color='green', alpha=0.5, label='Buying Pressure')
    ax1.fill_between(df.index, df['sell_pressure'], 0,
                    color='red', alpha=0.5, label='Selling Pressure')

    ax1.set_ylabel('Pressure', fontsize=11, fontweight='bold')
    ax1.set_title('Buy/Sell Pressure Over Time', fontsize=12, fontweight='bold')
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3)
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))

    # 3.2: OFI Distribution
    ax2 = axes[0, 1]
    ax2.hist(df['ofi'], bins=50, color='purple', alpha=0.7, edgecolor='black')
    ax2.axvline(x=0.6, color='green', linestyle='--', linewidth=2,
               label='Strong Buy (0.6)')
    ax2.axvline(x=0.4, color='red', linestyle='--', linewidth=2,
               label='Strong Sell (0.4)')
    ax2.axvline(x=df['ofi'].mean(), color='blue', linestyle='-',
               linewidth=2, label=f"Mean: {df['ofi'].mean():.3f}")

    ax2.set_xlabel('Order Flow Imbalance (0-1)', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Frequency', fontsize=11, fontweight='bold')
    ax2.set_title('OFI Distribution', fontsize=12, fontweight='bold')
    ax2.legend(fontsize=9)
    ax2.grid(True, alpha=0.3)

    # 3.3: Accumulation Score Timeline
    ax3 = axes[1, 0]
    ax3.plot(df.index, df['acc_score'], color='darkgreen', linewidth=2, alpha=0.8)
    ax3.fill_between(df.index, df['acc_score'], 60, where=(df['acc_score'] >= 60),
                    color='green', alpha=0.3)
    ax3.axhline(y=60, color='green', linestyle='--', linewidth=2)
    ax3.axhline(y=df['acc_score'].mean(), color='blue', linestyle='-',
               linewidth=2, label=f"Mean: {df['acc_score'].mean():.1f}")

    # Highlight accumulation zones
    accumulation_periods = df[df['acc_score'] >= 60]
    if len(accumulation_periods) > 0:
        ax3.fill_between(accumulation_periods.index, 60, accumulation_periods['acc_score'],
                        color='green', alpha=0.5, label='Accumulation Zone')

    ax3.set_xlabel('Time', fontsize=11, fontweight='bold')
    ax3.set_ylabel('Accumulation Score', fontsize=11, fontweight='bold')
    ax3.set_title('Institutional Accumulation Score', fontsize=12, fontweight='bold')
    ax3.legend(fontsize=9)
    ax3.grid(True, alpha=0.3)
    ax3.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))

    # 3.4: Accumulation Distribution
    ax4 = axes[1, 1]
    ax4.hist(df['acc_score'], bins=50, color='teal', alpha=0.7, edgecolor='black')
    ax4.axvline(x=60, color='green', linestyle='--', linewidth=2, label='Strong (60)')
    ax4.axvline(x=df['acc_score'].mean(), color='blue', linestyle='-',
               linewidth=2, label=f"Mean: {df['acc_score'].mean():.1f}")

    ax4.set_xlabel('Accumulation Score', fontsize=11, fontweight='bold')
    ax4.set_ylabel('Frequency', fontsize=11, fontweight='bold')
    ax4.set_title('Accumulation Score Distribution', fontsize=12, fontweight='bold')
    ax4.legend(fontsize=9)
    ax4.grid(True, alpha=0.3)

    plt.tight_layout()
    plot3_file = f"{base_filename}_order_flow.png"
    plt.savefig(plot3_file, dpi=150, bbox_inches='tight', facecolor='white')
    console.print(f"  [green]✓[/green] {plot3_file}")
    plt.close()

    # ============================================================================
    # PLOT 4: Price Analysis
    # ============================================================================
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    # Calculate returns
    df['returns'] = df['close'].pct_change() * 100
    df['price_range'] = ((df['high'] - df['low']) / df['low']) * 100

    # 4.1: Returns Distribution
    ax1 = axes[0, 0]
    ax1.hist(df['returns'].dropna(), bins=50, color='lightblue', alpha=0.7, edgecolor='black')
    ax1.axvline(x=0, color='black', linestyle='-', linewidth=1.5)
    ax1.axvline(x=df['returns'].mean(), color='red', linestyle='--',
               linewidth=2, label=f"Mean: {df['returns'].mean():.3f}%")

    ax1.set_xlabel('Returns (%)', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Frequency', fontsize=11, fontweight='bold')
    ax1.set_title('Price Returns Distribution', fontsize=12, fontweight='bold')
    ax1.legend(fontsize=9)
    ax1.grid(True, alpha=0.3)

    # 4.2: Returns Over Time
    ax2 = axes[0, 1]
    colors_returns = ['green' if r >= 0 else 'red' for r in df['returns']]
    ax2.bar(df.index, df['returns'], color=colors_returns, alpha=0.6, width=0.8)
    ax2.axhline(y=0, color='black', linestyle='-', linewidth=1)

    ax2.set_xlabel('Time', fontsize=11, fontweight='bold')
    ax2.set_ylabel('Returns (%)', fontsize=11, fontweight='bold')
    ax2.set_title('Returns Over Time', fontsize=12, fontweight='bold')
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))

    # 4.3: Price Range (Volatility)
    ax3 = axes[1, 0]
    ax3.plot(df.index, df['price_range'], color='orange', linewidth=2, alpha=0.8)
    ax3.fill_between(df.index, df['price_range'], color='orange', alpha=0.3)
    ax3.axhline(y=df['price_range'].mean(), color='red', linestyle='--',
               linewidth=2, label=f"Mean: {df['price_range'].mean():.2f}%")

    ax3.set_xlabel('Time', fontsize=11, fontweight='bold')
    ax3.set_ylabel('Price Range (%)', fontsize=11, fontweight='bold')
    ax3.set_title('Intraday Volatility (High-Low Range)', fontsize=12, fontweight='bold')
    ax3.legend(fontsize=9)
    ax3.grid(True, alpha=0.3)
    ax3.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))

    # 4.4: Price Range Distribution
    ax4 = axes[1, 1]
    ax4.hist(df['price_range'], bins=50, color='orange', alpha=0.7, edgecolor='black')
    ax4.axvline(x=df['price_range'].mean(), color='red', linestyle='--',
               linewidth=2, label=f"Mean: {df['price_range'].mean():.2f}%")

    ax4.set_xlabel('Price Range (%)', fontsize=11, fontweight='bold')
    ax4.set_ylabel('Frequency', fontsize=11, fontweight='bold')
    ax4.set_title('Volatility Distribution', fontsize=12, fontweight='bold')
    ax4.legend(fontsize=9)
    ax4.grid(True, alpha=0.3)

    plt.tight_layout()
    plot4_file = f"{base_filename}_price_analysis.png"
    plt.savefig(plot4_file, dpi=150, bbox_inches='tight', facecolor='white')
    console.print(f"  [green]✓[/green] {plot4_file}")
    plt.close()

    # ============================================================================
    # PLOT 5: Correlation Heatmap
    # ============================================================================
    fig, ax = plt.subplots(figsize=(12, 10))

    # Select numeric columns for correlation
    corr_cols = ['close', 'volume', 'vol_zscore', 'ofi', 'acc_score',
                 'buy_pressure', 'sell_pressure', 'returns', 'price_range']
    corr_df = df[corr_cols].copy()
    corr_matrix = corr_df.corr()

    # Create heatmap
    im = ax.imshow(corr_matrix, cmap='RdYlGn', aspect='auto', vmin=-1, vmax=1)

    # Set ticks
    ax.set_xticks(np.arange(len(corr_cols)))
    ax.set_yticks(np.arange(len(corr_cols)))
    ax.set_xticklabels(corr_cols, rotation=45, ha='right', fontsize=10)
    ax.set_yticklabels(corr_cols, fontsize=10)

    # Add colorbar
    cbar = plt.colorbar(im, ax=ax)
    cbar.set_label('Correlation Coefficient', fontsize=11, fontweight='bold')

    # Add correlation values
    for i in range(len(corr_cols)):
        for j in range(len(corr_cols)):
            text = ax.text(j, i, f'{corr_matrix.iloc[i, j]:.2f}',
                         ha="center", va="center", color="black", fontsize=9)

    ax.set_title('Correlation Matrix - Key Metrics', fontsize=14, fontweight='bold', pad=15)

    plt.tight_layout()
    plot5_file = f"{base_filename}_correlation.png"
    plt.savefig(plot5_file, dpi=150, bbox_inches='tight', facecolor='white')
    console.print(f"  [green]✓[/green] {plot5_file}")
    plt.close()

    # ============================================================================
    # PLOT 6: Trading Signal Summary
    # ============================================================================
    fig = plt.figure(figsize=(14, 10))
    gs = GridSpec(3, 3, figure=fig, hspace=0.3, wspace=0.3)

    # 6.1: Signal Gauge (simulated with pie chart)
    ax1 = fig.add_subplot(gs[0, 0])

    signal_colors = {'ENTER': '#2ecc71', 'WAIT': '#f39c12', 'AVOID': '#e74c3c'}
    signal_color = signal_colors.get(signal['action'], '#95a5a6')

    # Create gauge-like visualization
    wedges, texts = ax1.pie(
        [1], colors=[signal_color],
        startangle=90, counterclock=False,
        wedgeprops=dict(width=0.5, edgecolor='black', linewidth=2)
    )

    # Add signal text
    ax1.text(0.5, 0.5, signal['action'], ha='center', va='center',
            fontsize=14, fontweight='bold', transform=ax1.transAxes)
    ax1.text(0.5, 0.3, f"Confidence: {signal['confidence']}",
            ha='center', va='center', fontsize=9,
            transform=ax1.transAxes)

    ax1.set_title('TRADING SIGNAL', fontsize=12, fontweight='bold', pad=10)

    # 6.2: Distance to 52W
    ax2 = fig.add_subplot(gs[0, 1])

    dist_pct = context['distance_pct']
    colors_dist = ['green' if dist_pct < 3 else 'orange' if dist_pct < 5 else 'red']
    ax2.barh(['Distance to 52W'], [dist_pct], color=colors_dist, alpha=0.7, edgecolor='black')
    ax2.axvline(x=3, color='orange', linestyle='--', linewidth=2, label='Good (3%)')
    ax2.axvline(x=5, color='red', linestyle='--', linewidth=2, label='Far (5%)')

    ax2.set_xlabel('Distance (%)', fontsize=10, fontweight='bold')
    ax2.set_xlim(0, max(10, dist_pct * 1.2))
    ax2.legend(fontsize=9)
    ax2.set_title('52-WEEK HIGH PROXIMITY', fontsize=12, fontweight='bold')
    ax2.grid(True, alpha=0.3, axis='x')

    # 6.3: Key Metrics Summary
    ax3 = fig.add_subplot(gs[0, 2])
    ax3.axis('off')

    metrics_text = f"""
    KEY METRICS

    Current Price: ₹{df['close'].iloc[-1]:.2f}
    52-Week High: ₹{context['52w_high']:.2f}
    VWAP: ₹{df['vwap'].iloc[-1]:.2f}
    OFI: {df['ofi'].iloc[-1]:.3f}
    Acc Score: {df['acc_score'].iloc[-1]:.1f}

    Volume Anomalies: {df['is_anomaly'].sum()}
    Max Z-Score: {df['vol_zscore'].max():.1f}σ
    """

    ax3.text(0.1, 0.5, metrics_text, ha='left', va='center',
            fontsize=11, family='monospace',
            bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

    # 6.4: Signal Reasons
    ax4 = fig.add_subplot(gs[1:, :])
    ax4.axis('off')

    reasons_text = "SIGNAL REASONS:\n\n" + "\n".join([f"• {r}" for r in signal['reasons']])

    ax4.text(0.05, 0.95, reasons_text, ha='left', va='top',
            fontsize=12, family='monospace',
            bbox=dict(boxstyle='round', facecolor='lightblue', alpha=0.5),
            transform=ax4.transAxes)

    plt.suptitle(f'{symbol} - Trading Signal Summary', fontsize=16, fontweight='bold', y=0.98)

    plot6_file = f"{base_filename}_signal_summary.png"
    plt.savefig(plot6_file, dpi=150, bbox_inches='tight', facecolor='white')
    console.print(f"  [green]✓[/green] {plot6_file}")
    plt.close()

    console.print(f"\n[bold green]✅ All EDA plots saved to:[/bold green] {save_dir}/\n")

    return {
        'main_chart': plot1_file,
        'volume_analysis': plot2_file,
        'order_flow': plot3_file,
        'price_analysis': plot4_file,
        'correlation': plot5_file,
        'signal_summary': plot6_file
    }


def display_analysis(symbol: str, df: pd.DataFrame, big_orders: pd.DataFrame,
                     context: dict, signal: dict):
    """Display comprehensive analysis in Rich format."""

    console.print(f"\n[bold cyan]╔════════════════════════════════════════════════════════════╗[/bold cyan]")
    console.print(f"[bold cyan]║     INSTITUTIONAL ORDER FLOW ANALYSIS - {symbol:<18} ║[/bold cyan]")
    console.print(f"[bold cyan]╚════════════════════════════════════════════════════════════╝[/bold cyan]\n")

    # 1. 52W Context
    context_table = Table(title="📊 52-WEEK HIGH CONTEXT", box=box.ROUNDED)
    context_table.add_column("Metric", style="cyan")
    context_table.add_column("Value", justify="right")

    current_price = df['close'].iloc[-1]
    context_table.add_row("Current Price", f"₹{current_price:.2f}")
    context_table.add_row("52-Week High", f"₹{context['52w_high']:.2f}")
    context_table.add_row("Distance to 52W", f"{context['distance_pct']:.2f}%")
    context_table.add_row("Near 52W?", "✅ YES (<3%)" if context['is_near_52w'] else "❌ NO (>3%)")

    console.print(context_table)

    # 2. Entry Signal
    signal_color = {
        'ENTER': 'green',
        'WAIT': 'yellow',
        'AVOID': 'red'
    }.get(signal['action'], 'white')

    signal_panel = Panel(
        f"\n[bold {signal_color}]ACTION: {signal['action']}[/bold {signal_color}]\n"
        f"[bold]Confidence: {signal['confidence']}[/bold]\n\n"
        + "\n".join(signal['reasons']),
        title=f"🎯 TRADING SIGNAL",
        border_style=signal_color
    )
    console.print(signal_panel)

    # 3. Statistics
    stats_table = Table(title="📈 ORDER FLOW STATISTICS", box=box.ROUNDED)
    stats_table.add_column("Metric", style="cyan")
    stats_table.add_column("Value", justify="right")

    stats_table.add_row("Total Bars", f"{len(df):,}")
    stats_table.add_row("Avg Volume", f"{df['volume'].mean():,.0f}")
    stats_table.add_row("Max Volume", f"{df['volume'].max():,.0f}")
    stats_table.add_row("Volume Anomalies", f"{df['is_anomaly'].sum():,}")
    stats_table.add_row("Current VWAP", f"₹{df['vwap'].iloc[-1]:.2f}")
    stats_table.add_row("Current OFI", f"{df['ofi'].iloc[-1]:.3f}")
    stats_table.add_row("Max Accumulation Score", f"{df['acc_score'].max():.1f}")

    console.print(stats_table)

    # 4. Biggest Orders (Institutional Activity)
    if not big_orders.empty:
        orders_table = Table(title="🏛️  BIGGEST INSTITUTIONAL ORDERS (Top 10)", box=box.ROUNDED)
        orders_table.add_column("Time", style="cyan")
        orders_table.add_column("Price", justify="right")
        orders_table.add_column("Volume", justify="right")
        orders_table.add_column("Z-Score", justify="right")
        orders_table.add_column("OFI", justify="right")
        orders_table.add_column("Signal")
        orders_table.add_column("Acc Score", justify="right")

        for _, row in big_orders.iterrows():
            time_str = row['timestamp'].strftime('%Y-%m-%d %H:%M')
            price_str = f"₹{row['close']:.2f}"
            vol_str = f"{row['volume']:,.0f}"
            zscore_str = f"[bold red]{row['vol_zscore']:.1f}σ[/bold red]" if row['vol_zscore'] > 3 else f"{row['vol_zscore']:.1f}σ"
            ofi_str = f"{row['ofi']:.2f}"
            signal_str = row['ofi_signal']
            acc_str = f"[green]{row['acc_score']:.0f}[/green]" if row['acc_score'] > 50 else f"{row['acc_score']:.0f}"

            orders_table.add_row(time_str, price_str, vol_str, zscore_str, ofi_str, signal_str, acc_str)

        console.print(orders_table)
    else:
        console.print("[yellow]⚠️  No significant volume anomalies detected in the period.[/yellow]")

    # 5. Interpretation Guide
    guide = """
[bold cyan]📚 HOW TO INTERPRET:[/bold cyan]

• [bold green]Z-Score > 2.5[/bold green] = Volume spike (institutional order)
• [bold green]OFI > 0.6[/bold green] = Strong buying pressure (accumulation)
• [bold green]Acc Score > 60[/bold green] = High probability of institutional accumulation
• [bold green]Price > VWAP[/bold green] = Bulls in control
• [bold green]Consecutive bars[/bold green] = Sustained interest (not just one-off)

🎯 [bold]ENTRY STRATEGY:[/bold]
  1. Wait for ENTER signal with HIGH confidence
  2. Confirm price > VWAP
  3. Check for recent big orders (last 30-60 mins)
  4. Place stop loss at 2x ATR below entry
  5. Target = 52-week high

⚠️  [bold]RISK MANAGEMENT:[/bold]
  - If OFI drops below 0.5 = exit
  - If price falls below VWAP = caution
  - If no more volume anomalies = momentum faded

📊 [bold]EDA PLOTS GENERATED:[/bold]
  - Main chart: Price, Volume, VWAP, Order Flow
  - Volume Analysis: Distributions, Z-Scores
  - Order Flow: Buy/Sell pressure, OFI analysis
  - Price Analysis: Returns, Volatility
  - Correlation Matrix: All key metrics
  - Signal Summary: Trading signal visualized
    """
    console.print(Panel(guide, title="💡 INTERPRETATION GUIDE", border_style="cyan"))


def analyze_symbol(symbol: str, days: int = 5, min_volume: int = 50000):
    """
    Main analysis function for a single symbol.

    Args:
        symbol: Stock symbol (e.g., 'SUNDARMFIN')
        days: Number of days of 1-minute data to analyze
        min_volume: Minimum volume to consider as "big order"
    """

    console.print(f"[bold green]🔍 Analyzing {symbol} - Order Flow & Institutional Activity[/bold green]\n")

    # Initialize API
    try:
        api = TradingAPIFactory.create_from_config('upstox', quiet=True)
    except ValueError as e:
        console.print(f"[red]❌ {e}[/red]")
        return

    # Get instrument key first
    instrument_key = api.get_instrument_key(symbol)
    if not instrument_key:
        console.print(f"[red]❌ Symbol {symbol} not found in NSE instruments[/red]")
        return

    console.print(f"[dim]Instrument Key: {instrument_key}[/dim]")

    # Fetch 1-minute data
    # Note: Upstox API only provides 1-minute intraday data (today only)
    # For multi-day historical, use larger intervals
    try:
        if days == 1:
            # Fetch today's intraday data
            console.print(f"[dim]Fetching today's 1-minute intraday data...[/dim]\n")

            with console.status(f"[bold yellow]Fetching 1-minute intraday data for {symbol}...[/bold yellow]"):
                df = api.fetch_intraday_data_v3(
                    symbol=symbol,
                    interval='1'
                )
        else:
            # For multiple days, use 30-minute interval (historical API limitation)
            console.print(f"[yellow]⚠️  Note: Using 30-minute interval for {days} days (Upstox limitation)[/yellow]")
            console.print(f"[dim]For 1-minute data, use --days 1 (today only)[/dim]\n")

            to_date = datetime.now().strftime('%Y-%m-%d')
            from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

            with console.status(f"[bold yellow]Fetching {days} days of 30-minute data for {symbol}...[/bold yellow]"):
                df = api.fetch_historical_data_v3(
                    symbol=symbol,
                    unit='minutes',  # Note: plural 'minutes'
                    interval=30,  # 30-minute interval
                    from_date=from_date,
                    to_date=to_date
                )
    except Exception as e:
        console.print(f"[red]❌ Error fetching data: {str(e)[:100]}[/red]")
        return

    if df is None or df.empty:
        console.print(f"[red]❌ No data found for {symbol}[/red]")
        console.print(f"[dim]Tip: Try reducing --days parameter (current: {days})[/dim]")
        return

    # Determine actual interval for display
    interval_str = "1-minute" if days == 1 else "30-minute"

    if len(df) < 100:
        console.print(f"[yellow]⚠️  Only {len(df)} {interval_str} bars loaded (need at least 100 for analysis)[/yellow]")
        console.print(f"[dim]Tip: Try increasing --days parameter (current: {days})[/dim]")
        return

    console.print(f"[green]✅ Loaded {len(df):,} {interval_str} bars[/green]")

    if days > 1:
        trading_days_estimate = len(df) / 13  # ~13 bars per trading day for 30-min interval
        console.print(f"[dim]📊 Approximate trading days covered: {trading_days_estimate:.1f}[/dim]")
        console.print(f"[dim]   (Note: {interval_str} interval, ~13 bars per trading day)[/dim]\n")
    else:
        console.print("")

    # Add timestamp column for display
    df['timestamp'] = df.index

    # Display actual data received for verification
    console.print("[dim]═" * 60 + "[/dim]")
    console.print("[bold cyan]📋 DATA VERIFICATION[/bold cyan]\n")
    console.print(f"  [dim]First Candle:[/dim] {df.index[0]}")
    console.print(f"  [dim]Last Candle:[/dim]  {df.index[-1]}")
    console.print(f"  [dim]Total Bars:[/dim]    {len(df):,} {interval_str} candles")
    console.print(f"  [dim]Date Range:[/dim]    {(df.index[-1] - df.index[0]).days} calendar days")

    # Count unique trading days
    unique_dates = df.index.date
    if len(unique_dates) > 0:
        console.print(f"  [dim]Trading Days:[/dim]  {len(set(unique_dates))} unique days")

    # Check for gaps
    if len(df) > 1:
        time_diffs = df.index.to_series().diff()
        expected_diff = pd.Timedelta(minutes=1) if days == 1 else pd.Timedelta(minutes=30)
        gaps = time_diffs[time_diffs > expected_diff * 2]  # More than 2x expected = gap
        if len(gaps) > 0:
            console.print(f"  [yellow]⚠️  Gaps Detected:[/yellow] {len(gaps)} (weekends, holidays)")
        else:
            console.print(f"  [green]✅ No Gaps:[/green] Continuous data")

    console.print("\n[dim]Sample candles (first 3):[/dim]")
    for i in range(min(3, len(df))):
        row = df.iloc[i]
        console.print(f"  [dim][{row.name}][/dim] O:{row['open']:.2f} H:{row['high']:.2f} L:{row['low']:.2f} C:{row['close']:.2f} V:{row['volume']:,.0f}")

    console.print("\n[dim]" + "═" * 60 + "[/dim]\n")

    # 1. Calculate VWAP
    console.print("[cyan]📊 Calculating VWAP...[/cyan]")
    df['vwap'] = calculate_vwap(df)

    # 2. Detect volume anomalies (big orders)
    console.print("[cyan]📊 Detecting volume anomalies...[/cyan]")
    df = detect_volume_anomalies(df, window=20, threshold=2.5)

    # 3. Detect order blocks
    console.print("[cyan]📊 Detecting order blocks...[/cyan]")
    df = detect_order_blocks(df, min_size=min_volume)

    # 4. Calculate order flow imbalance
    console.print("[cyan]📊 Calculating order flow imbalance...[/cyan]")
    df = calculate_order_flow_imbalance(df)

    # 5. Detect institutional accumulation
    console.print("[cyan]📊 Analyzing accumulation patterns...[/cyan]")
    df = detect_institutional_accumulation(df, lookback=30)

    # 6. Find 52W context
    console.print("[cyan]📊 Checking 52-week high context...[/cyan]")
    current_price = df['close'].iloc[-1]
    context = find_52w_context(df, current_price)

    # 7. Analyze biggest orders
    console.print("[cyan]📊 Extracting biggest institutional orders...[/cyan]")
    big_orders = analyze_big_orders(df, top_n=10)

    # 8. Generate entry signal
    console.print("[cyan]📊 Generating trading signal...[/cyan]")
    signal = generate_entry_signal(df, context)

    # 9. Generate EDA visualizations
    console.print("\n[bold cyan]📈 Generating comprehensive EDA visualizations...[/bold cyan]\n")
    plot_files = create_comprehensive_eda(symbol, df, big_orders, context, signal, save_dir=".")

    # Display analysis
    display_analysis(symbol, df, big_orders, context, signal)

    console.print(f"\n[dim]Analysis completed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}[/dim]\n")


def main():
    parser = argparse.ArgumentParser(
        description="Institutional Order Flow Analysis for 52-Week High Breakout",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python analyze_order_flow_52w.py SUNDARMFIN
  python analyze_order_flow_52w.py SUNDARMFIN --days 7
  python analyze_order_flow_52w.py SUNDARMFIN --min-volume 100000
        """
    )

    parser.add_argument('symbol', type=str, help='Stock symbol (e.g., SUNDARMFIN)')
    parser.add_argument('--days', '-d', type=int, default=5,
                       help='Number of days to analyze (default: 5)')
    parser.add_argument('--min-volume', '-m', type=int, default=50000,
                       help='Minimum volume to consider as big order (default: 50000)')

    args = parser.parse_args()

    analyze_symbol(args.symbol.upper(), days=args.days, min_volume=args.min_volume)


if __name__ == "__main__":
    main()
