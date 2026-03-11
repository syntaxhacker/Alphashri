#!/usr/bin/env python3
"""
Historical Sector Cycle Analyzer - Multi-Year Cycle Detection

Uses Upstox API to fetch historical price data and identify cyclical patterns
in Indian market sectors over multiple years. Detects cycles using FFT, wavelets,
and time-series analysis to predict future sector rotation.

Features:
- Fetches 3-5 years of historical data for sector representatives
- Detects cyclical periods (12-month, 6-month, quarterly cycles)
- Visualizes sector performance timelines
- Predicts next cycle entry/exit points
- Generates comprehensive EDA visualizations

Author: EDA Tool
Date: 2026-01-02
"""

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import warnings

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.gridspec import GridSpec
import seaborn as sns

# Time series analysis
from scipy import signal
from scipy.fft import fft, fftfreq
from scipy.stats import pearsonr
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

# Add project root to path
_script_dir = Path(__file__).parent
_project_root = _script_dir.parent
sys.path.insert(0, str(_project_root))

from upstox_trader.config_and_utils.free_indian_apis import TradingAPIFactory
from tradingview_screener import Query, Column

# Set style
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")
warnings.filterwarnings('ignore')


# Define sector representatives (major stocks representing each sector)
SECTOR_REPRESENTATIVES = {
    'Finance': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK'],
    'Technology': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LTIM'],
    'Energy': ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'TATAPOWER'],
    'Automotive': ['TATAMOTORS', 'MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT'],
    'Pharma': ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'AUROPHARMA', 'DIVISLAB'],
    'Consumer Durables': ['TITAN', 'WHIRLPOOL', 'VOLTAS', 'BLUESTAR', 'HAVELLS'],
    'Infrastructure': ['LT', 'DLF', 'ADANIPORTS', 'BHARTIARTL', 'ABB'],
    'Metals & Mining': ['TATASTEEL', 'HINDALCO', 'JSWSTEEL', 'COALINDIA', 'NMDC'],
    'FMCG': ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR'],
    'Healthcare': ['APOLLOHOSP', 'MAXHEALTH', 'FORTIS', 'LANCER', 'GLENMARK'],
    'Telecom': ['RELIANCE', 'BHARTIARTL', 'VODAFONEIDEA'],
    'Chemicals': ['PIIND', 'SRF', 'DEEPAKNTR', 'NAUKRICO', 'TATACHEM'],
    'Oil & Gas': ['RELIANCE', 'ONGC', 'GAIL', 'BPCL', 'IOC'],
    'Power': ['NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIPOWER', 'JSWENERGY'],
    'Real Estate': ['DLF', 'GODREJPROP', 'BRIGADE', 'OBEROIRLTY', 'PHOENIXLTD']
}


class HistoricalSectorCycleAnalyzer:
    """Analyze multi-year sector cycles using historical price data."""

    def __init__(self, years: int = 3, provider: str = 'upstox'):
        """
        Initialize the analyzer.

        Args:
            years: Number of years of historical data to analyze
            provider: API provider ('upstox' or 'indmoney')
        """
        self.years = years
        self.provider = provider
        self.api = None
        self.sector_data = {}
        self.cycle_patterns = {}
        self.predictions = {}

    def initialize_api(self):
        """Initialize the trading API."""
        print(f"🔌 Initializing {self.provider.upper()} API...")
        try:
            self.api = TradingAPIFactory.create_from_config(
                self.provider,
                quiet=True
            )
            print(f"✅ {self.provider.upper()} API initialized")
            return True
        except Exception as e:
            print(f"❌ Failed to initialize API: {e}")
            return False

    def fetch_historical_data_for_sectors(self) -> bool:
        """
        Fetch historical data for all sector representatives.

        Returns:
            True if successful
        """
        if not self.api:
            if not self.initialize_api():
                return False

        print(f"\n📊 Fetching {self.years} years of historical data...")
        print("This may take several minutes...\n")

        # Calculate date range
        to_date = datetime.now()
        from_date = to_date - timedelta(days=self.years * 365)

        from_date_str = from_date.strftime('%Y-%m-%d')
        to_date_str = to_date.strftime('%Y-%m-%d')

        total_stocks = sum(len(v) for v in SECTOR_REPRESENTATIVES.values())
        fetched_count = 0

        for sector, symbols in SECTOR_REPRESENTATIVES.items():
            print(f"  📈 Processing {sector}...")

            sector_dfs = []
            sector_stats = []

            for symbol in symbols:
                try:
                    # Fetch historical daily data using V3 API
                    df = self.api.fetch_historical_data_v3(
                        symbol=symbol,
                        unit='days',
                        interval=1,
                        from_date=from_date_str,
                        to_date=to_date_str
                    )

                    if df is not None and not df.empty:
                        # Clean data
                        df = df[['open', 'high', 'low', 'close', 'volume']].copy()
                        df = df.dropna()

                        if len(df) > 100:  # Minimum data requirement
                            # Calculate returns
                            df['daily_return'] = df['close'].pct_change() * 100
                            df['cumulative_return'] = ((df['close'] / df['close'].iloc[0]) - 1) * 100

                            # Calculate rolling metrics
                            df['ma_50'] = df['close'].rolling(window=50).mean()
                            df['ma_200'] = df['close'].rolling(window=200).mean()
                            df['volatility_20'] = df['daily_return'].rolling(window=20).std()

                            # Store stats
                            stats = {
                                'symbol': symbol,
                                'total_return': df['cumulative_return'].iloc[-1],
                                'avg_daily_return': df['daily_return'].mean(),
                                'volatility': df['daily_return'].std(),
                                'max_drawdown': self._calculate_max_drawdown(df['close']),
                                'sharpe': self._calculate_sharpe_ratio(df['daily_return']),
                                'data_points': len(df)
                            }

                            sector_dfs.append(df)
                            sector_stats.append(stats)
                            fetched_count += 1

                            if fetched_count % 10 == 0:
                                print(f"    Progress: {fetched_count}/{total_stocks} stocks fetched")

                except Exception as e:
                    print(f"    ⚠️  Failed to fetch {symbol}: {e}")
                    continue

            if sector_dfs:
                # Combine sector data
                self.sector_data[sector] = {
                    'dataframes': sector_dfs,
                    'stats': sector_stats,
                    'symbols': [s['symbol'] for s in sector_stats]
                }
                print(f"    ✅ {sector}: {len(sector_dfs)} stocks fetched")
            else:
                print(f"    ❌ {sector}: No data fetched")

        print(f"\n✅ Fetched data for {len(self.sector_data)} sectors")
        return len(self.sector_data) > 0

    def _calculate_max_drawdown(self, price_series: pd.Series) -> float:
        """Calculate maximum drawdown."""
        cumulative = (1 + price_series.pct_change()).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = ((cumulative - running_max) / running_max) * 100
        return drawdown.min()

    def _calculate_sharpe_ratio(self, returns: pd.Series, risk_free_rate: float = 0.05) -> float:
        """Calculate annualized Sharpe ratio."""
        if len(returns) < 2 or returns.std() == 0:
            return 0.0
        excess_returns = returns.mean() - risk_free_rate / 252
        return (excess_returns / returns.std()) * np.sqrt(252)

    def analyze_sector_cycles(self):
        """
        Analyze cyclical patterns in sector performance.

        Uses FFT, autocorrelation, and seasonal decomposition.
        """
        print("\n🔄 Analyzing cyclical patterns...")

        for sector, data in self.sector_data.items():
            print(f"  🔍 {sector}...")

            # Aggregate sector performance
            sector_returns = self._aggregate_sector_returns(data['dataframes'])

            if sector_returns is None or len(sector_returns) < 252:
                continue

            # Detect cycles
            cycle_info = self._detect_cycles(sector_returns)

            # Calculate sector momentum phases
            phases = self._calculate_sector_phases(sector_returns)

            # Store results
            self.cycle_patterns[sector] = {
                'returns': sector_returns,
                'cycle_info': cycle_info,
                'phases': phases,
                'stats': self._calculate_sector_stats(data['stats'], sector_returns)
            }

        print(f"✅ Analyzed {len(self.cycle_patterns)} sectors for cycles")

    def _aggregate_sector_returns(self, dataframes: List[pd.DataFrame]) -> Optional[pd.Series]:
        """Aggregate returns across all stocks in a sector."""
        if not dataframes:
            return None

        # Align all dataframes on common dates
        common_index = dataframes[0].index
        for df in dataframes[1:]:
            common_index = common_index.intersection(df.index)

        if len(common_index) < 100:
            return None

        # Calculate average cumulative return
        returns_list = []
        for df in dataframes:
            aligned_df = df.reindex(common_index)
            aligned_df['cum_return'] = ((aligned_df['close'] / aligned_df['close'].iloc[0]) - 1) * 100
            returns_list.append(aligned_df['cum_return'])

        avg_returns = pd.concat(returns_list, axis=1).mean(axis=1)
        return avg_returns

    def _detect_cycles(self, returns: pd.Series) -> Dict:
        """
        Detect cyclical patterns using FFT and autocorrelation.

        Returns:
            Dict with cycle information
        """
        # Remove NaN values
        clean_returns = returns.dropna()
        n = len(clean_returns)

        if n < 100:
            return {}

        cycle_info = {}

        # 1. FFT Analysis
        fft_values = fft(clean_returns.values)
        fft_freq = fftfreq(n, d=1)  # Daily frequency

        # Get positive frequencies only
        positive_freq_idx = fft_freq > 0
        positive_freq = fft_freq[positive_freq_idx]
        positive_power = np.abs(fft_values[positive_freq_idx])

        # Find dominant frequencies
        top_5_idx = np.argsort(positive_power)[-5:][::-1]

        dominant_cycles = []
        for idx in top_5_idx:
            freq = positive_freq[idx]
            if freq > 0:
                period_days = 1 / freq
                period_months = period_days / 21  # ~21 trading days per month

                # Only consider cycles between 1 month and 2 years
                if 21 <= period_days <= 500:
                    dominant_cycles.append({
                        'period_days': period_days,
                        'period_months': period_months,
                        'power': positive_power[idx]
                    })

        cycle_info['fft_cycles'] = dominant_cycles[:3]  # Top 3 cycles

        # 2. Autocorrelation Analysis
        autocorr = [clean_returns.autocorr(lag=lag) for lag in range(1, 253)]
        autocorr_series = pd.Series(autocorr, index=range(1, 253))

        # Find peaks in autocorrelation
        peaks, _ = signal.find_peaks(autocorr_series, height=0.1)

        significant_lags = []
        for peak in peaks:
            if peak >= 20:  # Minimum 20 trading days
                significant_lags.append({
                    'lag_days': peak,
                    'lag_months': peak / 21,
                    'correlation': autocorr_series[peak]
                })

        cycle_info['autocorr_peaks'] = significant_lags[:3]

        # 3. Seasonal Decomposition (monthly returns)
        monthly_returns = clean_returns.resample('M').last()
        monthly_changes = monthly_returns.pct_change().dropna()

        if len(monthly_changes) >= 12:
            # Calculate average return by month
            monthly_returns_by_month = {}
            for i in range(12):
                month_data = monthly_changes[monthly_changes.index.month == i + 1]
                if len(month_data) > 0:
                    monthly_returns_by_month[i + 1] = month_data.mean()

            cycle_info['seasonal_pattern'] = monthly_returns_by_month

        return cycle_info

    def _calculate_sector_phases(self, returns: pd.Series) -> Dict:
        """
        Calculate momentum phases for the sector.

        Phases: Accumulation, Markup, Distribution, Markdown
        """
        current_return = returns.iloc[-1]
        recent_trend = returns.iloc[-63:] - returns.iloc[-126:-63] if len(returns) >= 126 else returns.iloc[-20:] - returns.iloc[-40:-20]

        volatility = returns.pct_change().dropna().std() * np.sqrt(252)

        # Determine phase
        if current_return > 20 and recent_trend.mean() > 5:
            phase = 'DISTRIBUTION'
            action = 'TAKE PROFITS'
        elif current_return > 0 and recent_trend.mean() > 0:
            phase = 'MARKUP'
            action = 'HOLD'
        elif current_return < -10:
            phase = 'MARKDOWN'
            action = 'ACCUMULATE'
        else:
            phase = 'ACCUMULATION'
            action = 'BUY'

        return {
            'current_phase': phase,
            'action': action,
            'current_return': current_return,
            'recent_trend': recent_trend.mean(),
            'volatility': volatility
        }

    def _calculate_sector_stats(self, stats_list: List[Dict], returns: pd.Series) -> Dict:
        """Calculate aggregated sector statistics."""
        return {
            'avg_total_return': np.mean([s['total_return'] for s in stats_list]),
            'best_performer': max(stats_list, key=lambda x: x['total_return']),
            'worst_performer': min(stats_list, key=lambda x: x['total_return']),
            'avg_volatility': np.mean([s['volatility'] for s in stats_list]),
            'avg_sharpe': np.mean([s['sharpe'] for s in stats_list]),
            'current_sector_return': returns.iloc[-1]
        }

    def predict_next_cycles(self):
        """
        Predict next cycle timing based on historical patterns.

        Uses detected cycles to forecast future performance phases.
        """
        print("\n🔮 Predicting next cycle timing...")

        for sector, pattern in self.cycle_patterns.items():
            cycle_info = pattern['cycle_info']
            current_phase = pattern['phases']['current_phase']
            current_return = pattern['phases']['current_return']

            prediction = {
                'sector': sector,
                'current_phase': current_phase,
                'current_return': current_return
            }

            # Use FFT cycles for prediction
            if 'fft_cycles' in cycle_info and cycle_info['fft_cycles']:
                dominant_cycle = cycle_info['fft_cycles'][0]
                cycle_period_days = dominant_cycle['period_days']

                # Estimate when the next peak will occur
                # Find recent peaks in returns
                returns = pattern['returns']
                peaks, _ = signal.find_peaks(returns, distance=int(cycle_period_days * 0.8))

                if len(peaks) > 0:
                    last_peak_date = returns.index[peaks[-1]]
                    days_since_peak = (returns.index[-1] - last_peak_date).days

                    next_peak_estimate = cycle_period_days - days_since_peak

                    prediction['dominant_cycle'] = {
                        'period_days': cycle_period_days,
                        'period_months': cycle_period_days / 21,
                        'last_peak': last_peak_date.strftime('%Y-%m-%d'),
                        'days_since_peak': days_since_peak,
                        'days_to_next_peak': int(next_peak_estimate)
                    }

            # Phase-based prediction
            if current_phase == 'DISTRIBUTION':
                prediction['next_phase'] = 'MARKDOWN'
                prediction['timeframe'] = '1-3 months'
                prediction['confidence'] = 'HIGH'
            elif current_phase == 'MARKUP':
                prediction['next_phase'] = 'DISTRIBUTION'
                prediction['timeframe'] = '2-4 months'
                prediction['confidence'] = 'MEDIUM'
            elif current_phase == 'MARKDOWN':
                prediction['next_phase'] = 'ACCUMULATION'
                prediction['timeframe'] = '2-6 months'
                prediction['confidence'] = 'HIGH'
            else:  # ACCUMULATION
                prediction['next_phase'] = 'MARKUP'
                prediction['timeframe'] = '1-4 months'
                prediction['confidence'] = 'MEDIUM-HIGH'

            self.predictions[sector] = prediction

        print(f"✅ Generated predictions for {len(self.predictions)} sectors")

    def create_visualizations(self, output_dir: str = 'historical_sector_cycles'):
        """
        Generate comprehensive visualizations.

        Args:
            output_dir: Directory to save images
        """
        print(f"\n📊 Generating visualizations in {output_dir}/...")

        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)

        # Generate plots
        self._plot_sector_performance_timeline(output_path)
        self._plot_sector_cycle_detection(output_path)
        self._plot_sector_phase_comparison(output_path)
        self._plot_cycle_periodogram(output_path)
        self._plot_seasonal_patterns(output_path)
        self._plot_sector_correlation_heatmap(output_path)
        self._plot_drawdown_analysis(output_path)
        self._plot_cycle_prediction_timeline(output_path)

        print(f"✅ Generated 8 visualizations in {output_path}/")
        return output_path

    def _plot_sector_performance_timeline(self, output_path: Path):
        """Plot cumulative returns over time for all sectors."""
        fig, ax = plt.subplots(figsize=(16, 10))

        for sector, pattern in self.cycle_patterns.items():
            returns = pattern['returns']
            ax.plot(returns.index, returns.values,
                   label=sector, linewidth=2, alpha=0.8)

        ax.axhline(y=0, color='black', linestyle='--', linewidth=1, alpha=0.5)
        ax.set_xlabel('Date', fontsize=12, fontweight='bold')
        ax.set_ylabel('Cumulative Return %', fontsize=12, fontweight='bold')
        ax.set_title(f'Sector Performance Timeline ({self.years} Years)',
                    fontsize=16, fontweight='bold', pad=20)
        ax.legend(loc='best', ncol=2)
        ax.grid(True, alpha=0.3)

        # Format x-axis
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
        plt.xticks(rotation=45)

        plt.tight_layout()
        plt.savefig(output_path / 'sector_performance_timeline.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_sector_cycle_detection(self, output_path: Path):
        """Plot detected cycles for each sector."""
        n_sectors = len(self.cycle_patterns)
        if n_sectors == 0:
            return

        fig, axes = plt.subplots(n_sectors, 1, figsize=(16, 4 * n_sectors))
        if n_sectors == 1:
            axes = [axes]

        for idx, (sector, pattern) in enumerate(self.cycle_patterns.items()):
            ax = axes[idx]
            returns = pattern['returns']

            # Plot returns
            ax.plot(returns.index, returns.values, label='Returns', linewidth=2)

            # Highlight detected cycles
            if 'fft_cycles' in pattern['cycle_info']:
                cycles = pattern['cycle_info']['fft_cycles']
                cycle_info_text = f"Detected Cycles: "
                for i, cycle in enumerate(cycles[:2]):
                    cycle_info_text += f"{cycle['period_months']:.1f}mo, "
                ax.text(0.02, 0.95, cycle_info_text[:-2],
                       transform=ax.transAxes, fontsize=10,
                       verticalalignment='top',
                       bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

            # Mark current phase
            phase = pattern['phases']['current_phase']
            action = pattern['phases']['action']
            phase_color = {'ACCUMULATION': 'blue', 'MARKUP': 'green',
                          'DISTRIBUTION': 'orange', 'MARKDOWN': 'red'}.get(phase, 'gray')

            ax.axhline(y=returns.iloc[-1], color=phase_color,
                      linestyle='--', linewidth=2, label=f'Current: {phase} ({action})')
            ax.axhline(y=0, color='black', linestyle=':', linewidth=1, alpha=0.5)

            ax.set_ylabel('Return %', fontsize=10, fontweight='bold')
            ax.set_title(f'{sector} - Cycle Detection', fontsize=12, fontweight='bold')
            ax.legend(loc='best', fontsize=8)
            ax.grid(True, alpha=0.3)

            if idx == n_sectors - 1:
                ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
                plt.setp(ax.xaxis.get_majorticklabels(), rotation=45)

        plt.tight_layout()
        plt.savefig(output_path / 'sector_cycle_detection.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_sector_phase_comparison(self, output_path: Path):
        """Compare sectors by current phase and performance."""
        fig, axes = plt.subplots(1, 2, figsize=(18, 8))

        # Phase distribution pie chart
        ax1 = axes[0]
        phase_counts = {}
        for pattern in self.cycle_patterns.values():
            phase = pattern['phases']['current_phase']
            phase_counts[phase] = phase_counts.get(phase, 0) + 1

        colors = {'ACCUMULATION': '#3498db', 'MARKUP': '#2ecc71',
                 'DISTRIBUTION': '#f39c12', 'MARKDOWN': '#e74c3c'}
        pie_colors = [colors.get(p, '#95a5a6') for p in phase_counts.keys()]

        wedges, texts, autotexts = ax1.pie(phase_counts.values(), labels=phase_counts.keys(),
                                            autopct='%1.1f%%', colors=pie_colors,
                                            startangle=90)
        for autotext in autotexts:
            autotext.set_fontsize(11)
            autotext.set_fontweight('bold')
        ax1.set_title('Current Sector Phase Distribution',
                     fontsize=14, fontweight='bold')

        # Return comparison by phase
        ax2 = axes[1]
        sectors_by_phase = {'ACCUMULATION': [], 'MARKUP': [],
                           'DISTRIBUTION': [], 'MARKDOWN': []}

        for sector, pattern in self.cycle_patterns.items():
            phase = pattern['phases']['current_phase']
            returns = pattern['phases']['current_return']
            sectors_by_phase[phase].append((sector, returns))

        y_pos = 0
        for phase in ['MARKDOWN', 'ACCUMULATION', 'MARKUP', 'DISTRIBUTION']:
            if sectors_by_phase[phase]:
                sectors = [s[0] for s in sectors_by_phase[phase]]
                returns = [s[1] for s in sectors_by_phase[phase]]

                ax2.barh([y_pos + i for i in range(len(sectors))], returns,
                        color=colors[phase], alpha=0.7, label=phase)
                y_pos += len(sectors) + 1

        ax2.axvline(x=0, color='black', linewidth=1)
        ax2.set_xlabel('Current Return %', fontsize=11, fontweight='bold')
        ax2.set_title('Sector Returns by Phase', fontsize=14, fontweight='bold')
        ax2.legend(loc='best')
        ax2.grid(axis='x', alpha=0.3)

        plt.tight_layout()
        plt.savefig(output_path / 'sector_phase_comparison.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_cycle_periodogram(self, output_path: Path):
        """Plot FFT periodogram showing dominant cycles."""
        n_sectors = len(self.cycle_patterns)
        if n_sectors == 0:
            return

        fig, axes = plt.subplots(2, 2, figsize=(18, 12))
        axes = axes.flatten()

        for idx, (sector, pattern) in enumerate(list(self.cycle_patterns.items())[:4]):
            if idx >= 4:
                break

            ax = axes[idx]
            returns = pattern['returns'].dropna()
            n = len(returns)

            # FFT
            fft_values = fft(returns.values)
            fft_freq = fftfreq(n, d=1)

            # Positive frequencies only
            positive_freq_idx = (fft_freq > 0) & (fft_freq < 0.1)  # Up to ~10 day cycles
            positive_freq = fft_freq[positive_freq_idx]
            positive_power = np.abs(fft_values[positive_freq_idx])

            # Convert to periods (in days)
            periods = 1 / positive_freq
            periods_months = periods / 21

            # Plot
            ax.plot(periods_months, positive_power, linewidth=2)
            ax.set_xlabel('Period (Months)', fontsize=10, fontweight='bold')
            ax.set_ylabel('Power', fontsize=10, fontweight='bold')
            ax.set_title(f'{sector} - Frequency Spectrum', fontsize=12, fontweight='bold')
            ax.grid(True, alpha=0.3)
            ax.set_xlim(0, 36)  # Show up to 3-year cycles

            # Mark dominant cycles
            if 'fft_cycles' in pattern['cycle_info'] and pattern['cycle_info']['fft_cycles']:
                for cycle in pattern['cycle_info']['fft_cycles'][:2]:
                    ax.axvline(x=cycle['period_months'], color='red',
                              linestyle='--', alpha=0.5, linewidth=2)

        plt.tight_layout()
        plt.savefig(output_path / 'cycle_periodogram.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_seasonal_patterns(self, output_path: Path):
        """Plot seasonal monthly return patterns."""
        fig, axes = plt.subplots(2, 1, figsize=(16, 12))

        # Aggregate monthly returns across all sectors
        all_monthly_returns = {}

        for sector, pattern in self.cycle_patterns.items():
            if 'seasonal_pattern' in pattern['cycle_info']:
                monthly_pattern = pattern['cycle_info']['seasonal_pattern']
                for month, ret in monthly_pattern.items():
                    if month not in all_monthly_returns:
                        all_monthly_returns[month] = []
                    all_monthly_returns[month].append(ret)

        # Calculate average monthly returns
        avg_monthly_returns = {}
        for month, returns_list in all_monthly_returns.items():
            avg_monthly_returns[month] = np.mean(returns_list)

        # Plot average monthly pattern
        ax1 = axes[0]
        months = list(range(1, 13))
        avg_returns = [avg_monthly_returns.get(m, 0) * 100 for m in months]  # Convert to %

        colors = ['green' if r > 0 else 'red' for r in avg_returns]
        ax1.bar(months, avg_returns, color=colors, alpha=0.7, edgecolor='black')
        ax1.axhline(y=0, color='black', linewidth=1)
        ax1.set_xlabel('Month', fontsize=11, fontweight='bold')
        ax1.set_ylabel('Average Return %', fontsize=11, fontweight='bold')
        ax1.set_title('Average Monthly Returns Across All Sectors',
                     fontsize=14, fontweight='bold')
        ax1.set_xticks(months)
        ax1.set_xticklabels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
        ax1.grid(axis='y', alpha=0.3)

        # Sector-wise monthly heatmap
        ax2 = axes[1]
        sector_monthly_data = []

        for sector, pattern in self.cycle_patterns.items():
            if 'seasonal_pattern' in pattern['cycle_info']:
                monthly_pattern = pattern['cycle_info']['seasonal_pattern']
                row = [monthly_pattern.get(m, 0) * 100 for m in months]
                sector_monthly_data.append([sector] + row)

        if sector_monthly_data:
            df_monthly = pd.DataFrame(sector_monthly_data,
                                      columns=['Sector'] + [str(m) for m in months])
            df_monthly = df_monthly.set_index('Sector')

            sns.heatmap(df_monthly, annot=True, fmt='.1f', cmap='RdYlGn',
                       center=0, cbar_kws={'label': 'Return %'},
                       linewidths=0.5, ax=ax2)
            ax2.set_title('Sector-wise Monthly Return Patterns',
                         fontsize=14, fontweight='bold')
            ax2.set_xlabel('Month', fontsize=11, fontweight='bold')

        plt.tight_layout()
        plt.savefig(output_path / 'seasonal_patterns.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_sector_correlation_heatmap(self, output_path: Path):
        """Plot correlation heatmap between sectors."""
        # Build returns matrix
        returns_data = {}

        for sector, pattern in self.cycle_patterns.items():
            returns = pattern['returns'].dropna()
            # Resample to monthly for correlation
            monthly_returns = returns.resample('M').last().pct_change().dropna()
            returns_data[sector] = monthly_returns

        if len(returns_data) < 2:
            return

        # Create aligned DataFrame
        df_returns = pd.DataFrame(returns_data)

        # Calculate correlation
        correlation = df_returns.corr()

        # Plot
        fig, ax = plt.subplots(figsize=(12, 10))

        sns.heatmap(correlation, annot=True, fmt='.2f', cmap='coolwarm',
                   center=0, vmin=-1, vmax=1,
                   cbar_kws={'label': 'Correlation'},
                   linewidths=0.5, ax=ax)
        ax.set_title('Sector Correlation Matrix (Monthly Returns)',
                    fontsize=16, fontweight='bold', pad=20)

        plt.tight_layout()
        plt.savefig(output_path / 'sector_correlation_heatmap.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_drawdown_analysis(self, output_path: Path):
        """Plot drawdown analysis for each sector."""
        fig, axes = plt.subplots(2, 1, figsize=(16, 12))

        # Drawdown timeline
        ax1 = axes[0]

        for sector, pattern in self.cycle_patterns.items():
            returns = pattern['returns']
            drawdown = self._calculate_drawdown_series(returns)
            ax1.fill_between(drawdown.index, drawdown.values, 0,
                            alpha=0.3, label=sector)

        ax1.set_xlabel('Date', fontsize=11, fontweight='bold')
        ax1.set_ylabel('Drawdown %', fontsize=11, fontweight='bold')
        ax1.set_title('Sector Drawdown Timeline', fontsize=14, fontweight='bold')
        ax1.legend(loc='best', ncol=2, fontsize=8)
        ax1.grid(True, alpha=0.3)

        # Max drawdown comparison
        ax2 = axes[1]
        sectors = []
        max_drawdowns = []

        for sector, pattern in self.cycle_patterns.items():
            stats = pattern['stats']
            worst = stats['worst_performer']
            sectors.append(f"{sector}\n({worst['symbol']})")
            max_drawdowns.append(worst['max_drawdown'])

        colors = ['red' if dd < -30 else 'orange' if dd < -15 else 'green'
                 for dd in max_drawdowns]
        ax2.barh(sectors, max_drawdowns, color=colors, alpha=0.7, edgecolor='black')
        ax2.axvline(x=-20, color='orange', linestyle='--', linewidth=2,
                   label='-20% threshold')
        ax2.axvline(x=0, color='black', linewidth=1)
        ax2.set_xlabel('Maximum Drawdown %', fontsize=11, fontweight='bold')
        ax2.set_title('Worst Performing Stock: Max Drawdown by Sector',
                     fontsize=14, fontweight='bold')
        ax2.legend(loc='best')
        ax2.grid(axis='x', alpha=0.3)

        plt.tight_layout()
        plt.savefig(output_path / 'drawdown_analysis.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def _calculate_drawdown_series(self, returns: pd.Series) -> pd.Series:
        """Calculate drawdown series from returns."""
        cumulative = (1 + returns / 100).cumprod()
        running_max = cumulative.expanding().max()
        drawdown = ((cumulative - running_max) / running_max) * 100
        return drawdown

    def _plot_cycle_prediction_timeline(self, output_path: Path):
        """Plot predicted cycle timeline."""
        fig, ax = plt.subplots(figsize=(16, 10))

        y_pos = 0
        sector_positions = []
        sector_colors = []

        for sector, prediction in self.predictions.items():
            current_phase = prediction['current_phase']
            current_return = prediction['current_return']

            # Color by phase
            phase_colors = {'ACCUMULATION': 'blue', 'MARKUP': 'green',
                           'DISTRIBUTION': 'orange', 'MARKDOWN': 'red'}
            color = phase_colors.get(current_phase, 'gray')

            # Plot current position
            ax.scatter(current_return, y_pos, s=200, color=color,
                      edgecolors='black', linewidth=2, zorder=3)

            # Add timeline arrow for prediction
            if 'dominant_cycle' in prediction:
                cycle_info = prediction['dominant_cycle']
                next_peak = cycle_info['days_to_next_peak']
                next_peak_months = next_peak / 21

                ax.annotate('',
                           xy=(current_return + 5, y_pos),
                           xytext=(current_return, y_pos),
                           arrowprops=dict(arrowstyle='->', lw=2, color=color))

                ax.text(current_return + 7, y_pos,
                       f"Next peak: ~{next_peak_months:.1f}mo",
                       fontsize=8, va='center')

            sector_positions.append(sector)
            sector_colors.append(color)
            y_pos += 1

        # Add phase legend
        from matplotlib.patches import Patch
        legend_elements = [Patch(facecolor='blue', label='Accumulation (BUY)'),
                          Patch(facecolor='green', label='Markup (HOLD)'),
                          Patch(facecolor='orange', label='Distribution (TAKE PROFITS)'),
                          Patch(facecolor='red', label='Markdown (ACCUMULATE)')]
        ax.legend(handles=legend_elements, loc='best', ncol=2)

        ax.axvline(x=0, color='black', linestyle='--', linewidth=1, alpha=0.5)
        ax.set_yticks(range(len(sector_positions)))
        ax.set_yticklabels(sector_positions)
        ax.set_xlabel('Cumulative Return %', fontsize=12, fontweight='bold')
        ax.set_title('Sector Cycle Predictions\n(Current Position → Expected Next Peak)',
                    fontsize=16, fontweight='bold', pad=20)
        ax.grid(axis='x', alpha=0.3)

        plt.tight_layout()
        plt.savefig(output_path / 'cycle_prediction_timeline.png',
                   dpi=300, bbox_inches='tight')
        plt.close()

    def export_data_for_dashboard(self, output_dir: str = 'historical_sector_cycles'):
        """
        Export data to JSON for D3 dashboard.

        Args:
            output_dir: Directory to save the JSON file

        Returns:
            Path to the generated JSON file
        """
        import json
        from datetime import datetime

        print(f"\n💾 Exporting data for D3 dashboard...")

        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)

        dashboard_data = {
            'metadata': {
                'generated_at': datetime.now().isoformat(),
                'analysis_period_years': self.years,
                'total_sectors': len(self.sector_data),
                'total_stocks': sum(len(v['dataframes']) for v in self.sector_data.values())
            },
            'sectors': []
        }

        for sector, pattern in self.cycle_patterns.items():
            # Convert returns series to list
            returns_data = pattern['returns'].reset_index()
            returns_data.columns = ['date', 'value']
            returns_list = []
            for _, row in returns_data.iterrows():
                returns_list.append({
                    'date': row['date'].strftime('%Y-%m-%d'),
                    'value': float(row['value'])
                })

            sector_data = {
                'name': sector,
                'current_phase': pattern['phases']['current_phase'],
                'action': pattern['phases']['action'],
                'current_return': float(pattern['phases']['current_return']),
                'volatility': float(pattern['phases']['volatility']) if not np.isnan(pattern['phases']['volatility']) else 0.0,
                'returns': returns_list,
                'stats': {
                    'avg_total_return': float(pattern['stats']['avg_total_return']),
                    'avg_volatility': float(pattern['stats']['avg_volatility']),
                    'avg_sharpe': float(pattern['stats']['avg_sharpe']),
                    'best_performer': pattern['stats']['best_performer']['symbol'],
                    'best_return': float(pattern['stats']['best_performer']['total_return']),
                    'worst_performer': pattern['stats']['worst_performer']['symbol'],
                    'worst_return': float(pattern['stats']['worst_performer']['total_return'])
                }
            }

            # Add cycle info
            if 'fft_cycles' in pattern['cycle_info'] and pattern['cycle_info']['fft_cycles']:
                sector_data['cycles'] = []
                for cycle in pattern['cycle_info']['fft_cycles'][:3]:
                    sector_data['cycles'].append({
                        'period_days': float(cycle['period_days']),
                        'period_months': float(cycle['period_months']),
                        'power': float(cycle['power'])
                    })

            # Add prediction
            if sector in self.predictions:
                pred = self.predictions[sector]
                sector_data['prediction'] = {
                    'next_phase': pred.get('next_phase', 'N/A'),
                    'timeframe': pred.get('timeframe', 'N/A'),
                    'confidence': pred.get('confidence', 'N/A')
                }

            dashboard_data['sectors'].append(sector_data)

        # Sort by current return
        dashboard_data['sectors'].sort(key=lambda x: x['current_return'], reverse=True)

        # Write JSON
        json_file = output_path / 'dashboard_data.json'
        with open(json_file, 'w') as f:
            json.dump(dashboard_data, f, indent=2)

        print(f"✅ Data exported to {json_file}")
        return json_file

    def generate_summary_report(self, output_dir: str = 'historical_sector_cycles'):
        """
        Generate comprehensive markdown summary report.

        Args:
            output_dir: Directory to save the report

        Returns:
            Path to the generated report
        """
        print(f"\n📝 Generating summary report...")

        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)

        report_file = output_path / 'HISTORICAL_SECTOR_CYCLE_REPORT.md'

        # Build report
        lines = [
            "# Historical Sector Cycle Analysis Report",
            "",
            f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"**Data Source:** Upstox API (Historical Price Data)",
            f"**Analysis Period:** {self.years} Years",
            f"**Sectors Analyzed:** {len(self.sector_data)}",
            f"**Total Stocks:** {sum(len(v['dataframes']) for v in self.sector_data.values())}",
            "",
            "---",
            "",
            "## Executive Summary",
            "",
            f"This report analyzes **{self.years}-year historical price data** for Indian market sectors",
            "to identify cyclical patterns and predict future rotation opportunities.",
            "",
            "### Key Methodology",
            "- **Data Source**: Upstox Historical API (daily OHLCV)",
            "- **Cycle Detection**: FFT (Fast Fourier Transform) + Autocorrelation",
            "- **Phase Analysis**: Accumulation → Markup → Distribution → Markdown",
            "- **Prediction**: Based on detected cycle periods and current phase",
            "",
            "---",
            "",
            "## Sector Cycle Analysis",
            ""
        ]

        # Add detailed analysis for each sector
        for sector, pattern in self.cycle_patterns.items():
            lines.extend([
                f"### {sector}",
                "",
                f"**Current Phase:** {pattern['phases']['current_phase']}",
                f"**Action:** {pattern['phases']['action']}",
                f"**Current Return:** {pattern['phases']['current_return']:.2f}%",
                "",
                "#### Detected Cycles",
                ""
            ])

            if 'fft_cycles' in pattern['cycle_info'] and pattern['cycle_info']['fft_cycles']:
                lines.append("| Period (Days) | Period (Months) | Power |")
                lines.append("|---------------|-----------------|-------|")
                for cycle in pattern['cycle_info']['fft_cycles']:
                    lines.append(f"| {cycle['period_days']:.1f} | {cycle['period_months']:.1f} | {cycle['power']:.2e} |")

            lines.extend([
                "",
                "#### Performance Stats",
                f"- Average Total Return: {pattern['stats']['avg_total_return']:.2f}%",
                f"- Best Performer: {pattern['stats']['best_performer']['symbol']} ({pattern['stats']['best_performer']['total_return']:.2f}%)",
                f"- Worst Performer: {pattern['stats']['worst_performer']['symbol']} ({pattern['stats']['worst_performer']['total_return']:.2f}%)",
                f"- Average Volatility: {pattern['stats']['avg_volatility']:.2f}%",
                f"- Average Sharpe Ratio: {pattern['stats']['avg_sharpe']:.2f}",
                "",
                "---",
                "",
            ])

        # Add predictions
        lines.extend([
            "## Cycle Predictions",
            "",
            "### Next Expected Phase by Sector",
            "",
            "| Sector | Current Phase | Next Phase | Timeframe | Confidence |",
            "|--------|---------------|------------|-----------|------------|"
        ])

        for sector, pred in self.predictions.items():
            lines.append(
                f"| {sector} | {pred['current_phase']} | {pred.get('next_phase', 'N/A')} | "
                f"{pred.get('timeframe', 'N/A')} | {pred.get('confidence', 'N/A')} |"
            )

        lines.extend([
            "",
            "---",
            "",
            "## Visualizations Generated",
            "",
            "1. **sector_performance_timeline.png** - Cumulative returns over {self.years} years",
            "2. **sector_cycle_detection.png** - Detected cycles with phase indicators",
            "3. **sector_phase_comparison.png** - Phase distribution and returns comparison",
            "4. **cycle_periodogram.png** - FFT frequency spectrum showing dominant cycles",
            "5. **seasonal_patterns.png** - Monthly seasonal return patterns",
            "6. **sector_correlation_heatmap.png** - Inter-sector correlation matrix",
            "7. **drawdown_analysis.png** - Historical drawdown analysis",
            "8. **cycle_prediction_timeline.png** - Predicted next cycle timing",
            "",
            "---",
            "",
            "## Key Findings",
            ""
        ])

        # Add key findings
        best_sectors = sorted(self.cycle_patterns.items(),
                             key=lambda x: x[1]['stats']['avg_total_return'],
                             reverse=True)[:3]

        worst_sectors = sorted(self.cycle_patterns.items(),
                              key=lambda x: x[1]['stats']['avg_total_return'])[:3]

        lines.extend([
            "### Best Performing Sectors (Period Average)",
            ""
        ])
        for sector, pattern in best_sectors:
            lines.append(f"- **{sector}**: {pattern['stats']['avg_total_return']:.2f}% avg return")

        lines.extend([
            "",
            "### Worst Performing Sectors (Period Average)",
            ""
        ])
        for sector, pattern in worst_sectors:
            lines.append(f"- **{sector}**: {pattern['stats']['avg_total_return']:.2f}% avg return")

        # Accumulation opportunities
        accum_sectors = [(s, p) for s, p in self.predictions.items()
                        if p['current_phase'] in ['ACCUMULATION', 'MARKDOWN']]

        if accum_sectors:
            lines.extend([
                "",
                "### Current Accumulation Opportunities (BUY Zone)",
                ""
            ])
            for sector, pred in accum_sectors:
                lines.append(f"- **{sector}**: {pred['current_phase']} phase")

        lines.extend([
            "",
            "---",
            "",
            "## Disclaimer",
            "",
            "This analysis is for educational purposes only and should not be considered",
            "as financial advice. Always conduct your own research and consult with a",
            "qualified financial advisor before making investment decisions.",
            "",
            f"---",
            "",
            f"*Report generated by Historical Sector Cycle Analyzer*",
            f"*Analysis period: {self.years} years | Data source: Upstox API*"
        ])

        # Write report
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))

        print(f"✅ Report saved to {report_file}")
        return report_file


def main():
    """Main execution function."""
    print("=" * 70)
    print("  HISTORICAL SECTOR CYCLE ANALYZER")
    print(f"  Multi-Year Cycle Detection using Upstox API")
    print("=" * 70)

    # Initialize analyzer
    analyzer = HistoricalSectorCycleAnalyzer(years=3, provider='upstox')

    try:
        # Step 1: Fetch historical data
        if not analyzer.fetch_historical_data_for_sectors():
            print("\n❌ Failed to fetch historical data")
            return 1

        # Step 2: Analyze cycles
        analyzer.analyze_sector_cycles()

        # Step 3: Predict next cycles
        analyzer.predict_next_cycles()

        # Step 4: Generate visualizations
        output_dir = analyzer.create_visualizations()

        # Step 5: Generate report
        report_file = analyzer.generate_summary_report()

        # Step 6: Export data for D3 dashboard
        json_file = analyzer.export_data_for_dashboard()

        print("\n" + "=" * 70)
        print("  ✅ ANALYSIS COMPLETE")
        print("=" * 70)
        print(f"\n📊 Visualizations: {output_dir}/")
        print(f"📝 Report: {report_file}")
        print(f"💾 Dashboard Data: {json_file}")

    except Exception as e:
        print(f"\n❌ Error during analysis: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
