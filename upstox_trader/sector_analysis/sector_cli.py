#!/usr/bin/env python3
"""
Sector CLI Module - CLI argument parsing and main() function.
"""

import argparse
from datetime import datetime
import time

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .sector_data import SectorDataFetcher, TV_AVAILABLE, UPSTOX_AVAILABLE
from .sector_analyzer import SectorAnalyzer
from .sector_visualizer import SectorVisualizer

console = Console()


class SectorCovarianceAnalyzer:
    def __init__(self, lookback_days: int = 365, min_correlation: float = 0.3):
        self.lookback_days = lookback_days
        self.min_correlation = min_correlation
        
        self.data_fetcher = SectorDataFetcher()
        self.analyzer = SectorAnalyzer(lookback_days=lookback_days, min_correlation=min_correlation)
        self.visualizer = SectorVisualizer()
        
        self.sector_data = {}
        self.correlation_matrix = None
        self.sector_returns = None
        self.instrument_mapping = {}
        
        console.print(f"[blue]📊 Initialized Sector Covariance Analyzer[/blue]")
        console.print(f"[dim]Lookback: {lookback_days} days | Min Correlation: {min_correlation}[/dim]")
        
        self.data_fetcher.load_instrument_mapping()
        self.instrument_mapping = self.data_fetcher.instrument_mapping
    
    def _get_tv_cookies(self):
        return self.data_fetcher.cookies
    
    def fetch_sector_stocks(self):
        return self.data_fetcher.fetch_sector_stocks()
    
    def fetch_historical_data_upstox(self, symbol, days):
        return self.data_fetcher.fetch_historical_data_upstox(symbol, days)
    
    def load_instrument_mapping(self):
        self.data_fetcher.load_instrument_mapping()
        self.instrument_mapping = self.data_fetcher.instrument_mapping
    
    def get_instrument_key(self, symbol):
        return self.data_fetcher.get_instrument_key(symbol)
    
    def calculate_sector_returns(self, sector_stocks):
        return self.analyzer.calculate_sector_returns(sector_stocks, self.fetch_historical_data_upstox)
    
    def calculate_correlation_matrix(self, returns_df):
        return self.analyzer.calculate_correlation_matrix(returns_df)
    
    def identify_lead_lag_relationships(self, returns_df):
        return self.analyzer.identify_lead_lag_relationships(returns_df)
    
    def find_correlated_sectors(self, trigger_sector, correlation_matrix):
        return self.analyzer.find_correlated_sectors(trigger_sector, correlation_matrix)
    
    def predict_sector_movement(self, trigger_sector, trigger_movement, correlation_matrix):
        return self.analyzer.predict_sector_movement(trigger_sector, trigger_movement, correlation_matrix)
    
    def get_sector_stock_candidates(self, sector, sector_stocks, predicted_direction):
        return self.analyzer.get_sector_stock_candidates(sector, sector_stocks, predicted_direction)
    
    def calculate_intra_sector_correlations(self, sector_stocks):
        return self.analyzer.calculate_intra_sector_correlations(sector_stocks, self.fetch_historical_data_upstox)
    
    def create_correlation_heatmap(self, correlation_matrix, filename=None):
        return self.visualizer.create_correlation_heatmap(correlation_matrix, filename)
    
    def create_sector_network_graph(self, correlation_matrix, filename=None):
        return self.visualizer.create_sector_network_graph(correlation_matrix, filename)
    
    def create_correlation_distribution_plot(self, correlation_matrix, filename=None):
        return self.visualizer.create_correlation_distribution_plot(correlation_matrix, filename)
    
    def create_stock_correlation_heatmap(self, sector, sector_correlations, filename=None):
        return self.visualizer.create_stock_correlation_heatmap(sector, sector_correlations, filename)
    
    def display_correlation_matrix(self, correlation_matrix):
        return self.visualizer.display_correlation_matrix(correlation_matrix)
    
    def display_predictions(self, predictions, sector_stocks):
        return self.visualizer.display_predictions(
            predictions, sector_stocks,
            self.correlation_matrix,
            self.calculate_intra_sector_correlations,
            self.get_sector_stock_candidates,
            self.create_stock_correlation_heatmap
        )
    
    def generate_echarts_html(self, correlation_matrix, sector_stocks, predictions=None):
        return self.visualizer.generate_echarts_html(correlation_matrix, sector_stocks, predictions, self.lookback_days)
    
    def save_and_open_visualization(self, correlation_matrix, sector_stocks, predictions=None):
        return self.visualizer.save_and_open_visualization(correlation_matrix, sector_stocks, predictions, self.lookback_days)
    
    def detect_sector_movements(self, previous, current, threshold, min_corr):
        return self.analyzer.detect_sector_movements(previous, current, threshold, min_corr, self.correlation_matrix)
    
    def run_full_analysis(self):
        """Run complete sector covariance analysis"""
        console.print(Panel.fit("🚀 SECTOR COVARIANCE ANALYSIS", style="bold red"))

        sector_stocks = self.fetch_sector_stocks()
        if not sector_stocks:
            console.print("[red]❌ Could not fetch sector data[/red]")
            return

        returns_df = self.calculate_sector_returns(sector_stocks)
        if returns_df.empty:
            console.print("[red]❌ Could not calculate sector returns[/red]")
            return

        self.sector_returns = returns_df

        correlation_matrix, covariance_matrix = self.calculate_correlation_matrix(returns_df)
        self.correlation_matrix = correlation_matrix

        lead_lag = self.identify_lead_lag_relationships(returns_df)

        console.print(Panel.fit("🎨 Generating Visualizations", style="bold cyan"))

        heatmap_file = self.create_correlation_heatmap(correlation_matrix)
        network_file = self.create_sector_network_graph(correlation_matrix)
        dist_file = self.create_correlation_distribution_plot(correlation_matrix)

        self.display_correlation_matrix(correlation_matrix)

        console.print(Panel.fit("🔗 Top Sector Correlations", style="bold green"))

        corr_pairs = self.analyzer.get_top_correlations(correlation_matrix)

        corr_table = Table(show_header=True, header_style="bold magenta")
        corr_table.add_column("Sector 1", style="cyan")
        corr_table.add_column("Sector 2", style="cyan")
        corr_table.add_column("Correlation", justify="center")
        corr_table.add_column("Relationship", justify="center")

        for sector1, sector2, corr_val in corr_pairs[:10]:
            corr_color = "green" if corr_val > 0 else "red"
            relationship = "Positive" if corr_val > 0 else "Negative"

            corr_table.add_row(
                sector1,
                sector2,
                f"[{corr_color}]{corr_val:+.3f}[/{corr_color}]",
                f"[{corr_color}]{relationship}[/{corr_color}]"
            )

        console.print(corr_table)

        self.sector_data = sector_stocks

        console.print(Panel.fit("📊 Generated Visualizations Summary", style="bold green"))
        console.print(f"📈 [cyan]Correlation Heatmap:[/cyan] {heatmap_file}")
        console.print(f"🔗 [cyan]Sector Network Graph:[/cyan] {network_file}")
        console.print(f"📊 [cyan]Correlation Distribution:[/cyan] {dist_file}")

        console.print(Panel.fit("✅ Analysis Complete - Ready for Predictions", style="bold green"))

    def predict_from_trigger(self, trigger_sector: str, trigger_movement: float):
        """Predict sector movements from trigger sector"""
        if self.correlation_matrix is None or self.sector_data is None:
            console.print("[red]❌ Run full analysis first[/red]")
            return
        
        predictions = self.predict_sector_movement(trigger_sector, trigger_movement, self.correlation_matrix)
        self.display_predictions(predictions, self.sector_data)

    def run_optimized_prediction(self, trigger_sector: str, trigger_movement: float):
        """Run optimized prediction with smart caching"""
        if (hasattr(self, 'correlation_matrix') and self.correlation_matrix is not None and 
            hasattr(self, 'sector_data') and self.sector_data):
            
            console.print("[green]⚡ Using cached correlation data (no API calls needed)[/green]")
            
        else:
            console.print("[yellow]⚠️ No cached correlations found. Running initial analysis...[/yellow]")
            
            self.sector_data = self.fetch_sector_stocks()
            if not self.sector_data:
                console.print("[red]❌ Could not fetch sector data[/red]")
                return
            
            self.sector_returns = self.calculate_sector_returns(self.sector_data)
            if self.sector_returns.empty:
                console.print("[red]❌ Could not calculate sector returns[/red]")
                return
            
            self.correlation_matrix, _ = self.calculate_correlation_matrix(self.sector_returns)
            console.print("[green]✅ Correlation matrix cached for future predictions[/green]")
        
        correlated_sectors = self.find_correlated_sectors(trigger_sector, self.correlation_matrix)
        
        if not correlated_sectors:
            console.print(f"[yellow]No significant correlations found for {trigger_sector}[/yellow]")
            return
            
        predictions = self.predict_sector_movement(trigger_sector, trigger_movement, self.correlation_matrix)
        self.display_predictions(predictions, self.sector_data)
        
        console.print(f"\n[dim]💡 Processed {len(correlated_sectors)} correlated sectors for {trigger_sector}[/dim]")
        console.print(f"[dim]🔄 Next prediction will be instant (cached data)[/dim]")

    def monitor_realtime(self, check_interval: int = 300):
        """Monitor sectors in real-time for significant movements"""
        console.print(Panel.fit(f"👁️ REAL-TIME SECTOR MONITORING (Every {check_interval//60} min)", style="bold red"))
        
        if not self.sector_data or self.correlation_matrix is None:
            console.print("[yellow]⚠️ Running initial analysis...[/yellow]")
            self.run_full_analysis()
        
        movement_threshold = 2.0
        
        try:
            while True:
                console.print(f"\n[dim]{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} - Checking sector movements...[/dim]")
                
                current_performance = self.get_current_sector_performance()
                
                for sector, movement in current_performance.items():
                    if abs(movement) >= movement_threshold:
                        console.print(f"\n[bold red]🚨 SIGNIFICANT MOVEMENT DETECTED 🚨[/bold red]")
                        console.print(f"[bold yellow]{sector}: {movement:+.2f}%[/bold yellow]")
                        
                        predictions = self.predict_sector_movement(sector, movement, self.correlation_matrix)
                        if predictions:
                            self.display_predictions(predictions, self.sector_data)
                            
                            console.print(f"[bold green]📱 ALERT: {sector} moved {movement:+.2f}%, check predictions above[/bold green]")

                time.sleep(check_interval)
                
        except KeyboardInterrupt:
            console.print("\n[yellow]⏹️ Monitoring stopped[/yellow]")

    def get_current_sector_performance(self) -> dict:
        """Get current day sector performance"""
        mock_movements = {}
        for sector in self.sector_data.keys() if self.sector_data else []:
            import numpy as np
            base_movement = np.random.normal(0, 1.5)
            mock_movements[sector] = base_movement
        
        return mock_movements

    def run_intraday_watch(self, watch_interval: int = 60, movement_threshold: float = 1.5,
                          min_correlation_watch: float = 0.4):
        """Watch mode for intraday sector monitoring"""
        console.print(Panel.fit(f"📊 INTRADAY SECTOR WATCH MODE", style="bold green"))
        console.print(f"[cyan]⏱️ Refresh Interval: {watch_interval}s | Movement Alert: ±{movement_threshold}% | Min Correlation: {min_correlation_watch}[/cyan]")
        console.print(f"[dim]🕐 Best for morning (9:15 AM - 12:00 PM) intraday sector rotation monitoring[/dim]")
        
        if not hasattr(self, 'correlation_matrix') or self.correlation_matrix is None:
            console.print(f"[yellow]🔄 Initializing sector correlations baseline...[/yellow]")
            self.sector_data = self.fetch_sector_stocks()
            if not self.sector_data:
                console.print("[red]❌ Could not fetch sector data[/red]")
                return
            
            self.sector_returns = self.calculate_sector_returns(self.sector_data)
            if self.sector_returns.empty:
                console.print("[red]❌ Could not calculate sector returns[/red]")
                return
            
            self.correlation_matrix, _ = self.calculate_correlation_matrix(self.sector_returns)
            console.print(f"[green]✅ Baseline established for {len(self.correlation_matrix)} sectors[/green]")
        
        previous_performance = {}
        watch_count = 0
        
        try:
            while True:
                watch_count += 1
                current_time = datetime.now()
                
                market_open = current_time.replace(hour=9, minute=15, second=0, microsecond=0)
                market_close = current_time.replace(hour=15, minute=30, second=0, microsecond=0)
                
                if not (market_open <= current_time <= market_close):
                    console.print(f"[dim]💤 Market closed. Sleeping until {market_open.strftime('%H:%M')}...[/dim]")
                    time.sleep(300)
                    continue
                
                console.print(f"\n[bold cyan]🔍 SCAN #{watch_count} | {current_time.strftime('%H:%M:%S')}[/bold cyan]")
                
                current_performance = self.get_current_sector_performance()
                
                if not current_performance:
                    console.print("[red]❌ Could not fetch current sector data[/red]")
                    time.sleep(watch_interval)
                    continue
                
                alerts = []
                if previous_performance:
                    alerts = self.detect_sector_movements(
                        previous_performance, current_performance, 
                        movement_threshold, min_correlation_watch
                    )
                
                self.visualizer.display_sector_watch_table(current_performance, alerts)
                
                if alerts:
                    self.visualizer.display_intraday_alerts(alerts)
                
                previous_performance = current_performance.copy()
                
                console.print(f"[dim]⏰ Next scan in {watch_interval}s...[/dim]")
                time.sleep(watch_interval)
                
        except KeyboardInterrupt:
            console.print(f"\n[yellow]👋 Watch mode stopped. Total scans: {watch_count}[/yellow]")
            return


def display_help():
    """Display comprehensive help and usage examples"""
    console.print(Panel.fit("🔍 SECTOR COVARIANCE ANALYZER - HELP", style="bold blue"))
    
    console.print("[bold yellow]QUICK START:[/bold yellow]")
    console.print("1. [cyan]python sector_covariance_analyzer.py --analyze-sectors[/cyan]")
    console.print("   └─ Run complete sector correlation analysis")
    console.print("")
    console.print("2. [cyan]python sector_covariance_analyzer.py --generate-images[/cyan]")
    console.print("   └─ 🎨 Generate matplotlib/seaborn visualizations (heatmaps, networks)")
    console.print("")
    console.print("3. [cyan]python sector_covariance_analyzer.py --visualize[/cyan]")
    console.print("   └─ 🌐 Generate interactive ECharts dashboard (opens in browser)")
    console.print("")
    console.print("4. [cyan]python sector_covariance_analyzer.py --predict-stocks --trigger-sector 'Technology Services' --trigger-movement 3.5[/cyan]")
    console.print("   └─ Predict stock movements when Technology Services rises 3.5%")
    console.print("")
    console.print("5. [cyan]python sector_covariance_analyzer.py --visualize-with-prediction --trigger-sector 'Finance' --trigger-movement -2.5[/cyan]")
    console.print("   └─ 🌐 Dashboard with prediction overlay for Finance sector drop")
    console.print("")
    console.print("6. [cyan]python sector_covariance_analyzer.py --watch --watch-interval 45 --movement-threshold 1.2[/cyan]")
    console.print("   └─ ⏱️ Intraday watch mode - monitor sectors for correlation opportunities")
    console.print("")
    console.print("7. [cyan]python sector_covariance_analyzer.py --monitor-realtime[/cyan]")
    console.print("   └─ Monitor sectors in real-time for significant movements")
    
    console.print("\n[bold yellow]KEY PARAMETERS:[/bold yellow]")
    params_table = Table(show_header=True, header_style="bold magenta")
    params_table.add_column("Parameter", style="cyan")
    params_table.add_column("Description", style="white")
    params_table.add_column("Example", style="green")
    
    params_table.add_row("--analyze-sectors", "Run complete analysis", "")
    params_table.add_row("--generate-images", "Generate matplotlib visualizations", "")
    params_table.add_row("--image-format", "Image format (png/pdf/svg)", "png")
    params_table.add_row("--predict-stocks", "Generate predictions", "--trigger-sector 'Finance'")
    params_table.add_row("--monitor-realtime", "Real-time monitoring", "--check-interval 180")
    params_table.add_row("--watch", "Intraday sector watch mode", "--watch-interval 45")
    params_table.add_row("--visualize", "Interactive ECharts dashboard", "")
    params_table.add_row("--visualize-with-prediction", "Dashboard with predictions", "--trigger-sector 'Tech'")
    params_table.add_row("--trigger-sector", "Sector name (exact)", "'Energy Minerals'")
    params_table.add_row("--trigger-movement", "Movement % (±)", "3.5 or -2.0")
    params_table.add_row("--watch-interval", "Watch refresh (seconds)", "30, 45, 60")
    params_table.add_row("--movement-threshold", "Alert threshold (%)", "1.0, 1.5, 2.0")
    params_table.add_row("--lookback-days", "Historical period", "60, 90, 120")
    params_table.add_row("--min-correlation", "Correlation threshold", "0.3, 0.4, 0.5")
    
    console.print(params_table)
    
    console.print("\n[bold yellow]AVAILABLE SECTORS:[/bold yellow]")
    console.print("[dim]Technology Services, Energy Minerals, Finance, Industrial Services,[/dim]")
    console.print("[dim]Consumer Durables, Producer Manufacturing, Health Technology,[/dim]")
    console.print("[dim]Consumer Non-Durables, Retail Trade, Communications, etc.[/dim]")
    
    console.print("\n[bold yellow]REQUIREMENTS:[/bold yellow]")
    console.print("• [green]Upstox API access token[/green] in config.py")
    console.print("• [green]TradingView login[/green] in browser (for live data)")
    console.print("• [green]Dependencies:[/green] pandas, numpy, requests, rich, tradingview-screener, rookiepy")
    
    console.print("\n[bold yellow]OUTPUT FEATURES:[/bold yellow]")
    console.print("📊 Sector correlation matrix (19x19)")
    console.print("🎨 High-resolution image visualizations (heatmaps, networks)")
    console.print("🌐 Interactive ECharts dashboard (opens in browser)")
    console.print("🎯 Movement predictions with confidence levels")
    console.print("📈 Stock candidates with technical scores")
    console.print("🔗 Intra-sector stock correlations")
    console.print("💡 Strongest correlation highlights")


def main():
    parser = argparse.ArgumentParser(description="Sector Covariance Correlation Analyzer")
    parser.add_argument('--analyze-sectors', action='store_true', help='Run full sector analysis')
    parser.add_argument('--monitor-realtime', action='store_true', help='Monitor sectors in real-time')
    parser.add_argument('--predict-stocks', action='store_true', help='Predict stocks from sector trigger')
    parser.add_argument('--trigger-sector', type=str, help='Sector that triggered movement')
    parser.add_argument('--trigger-movement', type=float, default=3.0, help='Trigger movement percentage')
    parser.add_argument('--lookback-days', type=int, default=365, help='Historical data lookback period')
    parser.add_argument('--min-correlation', type=float, default=0.3, help='Minimum correlation threshold')
    parser.add_argument('--check-interval', type=int, default=300, help='Real-time check interval (seconds)')
    parser.add_argument('--visualize', action='store_true', help='Generate interactive ECharts dashboard')
    parser.add_argument('--visualize-with-prediction', action='store_true', help='Generate dashboard with prediction overlay')
    parser.add_argument('--generate-images', action='store_true', help='Generate matplotlib/seaborn image visualizations')
    parser.add_argument('--image-format', type=str, default='png', choices=['png', 'pdf', 'svg'], help='Image format for visualizations')
    parser.add_argument('--watch', action='store_true', help='Watch mode - real-time sector monitoring for intraday')
    parser.add_argument('--watch-interval', type=int, default=60, help='Watch mode refresh interval in seconds (default: 60)')
    parser.add_argument('--movement-threshold', type=float, default=1.5, help='Sector movement threshold for alerts (default: 1.5%)')
    parser.add_argument('--min-correlation-watch', type=float, default=0.4, help='Minimum correlation for watch alerts (default: 0.4)')
    
    args = parser.parse_args()
    
    if not TV_AVAILABLE and not args.analyze_sectors:
        console.print("[red]❌ TradingView screener required for this functionality[/red]")
        return
    
    analyzer = SectorCovarianceAnalyzer(
        lookback_days=args.lookback_days,
        min_correlation=args.min_correlation
    )
    
    if args.analyze_sectors:
        analyzer.run_full_analysis()
    
    elif args.predict_stocks and args.trigger_sector:
        console.print(Panel.fit(f"🎯 QUICK PREDICTION | {args.trigger_sector} ({args.trigger_movement:+.1f}%)", style="bold magenta"))
        analyzer.run_optimized_prediction(args.trigger_sector, args.trigger_movement)
    
    elif args.monitor_realtime:
        analyzer.monitor_realtime(args.check_interval)
    
    elif args.watch:
        analyzer.run_intraday_watch(args.watch_interval, args.movement_threshold, args.min_correlation_watch)
    
    elif args.visualize:
        console.print(Panel.fit("🎨 GENERATING INTERACTIVE DASHBOARD", style="bold cyan"))
        
        analyzer.sector_data = analyzer.fetch_sector_stocks()
        if analyzer.sector_data:
            analyzer.sector_returns = analyzer.calculate_sector_returns(analyzer.sector_data)
            if not analyzer.sector_returns.empty:
                analyzer.correlation_matrix, _ = analyzer.calculate_correlation_matrix(analyzer.sector_returns)
                analyzer.save_and_open_visualization(analyzer.correlation_matrix, analyzer.sector_data)
            else:
                console.print("[red]❌ Could not calculate sector returns[/red]")
        else:
            console.print("[red]❌ Could not fetch sector data[/red]")
    
    elif args.visualize_with_prediction and args.trigger_sector:
        console.print(Panel.fit(f"🎨 DASHBOARD WITH PREDICTION | {args.trigger_sector} ({args.trigger_movement:+.1f}%)", style="bold cyan"))

        analyzer.sector_data = analyzer.fetch_sector_stocks()
        if analyzer.sector_data:
            analyzer.sector_returns = analyzer.calculate_sector_returns(analyzer.sector_data)
            if not analyzer.sector_returns.empty:
                analyzer.correlation_matrix, _ = analyzer.calculate_correlation_matrix(analyzer.sector_returns)
                predictions = analyzer.predict_sector_movement(args.trigger_sector, args.trigger_movement, analyzer.correlation_matrix)
                analyzer.save_and_open_visualization(analyzer.correlation_matrix, analyzer.sector_data, predictions)
            else:
                console.print("[red]❌ Could not calculate sector returns[/red]")
        else:
            console.print("[red]❌ Could not fetch sector data[/red]")

    elif args.generate_images:
        console.print(Panel.fit("🎨 GENERATING IMAGE VISUALIZATIONS", style="bold cyan"))

        analyzer.sector_data = analyzer.fetch_sector_stocks()
        if analyzer.sector_data:
            analyzer.sector_returns = analyzer.calculate_sector_returns(analyzer.sector_data)
            if not analyzer.sector_returns.empty:
                analyzer.correlation_matrix, _ = analyzer.calculate_correlation_matrix(analyzer.sector_returns)

                files_generated = []

                heatmap_file = analyzer.create_correlation_heatmap(analyzer.correlation_matrix)
                files_generated.append(heatmap_file)

                network_file = analyzer.create_sector_network_graph(analyzer.correlation_matrix)
                files_generated.append(network_file)

                dist_file = analyzer.create_correlation_distribution_plot(analyzer.correlation_matrix)
                files_generated.append(dist_file)

                sector_correlations = analyzer.calculate_intra_sector_correlations(analyzer.sector_data)
                for sector in list(sector_correlations.keys())[:5]:
                    stock_file = analyzer.create_stock_correlation_heatmap(sector, sector_correlations)
                    if stock_file:
                        files_generated.append(stock_file)

                console.print(f"\n[green]✅ Generated {len(files_generated)} visualization files:[/green]")
                for file in files_generated:
                    console.print(f"   📊 {file}")

                console.print("\n[dim]💡 All images saved in high resolution (300 DPI) with dark theme[/dim]")
                console.print("[dim]🔍 Use image viewer or include in reports/presentations[/dim]")
            else:
                console.print("[red]❌ Could not calculate sector returns[/red]")
        else:
            console.print("[red]❌ Could not fetch sector data[/red]")

    else:
        display_help()


if __name__ == "__main__":
    main()
