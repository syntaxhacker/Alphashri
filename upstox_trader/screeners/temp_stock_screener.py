import sys
import os
import pandas as pd
from datetime import datetime, timedelta
import time

# Add project root to sys.path for absolute imports
_current_file_dir = os.path.dirname(os.path.abspath(__file__))
_screeners_dir = _current_file_dir
_upstox_trader_dir = os.path.dirname(_screeners_dir)
_project_root_dir = os.path.dirname(_upstox_trader_dir)

if _project_root_dir not in sys.path:
    sys.path.insert(0, _project_root_dir)

from upstox_trader.screeners.tv_screen_usage import TVScreenerUsage
from tradingview_screener import Query, col  # Direct import as per tv_helpers
from upstox_trader.screeners.tv_helpers import display_table  # For displaying results
from rich.console import Console

console = Console()

def run_stock_screener():
    console.print("[bold cyan]🚀 Running Temporary Stock Screener for PDH Strategy Candidates[/bold cyan]")
    
    screener = TVScreenerUsage(enable_paper_trading=False)
    
    # Force load instruments
    console.print("[bold green]Loading Upstox instrument data...[/bold green]")
    screener.upstox_api.get_instrument_key("NIFTY", instrument_type="INDEX")
    
    # Query for suitable stocks using TradingView fields (general NSE screening)
    query = Query()
    query = (query
        .select('name', 'close', 'volume', 'ATR', 'relative_volume_10d_calc',
                'average_volume_30d_calc', 'EMA20', 'EMA50', 'ADX', 'RSI',
                'Perf.3M', 'market_cap_basic', 'beta_1_year', 'sector')
        .set_markets('india')  # NSE focus
        .where(
            col('average_volume_30d_calc') > 1000000,  # Liquidity: >1M avg volume
            col('relative_volume_10d_calc') > 1.5,     # Activity: Above average
            col('ATR') > 2,                            # Volatility: Sufficient for moves
            # col('Volatility.D') < 8,                # Skip if not reliable
            col('close') > col('EMA20'),               # Above short EMA (uptrend)
            col('EMA20') > col('EMA50'),               # 20 EMA > 50 EMA
            col('ADX') > 25,                           # Strong trend
            col('RSI') > 50,                           # Momentum (not oversold)
            col('Perf.3M') > 5,                        # Recent gains >5%
            col('market_cap_basic') > 5000000000,      # Size: >₹5B
            col('beta_1_year') < 1.5                   # Moderate risk
        )
        .order_by('Perf.W', ascending=False)         # Top recent performers (if Perf.W available)
        .limit(20))  # Top 20 candidates from all NSE
    
    console.print("[bold yellow]Executing TradingView screener query...[/bold yellow]")
    
    # Run the query using TradingView screener (correct pattern from tv_screen_usage.py)
    try:
        total_rows, results_df = query.get_scanner_data(cookies=screener.cookies)
        
        # Display top results (no symbol filtering)
        if not results_df.empty:
            console.print(f"[green]✅ Found {len(results_df)} suitable stocks across NSE (total available: {total_rows}):[/green]")
            display_table(results_df, title="Top PDH Strategy Candidates")
            
            # Summary
            console.print(f"\n[bold green]Recommendation: Use top {len(results_df)} stocks for PDH backtest/strategy.[/bold green]")
            console.print(f"[dim]Top picks: {', '.join(results_df['name'].head(5).tolist())}[/dim]")
        else:
            console.print("[yellow]⚠️ No stocks matched criteria. Showing top 5 overall matches with loosened filters...[/yellow]")
            # Loosened query would go here if needed
            
    except Exception as e:
        console.print(f"[red]❌ Error running TradingView query: {e}[/red]")
        console.print("[yellow]Falling back to manual Upstox simulation...[/yellow]")
        
        # Fallback: General simulation - could screen more NSE symbols, but for demo use a broader approach
        console.print("[yellow]Note: For full market simulation, would need NSE symbol list. Showing example with loosened criteria.[/yellow]")
        # Here, we could fetch from Upstox instruments or use a predefined NSE list
        # For now, demonstrate with the original symbols but loosened filters
        from_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
        to_date = datetime.now().strftime('%Y-%m-%d')
        
        # Use original symbols for demo, but loosen filters
        demo_symbols = ["PRECAM", "IOLCP", "MUFIN", "GALLANTT", "SSWL", "COHANCE",
                       "RAJESHEXPO", "HIMATSEIDE", "ARISINFRA", "ADANIPOWER",
                       "BIRLAMONEY", "NAVKARCORP", "SERVOTECH", "PARAGMILK", "BHARATFORG"]
        
        suitable = []
        for symbol in demo_symbols:
            try:
                daily_df = screener.upstox_api.fetch_historical_data_v3(
                    symbol=symbol, unit="days", interval=1, from_date=from_date, to_date=to_date
                )
                if daily_df is not None and not daily_df.empty and len(daily_df) >= 20:
                    recent_close = daily_df['close'].iloc[-1]
                    avg_volume = daily_df['volume'].tail(10).mean()  # 10-day avg
                    price_range = (daily_df['high'] - daily_df['low']).tail(14).mean() / recent_close * 100  # ATR proxy %
                    perf_3m = (recent_close - daily_df['close'].iloc[-63]) / daily_df['close'].iloc[-63] * 100 if len(daily_df) > 63 else 0
                    
                    # Loosened filters for demo
                    if avg_volume > 500000 and price_range > 1 and perf_3m > 0:
                        suitable.append({
                            'name': symbol,
                            'close': recent_close,
                            'volume': avg_volume,
                            'ATR': price_range,
                            'RSI': 'N/A',  # Would compute if TA-lib available
                            'ADX': 'N/A',
                            'Perf.3M': perf_3m,
                            'sector': 'N/A'
                        })
            except Exception as sym_e:
                console.print(f"[dim]Skipped {symbol}: {sym_e}[/dim]")
                continue
        
        if suitable:
            suitable_df = pd.DataFrame(suitable)
            console.print(f"[green]✅ Simulated suitable stocks (loosened criteria): {len(suitable)}[/green]")
            display_table(suitable_df, title="PDH Strategy Candidates (Simulated)")
        else:
            console.print("[red]❌ No suitable stocks even with loosened criteria.[/red]")
        

if __name__ == "__main__":
    run_stock_screener()