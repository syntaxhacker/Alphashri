import argparse
import sys
import os
from rich.console import Console

# Handle relative imports for both package and direct script execution
try:
    from .tv_screen_usage import TVScreenerUsage
except ImportError:
    # Add the current directory to sys.path for direct script execution
    current_dir = os.path.dirname(os.path.abspath(__file__))
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)
    from tv_screen_usage import TVScreenerUsage

console = Console()

def _setup_arg_parser():
    """Sets up the argument parser for TradingView Screener Usage Examples."""
    parser = argparse.ArgumentParser(description='TradingView Screener Usage Examples')
    parser.add_argument('--example', type=str, help='Run specific example')
    parser.add_argument('--list-examples', action='store_true', help='List all available examples')
    parser.add_argument('--run-all', action='store_true', help='Run all examples')
    parser.add_argument('--market', type=str, default='in', choices=['us', 'in'], help='Market to screen (us/in, default: in)')
    parser.add_argument('--sector', type=str, help='Sector name for sector-specific analysis')
    
    # Watch mode specific arguments
    parser.add_argument('--watch', action='store_true', help='Start intraday watch mode')
    parser.add_argument('--mode', type=str, default='PREBREAKOUT',
                       choices=['PREBREAKOUT', 'FOMO', 'SMART_FOMO', 'ACCUMULATION', 'MOMENTUM', 'OPTIMIZED_GAP', 'GAP_FILL_SR', 'HEAVY_BREAKOUT', 'SCALPING', 'MOMENTUM_SCALPER', 'SECTOR_SCALPER', 'SHORT_SQUEEZE', 'BREAKOUT_FAILURE', 'EXHAUSTION_REVERSAL', 'MORNING_FADE', 'REVERSAL', 'VOLUME_SURGE', 'CHANNEL_PLAY', 'SECTOR_MOMENTUM', 'QUICK_PROFIT', 'FOMO_MOMENTUM', 'REALTIME_MOMENTUM', 'SR_LEVELS_BREAK'],
                       help='Watch mode strategy (default: PREBREAKOUT)')
    parser.add_argument('--refresh', type=int, default=30, help='Refresh interval in seconds (default: 30)')
    # Adjusted lighter defaults as requested: Vol 1.2x, Price 1.0%
    parser.add_argument('--volume-threshold', type=float, default=1.2, help='Volume threshold for alerts (default: 1.2x)')
    parser.add_argument('--price-threshold', type=float, default=1.0, help='Price change threshold for alerts (default: 1.0 percent)')
    
    # Paper Trading Bot integration
    parser.add_argument('--enable-trading', action='store_true', help='Enable paper trading bot integration (₹20,000 per trade)')
    
    # Market cap filtering
    parser.add_argument('--cap', type=str, choices=['large', 'mid', 'small'], help='Filter by market cap: large (>20,000 Cr), mid (5,000-20,000 Cr), small (<5,000 Cr)')
    
    # Price filtering
    parser.add_argument('--max-price', type=float, help='Filter stocks below this price (e.g., 100 for stocks under ₹100)')
    parser.add_argument('--min-price', type=float, help='Filter stocks above this price (e.g., 50 for stocks over ₹50)')
    
    return parser

def _run_screener_from_args(args):
    """Initializes TVScreenerUsage and runs methods based on parsed arguments."""
    screener = TVScreenerUsage(market=args.market, enable_paper_trading=args.enable_trading)
    
    if args.list_examples:
        screener.show_available_examples()
    elif args.watch:
        screener.intraday_watch_mode(
            refresh_interval=args.refresh,
            volume_threshold=args.volume_threshold,
            price_threshold=args.price_threshold,
            mode=args.mode,
            market_cap_filter=args.cap,
            max_price=args.max_price,
            min_price=args.min_price
        )
    elif args.example:
        if args.example == 'intraday_watch':
            screener.run_example(args.example, 
                               refresh_interval=args.refresh,
                               volume_threshold=args.volume_threshold,
                               price_threshold=args.price_threshold)
        elif args.example == 'research_sector_stocks':
            screener.run_example(args.example, sector_name=args.sector)
        else:
            screener.run_example(args.example)
    elif args.run_all:
        screener.run_all_examples()
    elif len(sys.argv) > 1 and '--mode' in sys.argv:  # Mode explicitly specified but not in watch mode - run once
        screener.run_mode_once(args.mode, args.cap, args.max_price, args.min_price)
    else:
        console.print("[bold blue]TradingView Screener Usage Guide[/bold blue]")
        console.print("\nUse --list-examples to see all available examples")
        console.print("Use --example <name> to run a specific example")
        console.print("Use --run-all to run all examples")
        console.print("Use --watch to start intraday watch mode")
        console.print("Use --market <us|in> to select market (default: in)")
        console.print("Use --sector <name> for sector-specific analysis")
        console.print("Use --max-price <number> to filter stocks below price (e.g., --max-price 100)")
        console.print("Use --min-price <number> to filter stocks above price (e.g., --min-price 50)")
        console.print("\nExample usage:")
        console.print("  python tv_screen_usage.py --example intraday_breakouts")
        console.print("  python tv_screen_usage.py --market us --example intraday_breakouts")
        console.print("  python tv_screen_usage.py --example research_sectors")
        console.print("  python tv_screen_usage.py --example research_sector_stocks --sector 'Technology'")
        console.print("  python tv_screen_usage.py --example live_gap_sr_monitor  # Live gap-fill monitor")
        console.print("  python tv_screen_usage.py --example gap_fill_analysis    # Historical gap analysis")
        console.print("  python tv_screen_usage.py --watch --mode PREBREAKOUT --refresh 15")
        console.print("  python tv_screen_usage.py --watch --mode FOMO --volume-threshold 2.5 --price-threshold 2.0")
        console.print("  python tv_screen_usage.py --watch --mode ACCUMULATION --enable-trading")
        console.print("  python tv_screen_usage.py --watch --mode OPTIMIZED_GAP --refresh 2 --enable-trading")
        console.print("  python tv_screen_usage.py --watch --mode GAP_FILL_SR --refresh 30 --enable-trading  # Gap-fill + S/R")
        console.print("  python tv_screen_usage.py --watch --mode HEAVY_BREAKOUT --refresh 30 --enable-trading  # Smart money breakouts")
        console.print("  python tv_screen_usage.py --watch --mode SCALPING --refresh 5 --enable-trading  # Ultra-fast scalping")
        console.print("  python tv_screen_usage.py --watch --mode MOMENTUM_SCALPER --refresh 2 --enable-trading  # Advanced momentum with deltas")
        console.print("  python tv_screen_usage.py --watch --mode SECTOR_SCALPER --refresh 3 --enable-trading  # Sector correlation scalping")
        console.print("  python tv_screen_usage.py --watch --mode SHORT_SQUEEZE --refresh 5 --enable-trading  # Short squeeze explosions")
        console.print("  python tv_screen_usage.py --watch --mode BREAKOUT_FAILURE --refresh 10 --enable-trading  # Failed breakout shorts")
        console.print("  python tv_screen_usage.py --watch --mode EXHAUSTION_REVERSAL --refresh 15 --enable-trading  # Momentum exhaustion shorts")
        console.print("  python tv_screen_usage.py --watch --mode MORNING_FADE --refresh 5 --enable-trading  # Gap fade shorting")
        console.print("  python tv_screen_usage.py --watch --mode REVERSAL --refresh 15 --enable-trading  # Counter-trend trades")
        console.print("  python tv_screen_usage.py --watch --mode VOLUME_SURGE --refresh 10  # Unusual activity detector")
        console.print("  python tv_screen_usage.py --watch --mode CHANNEL_PLAY --refresh 20  # Range-bound trading")
        console.print("  python tv_screen_usage.py --watch --mode SECTOR_MOMENTUM --refresh 30  # Industry group moves")
        console.print("  python tv_screen_usage.py --watch --mode QUICK_PROFIT --refresh 5 --enable-trading  # Fast 1-2% scalps")
        console.print("  python tv_screen_usage.py --watch --mode SR_LEVELS_BREAK --refresh 10 --enable-trading  # S/R level breakouts")
        console.print("  python tv_screen_usage.py --example heavy_breakout  # Analyze heavy breakout patterns")
        console.print("  python tv_screen_usage.py --market us --example intraday_watch --refresh 10")

def run_cli():
    parser = _setup_arg_parser()
    args = parser.parse_args()
    _run_screener_from_args(args)
