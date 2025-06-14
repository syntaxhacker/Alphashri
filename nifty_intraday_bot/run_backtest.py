#!/usr/bin/env python
"""
Nifty Intraday Bot - Backtest Runner

This script runs backtest for various intraday trading strategies on Nifty 50 data.
"""

import os
import pandas as pd
import numpy as np
# Set matplotlib backend before importing pyplot
import matplotlib
matplotlib.use('Agg')  # Use non-GUI backend to avoid Tkinter dependency
import matplotlib.pyplot as plt
import logging
import argparse
from datetime import datetime
import importlib
import json
from pathlib import Path
import matplotlib.dates as mdates

# Import strategies
from strategies import MovingAverageCrossover, RSIMeanReversion, BollingerBands

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("nifty_intraday_bot.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("backtest_runner")

def load_data(file_path):
    """
    Load data from CSV file and convert index to datetime.
    
    Args:
        file_path (str): Path to the CSV file
        
    Returns:
        pd.DataFrame: DataFrame with data
    """
    try:
        logger.info(f"Loading data from {file_path}")
        df = pd.read_csv(file_path)
        
        # Convert timestamp column to datetime and set as index if not already
        if 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df.set_index('timestamp', inplace=True)
        elif 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'])
            df.set_index('date', inplace=True)
            
        logger.info(f"Loaded {len(df)} rows of data from {df.index.min()} to {df.index.max()}")
        return df
    except Exception as e:
        logger.error(f"Error loading data: {str(e)}")
        raise

def visualize_results(results_df, strategy_name, output_dir):
    """
    Create enhanced visualizations of the backtest results with dark theme and candlestick charts.
    
    Args:
        results_df (pd.DataFrame): DataFrame with backtest results
        strategy_name (str): Name of the strategy
        output_dir (str): Directory to save visualizations
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Set up dark theme for matplotlib with customizations
    plt.style.use('dark_background')
    plt.rcParams['figure.facecolor'] = '#121212'
    plt.rcParams['axes.facecolor'] = '#1e1e1e'
    plt.rcParams['axes.edgecolor'] = '#444444'
    plt.rcParams['axes.labelcolor'] = '#ffffff'
    plt.rcParams['xtick.color'] = '#bbbbbb'
    plt.rcParams['ytick.color'] = '#bbbbbb'
    plt.rcParams['grid.color'] = '#333333'
    plt.rcParams['lines.linewidth'] = 1.5
    
    # Create figure with 4 subplots - price, indicators, position, and equity
    fig = plt.figure(figsize=(16, 20))
    
    # Define the grid layout for our plots - price chart takes most space
    gs = plt.GridSpec(4, 1, height_ratios=[3, 1, 1, 2], figure=fig, hspace=0.15)
    
    # Price chart with candlesticks
    ax_price = fig.add_subplot(gs[0])
    
    # Create candlestick chart
    width = 0.6
    width2 = 0.1
    
    # Calculate the date ranges to properly space candlesticks
    dates = mdates.date2num(results_df.index.to_pydatetime())
    
    # Create candlestick chart
    up = results_df['close'] > results_df['open']
    down = results_df['close'] <= results_df['open']
    
    # Plot up candles - using a brighter green
    ax_price.bar(dates[up], results_df['high'][up] - results_df['low'][up], width=width2, bottom=results_df['low'][up], color='#00e676', zorder=3)
    ax_price.bar(dates[up], results_df['close'][up] - results_df['open'][up], width=width, bottom=results_df['open'][up], color='#00e676', zorder=3)
    
    # Plot down candles - using a brighter red
    ax_price.bar(dates[down], results_df['high'][down] - results_df['low'][down], width=width2, bottom=results_df['low'][down], color='#ff5252', zorder=3)
    ax_price.bar(dates[down], results_df['open'][down] - results_df['close'][down], width=width, bottom=results_df['close'][down], color='#ff5252', zorder=3)
    
    # Get buy signals with improved visualization
    buy_signals = results_df[results_df['signal'] == 1]
    if not buy_signals.empty:
        buy_dates = mdates.date2num(buy_signals.index.to_pydatetime())
        ax_price.scatter(buy_dates, buy_signals['low'] * 0.998, marker='^', color='#00ff00', s=140, 
                         label='Buy Signal', zorder=5, edgecolors='#ffffff', linewidth=1)
        
        # Add annotations for significant buy signals (just showing first few)
        for i, (idx, row) in enumerate(buy_signals.head(3).iterrows()):
            ax_price.annotate(f'Buy\n${row["close"]:.2f}', 
                             (mdates.date2num(idx.to_pydatetime()), row['low'] * 0.996),
                             xytext=(0, -30), textcoords='offset points',
                             arrowprops=dict(arrowstyle='->', color='#ffffff', alpha=0.7),
                             color='#ffffff', fontsize=9, ha='center', backgroundcolor='#00800080')
    
    # Get sell signals with improved visualization
    sell_signals = results_df[results_df['signal'] == -1]
    if not sell_signals.empty:
        sell_dates = mdates.date2num(sell_signals.index.to_pydatetime())
        ax_price.scatter(sell_dates, sell_signals['high'] * 1.002, marker='v', color='#ff0000', s=140, 
                       label='Sell Signal', zorder=5, edgecolors='#ffffff', linewidth=1)
        
        # Add annotations for significant sell signals (just showing first few)
        for i, (idx, row) in enumerate(sell_signals.head(3).iterrows()):
            ax_price.annotate(f'Sell\n${row["close"]:.2f}', 
                             (mdates.date2num(idx.to_pydatetime()), row['high'] * 1.004),
                             xytext=(0, 20), textcoords='offset points',
                             arrowprops=dict(arrowstyle='->', color='#ffffff', alpha=0.7),
                             color='#ffffff', fontsize=9, ha='center', backgroundcolor='#80000080')
    
    # Add strategy-specific indicators if they exist
    # Moving Averages with improved colors
    if 'SMA_20' in results_df.columns and 'SMA_50' in results_df.columns:
        ax_price.plot(dates, results_df['SMA_20'], '--', color='#ffab40', linewidth=2, label='SMA 20', zorder=4)
        ax_price.plot(dates, results_df['SMA_50'], '--', color='#ea80fc', linewidth=2, label='SMA 50', zorder=4)
    
    # Bollinger Bands with improved colors and transparency
    if 'BB_upper' in results_df.columns and 'BB_lower' in results_df.columns:
        ax_price.plot(dates, results_df['BB_upper'], '-', color='#ff1744', linewidth=2, label='Upper Band', alpha=0.8, zorder=4)
        ax_price.plot(dates, results_df['BB_middle'], '-', color='#2979ff', linewidth=2, label='Middle Band', alpha=0.8, zorder=4)
        ax_price.plot(dates, results_df['BB_lower'], '-', color='#00e676', linewidth=2, label='Lower Band', alpha=0.8, zorder=4)
        
        # Add shaded region between bands
        ax_price.fill_between(dates, results_df['BB_lower'], results_df['BB_upper'], color='#4a4a4a', alpha=0.15)
    
    # Format price chart
    ax_price.set_title(f'{strategy_name} - Candlestick Chart with Signals', fontsize=18, color='white', fontweight='bold', pad=20)
    ax_price.set_ylabel('Price', fontsize=14, color='white', fontweight='bold')
    ax_price.grid(True, alpha=0.2, linestyle='--')
    ax_price.legend(loc='upper left', framealpha=0.8, facecolor='#2c2c2c', edgecolor='#444444')
    
    # Format dates on x-axis
    ax_price.xaxis_date()
    ax_price.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
    
    # Technical indicator subplot
    ax_indicator = fig.add_subplot(gs[1], sharex=ax_price)
    
    # Add RSI if available with improved visualization
    if 'RSI' in results_df.columns:
        ax_indicator.plot(dates, results_df['RSI'], color='#2979ff', linewidth=2, label='RSI')
        ax_indicator.axhline(y=70, color='#ff1744', linestyle='--', alpha=0.7, linewidth=1.5)
        ax_indicator.axhline(y=30, color='#00e676', linestyle='--', alpha=0.7, linewidth=1.5)
        ax_indicator.fill_between(dates, 70, results_df['RSI'], where=(results_df['RSI'] > 70), 
                                 color='#ff174480', alpha=0.5, label='Overbought')
        ax_indicator.fill_between(dates, 30, results_df['RSI'], where=(results_df['RSI'] < 30), 
                                 color='#00e67680', alpha=0.5, label='Oversold')
        ax_indicator.set_ylabel('RSI', fontsize=14, color='white', fontweight='bold')
        ax_indicator.set_ylim(0, 100)
        ax_indicator.text(dates[0], 75, 'Overbought', color='#ff1744', fontsize=10)
        ax_indicator.text(dates[0], 25, 'Oversold', color='#00e676', fontsize=10)
    # Or MACD if available with improved visualization
    elif 'MACD' in results_df.columns:
        ax_indicator.plot(dates, results_df['MACD'], color='#2979ff', linewidth=2, label='MACD')
        ax_indicator.plot(dates, results_df['MACD_signal'], color='#ff1744', linewidth=2, label='Signal')
        # More vibrant colors for histogram
        hist_colors = ['#00e676' if x > 0 else '#ff1744' for x in results_df['MACD_hist']]
        ax_indicator.bar(dates, results_df['MACD_hist'], color=hist_colors, alpha=0.7, width=0.6)
        ax_indicator.set_ylabel('MACD', fontsize=14, color='white', fontweight='bold')
        
        # Add zero line
        ax_indicator.axhline(y=0, color='#888888', linestyle='-', alpha=0.5, linewidth=1)
    
    ax_indicator.set_title('Technical Indicator', fontsize=16, color='white', fontweight='bold')
    ax_indicator.grid(True, alpha=0.2, linestyle='--')
    ax_indicator.legend(loc='upper left', framealpha=0.8, facecolor='#2c2c2c', edgecolor='#444444')
    
    # Position chart with clearer visualization
    ax_position = fig.add_subplot(gs[2], sharex=ax_price)
    ax_position.step(dates, results_df['position'], where='post', color='#2979ff', linewidth=2.5, label='Position')
    
    # Add shading for active positions
    ax_position.fill_between(dates, 0, results_df['position'], step='post', alpha=0.3, color='#2979ff')
    
    ax_position.set_title('Position', fontsize=16, color='white', fontweight='bold')
    ax_position.set_ylabel('Position', fontsize=14, color='white', fontweight='bold')
    ax_position.set_yticks([0, 1])
    ax_position.set_yticklabels(['No Position', 'Long'])
    ax_position.grid(True, alpha=0.2, linestyle='--')
    
    # Equity curve with drawdown overlay - improved visualization
    ax_equity = fig.add_subplot(gs[3], sharex=ax_price)
    
    # Plot initial capital as a horizontal line
    if 'initial_capital' in results_df.columns:
        initial_capital = results_df['initial_capital'].iloc[0]
        ax_equity.axhline(y=initial_capital, color='#888888', linestyle='--', alpha=0.7, linewidth=1.5, label='Initial Capital')
    
    # Plot equity curve with improved styling
    ax_equity.plot(dates, results_df['total_value'], color='#00e676', linewidth=2.5, label='Portfolio Value')
    
    # Calculate and plot the drawdown with better visualization
    if 'drawdown' in results_df.columns:
        ax_equity_twin = ax_equity.twinx()
        ax_equity_twin.fill_between(dates, 0, results_df['drawdown'] * 100, color='#ff1744', alpha=0.3, label='Drawdown')
        ax_equity_twin.set_ylabel('Drawdown (%)', color='#ff5252', fontsize=14, fontweight='bold')
        ax_equity_twin.tick_params(axis='y', colors='#ff5252')
        
        # Set reasonable y-limit and add better tick marks
        max_dd = max(results_df['drawdown'] * 100)
        ax_equity_twin.set_ylim(0, max(5, max_dd * 1.5 + 1))  # At least show 0-5% range
        
        # Add reference lines for drawdown
        if max_dd > 5:
            ax_equity_twin.axhline(y=5, color='#ff5252', linestyle='--', alpha=0.3, linewidth=1)
            ax_equity_twin.axhline(y=10, color='#ff5252', linestyle='--', alpha=0.3, linewidth=1)
            ax_equity_twin.axhline(y=15, color='#ff5252', linestyle='--', alpha=0.3, linewidth=1)
    
    ax_equity.set_title('Equity Curve', fontsize=16, color='white', fontweight='bold')
    ax_equity.set_ylabel('Portfolio Value', fontsize=14, color='white', fontweight='bold')
    ax_equity.grid(True, alpha=0.2, linestyle='--')
    ax_equity.legend(loc='upper left', framealpha=0.8, facecolor='#2c2c2c', edgecolor='#444444')
    
    # Add performance metrics in an improved text box
    if hasattr(results_df, 'metrics') or ('metrics' in dir() and isinstance(metrics, dict)):
        metrics = results_df.metrics if hasattr(results_df, 'metrics') else metrics
        
        # Color format metrics based on positive/negative values
        total_return_color = '#00e676' if metrics['total_return'] >= 0 else '#ff5252'
        annual_return_color = '#00e676' if metrics['annualized_return'] >= 0 else '#ff5252'
        sharpe_color = '#00e676' if metrics['sharpe_ratio'] >= 1 else ('#ffab40' if metrics['sharpe_ratio'] >= 0 else '#ff5252')
        
        metrics_text = (
            f"Total Return: {metrics['total_return']:.2f}%\n"
            f"Annualized Return: {metrics['annualized_return']:.2f}%\n"
            f"Sharpe Ratio: {metrics['sharpe_ratio']:.2f}\n"
            f"Max Drawdown: {metrics['max_drawdown']:.2f}%\n"
            f"Win Rate: {metrics['win_rate']:.2f}%\n"
            f"Profit Factor: {metrics['profit_factor']:.2f}\n"
            f"Total Trades: {metrics['num_trades']}"
        )
        
        # Add text box with metrics to the equity plot
        props = dict(boxstyle='round,pad=1', facecolor='#212121', alpha=0.9, edgecolor='#555555')
        ax_equity.text(0.02, 0.97, metrics_text, transform=ax_equity.transAxes, fontsize=12,
                    verticalalignment='top', horizontalalignment='left', bbox=props, color='white')
        
        # Add color-coded result summary at the top of the chart
        result_text = f"STRATEGY RESULT: "
        if metrics['total_return'] >= 5:
            result_text += "STRONG PROFIT"
            result_color = '#00e676'
        elif metrics['total_return'] > 0:
            result_text += "PROFIT"
            result_color = '#00c853'
        elif metrics['total_return'] > -3:
            result_text += "SMALL LOSS"
            result_color = '#ffab40'
        else:
            result_text += "SIGNIFICANT LOSS"
            result_color = '#ff5252'
            
        fig.text(0.5, 0.985, result_text, ha='center', va='top', fontsize=16, 
                 color=result_color, fontweight='bold',
                 bbox=dict(boxstyle='round,pad=0.5', facecolor='#212121', alpha=0.9, edgecolor=result_color))
    
    # Format x-axis for all subplots
    for ax in [ax_price, ax_indicator, ax_position, ax_equity]:
        ax.tick_params(axis='x', rotation=45)
        ax.tick_params(axis='both', colors='#bbbbbb')
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['bottom'].set_color('#444444')
        ax.spines['left'].set_color('#444444')
        
    # Adjust layout
    plt.tight_layout()
    
    # Add watermark
    fig.text(0.99, 0.01, 'Nifty Intraday Bot', ha='right', va='bottom', 
             color='#555555', fontsize=10, fontstyle='italic')
    
    # Save the figure with higher DPI for better quality
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_path = os.path.join(output_dir, f"{strategy_name.replace(' ', '_')}_{timestamp}.png")
    plt.savefig(file_path, dpi=300, bbox_inches='tight', facecolor='#121212')
    logger.info(f"Saved visualization to {file_path}")
    
    plt.close(fig)

def save_results(results_df, trades_df, metrics, strategy_name, output_dir):
    """
    Save backtest results to CSV and JSON files.
    
    Args:
        results_df (pd.DataFrame): DataFrame with backtest results
        trades_df (pd.DataFrame): DataFrame with trade details
        metrics (dict): Dictionary with performance metrics
        strategy_name (str): Name of the strategy
        output_dir (str): Directory to save results
    """
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save backtest results to CSV
    results_path = os.path.join(output_dir, f"{strategy_name.replace(' ', '_')}_results_{timestamp}.csv")
    results_df.to_csv(results_path)
    logger.info(f"Saved backtest results to {results_path}")
    
    # Save trades to CSV
    if not trades_df.empty:
        trades_path = os.path.join(output_dir, f"{strategy_name.replace(' ', '_')}_trades_{timestamp}.csv")
        trades_df.to_csv(trades_path)
        logger.info(f"Saved trade details to {trades_path}")
    
    # Save metrics to JSON
    metrics_path = os.path.join(output_dir, f"{strategy_name.replace(' ', '_')}_metrics_{timestamp}.json")
    
    # Convert any non-serializable objects to strings
    serializable_metrics = {}
    for key, value in metrics.items():
        if isinstance(value, (int, float, str, bool, list, dict)) or value is None:
            serializable_metrics[key] = value
        else:
            serializable_metrics[key] = str(value)
    
    with open(metrics_path, 'w') as f:
        json.dump(serializable_metrics, f, indent=4)
    logger.info(f"Saved performance metrics to {metrics_path}")

def run_backtest(data_file, strategy, output_dir, initial_capital=100000, position_size=0.1, commission=0.001):
    """
    Run a backtest for a given strategy on the provided data.
    
    Args:
        data_file (str): Path to the data file
        strategy (StrategyBase): Strategy instance to backtest
        output_dir (str): Directory to save results
        initial_capital (float): Initial capital for the backtest
        position_size (float): Fraction of capital to use per trade
        commission (float): Commission per trade as a fraction
        
    Returns:
        dict: Dictionary with backtest metrics
    """
    try:
        # Load data
        df = load_data(data_file)
        
        # Run backtest
        logger.info(f"Running backtest for {strategy.name}")
        results = strategy.backtest(df, initial_capital=initial_capital, 
                                  position_size=position_size, commission=commission)
        
        # Get trade summary
        trades_df = strategy.get_trades_summary()
        
        # Create visualization
        visualize_results(results, strategy.name, os.path.join(output_dir, 'visualizations'))
        
        # Save results
        save_results(results, trades_df, strategy.metrics, 
                   strategy.name, os.path.join(output_dir, 'backtest_results'))
        
        logger.info(f"Backtest completed for {strategy.name}")
        return strategy.metrics
        
    except Exception as e:
        logger.error(f"Error running backtest: {str(e)}", exc_info=True)
        return None

def run_multiple_strategies(data_file, strategies, output_dir, **kwargs):
    """
    Run backtests for multiple strategies and compare results.
    
    Args:
        data_file (str): Path to the data file
        strategies (list): List of strategy instances to backtest
        output_dir (str): Directory to save results
        **kwargs: Additional arguments for the backtest
    """
    results = []
    
    for strategy in strategies:
        logger.info(f"Testing {strategy.name}")
        metrics = run_backtest(data_file, strategy, output_dir, **kwargs)
        if metrics:
            results.append({
                'strategy': strategy.name,
                'metrics': metrics
            })
    
    # Create comparison report
    if results:
        comparison_df = pd.DataFrame([
            {
                'Strategy': r['strategy'],
                'Total Return (%)': r['metrics']['total_return'],
                'Annualized Return (%)': r['metrics']['annualized_return'],
                'Sharpe Ratio': r['metrics']['sharpe_ratio'],
                'Max Drawdown (%)': r['metrics']['max_drawdown'],
                'Win Rate (%)': r['metrics']['win_rate'],
                'Profit Factor': r['metrics']['profit_factor'],
                'Number of Trades': r['metrics']['num_trades']
            }
            for r in results
        ])
        
        # Sort by total return
        comparison_df = comparison_df.sort_values('Total Return (%)', ascending=False)
        
        # Save comparison to CSV
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        comparison_path = os.path.join(output_dir, f"strategy_comparison_{timestamp}.csv")
        comparison_df.to_csv(comparison_path, index=False)
        logger.info(f"Saved strategy comparison to {comparison_path}")
        
        # Print comparison table
        logger.info("\nStrategy Comparison:")
        logger.info(comparison_df.to_string())
        
        return comparison_df
    
    return None

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Nifty Intraday Bot - Backtest Runner')
    
    parser.add_argument('--data-file', type=str, required=True,
                      help='Path to the data file')
    
    parser.add_argument('--strategy', type=str, choices=['ma_crossover', 'rsi', 'bollinger', 'all'],
                      default='all', help='Strategy to test')
    
    parser.add_argument('--output-dir', type=str, default='nifty_intraday_bot/results',
                      help='Directory to save results')
    
    parser.add_argument('--initial-capital', type=float, default=100000,
                      help='Initial capital for the backtest')
    
    parser.add_argument('--position-size', type=float, default=0.1,
                      help='Fraction of capital to use per trade (0.0-1.0)')
    
    parser.add_argument('--commission', type=float, default=0.001,
                      help='Commission per trade as a fraction (e.g., 0.001 for 0.1%)')
    
    return parser.parse_args()

def main():
    """Main function to run the backtest"""
    # Parse command line arguments
    args = parse_args()
    
    # Ensure output directory exists
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Print backtest settings
    logger.info("Nifty Intraday Bot - Backtest Runner")
    logger.info("=====================================")
    logger.info(f"Data file: {args.data_file}")
    logger.info(f"Strategy: {args.strategy}")
    logger.info(f"Output directory: {args.output_dir}")
    logger.info(f"Initial capital: {args.initial_capital}")
    logger.info(f"Position size: {args.position_size}")
    logger.info(f"Commission: {args.commission}")
    logger.info("=====================================")
    
    # Create strategies based on the argument
    strategies = []
    
    if args.strategy in ['ma_crossover', 'all']:
        # Create multiple MA crossover strategies with different parameters
        strategies.extend([
            MovingAverageCrossover(5, 20, name="MA_Crossover_5_20"),
            MovingAverageCrossover(10, 30, name="MA_Crossover_10_30"),
            MovingAverageCrossover(20, 50, name="MA_Crossover_20_50")
        ])
    
    if args.strategy in ['rsi', 'all']:
        # Create RSI strategies with different parameters
        strategies.extend([
            RSIMeanReversion(14, 30, 70, name="RSI_14_30_70"),
            RSIMeanReversion(7, 20, 80, name="RSI_7_20_80"),
            RSIMeanReversion(21, 35, 65, name="RSI_21_35_65")
        ])
    
    if args.strategy in ['bollinger', 'all']:
        # Create Bollinger Band strategies with different parameters
        strategies.extend([
            BollingerBands(20, 2.0, 'mean_reversion', name="BB_MeanRev_20_2.0"),
            BollingerBands(20, 2.0, 'breakout', name="BB_Breakout_20_2.0"),
            BollingerBands(10, 1.5, 'mean_reversion', name="BB_MeanRev_10_1.5")
        ])
    
    # Check if we have valid strategies
    if not strategies:
        logger.error(f"No valid strategies specified")
        return
    
    # Run backtests
    start_time = datetime.now()
    logger.info(f"Starting backtests at {start_time}")
    
    # Run all selected strategies and compare results
    comparison = run_multiple_strategies(
        args.data_file,
        strategies,
        args.output_dir,
        initial_capital=args.initial_capital,
        position_size=args.position_size,
        commission=args.commission
    )
    
    end_time = datetime.now()
    duration = end_time - start_time
    
    logger.info(f"All backtests completed at {end_time}")
    logger.info(f"Total duration: {duration}")

if __name__ == "__main__":
    main() 