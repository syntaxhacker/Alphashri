import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from datetime import datetime
from typing import Dict, List

from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from .formatting import (
    console,
    get_rich_color,
    get_confidence_color,
    get_movement_color,
)


class ChartsMixin:
    def create_correlation_distribution_plot(self, correlation_matrix: pd.DataFrame, filename: str = None):
        if filename is None:
            filename = f"visualizations/correlation_distribution_{datetime.now().strftime('%Y%m%d_%H%M')}.png"

        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(12, 8))

        correlations = []
        for i in range(len(correlation_matrix.columns)):
            for j in range(i+1, len(correlation_matrix.columns)):
                corr_val = correlation_matrix.iloc[i, j]
                if not pd.isna(corr_val):
                    correlations.append(corr_val)

        n, bins, patches = ax.hist(correlations, bins=20, alpha=0.7,
                                  color='#64b5f6', edgecolor='black', linewidth=0.5)

        for patch, left, right in zip(patches, bins[:-1], bins[1:]):
            if left >= -1 and right <= -0.3:
                patch.set_facecolor('#d73027')
            elif left >= -0.3 and right <= 0.3:
                patch.set_facecolor('#fdae61')
            elif left >= 0.3 and right <= 1:
                patch.set_facecolor('#91cc75')

        ax.axvline(x=0.5, color='#91cc75', linestyle='--', linewidth=2, alpha=0.8, label='Strong Positive (0.5)')
        ax.axvline(x=-0.5, color='#d73027', linestyle='--', linewidth=2, alpha=0.8, label='Strong Negative (-0.5)')
        ax.axvline(x=0.3, color='#74add1', linestyle=':', linewidth=1, alpha=0.6, label='Moderate (0.3)')
        ax.axvline(x=-0.3, color='#f46d43', linestyle=':', linewidth=1, alpha=0.6, label='Moderate (-0.3)')

        ax.set_xlabel('Correlation Coefficient', fontsize=12)
        ax.set_ylabel('Frequency', fontsize=12)
        ax.set_title('📊 Distribution of Sector Correlations\n(Excluding diagonal - self correlations)',
                    fontsize=16, fontweight='bold', pad=20)
        ax.grid(True, alpha=0.3, linestyle='--')
        ax.legend()

        stats_text = f"Total Correlations: {len(correlations)}\n" \
                    f"Mean Correlation: {np.mean(correlations):.3f}\n" \
                    f"Median Correlation: {np.median(correlations):.3f}\n" \
                    f"Std Deviation: {np.std(correlations):.3f}"

        ax.text(0.02, 0.98, stats_text, transform=ax.transAxes,
               bbox=dict(boxstyle="round,pad=0.5", facecolor="#2d2d2d", alpha=0.8),
               verticalalignment='top', fontsize=10, color='white')

        plt.tight_layout()
        plt.savefig(filename, dpi=300, bbox_inches='tight', facecolor='#2d2d2d')
        plt.close()

        console.print(f"[green]✅ Correlation distribution plot saved: {filename}[/green]")
        return filename

    def display_correlation_matrix(self, correlation_matrix: pd.DataFrame):
        console.print(Panel.fit("📊 Sector Correlation Matrix", style="bold blue"))

        heatmap_file = self.create_correlation_heatmap(correlation_matrix)

        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Sector", style="cyan", no_wrap=True)

        for sector in correlation_matrix.columns:
            table.add_column(sector[:8], justify="center", style="yellow")

        for sector in correlation_matrix.index[:8]:
            row_data = [sector[:15]]
            for col_sector in correlation_matrix.columns:
                corr_val = correlation_matrix.loc[sector, col_sector]
                if pd.isna(corr_val):
                    row_data.append("-")
                elif sector == col_sector:
                    row_data.append("1.00")
                else:
                    color = get_rich_color(corr_val)
                    row_data.append(f"[{color}]{corr_val:.2f}[/{color}]")

            table.add_row(*row_data)

        console.print(table)
        console.print(f"[dim]💡 Full correlation matrix heatmap saved as image: {heatmap_file}[/dim]")

    def display_predictions(self, predictions: Dict[str, Dict], sector_stocks: Dict[str, List[Dict]],
                          correlation_matrix: pd.DataFrame,
                          calculate_intra_sector_func,
                          get_sector_stock_candidates_func,
                          create_stock_correlation_heatmap_func):
        if not predictions:
            console.print("[yellow]No predictions to display[/yellow]")
            return

        console.print(Panel.fit("🎯 Sector Movement Predictions", style="bold green"))

        pred_table = Table(show_header=True, header_style="bold magenta")
        pred_table.add_column("Sector", style="cyan")
        pred_table.add_column("Predicted Move", justify="center")
        pred_table.add_column("Correlation", justify="center")
        pred_table.add_column("Confidence", justify="center")
        pred_table.add_column("Direction", justify="center")

        sorted_predictions = sorted(predictions.items(), key=lambda x: abs(x[1]['predicted_movement']), reverse=True)

        for sector, pred in sorted_predictions:
            move_color = get_movement_color(pred['predicted_movement'])
            conf_color = get_confidence_color(pred['confidence'])
            dir_color = get_movement_color(pred['predicted_movement'])

            pred_table.add_row(
                sector,
                f"[{move_color}]{pred['predicted_movement']:+.2f}%[/{move_color}]",
                f"{pred['correlation']:+.2f}",
                f"[{conf_color}]{pred['confidence']:.2f}[/{conf_color}]",
                f"[{dir_color}]{pred['direction'].upper()}[/{dir_color}]"
            )

        console.print(pred_table)

        sector_correlations = calculate_intra_sector_func(sector_stocks)

        dist_file = self.create_correlation_distribution_plot(correlation_matrix)
        network_file = self.create_sector_network_graph(correlation_matrix)

        console.print(Panel.fit("📈 Top Stock Candidates with Intra-Sector Correlations", style="bold yellow"))

        for sector, pred in sorted_predictions[:3]:
            candidates = get_sector_stock_candidates_func(sector, sector_stocks, pred['direction'])

            if candidates:
                console.print(f"\n[bold cyan]{sector} - {pred['direction'].upper()} ({pred['predicted_movement']:+.2f}%)[/bold cyan]")

                stock_table = Table(show_header=True, header_style="bold blue")
                stock_table.add_column("Stock", style="cyan")
                stock_table.add_column("Price", justify="right")
                stock_table.add_column("Mkt Cap", justify="right")
                stock_table.add_column("Volume", justify="right")
                stock_table.add_column("1W Perf", justify="center")
                stock_table.add_column("RSI", justify="center")
                stock_table.add_column("Score", justify="center")

                top_candidates = candidates[:5]
                for stock in top_candidates:
                    perf_color = get_movement_color(stock.get('perf_w', 0))
                    rsi = stock.get('rsi', 50)
                    rsi_color = "red" if rsi > 70 else "green" if rsi < 30 else "white"

                    stock_table.add_row(
                        stock['symbol'][:12],
                        f"₹{stock.get('close', 0):.1f}",
                        f"₹{stock.get('market_cap', 0)/1e9:.1f}B",
                        f"{stock.get('volume', 0)/1e6:.1f}M",
                        f"[{perf_color}]{stock.get('perf_w', 0):+.1f}%[/{perf_color}]",
                        f"[{rsi_color}]{rsi:.0f}[/{rsi_color}]",
                        f"{stock['prediction_score']}"
                    )

                console.print(stock_table)

                if sector in sector_correlations:
                    console.print(f"\n[bold yellow]🔗 {sector} - Stock-to-Stock Correlations[/bold yellow]")

                    stock_heatmap_file = create_stock_correlation_heatmap_func(sector, sector_correlations)

                    corr_matrix = sector_correlations[sector]
                    top_stock_symbols = [s['symbol'] for s in top_candidates]

                    available_symbols = [s for s in top_stock_symbols if s in corr_matrix.columns]

                    if len(available_symbols) > 1:
                        filtered_corr = corr_matrix.loc[available_symbols, available_symbols]

                        summary_table = Table(show_header=True, header_style="bold magenta", title=f"{sector} - Top Stock Correlations")
                        summary_table.add_column("Stock Pair", style="cyan")
                        summary_table.add_column("Correlation", justify="center")
                        summary_table.add_column("Strength", justify="center")

                        strong_correlations = []
                        for i, stock1 in enumerate(available_symbols):
                            for j, stock2 in enumerate(available_symbols):
                                if i < j:
                                    try:
                                        corr_val = filtered_corr.loc[stock1, stock2]
                                        val = corr_val.iloc[0] if hasattr(corr_val, 'iloc') else corr_val
                                        if not pd.isna(val) and abs(val) > 0.4:
                                            strong_correlations.append((stock1, stock2, val))
                                    except:
                                        continue

                        if strong_correlations:
                            strong_correlations.sort(key=lambda x: abs(x[2]), reverse=True)
                            for stock1, stock2, corr in strong_correlations[:5]:
                                color = "green" if corr > 0 else "red"
                                strength = "Strong" if abs(corr) > 0.6 else "Moderate"
                                summary_table.add_row(f"{stock1[:8]} ↔ {stock2[:8]}",
                                                    f"[{color}]{corr:+.2f}[/{color}]",
                                                    f"[{color}]{strength}[/{color}]")

                            console.print(summary_table)
                            console.print(f"[dim]💡 Full stock correlation heatmap saved as image: {stock_heatmap_file}[/dim]")
                            console.print(f"[dim]🔗 When one stock rises, highly correlated stocks (>0.5) likely to follow[/dim]")
                        else:
                            console.print(f"[yellow]⚠️ No strong stock correlations found in {sector}[/yellow]")
                    else:
                        console.print(f"[yellow]⚠️ Insufficient correlation data for {sector}[/yellow]")
                else:
                    console.print(f"[yellow]⚠️ No correlation data available for {sector}[/yellow]")

                console.print("")

    def display_top_correlations(self, correlation_matrix, top_corrs):
        console.print(Panel.fit("🔗 Top Sector Correlations", style="bold green"))

        corr_table = Table(show_header=True, header_style="bold magenta")
        corr_table.add_column("Sector 1", style="cyan")
        corr_table.add_column("Sector 2", style="cyan")
        corr_table.add_column("Correlation", justify="center")
        corr_table.add_column("Relationship", justify="center")

        for sector1, sector2, corr_val in top_corrs[:10]:
            corr_color = get_movement_color(corr_val)
            relationship = "Positive" if corr_val > 0 else "Negative"

            corr_table.add_row(
                sector1,
                sector2,
                f"[{corr_color}]{corr_val:+.3f}[/{corr_color}]",
                f"[{corr_color}]{relationship}[/{corr_color}]"
            )

        console.print(corr_table)

    def display_sector_watch_table(self, performance: Dict[str, Dict], alerts: List[Dict]):
        if not performance:
            return

        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Sector", style="cyan", width=20)
        table.add_column("Change %", justify="center", width=10)
        table.add_column("Volume", justify="center", width=8)
        table.add_column("Strength", justify="center", width=10)
        table.add_column("Status", justify="center", width=12)

        alert_sectors = set()
        for alert in alerts:
            alert_sectors.add(alert['trigger_sector'])

        sorted_sectors = sorted(performance.items(), key=lambda x: x[1]['strength'], reverse=True)

        for sector, data in sorted_sectors[:15]:
            change = data['change']
            volume = data['volume_ratio']
            strength = data['strength']

            change_color = get_movement_color(change)
            volume_color = "yellow" if volume > 1.5 else "white"

            if sector in alert_sectors:
                status = "[bold red]🚨 ALERT[/bold red]"
            elif abs(change) > 2.0:
                status = "[yellow]📈 STRONG[/yellow]" if change > 0 else "[yellow]📉 WEAK[/yellow]"
            elif volume > 2.0:
                status = "[cyan]📊 VOLUME[/cyan]"
            else:
                status = "[dim]➖ NORMAL[/dim]"

            table.add_row(
                sector.split()[0],
                f"[{change_color}]{change:+.2f}%[/{change_color}]",
                f"[{volume_color}]{volume:.1f}x[/{volume_color}]",
                f"{strength:.2f}",
                status
            )

        console.print(table)

    def display_intraday_alerts(self, alerts: List[Dict]):
        if not alerts:
            return

        console.print(Panel.fit("🚨 INTRADAY CORRELATION ALERTS", style="bold red"))

        for alert in alerts:
            signal_color = "green" if alert['signal_type'] == 'BULLISH' else "red"

            console.print(f"\n[bold {signal_color}]📊 {alert['trigger_sector'].upper()} | {alert['movement']:+.2f}% | {alert['signal_type']}[/bold {signal_color}]")

            timestamp = alert['timestamp']
            if hasattr(timestamp, 'strftime'):
                console.print(f"[dim]Current Change: {alert['current_change']:+.2f}% | Volume: {alert['volume_ratio']:.1f}x | {timestamp.strftime('%H:%M:%S')}[/dim]")
            else:
                console.print(f"[dim]Current Change: {alert['current_change']:+.2f}% | Volume: {alert['volume_ratio']:.1f}x[/dim]")

            if alert['correlated_sectors']:
                corr_table = Table(show_header=True, header_style="bold blue", title="Correlation-Based Predictions")
                corr_table.add_column("Target Sector", style="cyan")
                corr_table.add_column("Correlation", justify="center")
                corr_table.add_column("Predicted Move", justify="center")
                corr_table.add_column("Current Status", justify="center")
                corr_table.add_column("Action", justify="center")

                for pred in alert['correlated_sectors'][:5]:
                    corr_strength = abs(pred['correlation'])
                    pred_move = pred['predicted_move']
                    current_change = pred['current_change']

                    if abs(current_change) < abs(pred_move) * 0.5:
                        action = "[green]🎯 ENTER[/green]" if pred_move > 0 else "[red]🎯 SHORT[/red]"
                    elif abs(current_change) > abs(pred_move) * 1.2:
                        action = "[yellow]⚠️ LATE[/yellow]"
                    else:
                        action = "[blue]👁️ WATCH[/blue]"

                    corr_color = "green" if corr_strength > 0.6 else "yellow" if corr_strength > 0.4 else "white"
                    pred_color = get_movement_color(pred_move)
                    curr_color = get_movement_color(current_change)

                    corr_table.add_row(
                        pred['sector'].split()[0],
                        f"[{corr_color}]{pred['correlation']:+.2f}[/{corr_color}]",
                        f"[{pred_color}]{pred_move:+.2f}%[/{pred_color}]",
                        f"[{curr_color}]{current_change:+.2f}%[/{curr_color}]",
                        action
                    )

                console.print(corr_table)
