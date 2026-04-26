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
from pathlib import Path

_script_dir = Path(__file__).parent
_project_root = _script_dir.parent
sys.path.insert(0, str(_project_root))

from .sector_cycle.fetcher import initialize_api, fetch_historical_data
from .sector_cycle.analyzer import analyze_sector_cycles, predict_next_cycles
from .sector_cycle.visualizer import (
    create_visualizations,
    export_data_for_dashboard,
    generate_summary_report,
)
from .sector_cycle.models import SECTOR_REPRESENTATIVES


class HistoricalSectorCycleAnalyzer:
    """Analyze multi-year sector cycles using historical price data."""

    def __init__(self, years: int = 3, provider: str = 'upstox'):
        self.years = years
        self.provider = provider
        self.api = None
        self.sector_data = {}
        self.cycle_patterns = {}
        self.predictions = {}

    def initialize_api(self):
        self.api = initialize_api(self.provider)
        return self.api is not None

    def fetch_historical_data_for_sectors(self) -> bool:
        if not self.api:
            if not self.initialize_api():
                return False
        self.sector_data = fetch_historical_data(self.api, self.years)
        return len(self.sector_data) > 0

    def analyze_sector_cycles(self):
        self.cycle_patterns = analyze_sector_cycles(self.sector_data)

    def predict_next_cycles(self):
        self.predictions = predict_next_cycles(self.cycle_patterns)

    def create_visualizations(self, output_dir: str = 'historical_sector_cycles'):
        return create_visualizations(
            self.cycle_patterns, self.predictions,
            self.sector_data, self.years, output_dir
        )

    def export_data_for_dashboard(self, output_dir: str = 'historical_sector_cycles'):
        return export_data_for_dashboard(
            self.cycle_patterns, self.predictions,
            self.sector_data, self.years, output_dir
        )

    def generate_summary_report(self, output_dir: str = 'historical_sector_cycles'):
        return generate_summary_report(
            self.cycle_patterns, self.predictions,
            self.sector_data, self.years, output_dir
        )


def main():
    print("=" * 70)
    print("  HISTORICAL SECTOR CYCLE ANALYZER")
    print(f"  Multi-Year Cycle Detection using Upstox API")
    print("=" * 70)

    analyzer = HistoricalSectorCycleAnalyzer(years=3, provider='upstox')

    try:
        if not analyzer.fetch_historical_data_for_sectors():
            print("\n❌ Failed to fetch historical data")
            return 1

        analyzer.analyze_sector_cycles()
        analyzer.predict_next_cycles()

        output_dir = analyzer.create_visualizations()
        report_file = analyzer.generate_summary_report()
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
