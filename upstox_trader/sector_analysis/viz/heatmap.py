import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.colors import LinearSegmentedColormap
import matplotlib.patches as mpatches
from datetime import datetime
from typing import Dict

from .formatting import (
    console,
    CORRELATION_COLORS,
    HEATMAP_PALETTE,
    truncate_label,
)


class HeatmapMixin:
    def create_correlation_heatmap(self, correlation_matrix: pd.DataFrame, filename: str = None):
        if filename is None:
            filename = f"visualizations/sector_correlation_heatmap_{datetime.now().strftime('%Y%m%d_%H%M')}.png"

        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(16, 14))

        cmap = LinearSegmentedColormap.from_list('correlation', HEATMAP_PALETTE, N=256)

        mask = np.triu(np.ones_like(correlation_matrix, dtype=bool))
        sns.heatmap(correlation_matrix,
                    mask=mask,
                    annot=True,
                    cmap=cmap,
                    center=0,
                    fmt='.2f',
                    square=True,
                    linewidths=0.5,
                    cbar_kws={"shrink": 0.8, "label": "Correlation Coefficient"},
                    ax=ax)

        ax.set_title('📊 Sector Correlation Matrix Heatmap', fontsize=20, fontweight='bold', pad=20)
        ax.set_xticklabels([truncate_label(label) for label in correlation_matrix.columns], rotation=45, ha='right', fontsize=10)
        ax.set_yticklabels([truncate_label(label) for label in correlation_matrix.index], rotation=0, fontsize=10)

        legend_elements = [
            mpatches.Patch(color=CORRELATION_COLORS['strong_positive'], label='Strong Positive (>0.5)'),
            mpatches.Patch(color=CORRELATION_COLORS['moderate_positive'], label='Moderate Positive (0.2-0.5)'),
            mpatches.Patch(color=CORRELATION_COLORS['weak'], label='Weak (±0.2)'),
            mpatches.Patch(color=CORRELATION_COLORS['moderate_negative'], label='Moderate Negative (-0.5 to -0.2)'),
            mpatches.Patch(color=CORRELATION_COLORS['strong_negative'], label='Strong Negative (<-0.5)')
        ]
        ax.legend(handles=legend_elements, loc='upper right', bbox_to_anchor=(1.15, 1))

        plt.tight_layout()
        plt.savefig(filename, dpi=300, bbox_inches='tight', facecolor='#2d2d2d')
        plt.close()

        console.print(f"[green]✅ Correlation heatmap saved: {filename}[/green]")
        return filename

    def create_stock_correlation_heatmap(self, sector: str, sector_correlations: Dict, filename: str = None):
        if sector not in sector_correlations:
            console.print(f"[yellow]⚠️ No correlation data for {sector}[/yellow]")
            return None

        if filename is None:
            filename = f"visualizations/{sector.replace(' ', '_').lower()}_stock_correlations_{datetime.now().strftime('%Y%m%d_%H%M')}.png"

        corr_matrix = sector_correlations[sector]

        if len(corr_matrix) > 12:
            avg_corr = corr_matrix.abs().mean().sort_values(ascending=False)
            top_stocks = avg_corr.index[:12].tolist()
            corr_matrix = corr_matrix.loc[top_stocks, top_stocks]

        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(14, 12))

        mask = np.triu(np.ones_like(corr_matrix, dtype=bool))
        sns.heatmap(corr_matrix,
                    mask=mask,
                    annot=True,
                    cmap='RdYlBu_r',
                    center=0,
                    fmt='.2f',
                    square=True,
                    linewidths=0.5,
                    cbar_kws={"shrink": 0.8, "label": "Correlation"},
                    ax=ax)

        ax.set_title(f'🔗 {sector} - Stock-to-Stock Correlations\n(Top {len(corr_matrix)} stocks by connectivity)',
                    fontsize=16, fontweight='bold', pad=20)
        ax.set_xticklabels([truncate_label(label, 8) for label in corr_matrix.columns], rotation=45, ha='right', fontsize=8)
        ax.set_yticklabels([truncate_label(label, 8) for label in corr_matrix.index], rotation=0, fontsize=8)

        plt.tight_layout()
        plt.savefig(filename, dpi=300, bbox_inches='tight', facecolor='#2d2d2d')
        plt.close()

        console.print(f"[green]✅ {sector} stock correlation heatmap saved: {filename}[/green]")
        return filename
