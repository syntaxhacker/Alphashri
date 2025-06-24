#!/usr/bin/env python3
"""
🚀 Run TATAMOTORS Walk Forward Analysis
Main execution script for Indian stock analysis
"""

import argparse
import sys
from datetime import datetime
from rich.console import Console
from rich.panel import Panel

# Import our modules
from vectorbt_tatamotors_analysis import TATAMOTORSWalkForward
from indian_stock_config import DEFAULT_CONFIGS, get_stock_symbol

console = Console()

def main():
    """Main execution function"""
    
    parser = argparse.ArgumentParser(
        description='🇮🇳 TATAMOTORS Walk Forward Analysis',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_tatamotors_walkforward.py                    # Run with default settings
  python run_tatamotors_walkforward.py --symbol MARUTI    # Analyze MARUTI instead
  python run_tatamotors_walkforward.py --exchange BSE     # Use BSE instead of NSE
  python run_tatamotors_walkforward.py --timeframe 1h     # Use hourly data
  python run_tatamotors_walkforward.py --days 500         # Use 500 days of data
  python run_tatamotors_walkforward.py --config TATAMOTORS_HOURLY  # Use hourly config
        """
    )
    
    # Symbol and Exchange options
    parser.add_argument('--symbol', type=str, default='TATAMOTORS',
                       help='Stock symbol (default: TATAMOTORS)')
    parser.add_argument('--exchange', type=str, choices=['NSE', 'BSE'], default='NSE',
                       help='Exchange (default: NSE)')
    
    # Analysis parameters
    parser.add_argument('--timeframe', type=str, choices=['1h', '1d'], default='1d',
                       help='Data timeframe (default: 1d)')
    parser.add_argument('--days', type=int, default=365,
                       help='Days of historical data to analyze (default: 365)')
    
    # Configuration options
    parser.add_argument('--config', type=str, choices=list(DEFAULT_CONFIGS.keys()), 
                       default='TATAMOTORS_DAILY',
                       help='Predefined configuration to use (default: TATAMOTORS_DAILY)')
    
    # Analysis modes
    parser.add_argument('--quick', action='store_true',
                       help='Run quick test with limited data')
    parser.add_argument('--full', action='store_true',
                       help='Run full comprehensive analysis')
    parser.add_argument('--synthetic', action='store_true',
                       help='Use synthetic data (for testing when API is rate limited)')
    
    # Output options
    parser.add_argument('--output-dir', type=str, default='.',
                       help='Output directory for results (default: current directory)')
    parser.add_argument('--save-dashboard', action='store_true',
                       help='Save dashboard visualization')
    
    args = parser.parse_args()
    
    # Display startup banner
    console.print(Panel.fit(
        "[bold blue]🇮🇳 TATAMOTORS Walk Forward Analysis Runner[/bold blue]\n"
        "Comprehensive Indian stock market analysis using VectorBT",
        border_style="blue"
    ))
    
    try:
        # Determine configuration
        if args.config:
            config_name = args.config
        else:
            # Build config name based on arguments
            if args.timeframe == '1h':
                config_name = 'TATAMOTORS_HOURLY'
            else:
                config_name = 'TATAMOTORS_DAILY'
        
        # Display analysis parameters
        console.print(f"\n[cyan]📊 Analysis Parameters:[/cyan]")
        console.print(f"  Stock: {args.symbol} ({args.exchange})")
        console.print(f"  Timeframe: {args.timeframe}")
        console.print(f"  Historical Period: {args.days} days")
        console.print(f"  Configuration: {config_name}")
        
        if args.quick:
            console.print(f"  Mode: Quick test")
            days_to_analyze = min(args.days, 120)  # Limit to 120 days for quick test
        elif args.full:
            console.print(f"  Mode: Full comprehensive analysis")
            days_to_analyze = args.days
        else:
            console.print(f"  Mode: Standard analysis")
            days_to_analyze = args.days
        
        if args.synthetic:
            console.print(f"  Data: Synthetic (for testing)")
        else:
            console.print(f"  Data: Live market data")
        
        # Initialize analyzer
        console.print(f"\n[yellow]🔧 Initializing analyzer...[/yellow]")
        analyzer = TATAMOTORSWalkForward(config_name)
        
        # Override symbol if different from config
        if args.symbol != 'TATAMOTORS' or args.exchange != 'NSE':
            full_symbol = get_stock_symbol(args.symbol, args.exchange)
            analyzer.symbol = full_symbol
            analyzer.config['symbol'] = full_symbol
            console.print(f"[cyan]Using custom symbol: {full_symbol}[/cyan]")
        
        # Run analysis
        console.print(f"\n[green]🚀 Starting analysis...[/green]")
        start_time = datetime.now()
        
        # Run analysis with synthetic flag
        if hasattr(analyzer, 'run_full_analysis'):
            if args.synthetic:
                # Force synthetic mode by modifying fetch method
                original_fetch = analyzer.fetch_stock_data
                analyzer.fetch_stock_data = lambda days_back: analyzer.generate_synthetic_data(days_back)
                
            analyzer.run_full_analysis(days_back=days_to_analyze)
        else:
            console.print("[red]❌ Analysis method not available[/red]")
        
        end_time = datetime.now()
        duration = end_time - start_time
        
        # Success message
        console.print(Panel.fit(
            f"[bold green]✅ Analysis Completed Successfully![/bold green]\n\n"
            f"⏱️ Duration: {duration.total_seconds():.1f} seconds\n"
            f"📊 Stock: {analyzer.symbol}\n"
            f"📈 Mode: {'Quick' if args.quick else 'Full' if args.full else 'Standard'}\n"
            f"💾 Results available in output directory",
            border_style="green"
        ))
        
    except KeyboardInterrupt:
        console.print("\n[yellow]⏸️ Analysis interrupted by user[/yellow]")
        sys.exit(1)
        
    except Exception as e:
        console.print(f"\n[red]❌ Analysis failed: {str(e)}[/red]")
        console.print(f"[red]Please check your parameters and try again[/red]")
        sys.exit(1)

def show_available_configs():
    """Show available predefined configurations"""
    
    console.print(Panel.fit(
        "[bold cyan]📋 Available Configurations[/bold cyan]",
        border_style="cyan"
    ))
    
    for config_name, config in DEFAULT_CONFIGS.items():
        console.print(f"\n[bold yellow]{config_name}:[/bold yellow]")
        for key, value in config.items():
            if key != 'symbol':
                console.print(f"  {key}: {value}")
        console.print(f"  symbol: {config['symbol']}")

def show_help_examples():
    """Show detailed usage examples"""
    
    console.print(Panel.fit(
        "[bold green]💡 Usage Examples[/bold green]",
        border_style="green"
    ))
    
    examples = [
        ("Basic TATAMOTORS analysis", "python run_tatamotors_walkforward.py"),
        ("Quick test with limited data", "python run_tatamotors_walkforward.py --quick"),
        ("Analyze MARUTI stock", "python run_tatamotors_walkforward.py --symbol MARUTI"),
        ("Use BSE exchange", "python run_tatamotors_walkforward.py --exchange BSE"),
        ("Hourly timeframe analysis", "python run_tatamotors_walkforward.py --timeframe 1h"),
        ("Full analysis with 2 years data", "python run_tatamotors_walkforward.py --full --days 730"),
        ("Custom output directory", "python run_tatamotors_walkforward.py --output-dir ./results"),
    ]
    
    for description, command in examples:
        console.print(f"\n[cyan]{description}:[/cyan]")
        console.print(f"  [white]{command}[/white]")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == '--help-examples':
        show_help_examples()
    elif len(sys.argv) > 1 and sys.argv[1] == '--show-configs':
        show_available_configs()
    else:
        main() 