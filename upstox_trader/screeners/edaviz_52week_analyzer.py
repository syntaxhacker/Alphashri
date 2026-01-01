#!/usr/bin/env python3
"""
52-Week High Strategy - Exceptional EDA & Visualizer
======================================================
Deep analysis of:
1. Days taken to reach 52W level
2. Velocity of approach (how fast)
3. Trend scores at entry
4. Correlation with trade outcomes
5. Optimal entry timing visualization
"""

import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import time

# Add project root
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_project_root_dir = os.path.dirname(os.path.dirname(_current_file_dir))
if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.express as px

console = Console()


def calculate_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate all technical indicators for EDA"""

    # ATR
    high_low = df['high'] - df['low']
    high_close = abs(df['high'] - df['close'].shift())
    low_close = abs(df['low'] - df['close'].shift())
    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    df['atr'] = true_range.rolling(window=14).mean()

    # 52-week high
    df['52w_high'] = df['high'].rolling(window=252, min_periods=100).max().shift(1)

    # Distance to 52W
    df['distance_to_52w_pct'] = ((df['52w_high'] - df['close']) / df['close']) * 100

    # ADX
    tr1 = df['high'] - df['low']
    tr2 = abs(df['high'] - df['close'].shift(1))
    tr3 = abs(df['low'] - df['close'].shift(1))
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    plus_dm = df['high'].diff()
    minus_dm = -df['low'].diff()
    plus_dm[plus_dm < 0] = 0
    minus_dm[minus_dm < 0] = 0

    atr = tr.rolling(window=14).mean()
    plus_di = 100 * (plus_dm.rolling(window=14).mean() / atr)
    minus_di = 100 * (minus_dm.rolling(window=14).mean() / atr)

    dx = 100 * abs(plus_di - minus_di) / (plus_di + minus_di)
    df['adx'] = dx.rolling(window=14).mean()
    df['plus_di'] = plus_di
    df['minus_di'] = minus_di

    # RSI
    delta = df['close'].diff()
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)
    avg_gain = gain.ewm(span=14, adjust=False).mean()
    avg_loss = loss.ewm(span=14, adjust=False).mean()
    rs = avg_gain / avg_loss
    df['rsi'] = 100 - (100 / (1 + rs))

    # Moving averages
    df['ma_20'] = df['close'].rolling(window=20).mean()
    df['ma_50'] = df['close'].rolling(window=50).mean()
    df['ma_200'] = df['close'].rolling(window=200).mean()

    # Volume
    df['vol_avg'] = df['volume'].rolling(window=20).mean()
    df['vol_ratio'] = df['volume'] / df['vol_avg']

    # Price momentum (velocity)
    df['price_momentum_5'] = df['close'].pct_change(5) * 100
    df['price_momentum_10'] = df['close'].pct_change(10) * 100
    df['price_momentum_20'] = df['close'].pct_change(20) * 100

    # Bollinger Bands
    df['bb_middle'] = df['close'].rolling(window=20).mean()
    bb_std = df['close'].rolling(window=20).std()
    df['bb_upper'] = df['bb_middle'] + (bb_std * 2)
    df['bb_lower'] = df['bb_middle'] - (bb_std * 2)
    df['bb_width'] = ((df['bb_upper'] - df['bb_lower']) / df['bb_middle']) * 100

    # Trend Score (0-100)
    # Combines ADX, RSI, MA alignment, Volume
    df['trend_score'] = (
        (df['adx'] / 50 * 25) +  # ADX up to 50 gets 25 points
        ((df['rsi'] - 30) / 40 * 25) +  # RSI 30-70 gets 25 points
        (np.where(df['close'] > df['ma_20'], 1, 0) * 10) +  # Above MA20
        (np.where(df['close'] > df['ma_50'], 1, 0) * 10) +  # Above MA50
        (np.where(df['close'] > df['ma_200'], 1, 0) * 10) +  # Above MA200
        (np.where(df['adx'] > 25, 1, 0) * 10) +  # Strong trend
        (np.where(df['vol_ratio'] > 1.5, 1, 0) * 10)  # Volume confirmation
    )
    df['trend_score'] = df['trend_score'].clip(0, 100)

    # Days since 52W high
    df['days_since_52w'] = None
    for i in range(len(df)):
        current_52w = df.iloc[i]['52w_high']
        if pd.isna(current_52w):
            continue
        first_idx = None
        for j in range(i, max(0, i - 252), -1):
            if df.iloc[j]['high'] >= current_52w * 0.999:
                first_idx = j
                break
        if first_idx is not None:
            df.iloc[i, df.columns.get_loc('days_since_52w')] = i - first_idx

    return df


def analyze_52w_behavior(ticker: str, days: int = 730) -> Dict:
    """
    Analyze how stock behaves around 52-week high levels
    Returns detailed EDA data
    """

    console.print(f"\n[cyan]🔍 Analyzing {ticker}...[/cyan]")

    screener = TVScreenerUsage(enable_paper_trading=False)

    # Fetch data
    from_date = (datetime.now() - timedelta(days=days + 500)).strftime('%Y-%m-%d')
    to_date = datetime.now().strftime('%Y-%m-%d')

    df = screener.upstox_api.fetch_historical_data_v3(
        symbol=ticker,
        unit="days",
        interval=1,
        from_date=from_date,
        to_date=to_date
    )

    if df is None or len(df) < 500:
        return None

    # Calculate all indicators
    df = calculate_all_indicators(df)

    # Filter to backtest period
    backtest_start = (datetime.now() - timedelta(days=days)).date()
    df = df[df.index.date >= backtest_start]

    # Find all approaches to 52W (within 5%)
    approaches = []

    for i in range(len(df)):
        row = df.iloc[i]
        distance = row['distance_to_52w_pct']

        # Only consider when within 5% of 52W
        if pd.isna(distance) or distance > 5 or distance < 0:
            continue

        # Track forward - did it reach 52W within 30 days?
        reached_52w = False
        days_to_reach = None
        max_profit_pct = 0
        max_loss_pct = 0

        for j in range(i + 1, min(i + 31, len(df))):
            future_row = df.iloc[j]
            profit_pct = ((future_row['high'] - row['close']) / row['close']) * 100
            loss_pct = ((future_row['low'] - row['close']) / row['close']) * 100

            max_profit_pct = max(max_profit_pct, profit_pct)
            max_loss_pct = min(max_loss_pct, loss_pct)

            if future_row['high'] >= row['52w_high'] * 0.999:
                reached_52w = True
                days_to_reach = j - i
                break

        approaches.append({
            'date': row.name,
            'close': row['close'],
            '52w_high': row['52w_high'],
            'distance_pct': distance,
            'days_since_52w': row['days_since_52w'],
            'trend_score': row['trend_score'],
            'adx': row['adx'],
            'rsi': row['rsi'],
            'vol_ratio': row['vol_ratio'],
            'price_momentum_5': row['price_momentum_5'],
            'price_momentum_10': row['price_momentum_10'],
            'price_momentum_20': row['price_momentum_20'],
            'above_ma20': row['close'] > row['ma_20'],
            'above_ma50': row['close'] > row['ma_50'],
            'above_ma200': row['close'] > row['ma_200'],
            'reached_52w': reached_52w,
            'days_to_reach': days_to_reach,
            'max_profit_pct': max_profit_pct,
            'max_loss_pct': max_loss_pct,
            'bb_width': row['bb_width']
        })

    if not approaches:
        return None

    # Convert to DataFrame
    eda_df = pd.DataFrame(approaches)

    # Analysis
    total_approaches = len(eda_df)
    successful = eda_df[eda_df['reached_52w']]
    success_rate = (len(successful) / total_approaches * 100) if total_approaches > 0 else 0

    avg_days_to_reach = successful['days_to_reach'].mean() if len(successful) > 0 else 0

    # Correlation analysis
    correlations = {
        'trend_score': eda_df['trend_score'].corr(eda_df['reached_52w'].astype(int)),
        'adx': eda_df['adx'].corr(eda_df['reached_52w'].astype(int)),
        'distance_pct': eda_df['distance_pct'].corr(eda_df['reached_52w'].astype(int)),
        'vol_ratio': eda_df['vol_ratio'].corr(eda_df['reached_52w'].astype(int)),
        'momentum_5': eda_df['price_momentum_5'].corr(eda_df['reached_52w'].astype(int)),
        'bb_width': eda_df['bb_width'].corr(eda_df['reached_52w'].astype(int))
    }

    return {
        'ticker': ticker,
        'eda_df': eda_df,
        'total_approaches': total_approaches,
        'successful_approaches': len(successful),
        'success_rate': success_rate,
        'avg_days_to_reach': avg_days_to_reach,
        'correlations': correlations,
        'df': df  # Full data with indicators
    }


def create_eda_visualizations(eda_results: List[Dict], save_path: str = None):
    """
    Create comprehensive EDA visualizations
    """

    if not eda_results:
        console.print("[red]No EDA results to visualize![/red]")
        return

    # Combine all data
    all_approaches = []
    for result in eda_results:
        df = result['eda_df'].copy()
        df['ticker'] = result['ticker']
        all_approaches.append(df)

    combined_df = pd.concat(all_approaches, ignore_index=True)

    # Create subplots
    fig = make_subplots(
        rows=3, cols=2,
        subplot_titles=(
            'Success Rate by Distance to 52W',
            'Days to Reach 52W Distribution',
            'Trend Score vs Success',
            'ADX vs Success Rate',
            'Volume Ratio Impact',
            'Price Momentum (5D) Effect'
        ),
        specs=[[{"type": "bar"}, {"type": "histogram"}],
               [{"type": "scatter"}, {"type": "bar"}],
               [{"type": "bar"}, {"type": "scatter"}]],
        vertical_spacing=0.12,
        horizontal_spacing=0.15
    )

    # 1. Success Rate by Distance
    distance_bins = pd.cut(combined_df['distance_pct'], bins=[0, 1, 2, 3, 4, 5])
    success_by_distance = combined_df.groupby(distance_bins, observed=True).apply(
        lambda x: (x['reached_52w'].sum() / len(x) * 100) if len(x) > 0 else 0
    )

    fig.add_trace(
        go.Bar(x=[str(x) for x in success_by_distance.index],
               y=success_by_distance.values,
               marker_color='green',
               name='Success %'),
        row=1, col=1
    )

    # 2. Days to Reach Distribution
    successful_trades = combined_df[combined_df['reached_52w']]
    if len(successful_trades) > 0:
        fig.add_trace(
            go.Histogram(x=successful_trades['days_to_reach'],
                        nbinsx=20,
                        marker_color='blue',
                        name='Days Distribution'),
            row=1, col=2
        )

    # 3. Trend Score vs Success
    trend_bins = pd.cut(combined_df['trend_score'], bins=10)
    success_by_trend = combined_df.groupby(trend_bins, observed=True).apply(
        lambda x: (x['reached_52w'].sum() / len(x) * 100) if len(x) > 0 else 0
    )

    fig.add_trace(
        go.Bar(x=[str(x) for x in success_by_trend.index],
               y=success_by_trend.values,
               marker_color='purple',
               name='Trend Score'),
        row=2, col=1
    )

    # 4. ADX vs Success Rate
    adx_bins = pd.cut(combined_df['adx'], bins=[0, 20, 25, 30, 40, 100])
    success_by_adx = combined_df.groupby(adx_bins, observed=True).apply(
        lambda x: (x['reached_52w'].sum() / len(x) * 100) if len(x) > 0 else 0
    )

    fig.add_trace(
        go.Bar(x=[str(x) for x in success_by_adx.index],
               y=success_by_adx.values,
               marker_color='orange',
               name='ADX'),
        row=2, col=2
    )

    # 5. Volume Ratio Impact
    vol_bins = pd.cut(combined_df['vol_ratio'], bins=[0, 0.8, 1.0, 1.2, 1.5, 2.0, 5.0])
    success_by_vol = combined_df.groupby(vol_bins, observed=True).apply(
        lambda x: (x['reached_52w'].sum() / len(x) * 100) if len(x) > 0 else 0
    )

    fig.add_trace(
        go.Bar(x=[str(x) for x in success_by_vol.index],
               y=success_by_vol.values,
               marker_color='cyan',
               name='Volume'),
        row=3, col=1
    )

    # 6. Price Momentum Scatter
    momentum_success = combined_df.groupby(
        pd.cut(combined_df['price_momentum_5'], bins=10), observed=True
    ).apply(lambda x: (x['reached_52w'].sum() / len(x) * 100) if len(x) > 0 else 0)

    fig.add_trace(
        go.Bar(x=[str(x) for x in momentum_success.index],
               y=momentum_success.values,
               marker_color='magenta',
               name='Momentum'),
        row=3, col=2
    )

    # Update layout
    fig.update_layout(
        height=1200,
        width=1600,
        title_text="<b>52-Week High Strategy - EDA Dashboard</b><br>" +
                  f"Analyzing {len(eda_results)} stocks | {len(combined_df)} total approaches",
        showlegend=False,
        title_font_size=16
    )

    fig.update_xaxes(title_text="Distance to 52W %", row=1, col=1)
    fig.update_yaxes(title_text="Success Rate %", row=1, col=1)
    fig.update_xaxes(title_text="Days", row=1, col=2)
    fig.update_yaxes(title_text="Count", row=1, col=2)
    fig.update_xaxes(title_text="Trend Score", row=2, col=1)
    fig.update_yaxes(title_text="Success Rate %", row=2, col=1)
    fig.update_xaxes(title_text="ADX", row=2, col=2)
    fig.update_yaxes(title_text="Success Rate %", row=2, col=2)
    fig.update_xaxes(title_text="Volume Ratio", row=3, col=1)
    fig.update_yaxes(title_text="Success Rate %", row=3, col=1)
    fig.update_xaxes(title_text="5D Momentum %", row=3, col=2)
    fig.update_yaxes(title_text="Success Rate %", row=3, col=2)

    # Save
    if save_path:
        fig.write_html(save_path)
        console.print(f"[green]✅ Visualization saved to {save_path}[/green]")

    return fig


def create_stock_trajectory_viz(eda_result: Dict, save_path: str = None):
    """
    Create visual trajectory of stock approaching 52W
    Shows actual price action with entry points and outcomes
    """

    df = eda_result['df']
    approaches = eda_result['eda_df']
    ticker = eda_result['ticker']

    fig = go.Figure()

    # Price
    fig.add_trace(go.Scatter(
        x=df.index,
        y=df['close'],
        mode='lines',
        name='Close Price',
        line=dict(color='blue', width=1)
    ))

    # 52W High
    fig.add_trace(go.Scatter(
        x=df.index,
        y=df['52w_high'],
        mode='lines',
        name='52-Week High',
        line=dict(color='red', width=2, dash='dash')
    ))

    # Entry points (approaches)
    successful = approaches[approaches['reached_52w']]
    failed = approaches[~approaches['reached_52w']]

    if len(successful) > 0:
        fig.add_trace(go.Scatter(
            x=successful['date'],
            y=successful['close'],
            mode='markers',
            name='Successful Entry',
            marker=dict(color='green', size=10, symbol='triangle-up'),
            text=successful.apply(lambda x: f"Days: {x['days_to_reach']}, Trend: {x['trend_score']:.0f}", axis=1),
            hoverinfo='text+x+y'
        ))

    if len(failed) > 0:
        fig.add_trace(go.Scatter(
            x=failed['date'],
            y=failed['close'],
            mode='markers',
            name='Failed Entry',
            marker=dict(color='red', size=10, symbol='x'),
            text=failed.apply(lambda x: f"Trend: {x['trend_score']:.0f}, ADX: {x['adx']:.0f}", axis=1),
            hoverinfo='text+x+y'
        ))

    fig.update_layout(
        title=f"<b>{ticker} - 52-Week High Approaches</b><br>" +
              f"Success Rate: {eda_result['success_rate']:.1f}% | " +
              f"Avg Days to Reach: {eda_result['avg_days_to_reach']:.1f}",
        xaxis_title='Date',
        yaxis_title='Price',
        hovermode='closest',
        height=600,
        template='plotly_dark'
    )

    if save_path:
        fig.write_html(save_path)
        console.print(f"[green]✅ Trajectory saved to {save_path}[/green]")

    return fig


def print_eda_summary(eda_results: List[Dict]):
    """Print comprehensive EDA summary"""

    console.print("\n[bold cyan]╔════════════════════════════════════════════════════════════╗[/bold cyan]")
    console.print("[bold cyan]║       52-WEEK HIGH STRATEGY - EXCEPTIONAL EDA            ║[/bold cyan]")
    console.print("[bold cyan]╚════════════════════════════════════════════════════════════╝[/bold cyan]\n")

    # Overall stats
    total_approaches = sum(r['total_approaches'] for r in eda_results)
    total_successful = sum(r['successful_approaches'] for r in eda_results)
    overall_success_rate = (total_successful / total_approaches * 100) if total_approaches > 0 else 0

    console.print(f"[bold yellow]📊 OVERALL STATISTICS[/bold yellow]")
    console.print(f"  Total Approaches to 52W: {total_approaches}")
    console.print(f"  Successful (reached 52W): {total_successful}")
    console.print(f"  Failed: {total_approaches - total_successful}")
    console.print(f"  Overall Success Rate: [bold cyan]{overall_success_rate:.2f}%[/bold cyan]")

    # Average correlations
    all_correlations = {}
    for key in eda_results[0]['correlations'].keys():
        values = [r['correlations'][key] for r in eda_results if not pd.isna(r['correlations'][key])]
        if values:
            all_correlations[key] = np.mean(values)

    console.print(f"\n[bold yellow]🔗 FACTOR CORRELATIONS WITH SUCCESS[/bold yellow]")
    for factor, corr in sorted(all_correlations.items(), key=lambda x: abs(x[1]), reverse=True):
        strength = "Strong" if abs(corr) > 0.3 else ("Moderate" if abs(corr) > 0.15 else "Weak")
        color = "green" if corr > 0 else "red"
        console.print(f"  {factor:20s}: [{color}]{corr:+.3f}[/{color}] ({strength})")

    # Per-stock summary
    console.print(f"\n[bold yellow]📈 PER-STOCK ANALYSIS[/bold yellow]\n")

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Ticker", style="cyan")
    table.add_column("Approaches", justify="right")
    table.add_column("Success Rate", justify="right", style="green")
    table.add_column("Avg Days to 52W", justify="right")
    table.add_column("Best Factor", style="yellow")

    for r in eda_results:
        # Find best correlated factor
        best_factor = max(r['correlations'].items(), key=lambda x: abs(x[1]))

        table.add_row(
            r['ticker'],
            str(r['total_approaches']),
            f"{r['success_rate']:.1f}%",
            f"{r['avg_days_to_reach']:.1f}",
            f"{best_factor[0]} ({best_factor[1]:+.2f})"
        )

    console.print(table)

    # Key insights
    console.print(f"\n[bold yellow]💡 KEY INSIGHTS[/bold yellow]")

    if all_correlations.get('distance_pct', 0) < -0.2:
        console.print(f"  ✅ Closer to 52W = Higher success (consider entering at 2-3% instead of 5%)")

    if all_correlations.get('trend_score', 0) > 0.2:
        console.print(f"  ✅ Trend Score strongly predicts success - use strict filters!")

    if all_correlations.get('adx', 0) > 0.15:
        console.print(f"  ✅ ADX matters - strong trends lead to breakouts")

    if all_correlations.get('vol_ratio', 0) > 0.1:
        console.print(f"  ✅ Volume confirmation improves odds")

    avg_days = np.mean([r['avg_days_to_reach'] for r in eda_results if r['avg_days_to_reach'] > 0])
    console.print(f"  ⏱️  Average time to reach 52W: {avg_days:.1f} days")

    console.print()


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="52-Week High Strategy - EDA & Visualization"
    )
    parser.add_argument('--symbol', '-s', type=str,
                       default='EICHERMOT,BAJFINANCE,HAVELLS,TVSMOTOR,LT',
                       help='Comma-separated symbols to analyze')
    parser.add_argument('--days', '-d', type=int, default=730,
                       help='Analysis period in days')
    parser.add_argument('--output', '-o', type=str, default='52w_eda_dashboard.html',
                       help='Output HTML file for visualizations')

    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbol.split(',')]

    console.print("[bold cyan]Starting EDA Analysis...[/bold cyan]")

    # Analyze each stock
    eda_results = []
    for symbol in symbols:
        try:
            result = analyze_52w_behavior(symbol, args.days)
            if result:
                eda_results.append(result)
                console.print(f"[green]✅ {symbol}: {result['total_approaches']} approaches, "
                           f"{result['success_rate']:.1f}% success rate[/green]")
            time.sleep(1)
        except Exception as e:
            console.print(f"[red]Error analyzing {symbol}: {e}[/red]")
            continue

    if not eda_results:
        console.print("[red]No EDA results generated![/red]")
        return

    # Print summary
    print_eda_summary(eda_results)

    # Create visualizations
    console.print("\n[cyan]📊 Creating visualizations...[/cyan]")

    # Main dashboard
    dashboard_path = args.output
    create_eda_visualizations(eda_results, save_path=dashboard_path)

    # Individual stock trajectories
    for result in eda_results:
        ticker = result['ticker']
        trajectory_path = f"52w_trajectory_{ticker}.html"
        create_stock_trajectory_viz(result, save_path=trajectory_path)

    console.print(f"\n[bold green]✨ EDA Complete! Open {dashboard_path} in browser to view visualizations[/bold green]\n")


if __name__ == "__main__":
    main()
