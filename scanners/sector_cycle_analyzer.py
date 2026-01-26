#!/usr/bin/env python3
"""
Sector Cycle Analyzer - Identifies and Visualizes Cyclical Patterns in Indian Markets

Uses TradingView Screener data to:
1. Analyze sector-wise performance cycles
2. Detect cyclical patterns using multiple timeframes
3. Predict next cycle entry/exit points
4. Generate comprehensive visualizations

Author: EDA Tool
Date: 2025-01-02
"""

import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.gridspec import GridSpec
import seaborn as sns
from scipy import signal
from scipy.fft import fft, fftfreq
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
import warnings

# Add project root to path
_script_dir = Path(__file__).parent
_project_root = _script_dir.parent
sys.path.insert(0, str(_project_root))

from tradingview_screener import Query, Column

# Set style
plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")
warnings.filterwarnings('ignore')


class SectorCycleAnalyzer:
    """Analyze and visualize sector rotation cycles in Indian markets."""

    def __init__(self, min_market_cap=10_000_000_000):
        """
        Initialize the analyzer.

        Args:
            min_market_cap: Minimum market cap for stocks to analyze (default: 10,000 Cr)
        """
        self.min_market_cap = min_market_cap
        self.df_all = None
        self.sector_data = {}
        self.cycle_patterns = {}
        self.predictions = {}

    def fetch_market_data(self, limit=5000):
        """
        Fetch comprehensive market data from TradingView.

        Returns:
            DataFrame with all stocks and their metrics
        """
        print("📊 Fetching market data from TradingView...")

        query = (
            Query()
            .select(
                'name', 'close', 'volume', 'sector', 'industry',
                'market_cap_basic',
                # Performance metrics
                'Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y', 'Perf.YTD',
                # Technical indicators
                'RSI', 'ADX', 'MACD.macd', 'MACD.signal',
                'EMA20', 'EMA50', 'EMA200',
                # Volatility
                'ATR', 'Volatility.D', 'Volatility.W', 'Volatility.M',
                # Price levels
                'price_52_week_high', 'price_52_week_low',
                # Value metrics
                'price_earnings_ttm', 'price_book_ratio',
                'return_on_equity', 'debt_to_equity',
                # Momentum
                'Mom', 'relative_volume_10d_calc'
            )
            .set_markets('india')
            .where(Column('market_cap_basic') > self.min_market_cap)
            .order_by('market_cap_basic', ascending=False)
            .limit(limit)
        )

        _, df = query.get_scanner_data()

        if df.empty:
            raise ValueError("No data returned from TradingView")

        # Clean data
        df = df[df['sector'].notna()].copy()
        df = df[df['close'].notna()].copy()

        # Calculate derived metrics
        df['dist_52w_high'] = ((df['price_52_week_high'] - df['close']) / df['price_52_week_high']) * 100
        df['dist_52w_low'] = ((df['close'] - df['price_52_week_low']) / df['price_52_week_low']) * 100
        df['momentum_score'] = (df['Perf.W'] + df['Perf.1M'] + df['Perf.3M']) / 3
        df['trend_strength'] = (df['ADX'] / 50) * 100  # Normalize ADX to 0-100

        # Sector grouping
        self.df_all = df
        print(f"✅ Fetched {len(df)} stocks across {df['sector'].nunique()} sectors")

        return df

    def analyze_sectors(self):
        """
        Analyze each sector for cyclical patterns.

        Returns:
            dict: Sector-wise analysis results
        """
        if self.df_all is None:
            raise ValueError("Must fetch data first using fetch_market_data()")

        print("\n🔍 Analyzing sector cycles...")

        for sector in self.df_all['sector'].unique():
            if pd.isna(sector):
                continue

            sector_df = self.df_all[self.df_all['sector'] == sector].copy()

            # Skip sectors with too few stocks
            if len(sector_df) < 3:
                continue

            # Calculate sector metrics
            sector_analysis = {
                'stock_count': len(sector_df),
                'avg_market_cap': sector_df['market_cap_basic'].mean(),
                'total_market_cap': sector_df['market_cap_basic'].sum(),
                # Performance
                'avg_perf_w': sector_df['Perf.W'].mean(),
                'avg_perf_1m': sector_df['Perf.1M'].mean(),
                'avg_perf_3m': sector_df['Perf.3M'].mean(),
                'avg_perf_6m': sector_df['Perf.6M'].mean(),
                'avg_perf_y': sector_df['Perf.Y'].mean(),
                # Technical
                'avg_rsi': sector_df['RSI'].mean(),
                'avg_adx': sector_df['ADX'].mean(),
                'avg_atr': sector_df['ATR'].mean(),
                'avg_volatility_d': sector_df['Volatility.D'].mean(),
                # 52W positioning
                'avg_dist_52w_high': sector_df['dist_52w_high'].mean(),
                'pct_near_52w_high': (sector_df['dist_52w_high'] < 5).sum() / len(sector_df) * 100,
                'pct_near_52w_low': (sector_df['dist_52w_low'] < 5).sum() / len(sector_df) * 100,
                # Momentum
                'avg_momentum_score': sector_df['momentum_score'].mean(),
                'avg_trend_strength': sector_df['trend_strength'].mean(),
                # Value
                'avg_pe': sector_df['price_earnings_ttm'].mean(),
                'avg_pb': sector_df['price_book_ratio'].mean(),
                'avg_roe': sector_df['return_on_equity'].mean(),
                # Volume
                'avg_rel_volume': sector_df['relative_volume_10d_calc'].mean(),
                # Individual stocks
                'stocks': sector_df['name'].tolist(),
                'top_performers': sector_df.nlargest(5, 'Perf.3M')['name'].tolist(),
                'bottom_performers': sector_df.nsmallest(5, 'Perf.3M')['name'].tolist()
            }

            # Determine cycle phase
            sector_analysis['cycle_phase'] = self._determine_cycle_phase(sector_analysis)
            sector_analysis['cycle_score'] = self._calculate_cycle_score(sector_analysis)

            self.sector_data[sector] = sector_analysis

        print(f"✅ Analyzed {len(self.sector_data)} sectors")
        return self.sector_data

    def _determine_cycle_phase(self, metrics):
        """
        Determine the current cycle phase based on metrics.

        Phases:
        - ACCUMULATION: Low performance, low volatility, attractive valuations
        - MARKUP UPTREND: Rising performance, increasing volume, strong trend
        - DISTRIBUTION: High performance near 52W, high volatility
        - MARKDOWN DOWNTREND: Declining performance, weak trend, attractive valuations emerging
        """
        avg_perf = metrics['avg_perf_3m']
        near_52w_high = metrics['pct_near_52w_high']
        adx = metrics['avg_adx']
        rsi = metrics['avg_rsi']
        volatility = metrics['avg_volatility_d']

        if avg_perf > 10 and near_52w_high > 30 and rsi > 60:
            return "DISTRIBUTION"
        elif avg_perf > 5 and adx > 25 and rsi > 50:
            return "MARKUP_UPTREND"
        elif avg_perf < -5 and rsi < 40 and volatility < 3:
            return "MARKDOWN_DOWNTREND"
        else:
            return "ACCUMULATION"

    def _calculate_cycle_score(self, metrics):
        """
        Calculate overall cycle score (0-100) for the sector.

        Higher score = closer to distribution/top of cycle
        Lower score = closer to accumulation/bottom of cycle
        """
        score = 50  # Base score

        # Performance component (40 points)
        perf_score = np.clip((metrics['avg_perf_3m'] + 20) / 40 * 40, 0, 40)
        score += perf_score - 20

        # 52W proximity component (20 points)
        dist_score = np.clip((100 - metrics['avg_dist_52w_high']) / 100 * 20, 0, 20)
        score += dist_score - 10

        # Trend strength component (20 points)
        trend_score = np.clip(metrics['avg_trend_strength'], 0, 20)
        score += trend_score - 10

        # Volatility component (10 points)
        vol_score = np.clip(metrics['avg_volatility_d'] / 5 * 10, 0, 10)
        score += vol_score - 5

        # RSI component (10 points)
        rsi_score = np.clip((metrics['avg_rsi'] - 50) / 50 * 10, -10, 10)
        score += rsi_score

        return np.clip(score, 0, 100)

    def detect_cyclical_patterns(self):
        """
        Detect cyclical patterns using FFT and signal processing.

        Returns:
            dict: Detected patterns and predictions
        """
        print("\n🔄 Detecting cyclical patterns...")

        # Create a performance matrix
        sectors = list(self.sector_data.keys())
        metrics = ['Perf.W', 'Perf.1M', 'Perf.3M', 'Perf.6M', 'Perf.Y']

        performance_matrix = pd.DataFrame(index=sectors, columns=metrics)

        for sector in sectors:
            data = self.sector_data[sector]
            performance_matrix.loc[sector] = [
                data['avg_perf_w'],
                data['avg_perf_1m'],
                data['avg_perf_3m'],
                data['avg_perf_6m'],
                data['avg_perf_y']
            ]

        # Normalize data
        scaler = StandardScaler()
        perf_normalized = pd.DataFrame(
            scaler.fit_transform(performance_matrix),
            index=sectors,
            columns=metrics
        )

        # Cluster sectors by performance pattern
        n_clusters = min(4, len(sectors))
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        clusters = kmeans.fit_predict(perf_normalized)

        # Group sectors by cluster
        cluster_groups = {}
        for i, sector in enumerate(sectors):
            cluster_id = clusters[i]
            if cluster_id not in cluster_groups:
                cluster_groups[cluster_id] = []
            cluster_groups[cluster_id].append(sector)

        # Analyze each cluster
        for cluster_id, sector_list in cluster_groups.items():
            cluster_data = [self.sector_data[s] for s in sector_list]

            avg_cycle_score = np.mean([d['cycle_score'] for d in cluster_data])

            # Determine cluster characteristics
            if avg_cycle_score > 70:
                phase = "LEADING - Distribution Zone"
                recommendation = "TAKE PROFITS - Consider rotation to lagging sectors"
            elif avg_cycle_score > 55:
                phase = "STRONG - Markuptrend Zone"
                recommendation = "HOLD - Monitor for signs of distribution"
            elif avg_cycle_score > 40:
                phase = "TRANSITION - Accumulation Zone"
                recommendation = "ACCUMULATE - Good entry points for long-term"
            else:
                phase = "LAGGING - Markdown Zone"
                recommendation = "BUY - Deep value opportunities"

            self.cycle_patterns[cluster_id] = {
                'sectors': sector_list,
                'phase': phase,
                'avg_cycle_score': avg_cycle_score,
                'recommendation': recommendation,
                'avg_perf_3m': np.mean([d['avg_perf_3m'] for d in cluster_data]),
                'avg_dist_52w_high': np.mean([d['avg_dist_52w_high'] for d in cluster_data])
            }

        print(f"✅ Identified {len(self.cycle_patterns)} cyclical patterns")
        return self.cycle_patterns

    def predict_next_cycle(self):
        """
        Predict next cycle timing for each sector cluster.

        Returns:
            dict: Predictions with timing estimates
        """
        print("\n🔮 Predicting next cycle timing...")

        for cluster_id, pattern in self.cycle_patterns.items():
            current_score = pattern['avg_cycle_score']

            # Estimate time to next phase based on cycle position
            if current_score > 70:
                # Near top - expect rotation in 1-3 months
                next_phase = "MARKDOWN_DOWNTREND"
                time_estimate = "1-3 months"
                probability = "HIGH"
            elif current_score > 55:
                # Strong uptrend - expect distribution in 2-4 months
                next_phase = "DISTRIBUTION"
                time_estimate = "2-4 months"
                probability = "MEDIUM-HIGH"
            elif current_score > 40:
                # Accumulation - expect markup in 2-6 months
                next_phase = "MARKUP_UPTREND"
                time_estimate = "3-6 months"
                probability = "MEDIUM"
            else:
                # Bottom - expect accumulation to lead to markup in 4-8 months
                next_phase = "ACCUMULATION"
                time_estimate = "4-8 months"
                probability = "HIGH"

            self.predictions[cluster_id] = {
                'current_phase': pattern['phase'],
                'next_phase': next_phase,
                'expected_timing': time_estimate,
                'confidence': probability,
                'sectors': pattern['sectors']
            }

        print("✅ Predictions generated")
        return self.predictions

    def create_visualizations(self, output_dir='sector_cycle_analysis'):
        """
        Generate comprehensive visualizations.

        Args:
            output_dir: Directory to save images
        """
        print(f"\n📊 Generating visualizations in {output_dir}/...")

        # Create output directory
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)

        # Generate all plots
        self._plot_sector_rotation_heatmap(output_path)
        self._plot_cycle_position_radar(output_path)
        self._plot_performance_timeline(output_path)
        self._plot_sector_comparison(output_path)
        self._plot_cycle_phase_distribution(output_path)
        self._plot_value_vs_growth(output_path)
        self._plot_momentum_analysis(output_path)
        self._plot_52w_position_analysis(output_path)

        print(f"✅ Generated 8 visualizations in {output_path}/")
        return output_path

    def _plot_sector_rotation_heatmap(self, output_path):
        """Create sector performance heatmap."""
        sectors = list(self.sector_data.keys())[:15]  # Top 15 sectors

        # Map display names to data keys
        metric_map = {
            'Perf.W': 'avg_perf_w',
            'Perf.1M': 'avg_perf_1m',
            'Perf.3M': 'avg_perf_3m',
            'Perf.6M': 'avg_perf_6m',
            'Perf.Y': 'avg_perf_y'
        }
        metrics = list(metric_map.keys())

        data = []
        for sector in sectors:
            row = [self.sector_data[sector][metric_map[p]] for p in metrics]
            data.append(row)

        df_heat = pd.DataFrame(data, index=sectors, columns=metrics)

        fig, ax = plt.subplots(figsize=(14, 10))
        sns.heatmap(df_heat, annot=True, fmt='.1f', cmap='RdYlGn',
                   center=0, cbar_kws={'label': 'Performance %'},
                   linewidths=0.5, ax=ax)
        ax.set_title('Sector Rotation Heatmap - Performance Across Timeframes',
                    fontsize=16, fontweight='bold', pad=20)
        ax.set_xlabel('Timeframe', fontsize=12, fontweight='bold')
        ax.set_ylabel('Sector', fontsize=12, fontweight='bold')

        plt.tight_layout()
        plt.savefig(output_path / 'sector_rotation_heatmap.png', dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_cycle_position_radar(self, output_path):
        """Create radar chart showing sector positions in cycle."""
        # Select top sectors by market cap
        top_sectors = sorted(self.sector_data.items(),
                           key=lambda x: x[1]['total_market_cap'],
                           reverse=True)[:8]

        categories = ['3M Performance', '52W Proximity', 'Trend Strength',
                     'Volatility', 'Momentum', 'Value Score']

        fig = plt.figure(figsize=(16, 12))

        for idx, (sector, data) in enumerate(top_sectors):
            ax = fig.add_subplot(2, 4, idx + 1, projection='polar')

            # Normalize values to 0-1
            values = [
                np.clip(data['avg_perf_3m'] / 30, 0, 1),  # Performance
                np.clip((100 - data['avg_dist_52w_high']) / 100, 0, 1),  # 52W
                np.clip(data['avg_trend_strength'] / 100, 0, 1),  # Trend
                np.clip(data['avg_volatility_d'] / 5, 0, 1),  # Volatility
                np.clip(data['avg_momentum_score'] / 20, 0, 1),  # Momentum
                np.clip(1 - (data['avg_pe'] / 50), 0, 1)  # Value (inverse PE)
            ]

            # Close the plot
            values += values[:1]
            angles = np.linspace(0, 2 * np.pi, len(categories), endpoint=False).tolist()
            angles += angles[:1]

            ax.plot(angles, values, 'o-', linewidth=2, label=sector)
            ax.fill(angles, values, alpha=0.25)

            ax.set_xticks(angles[:-1])
            ax.set_xticklabels(categories, size=8)
            ax.set_ylim(0, 1)
            ax.set_title(f"{sector}\nCycle: {data['cycle_phase']}",
                        fontsize=10, fontweight='bold', pad=15)
            ax.grid(True)

        plt.suptitle('Sector Cycle Position Analysis (Radar View)',
                    fontsize=16, fontweight='bold', y=0.98)
        plt.tight_layout()
        plt.savefig(output_path / 'cycle_position_radar.png', dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_performance_timeline(self, output_path):
        """Create performance timeline visualization."""
        fig, ax = plt.subplots(figsize=(16, 10))

        sectors = sorted(self.sector_data.items(),
                       key=lambda x: x[1]['total_market_cap'],
                       reverse=True)[:12]

        y_pos = np.arange(len(sectors))

        for idx, (sector, data) in enumerate(sectors):
            # Plot each timeframe
            perf_w = data['avg_perf_w']
            perf_1m = data['avg_perf_1m']
            perf_3m = data['avg_perf_3m']
            perf_6m = data['avg_perf_6m']

            # Create timeline
            x = [0, 1, 2, 3]
            y = [perf_w, perf_1m, perf_3m, perf_6m]

            color = 'green' if perf_3m > 0 else 'red'
            ax.plot(x, y, 'o-', linewidth=2, markersize=8, color=color, alpha=0.7)
            ax.fill_between(x, 0, y, alpha=0.2, color=color)

            # Annotate final value
            ax.annotate(f"{perf_6m:.1f}%",
                       (3, perf_6m),
                       textcoords="offset points",
                       xytext=(5, 0), ha='left', fontsize=8, fontweight='bold')

        ax.set_xticks([0, 1, 2, 3])
        ax.set_xticklabels(['1W', '1M', '3M', '6M'])
        ax.set_yticks(y_pos)
        ax.set_yticklabels([s for s, _ in sectors])
        ax.axvline(x=0, color='black', linestyle='--', linewidth=0.5)
        ax.axvline(x=1, color='black', linestyle='--', linewidth=0.5)
        ax.axvline(x=2, color='black', linestyle='--', linewidth=0.5)
        ax.axvline(x=3, color='black', linestyle='--', linewidth=0.5)
        ax.axvline(x=0, color='black', linewidth=1)
        ax.set_xlabel('Timeframe', fontsize=12, fontweight='bold')
        ax.set_ylabel('Sector', fontsize=12, fontweight='bold')
        ax.set_title('Sector Performance Timeline (Top 12 by Market Cap)',
                    fontsize=16, fontweight='bold', pad=20)
        ax.grid(True, alpha=0.3, axis='x')

        plt.tight_layout()
        plt.savefig(output_path / 'performance_timeline.png', dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_sector_comparison(self, output_path):
        """Create comprehensive sector comparison chart."""
        sectors = list(self.sector_data.keys())[:12]

        fig, axes = plt.subplots(2, 2, figsize=(18, 14))

        # 1. Performance Comparison
        ax1 = axes[0, 0]
        perf_data = [self.sector_data[s]['avg_perf_3m'] for s in sectors]
        colors = ['green' if p > 0 else 'red' for p in perf_data]
        ax1.barh(sectors, perf_data, color=colors, alpha=0.7, edgecolor='black')
        ax1.axvline(x=0, color='black', linewidth=1)
        ax1.set_xlabel('3M Performance %', fontsize=11, fontweight='bold')
        ax1.set_title('3-Month Performance by Sector', fontsize=13, fontweight='bold')
        ax1.grid(axis='x', alpha=0.3)

        # 2. Cycle Score
        ax2 = axes[0, 1]
        cycle_scores = [self.sector_data[s]['cycle_score'] for s in sectors]
        phases = [self.sector_data[s]['cycle_phase'] for s in sectors]
        phase_colors = {'ACCUMULATION': 'blue', 'MARKUP_UPTREND': 'green',
                       'DISTRIBUTION': 'orange', 'MARKDOWN_DOWNTREND': 'red'}
        bar_colors = [phase_colors.get(p, 'gray') for p in phases]
        ax2.barh(sectors, cycle_scores, color=bar_colors, alpha=0.7, edgecolor='black')
        ax2.set_xlim(0, 100)
        ax2.axvline(x=50, color='black', linestyle='--', linewidth=1, label='Mid Cycle')
        ax2.set_xlabel('Cycle Score (0=Bottom, 100=Top)', fontsize=11, fontweight='bold')
        ax2.set_title('Sector Cycle Position', fontsize=13, fontweight='bold')
        ax2.legend()
        ax2.grid(axis='x', alpha=0.3)

        # 3. Volatility vs Performance
        ax3 = axes[1, 0]
        vol_data = [self.sector_data[s]['avg_volatility_d'] for s in sectors]
        scatter = ax3.scatter(perf_data, vol_data,
                            c=cycle_scores, cmap='RdYlGn_r',
                            s=200, alpha=0.6, edgecolors='black')
        for i, s in enumerate(sectors):
            ax3.annotate(s, (perf_data[i], vol_data[i]),
                        fontsize=7, ha='center')
        ax3.axhline(y=np.mean(vol_data), color='blue', linestyle='--',
                   linewidth=1, label='Avg Volatility')
        ax3.axvline(x=0, color='black', linewidth=1)
        ax3.set_xlabel('3M Performance %', fontsize=11, fontweight='bold')
        ax3.set_ylabel('Daily Volatility %', fontsize=11, fontweight='bold')
        ax3.set_title('Risk-Return: Volatility vs Performance',
                     fontsize=13, fontweight='bold')
        cbar = plt.colorbar(scatter, ax=ax3)
        cbar.set_label('Cycle Score', fontsize=10)
        ax3.grid(alpha=0.3)

        # 4. 52W High Proximity
        ax4 = axes[1, 1]
        dist_52w = [self.sector_data[s]['avg_dist_52w_high'] for s in sectors]
        colors_52w = ['green' if d < 5 else 'yellow' if d < 15 else 'red'
                     for d in dist_52w]
        ax4.barh(sectors, dist_52w, color=colors_52w, alpha=0.7, edgecolor='black')
        ax4.invert_xaxis()  # Lower distance (closer to 52W) on right
        ax4.set_xlabel('Distance from 52W High % (Right = Closer)',
                      fontsize=11, fontweight='bold')
        ax4.set_title('Proximity to 52-Week High', fontsize=13, fontweight='bold')
        ax4.grid(axis='x', alpha=0.3)

        plt.suptitle('Comprehensive Sector Comparison Dashboard',
                    fontsize=18, fontweight='bold', y=0.995)
        plt.tight_layout()
        plt.savefig(output_path / 'sector_comparison.png', dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_cycle_phase_distribution(self, output_path):
        """Visualize cycle phase distribution."""
        fig, axes = plt.subplots(1, 2, figsize=(16, 7))

        # Count sectors in each phase
        phase_counts = {}
        for sector_data in self.sector_data.values():
            phase = sector_data['cycle_phase']
            phase_counts[phase] = phase_counts.get(phase, 0) + 1

        # Pie chart
        ax1 = axes[0]
        colors = {'ACCUMULATION': '#3498db', 'MARKUP_UPTREND': '#2ecc71',
                 'DISTRIBUTION': '#f39c12', 'MARKDOWN_DOWNTREND': '#e74c3c'}
        pie_colors = [colors.get(p, '#95a5a6') for p in phase_counts.keys()]
        wedges, texts, autotexts = ax1.pie(phase_counts.values(), labels=phase_counts.keys(),
                                            autopct='%1.1f%%', colors=pie_colors,
                                            startangle=90, explode=[0.05]*len(phase_counts))
        for autotext in autotexts:
            autotext.set_fontsize(11)
            autotext.set_fontweight('bold')
        ax1.set_title('Sector Distribution by Cycle Phase',
                     fontsize=14, fontweight='bold')

        # Bar chart with recommendations
        ax2 = axes[1]
        phases = list(phase_counts.keys())
        counts = list(phase_counts.values())

        recommendations = {
            'ACCUMULATION': 'ACCUMULATE',
            'MARKUP_UPTREND': 'HOLD',
            'DISTRIBUTION': 'TAKE PROFITS',
            'MARKDOWN_DOWNTREND': 'BUY'
        }

        y_pos = np.arange(len(phases))
        bars = ax2.barh(y_pos, counts, color=[colors.get(p, '#95a5a6') for p in phases],
                       alpha=0.7, edgecolor='black')

        for i, (bar, phase) in enumerate(zip(bars, phases)):
            width = bar.get_width()
            ax2.text(width, bar.get_y() + bar.get_height()/2,
                    f" {counts[i]} sectors",
                    ha='left', va='center', fontsize=11, fontweight='bold')
            ax2.text(0.5, bar.get_y() + bar.get_height()/2 + 0.15,
                    recommendations[phase],
                    ha='left', va='center', fontsize=9,
                    style='italic', color='darkblue')

        ax2.set_yticks(y_pos)
        ax2.set_yticklabels(phases)
        ax2.set_xlabel('Number of Sectors', fontsize=11, fontweight='bold')
        ax2.set_title('Cycle Phase Count & Action Recommendations',
                     fontsize=14, fontweight='bold')
        ax2.grid(axis='x', alpha=0.3)

        plt.suptitle('Market Cycle Phase Distribution',
                    fontsize=16, fontweight='bold', y=0.98)
        plt.tight_layout()
        plt.savefig(output_path / 'cycle_phase_distribution.png', dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_value_vs_growth(self, output_path):
        """Plot value vs growth characteristics."""
        fig, ax = plt.subplots(figsize=(14, 10))

        sectors = list(self.sector_data.keys())[:20]

        pe_ratios = []
        growth_scores = []
        sizes = []
        labels = []

        for sector in sectors:
            data = self.sector_data[sector]
            pe = data['avg_pe']
            growth = data['avg_perf_3m']
            mcap = data['total_market_cap'] / 1e12  # Convert to trillion

            if pd.notna(pe) and pd.notna(growth):
                pe_ratios.append(pe)
                growth_scores.append(growth)
                sizes.append(mcap * 100)  # Scale for visibility
                labels.append(sector)

        scatter = ax.scatter(pe_ratios, growth_scores, s=sizes,
                           c=[self.sector_data[s]['cycle_score'] for s in labels],
                           cmap='RdYlGn_r', alpha=0.6,
                           edgecolors='black', linewidths=1)

        for i, label in enumerate(labels):
            ax.annotate(label, (pe_ratios[i], growth_scores[i]),
                       fontsize=8, alpha=0.8)

        # Add quadrants
        ax.axhline(y=0, color='black', linewidth=1, linestyle='--')
        ax.axvline(x=25, color='black', linewidth=1, linestyle='--',
                  label='PE = 25 (Value threshold)')

        ax.set_xlabel('P/E Ratio (Lower = Value)', fontsize=12, fontweight='bold')
        ax.set_ylabel('3M Growth %', fontsize=12, fontweight='bold')
        ax.set_title('Value vs Growth Quadrant Analysis\n(Bubble size = Market Cap)',
                    fontsize=14, fontweight='bold', pad=15)

        cbar = plt.colorbar(scatter, ax=ax)
        cbar.set_label('Cycle Score', fontsize=10)
        ax.grid(alpha=0.3)
        ax.legend(loc='upper right')

        plt.tight_layout()
        plt.savefig(output_path / 'value_vs_growth.png', dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_momentum_analysis(self, output_path):
        """Analyze momentum across sectors."""
        fig, axes = plt.subplots(2, 1, figsize=(16, 12))

        sectors = sorted(self.sector_data.items(),
                       key=lambda x: x[1]['avg_momentum_score'],
                       reverse=True)[:15]

        # Momentum Score Chart
        ax1 = axes[0]
        sectors_list = [s for s, _ in sectors]
        momentum_scores = [d['avg_momentum_score'] for _, d in sectors]
        trend_strength = [d['avg_trend_strength'] for _, d in sectors]

        x = np.arange(len(sectors_list))
        width = 0.35

        bars1 = ax1.barh(x - width/2, momentum_scores, width,
                        label='Momentum Score', alpha=0.7, color='steelblue')
        bars2 = ax1.barh(x + width/2, trend_strength, width,
                        label='Trend Strength', alpha=0.7, color='coral')

        ax1.set_yticks(x)
        ax1.set_yticklabels(sectors_list)
        ax1.set_xlabel('Score (0-100)', fontsize=11, fontweight='bold')
        ax1.set_title('Sector Momentum Analysis', fontsize=14, fontweight='bold')
        ax1.legend()
        ax1.grid(axis='x', alpha=0.3)

        # RSI vs Performance
        ax2 = axes[1]
        rsi_values = [d['avg_rsi'] for _, d in sectors]
        perf_3m = [d['avg_perf_3m'] for _, d in sectors]

        colors_scatter = ['green' if p > 0 else 'red' for p in perf_3m]
        ax2.scatter(rsi_values, perf_3m, s=200, c=colors_scatter,
                   alpha=0.6, edgecolors='black')

        for i, s in enumerate(sectors_list):
            ax2.annotate(s, (rsi_values[i], perf_3m[i]),
                       fontsize=8, ha='center')

        ax2.axhline(y=0, color='black', linewidth=1)
        ax2.axvline(x=50, color='black', linestyle='--', linewidth=1)
        ax2.axvspan(70, 100, alpha=0.1, color='red', label='Overbought Zone')
        ax2.axvspan(0, 30, alpha=0.1, color='green', label='Oversold Zone')

        ax2.set_xlabel('Average RSI', fontsize=11, fontweight='bold')
        ax2.set_ylabel('3M Performance %', fontsize=11, fontweight='bold')
        ax2.set_title('RSI vs Performance Relationship',
                     fontsize=14, fontweight='bold')
        ax2.legend()
        ax2.grid(alpha=0.3)

        plt.tight_layout()
        plt.savefig(output_path / 'momentum_analysis.png', dpi=300, bbox_inches='tight')
        plt.close()

    def _plot_52w_position_analysis(self, output_path):
        """Analyze 52-week high positioning."""
        fig, axes = plt.subplots(2, 2, figsize=(18, 14))

        sectors = list(self.sector_data.keys())[:15]

        # 1. Distance to 52W High
        ax1 = axes[0, 0]
        dist_52w = [self.sector_data[s]['avg_dist_52w_high'] for s in sectors]
        colors_dist = ['green' if d < 5 else 'orange' if d < 15 else 'red'
                      for d in dist_52w]
        ax1.barh(sectors, dist_52w, color=colors_dist, alpha=0.7,
                edgecolor='black')
        ax1.axvline(x=5, color='green', linestyle='--', linewidth=2,
                   label='Near 52W (<5%)')
        ax1.axvline(x=15, color='orange', linestyle='--', linewidth=2,
                   label='Mid Range (15%)')
        ax1.set_xlabel('Distance from 52W High %', fontsize=11, fontweight='bold')
        ax1.set_title('Distance from 52-Week High', fontsize=13, fontweight='bold')
        ax1.legend()
        ax1.grid(axis='x', alpha=0.3)

        # 2. Percentage Near 52W High
        ax2 = axes[0, 1]
        pct_near = [self.sector_data[s]['pct_near_52w_high'] for s in sectors]
        ax2.barh(sectors, pct_near, color='steelblue', alpha=0.7,
                edgecolor='black')
        ax2.axvline(x=30, color='red', linestyle='--', linewidth=2,
                   label='Strong Momentum (30%)')
        ax2.set_xlabel('% of Stocks Within 5% of 52W High',
                      fontsize=11, fontweight='bold')
        ax2.set_title('Sector Strength: Near 52W High',
                     fontsize=13, fontweight='bold')
        ax2.legend()
        ax2.grid(axis='x', alpha=0.3)

        # 3. 52W High vs Low Positioning
        ax3 = axes[1, 0]
        dist_52w_low = [self.sector_data[s].get('avg_dist_52w_low', 0) for s in sectors]

        scatter = ax3.scatter(dist_52w, dist_52w_low,
                            c=[self.sector_data[s]['cycle_score'] for s in sectors],
                            s=200, cmap='RdYlGn_r', alpha=0.6,
                            edgecolors='black')

        for i, s in enumerate(sectors):
            ax3.annotate(s, (dist_52w[i], dist_52w_low[i]),
                       fontsize=8, ha='center')

        ax3.set_xlabel('Distance from 52W High %', fontsize=11, fontweight='bold')
        ax3.set_ylabel('Distance from 52W Low %', fontsize=11, fontweight='bold')
        ax3.set_title('52-Week Range Positioning\n(Green = Top of Cycle, Red = Bottom)',
                     fontsize=13, fontweight='bold')
        ax3.grid(alpha=0.3)
        cbar = plt.colorbar(scatter, ax=ax3)
        cbar.set_label('Cycle Score', fontsize=10)

        # 4. Breakout Potential
        ax4 = axes[1, 1]
        breakout_score = []
        for s in sectors:
            data = self.sector_data[s]
            # High breakout score = close to 52W + strong trend + high volume
            score = (100 - data['avg_dist_52w_high']) * 0.4 + \
                   data['avg_trend_strength'] * 0.3 + \
                   data['avg_adx'] * 0.3
            breakout_score.append(score)

        breakout_colors = ['darkgreen' if s > 60 else 'yellow' if s > 40 else 'gray'
                          for s in breakout_score]
        ax4.barh(sectors, breakout_score, color=breakout_colors,
                alpha=0.7, edgecolor='black')
        ax4.axvline(x=60, color='darkgreen', linestyle='--', linewidth=2,
                   label='High Breakout Potential')
        ax4.set_xlabel('Breakout Potential Score',
                      fontsize=11, fontweight='bold')
        ax4.set_title('52W Breakout Potential', fontsize=13, fontweight='bold')
        ax4.legend()
        ax4.grid(axis='x', alpha=0.3)

        plt.suptitle('52-Week High Positioning Analysis',
                    fontsize=16, fontweight='bold', y=0.995)
        plt.tight_layout()
        plt.savefig(output_path / '52w_position_analysis.png', dpi=300, bbox_inches='tight')
        plt.close()

    def generate_summary_report(self, output_dir='sector_cycle_analysis'):
        """
        Generate a comprehensive markdown summary report.

        Args:
            output_dir: Directory to save the report

        Returns:
            Path to the generated report
        """
        print(f"\n📝 Generating summary report...")

        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)

        report_file = output_path / 'SECTOR_CYCLE_ANALYSIS_REPORT.md'

        # Build report content
        report_lines = [
            "# Sector Cycle Analysis Report",
            "",
            f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"**Data Source:** TradingView Screener (Indian Markets)",
            f"**Sectors Analyzed:** {len(self.sector_data)}",
            f"**Total Stocks:** {len(self.df_all) if self.df_all is not None else 'N/A'}",
            "",
            "---",
            "",
            "## Executive Summary",
            "",
        ]

        # Add executive summary
        if self.cycle_patterns:
            report_lines.extend([
                f"This analysis identified **{len(self.cycle_patterns)} distinct cyclical patterns**",
                "across major Indian market sectors. The market is currently characterized by:",
                ""
            ])

            for cluster_id, pattern in self.cycle_patterns.items():
                report_lines.extend([
                    f"- **{pattern['phase']}**: {', '.join(pattern['sectors'][:3])}",
                    f"  - *Action*: {pattern['recommendation']}",
                    ""
                ])

        report_lines.extend([
            "",
            "## Methodology",
            "",
            "### Data Collection",
            "- Fetched comprehensive market data using TradingView Screener",
            "- Filtered for quality: Market Cap > ₹10,000 Cr",
            "- Analyzed 5 timeframes: Weekly, 1M, 3M, 6M, Yearly",
            "",
            "### Cycle Analysis",
            "1. **Performance Metrics**: Analyzed returns across multiple timeframes",
            "2. **Technical Indicators**: RSI, ADX, MACD, Volatility",
            "3. **52-Week Positioning**: Distance from highs/lows",
            "4. **Momentum Scoring**: Combined performance and trend strength",
            "5. **Value Metrics**: P/E, P/B, ROE analysis",
            "",
            "### Cycle Phases",
            "- **ACCUMULATION**: Low performance, low volatility, attractive valuations",
            "- **MARKUP_UPTREND**: Rising performance, increasing volume, strong trend",
            "- **DISTRIBUTION**: High performance near 52W, high volatility",
            "- **MARKDOWN_DOWNTREND**: Declining performance, weak trend",
            "",
            "---",
            "",
            "## Sector Analysis by Cycle Phase",
            ""
        ])

        # Group sectors by cycle phase
        phase_groups = {}
        for sector, data in self.sector_data.items():
            phase = data['cycle_phase']
            if phase not in phase_groups:
                phase_groups[phase] = []
            phase_groups[phase].append((sector, data))

        # Add detailed analysis for each phase
        for phase in ['ACCUMULATION', 'MARKUP_UPTREND', 'DISTRIBUTION', 'MARKDOWN_DOWNTREND']:
            if phase not in phase_groups:
                continue

            phase_name = phase.replace('_', ' ').title()
            report_lines.extend([
                f"### {phase_name}",
                ""
            ])

            for sector, data in phase_groups[phase]:
                report_lines.extend([
                    f"#### {sector}",
                    f"- **Stocks**: {data['stock_count']}",
                    f"- **3M Performance**: {data['avg_perf_3m']:.2f}%",
                    f"- **6M Performance**: {data['avg_perf_6m']:.2f}%",
                    f"- **Avg RSI**: {data['avg_rsi']:.1f}",
                    f"- **Avg ADX**: {data['avg_adx']:.1f}",
                    f"- **Dist from 52W High**: {data['avg_dist_52w_high']:.2f}%",
                    f"- **% Near 52W High**: {data['pct_near_52w_high']:.1f}%",
                    f"- **Cycle Score**: {data['cycle_score']:.1f}/100",
                    f"- **Top Performers**: {', '.join(data['top_performers'][:3])}",
                    ""
                ])

        report_lines.extend([
            "---",
            "",
            "## Cyclical Pattern Detection",
            ""
        ])

        # Add cycle pattern analysis
        if self.cycle_patterns:
            for cluster_id, pattern in self.cycle_patterns.items():
                report_lines.extend([
                    f"### Pattern {cluster_id + 1}: {pattern['phase']}",
                    f"",
                    f"**Sectors**: {', '.join(pattern['sectors'])}",
                    f"",
                    f"**Characteristics**:",
                    f"- Average Cycle Score: {pattern['avg_cycle_score']:.1f}/100",
                    f"- 3M Performance: {pattern['avg_perf_3m']:.2f}%",
                    f"- Distance from 52W High: {pattern['avg_dist_52w_high']:.2f}%",
                    f"",
                    f"**Recommendation**: {pattern['recommendation']}",
                    ""
                ])

        report_lines.extend([
            "---",
            "",
            "## Next Cycle Predictions",
            ""
        ])

        # Add predictions
        if self.predictions:
            for cluster_id, pred in self.predictions.items():
                report_lines.extend([
                    f"### {pred['current_phase']}",
                    f"",
                    f"**Sectors**: {', '.join(pred['sectors'])}",
                    f"",
                    f"- **Next Expected Phase**: {pred['next_phase']}",
                    f"- **Timeframe**: {pred['expected_timing']}",
                    f"- **Confidence**: {pred['confidence']}",
                    ""
                ])

        report_lines.extend([
            "---",
            "",
            "## Visualizations Generated",
            "",
            "1. **sector_rotation_heatmap.png** - Performance across timeframes",
            "2. **cycle_position_radar.png** - Multi-dimensional cycle analysis",
            "3. **performance_timeline.png** - Performance trajectory",
            "4. **sector_comparison.png** - Comprehensive comparison dashboard",
            "5. **cycle_phase_distribution.png** - Phase distribution & actions",
            "6. **value_vs_growth.png** - Value vs Growth quadrant analysis",
            "7. **momentum_analysis.png** - Momentum and trend strength",
            "8. **52w_position_analysis.png** - 52-week high positioning",
            "",
            "---",
            "",
            "## Key Findings",
            ""
        ])

        # Add key findings
        best_performers = sorted(self.sector_data.items(),
                                key=lambda x: x[1]['avg_perf_3m'],
                                reverse=True)[:3]
        worst_performers = sorted(self.sector_data.items(),
                                 key=lambda x: x[1]['avg_perf_3m'])[:3]

        report_lines.extend([
            "### Top Performing Sectors (3M)",
            ""
        ])
        for sector, data in best_performers:
            report_lines.append(f"- **{sector}**: {data['avg_perf_3m']:.2f}%")

        report_lines.extend([
            "",
            "### Lagging Sectors (3M)",
            ""
        ])
        for sector, data in worst_performers:
            report_lines.append(f"- **{sector}**: {data['avg_perf_3m']:.2f}%")

        report_lines.extend([
            "",
            "### Sectors Near 52-Week Highs (Breakout Watch)",
            ""
        ])

        near_52w = [(s, d) for s, d in self.sector_data.items()
                   if d['pct_near_52w_high'] > 25]
        near_52w_sorted = sorted(near_52w, key=lambda x: x[1]['pct_near_52w_high'],
                                reverse=True)[:5]

        for sector, data in near_52w_sorted:
            report_lines.append(f"- **{sector}**: {data['pct_near_52w_high']:.1f}% of stocks near 52W high")

        report_lines.extend([
            "",
            "### Value Opportunities (Low P/E, Good Momentum)",
            ""
        ])

        value_stocks = [(s, d) for s, d in self.sector_data.items()
                       if pd.notna(d['avg_pe']) and d['avg_pe'] < 20 and d['avg_perf_3m'] > 0]
        value_stocks_sorted = sorted(value_stocks, key=lambda x: x[1]['avg_pe'])[:5]

        for sector, data in value_stocks_sorted:
            report_lines.append(f"- **{sector}**: P/E {data['avg_pe']:.1f}, 3M: {data['avg_perf_3m']:.2f}%")

        report_lines.extend([
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
            f"",
            f"*Report generated by Sector Cycle Analyzer*"
        ])

        # Write report
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(report_lines))

        print(f"✅ Report saved to {report_file}")
        return report_file


def main():
    """Main execution function."""
    print("=" * 70)
    print("     SECTOR CYCLE ANALYZER - Indian Market Cycles")
    print("=" * 70)

    # Initialize analyzer
    analyzer = SectorCycleAnalyzer(min_market_cap=10_000_000_000)

    try:
        # Step 1: Fetch market data
        df = analyzer.fetch_market_data(limit=5000)

        # Step 2: Analyze sectors
        analyzer.analyze_sectors()

        # Step 3: Detect cyclical patterns
        analyzer.detect_cyclical_patterns()

        # Step 4: Predict next cycle
        analyzer.predict_next_cycle()

        # Step 5: Generate visualizations
        output_dir = analyzer.create_visualizations()

        # Step 6: Generate summary report
        report_file = analyzer.generate_summary_report()

        print("\n" + "=" * 70)
        print("     ✅ ANALYSIS COMPLETE")
        print("=" * 70)
        print(f"\n📊 Visualizations: {output_dir}/")
        print(f"📝 Summary Report: {report_file}")
        print("\nKey Findings:")
        print(f"  - Sectors Analyzed: {len(analyzer.sector_data)}")
        print(f"  - Cyclical Patterns: {len(analyzer.cycle_patterns)}")
        print(f"  - Predictions Generated: {len(analyzer.predictions)}")

    except Exception as e:
        print(f"\n❌ Error during analysis: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
