import json
from pathlib import Path
from datetime import datetime
from typing import Dict

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Patch
import seaborn as sns
from scipy.fft import fft, fftfreq

from .analyzer import calculate_sector_stats

plt.style.use('seaborn-v0_8-darkgrid')
sns.set_palette("husl")


def create_visualizations(cycle_patterns: Dict, predictions: Dict, sector_data: Dict, years: int, output_dir: str = 'historical_sector_cycles'):
    print(f"\n📊 Generating visualizations in {output_dir}/...")

    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    _plot_sector_performance_timeline(output_path, cycle_patterns, years)
    _plot_sector_cycle_detection(output_path, cycle_patterns)
    _plot_sector_phase_comparison(output_path, cycle_patterns)
    _plot_cycle_periodogram(output_path, cycle_patterns)
    _plot_seasonal_patterns(output_path, cycle_patterns)
    _plot_sector_correlation_heatmap(output_path, cycle_patterns)
    _plot_drawdown_analysis(output_path, cycle_patterns)
    _plot_cycle_prediction_timeline(output_path, predictions)

    print(f"✅ Generated 8 visualizations in {output_path}/")
    return output_path


def export_data_for_dashboard(cycle_patterns: Dict, predictions: Dict, sector_data: Dict, years: int, output_dir: str = 'historical_sector_cycles'):
    print(f"\n💾 Exporting data for D3 dashboard...")

    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    dashboard_data = {
        'metadata': {
            'generated_at': datetime.now().isoformat(),
            'analysis_period_years': years,
            'total_sectors': len(sector_data),
            'total_stocks': sum(len(v['dataframes']) for v in sector_data.values())
        },
        'sectors': []
    }

    for sector, pattern in cycle_patterns.items():
        returns_data = pattern['returns'].reset_index()
        returns_data.columns = ['date', 'value']
        returns_list = []
        for _, row in returns_data.iterrows():
            returns_list.append({
                'date': row['date'].strftime('%Y-%m-%d'),
                'value': float(row['value'])
            })

        sector_data_entry = {
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

        if 'fft_cycles' in pattern['cycle_info'] and pattern['cycle_info']['fft_cycles']:
            sector_data_entry['cycles'] = []
            for cycle in pattern['cycle_info']['fft_cycles'][:3]:
                sector_data_entry['cycles'].append({
                    'period_days': float(cycle['period_days']),
                    'period_months': float(cycle['period_months']),
                    'power': float(cycle['power'])
                })

        if sector in predictions:
            pred = predictions[sector]
            sector_data_entry['prediction'] = {
                'next_phase': pred.get('next_phase', 'N/A'),
                'timeframe': pred.get('timeframe', 'N/A'),
                'confidence': pred.get('confidence', 'N/A')
            }

        dashboard_data['sectors'].append(sector_data_entry)

    dashboard_data['sectors'].sort(key=lambda x: x['current_return'], reverse=True)

    json_file = output_path / 'dashboard_data.json'
    with open(json_file, 'w') as f:
        json.dump(dashboard_data, f, indent=2)

    print(f"✅ Data exported to {json_file}")
    return json_file


def generate_summary_report(cycle_patterns: Dict, predictions: Dict, sector_data: Dict, years: int, output_dir: str = 'historical_sector_cycles'):
    print(f"\n📝 Generating summary report...")

    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    report_file = output_path / 'HISTORICAL_SECTOR_CYCLE_REPORT.md'

    lines = [
        "# Historical Sector Cycle Analysis Report",
        "",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"**Data Source:** Upstox API (Historical Price Data)",
        f"**Analysis Period:** {years} Years",
        f"**Sectors Analyzed:** {len(sector_data)}",
        f"**Total Stocks:** {sum(len(v['dataframes']) for v in sector_data.values())}",
        "",
        "---",
        "",
        "## Executive Summary",
        "",
        f"This report analyzes **{years}-year historical price data** for Indian market sectors",
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

    for sector, pattern in cycle_patterns.items():
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

    lines.extend([
        "## Cycle Predictions",
        "",
        "### Next Expected Phase by Sector",
        "",
        "| Sector | Current Phase | Next Phase | Timeframe | Confidence |",
        "|--------|---------------|------------|-----------|------------|"
    ])

    for sector, pred in predictions.items():
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
        "1. **sector_performance_timeline.png** - Cumulative returns over {years} years",
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

    best_sectors = sorted(cycle_patterns.items(),
                          key=lambda x: x[1]['stats']['avg_total_return'],
                          reverse=True)[:3]

    worst_sectors = sorted(cycle_patterns.items(),
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

    accum_sectors = [(s, p) for s, p in predictions.items()
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
        f"*Analysis period: {years} years | Data source: Upstox API*"
    ])

    with open(report_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"✅ Report saved to {report_file}")
    return report_file


def _calculate_drawdown_series(returns: pd.Series) -> pd.Series:
    cumulative = (1 + returns / 100).cumprod()
    running_max = cumulative.expanding().max()
    drawdown = ((cumulative - running_max) / running_max) * 100
    return drawdown


def _plot_sector_performance_timeline(output_path: Path, cycle_patterns: Dict, years: int):
    fig, ax = plt.subplots(figsize=(16, 10))

    for sector, pattern in cycle_patterns.items():
        returns = pattern['returns']
        ax.plot(returns.index, returns.values,
                label=sector, linewidth=2, alpha=0.8)

    ax.axhline(y=0, color='black', linestyle='--', linewidth=1, alpha=0.5)
    ax.set_xlabel('Date', fontsize=12, fontweight='bold')
    ax.set_ylabel('Cumulative Return %', fontsize=12, fontweight='bold')
    ax.set_title(f'Sector Performance Timeline ({years} Years)',
                 fontsize=16, fontweight='bold', pad=20)
    ax.legend(loc='best', ncol=2)
    ax.grid(True, alpha=0.3)

    ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
    plt.xticks(rotation=45)

    plt.tight_layout()
    plt.savefig(output_path / 'sector_performance_timeline.png',
                dpi=300, bbox_inches='tight')
    plt.close()


def _plot_sector_cycle_detection(output_path: Path, cycle_patterns: Dict):
    n_sectors = len(cycle_patterns)
    if n_sectors == 0:
        return

    fig, axes = plt.subplots(n_sectors, 1, figsize=(16, 4 * n_sectors))
    if n_sectors == 1:
        axes = [axes]

    for idx, (sector, pattern) in enumerate(cycle_patterns.items()):
        ax = axes[idx]
        returns = pattern['returns']

        ax.plot(returns.index, returns.values, label='Returns', linewidth=2)

        if 'fft_cycles' in pattern['cycle_info']:
            cycles = pattern['cycle_info']['fft_cycles']
            cycle_info_text = f"Detected Cycles: "
            for i, cycle in enumerate(cycles[:2]):
                cycle_info_text += f"{cycle['period_months']:.1f}mo, "
            ax.text(0.02, 0.95, cycle_info_text[:-2],
                    transform=ax.transAxes, fontsize=10,
                    verticalalignment='top',
                    bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

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


def _plot_sector_phase_comparison(output_path: Path, cycle_patterns: Dict):
    fig, axes = plt.subplots(1, 2, figsize=(18, 8))

    ax1 = axes[0]
    phase_counts = {}
    for pattern in cycle_patterns.values():
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

    ax2 = axes[1]
    sectors_by_phase = {'ACCUMULATION': [], 'MARKUP': [],
                        'DISTRIBUTION': [], 'MARKDOWN': []}

    for sector, pattern in cycle_patterns.items():
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


def _plot_cycle_periodogram(output_path: Path, cycle_patterns: Dict):
    n_sectors = len(cycle_patterns)
    if n_sectors == 0:
        return

    fig, axes = plt.subplots(2, 2, figsize=(18, 12))
    axes = axes.flatten()

    for idx, (sector, pattern) in enumerate(list(cycle_patterns.items())[:4]):
        if idx >= 4:
            break

        ax = axes[idx]
        returns = pattern['returns'].dropna()
        n = len(returns)

        fft_values = fft(returns.values)
        fft_freq = fftfreq(n, d=1)

        positive_freq_idx = (fft_freq > 0) & (fft_freq < 0.1)
        positive_freq = fft_freq[positive_freq_idx]
        positive_power = np.abs(fft_values[positive_freq_idx])

        periods = 1 / positive_freq
        periods_months = periods / 21

        ax.plot(periods_months, positive_power, linewidth=2)
        ax.set_xlabel('Period (Months)', fontsize=10, fontweight='bold')
        ax.set_ylabel('Power', fontsize=10, fontweight='bold')
        ax.set_title(f'{sector} - Frequency Spectrum', fontsize=12, fontweight='bold')
        ax.grid(True, alpha=0.3)
        ax.set_xlim(0, 36)

        if 'fft_cycles' in pattern['cycle_info'] and pattern['cycle_info']['fft_cycles']:
            for cycle in pattern['cycle_info']['fft_cycles'][:2]:
                ax.axvline(x=cycle['period_months'], color='red',
                           linestyle='--', alpha=0.5, linewidth=2)

    plt.tight_layout()
    plt.savefig(output_path / 'cycle_periodogram.png',
                dpi=300, bbox_inches='tight')
    plt.close()


def _plot_seasonal_patterns(output_path: Path, cycle_patterns: Dict):
    fig, axes = plt.subplots(2, 1, figsize=(16, 12))

    all_monthly_returns = {}

    for sector, pattern in cycle_patterns.items():
        if 'seasonal_pattern' in pattern['cycle_info']:
            monthly_pattern = pattern['cycle_info']['seasonal_pattern']
            for month, ret in monthly_pattern.items():
                if month not in all_monthly_returns:
                    all_monthly_returns[month] = []
                all_monthly_returns[month].append(ret)

    avg_monthly_returns = {}
    for month, returns_list in all_monthly_returns.items():
        avg_monthly_returns[month] = np.mean(returns_list)

    ax1 = axes[0]
    months = list(range(1, 13))
    avg_returns = [avg_monthly_returns.get(m, 0) * 100 for m in months]

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

    ax2 = axes[1]
    sector_monthly_data = []

    for sector, pattern in cycle_patterns.items():
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


def _plot_sector_correlation_heatmap(output_path: Path, cycle_patterns: Dict):
    returns_data = {}

    for sector, pattern in cycle_patterns.items():
        returns = pattern['returns'].dropna()
        monthly_returns = returns.resample('M').last().pct_change().dropna()
        returns_data[sector] = monthly_returns

    if len(returns_data) < 2:
        return

    df_returns = pd.DataFrame(returns_data)
    correlation = df_returns.corr()

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


def _plot_drawdown_analysis(output_path: Path, cycle_patterns: Dict):
    fig, axes = plt.subplots(2, 1, figsize=(16, 12))

    ax1 = axes[0]

    for sector, pattern in cycle_patterns.items():
        returns = pattern['returns']
        drawdown = _calculate_drawdown_series(returns)
        ax1.fill_between(drawdown.index, drawdown.values, 0,
                         alpha=0.3, label=sector)

    ax1.set_xlabel('Date', fontsize=11, fontweight='bold')
    ax1.set_ylabel('Drawdown %', fontsize=11, fontweight='bold')
    ax1.set_title('Sector Drawdown Timeline', fontsize=14, fontweight='bold')
    ax1.legend(loc='best', ncol=2, fontsize=8)
    ax1.grid(True, alpha=0.3)

    ax2 = axes[1]
    sectors = []
    max_drawdowns = []

    for sector, pattern in cycle_patterns.items():
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


def _plot_cycle_prediction_timeline(output_path: Path, predictions: Dict):
    fig, ax = plt.subplots(figsize=(16, 10))

    y_pos = 0
    sector_positions = []

    for sector, prediction in predictions.items():
        current_phase = prediction['current_phase']
        current_return = prediction['current_return']

        phase_colors = {'ACCUMULATION': 'blue', 'MARKUP': 'green',
                        'DISTRIBUTION': 'orange', 'MARKDOWN': 'red'}
        color = phase_colors.get(current_phase, 'gray')

        ax.scatter(current_return, y_pos, s=200, color=color,
                   edgecolors='black', linewidth=2, zorder=3)

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
        y_pos += 1

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
