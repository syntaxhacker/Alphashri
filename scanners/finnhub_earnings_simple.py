#!/usr/bin/env python3
import argparse
import finnhub
from rich.console import Console
from rich.table import Table
import pandas as pd
from datetime import datetime, timedelta
import os
from pathlib import Path
try:
    from zoneinfo import ZoneInfo
except ImportError:
    import pytz

# Initialize the client with your Finnhub API key
finnhub_client = finnhub.Client(api_key="d3mkpb1r01qmso349jk0d3mkpb1r01qmso349jkg")
console = Console()

MARKET_CONFIG = {
    'us': {
        'label': 'US',
        'exchanges': ['US'],
        'international': False
    },
    'india': {
        'label': 'India',
        'exchanges': ['NSE', 'BSE'],
        'international': True
    }
}

INDIA_MAJOR_STOCKS = [
    'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS',
    'HINDUNILVR.NS', 'ITC.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'LT.NS',
    'AXISBANK.NS', 'KOTAKBANK.NS', 'HCLTECH.NS', 'BAJFINANCE.NS',
    'MARUTI.NS', 'ASIANPAINT.NS', 'SUNPHARMA.NS', 'TITAN.NS',
    'ULTRACEMCO.NS', 'NESTLEIND.NS', 'WIPRO.NS', 'POWERGRID.NS',
    'NTPC.NS', 'ONGC.NS', 'M&M.NS', 'TATAMOTORS.NS', 'ADANIENT.NS',
    'ADANIPORTS.NS', 'COALINDIA.NS', 'GRASIM.NS'
]

US_MAJOR_STOCKS = [
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'AMD', 'INTC',
    'TSM', 'QCOM', 'BABA', 'UBER', 'DIS', 'PYPL', 'ADBE', 'CRM', 'EBAY', 'SQ',
    'SNAP', 'ZM', 'ROKU', 'SHOP', 'BIDU', 'NIO', 'PDD', 'JD', 'BILI'
]

US_BLUE_CHIPS = [
    'JPM', 'BAC', 'WMT', 'HD', 'KO', 'PEP', 'JNJ', 'PFE', 'UNH', 'PG',
    'MRK', 'ABBV', 'V', 'MA', 'BA', 'CAT', 'GE', 'MMM', 'HON', 'CSCO',
    'ORCL', 'IBM', 'TXN', 'COP', 'CVX', 'XOM', 'T', 'VZ', 'NEE', 'DUK'
]

US_SP500_ADDITIONAL = [
    'BRK.B', 'LLY', 'AVGO', 'COST', 'LIN', 'ACN', 'DHR', 'MCD', 'ABT', 'PLD',
    'SCHW', 'UPS', 'RTX', 'LRCX', 'AMGN', 'MU', 'TXN', 'LOW', 'TGT', 'CB',
    'ICE', 'BDX', 'FIS', 'REGN', 'CME', 'ISRG', 'MMC', 'GS', 'BLK', 'GWW',
    'AON', 'MS', 'CCI', 'EOG', 'PGR', 'USB', 'ADP', 'MDT', 'SYK', 'CVS'
]

US_NASDAQ_ADDITIONAL = [
    'INTU', 'MU', 'BKNG', 'MDLZ', 'GILD', 'ADSK', 'FISV', 'ORLY', 'LRCX', 'SNPS',
    'CDNS', 'KLAC', 'MRVL', 'MCHP', 'ADI', 'MPWR', 'NXPI', 'ON', 'XLNX', 'MRVL'
]

def load_india_symbols_from_local_file(max_symbols=3000):
    """Load India equity symbols from local instruments CSV as fallback."""
    try:
        instruments_path = Path(__file__).resolve().parent.parent / 'ind_equity_instruments.csv'
        if not instruments_path.exists():
            return []

        df = pd.read_csv(instruments_path, usecols=['EXCH', 'TRADING_SYMBOL', 'SERIES'])
        nse_eq = df[(df['EXCH'] == 'NSE') & (df['SERIES'] == 'EQ')]

        symbols = []
        for raw in nse_eq['TRADING_SYMBOL'].dropna():
            symbol = str(raw).strip().upper()
            if not symbol:
                continue
            # Keep simple equity-like identifiers and map to Finnhub-compatible NSE suffix.
            if all(ch.isalnum() or ch in ['&', '-', '.'] for ch in symbol):
                symbols.append(f'{symbol}.NS')

        return list(dict.fromkeys(symbols))[:max_symbols]
    except Exception as e:
        console.print(f'[yellow]⚠️ Local India symbol fallback unavailable: {str(e)}[/yellow]')
        return []

def format_date_readable(date_str: str) -> str:
    """Convert YYYY-MM-DD to readable format"""
    try:
        date_obj = datetime.strptime(date_str, '%Y-%m-%d')
        return date_obj.strftime('%b %d, %Y')
    except (ValueError, TypeError):
        return date_str

def get_relative_date_text(target_date: str) -> str:
    """Convert days until date to human text"""
    try:
        target_dt = datetime.strptime(target_date, '%Y-%m-%d')
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        target_day = target_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        days_diff = (target_day - today).days

        if days_diff == 0:
            return "Today"
        elif days_diff == 1:
            return "Tomorrow"
        elif days_diff == -1:
            return "Yesterday"
        elif days_diff > 1 and days_diff <= 7:
            return f"In {days_diff} days"
        elif days_diff < -1 and days_diff >= -7:
            return f"{abs(days_diff)} days ago"
        else:
            return format_date_readable(target_date)
    except (ValueError, TypeError):
        return target_date

def format_market_time(time_str: str, market: str = 'us') -> str:
    """Format trading hours with market context"""
    if not time_str or time_str.upper() in ['TBD', 'N/A', 'NA', 'NULL', '']:
        return '⏰ Time TBD'
    
    time_upper = str(time_str).upper()
    if time_upper in ['BMO', 'PRE']:
        return '🌅 Pre-Market'
    elif time_upper in ['AMC', 'AFTER']:
        return '🌙 After-Hours'
    elif time_upper == 'TAS':
        return '⏰ Time Not Specified'
    else:
        timezone_label = 'ET' if market == 'us' else 'IST'
        return f'🕒 {time_upper} {timezone_label}'

def get_dynamic_date_range(days_ahead: int = 10) -> tuple:
    """Generate date ranges dynamically"""
    from_date = datetime.now()
    to_date = from_date + timedelta(days=days_ahead)
    return (from_date.strftime('%Y-%m-%d'), to_date.strftime('%Y-%m-%d'))

def get_historical_earnings_reaction(symbol, earnings_date):
    """Get stock's reaction on earnings day"""
    try:
        import time
        
        # Convert earnings date to datetime
        earnings_dt = datetime.strptime(earnings_date, '%Y-%m-%d')
        prev_day = earnings_dt - timedelta(days=1)
        
        # Get UNIX timestamps using mktime
        prev_start_ts = int(time.mktime(prev_day.timetuple()))
        earnings_end_ts = int(time.mktime((earnings_dt + timedelta(days=1)).timetuple()))
        
        # Get candle data for the period
        candles = finnhub_client.stock_candles(symbol, 'D', prev_start_ts, earnings_end_ts)
        
        if candles and candles['s'] == 'ok' and len(candles['c']) >= 2:
            # Get the two most recent closes
            prev_close = candles['c'][0]  # Previous day close
            curr_close = candles['c'][1]  # Earnings day close
            curr_open = candles['o'][1]   # Earnings day open
            curr_volume = candles['v'][1]  # Earnings day volume
            
            # Calculate metrics
            day_change = ((curr_close - prev_close) / prev_close) * 100
            
            # Get average volume
            avg_volume = sum(candles['v']) / len(candles['v'])
            volume_ratio = curr_volume / avg_volume if avg_volume > 0 else 1
            
            return {
                'day_change': day_change,
                'volume_ratio': volume_ratio,
                'close': curr_close,
                'volume': curr_volume
            }
        else:
            return None
    except Exception:
        return None

def get_stock_symbols(limit=None, market='us'):
    """Fetch stock symbols dynamically for a selected market."""
    try:
        market = market.lower()
        if market not in MARKET_CONFIG:
            raise ValueError(f"Unsupported market: {market}")

        if market == 'india':
            console.print('[blue]📋 Starting with major India stocks...[/blue]')
            all_symbols = list(dict.fromkeys(INDIA_MAJOR_STOCKS))
        else:
            console.print('[blue]📋 Starting with major US stocks...[/blue]')
            all_symbols = list(dict.fromkeys(US_MAJOR_STOCKS + US_BLUE_CHIPS))
        seed_count = len(all_symbols)
        
        target_limit = limit if isinstance(limit, int) and limit > 0 else None

        # Method 2: Supplement with Finnhub symbols API for the selected exchange(s).
        try:
            console.print(f'[cyan]🔍 Fetching additional symbols from Finnhub API...[/cyan]')
            import requests
            added = 0
            for exchange in MARKET_CONFIG[market]['exchanges']:
                response = requests.get(
                    'https://finnhub.io/api/v1/stock/symbol',
                    params={'exchange': exchange, 'token': 'd3mkpb1r01qmso349jk0d3mkpb1r01qmso349jkg'}
                )
                if response.status_code == 200:
                    data = response.json()
                    if data:
                        for stock in data:
                            symbol = stock.get('symbol')
                            stock_type = str(stock.get('type', '')).lower()
                            if not symbol:
                                continue
                            if stock_type and 'common' not in stock_type and stock_type not in ['eqs', 'equity']:
                                continue
                            if symbol not in all_symbols:
                                all_symbols.append(symbol)
                                added += 1
            console.print(f'[green]✅ Added {added} symbols from Finnhub API[/green]')
            if market == 'india' and added == 0:
                console.print('[yellow]⚠️ Finnhub returned no additional India symbols beyond seed list[/yellow]')
        except Exception as e:
            console.print(f'[yellow]⚠️ Finnhub symbols API not available: {str(e)}[/yellow]')

        # Method 3: For India, load local NSE EQ universe as deterministic fallback.
        if market == 'india' and (target_limit is None or len(all_symbols) < target_limit):
            local_symbols = load_india_symbols_from_local_file()
            local_added = 0
            for symbol in local_symbols:
                if symbol not in all_symbols:
                    all_symbols.append(symbol)
                    local_added += 1
            if local_added > 0:
                console.print(f'[green]✅ Added {local_added} India symbols from local instruments file[/green]')
            if len(all_symbols) <= seed_count:
                console.print('[yellow]⚠️ India universe still limited to seed list; check Finnhub plan/API coverage[/yellow]')
        
        # Method 4: For US only, backfill from broad index constituents if needed.
        if market == 'us' and (target_limit is None or len(all_symbols) < target_limit):
            console.print(f'[blue]📊 Adding more S&P 500 and Nasdaq components...[/blue]')

            for symbol in US_SP500_ADDITIONAL + US_NASDAQ_ADDITIONAL:
                if symbol not in all_symbols and (target_limit is None or len(all_symbols) < target_limit):
                    all_symbols.append(symbol)
        
        selected_count = len(all_symbols) if target_limit is None else min(len(all_symbols), target_limit)
        console.print(
            f'[green]✅ Using {selected_count} {MARKET_CONFIG[market]["label"]} stocks '
            f'(universe size: {len(all_symbols)})[/green]'
        )
        
        # Return up to the requested limit
        return all_symbols if target_limit is None else all_symbols[:target_limit]
        
    except Exception as e:
        console.print(f'[red]❌ Error fetching stock symbols: {str(e)}[/red]')
        fallback = INDIA_MAJOR_STOCKS[:10] if market == 'india' else ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'NFLX', 'AMD', 'INTC']
        console.print('[yellow]🔄 Using essential fallback symbols[/yellow]')
        return fallback

def display_upcoming_earnings_calendar(days_ahead=10, stock_limit=None, market='us'):
    """Display upcoming earnings calendar for a market."""
    market = market.lower()
    if market not in MARKET_CONFIG:
        console.print(f'[red]❌ Unsupported market: {market}[/red]')
        return
    market_label = MARKET_CONFIG[market]['label']
    international = MARKET_CONFIG[market]['international']
    
    scope_text = 'all available' if stock_limit is None else str(stock_limit)
    console.print(f'📅 [bold cyan]UPCOMING EARNINGS CALENDAR (Next {days_ahead} Days)[/bold cyan]')
    console.print(f'🔍 Scanning [green]{scope_text}[/green] major {market_label} stocks for earnings...')
    console.print()
    
    # Get stock symbols dynamically for the selected market.
    symbols = get_stock_symbols(stock_limit, market)
    selected_symbols = set(symbols)
    selected_base_symbols = {s.split('.')[0] for s in symbols}
    
    from_date, to_date = get_dynamic_date_range(days_ahead)
    all_upcoming = []
    
    console.print(f'📊 Checking [yellow]{len(symbols)}[/yellow] stocks for earnings announcements...')

    # Use market-wide earnings pull once, then filter to selected symbols.
    try:
        calendar = finnhub_client.earnings_calendar(
            _from=from_date,
            to=to_date,
            symbol='',
            international=international
        )
        events = calendar.get('earningsCalendar', []) if calendar else []
    except Exception as e:
        console.print(f'[red]❌ Error fetching earnings calendar: {str(e)}[/red]')
        events = []

    console.print(f'📦 Received [cyan]{len(events)}[/cyan] earnings events from data source')

    for event in events:
        event_symbol = str(event.get('symbol') or '').upper()
        if not event_symbol:
            continue

        # Keep events only for selected market symbols.
        if event_symbol not in selected_symbols and event_symbol.split('.')[0] not in selected_base_symbols:
            continue

        try:
            days_until = (datetime.strptime(event['date'], '%Y-%m-%d') - datetime.now()).days
        except Exception:
            continue

        if 0 <= days_until <= days_ahead:
            eps_estimate = event.get('epsEstimate')
            revenue_estimate = event.get('revenueEstimate')
            all_upcoming.append({
                'symbol': event_symbol,
                'date': event['date'],
                'time': event['hour'].upper() if event.get('hour') else 'TBD',
                'quarter': f"Q{event['quarter']} {event['year']}" if event.get('quarter') and event.get('year') else 'N/A',
                'eps_estimate': f"${eps_estimate:.2f}" if eps_estimate else 'N/A',
                'revenue_estimate': f"${revenue_estimate/1000000000:.1f}B" if revenue_estimate else 'N/A',
                'days_until': days_until
            })
    
    if all_upcoming:
        # Remove duplicates (same symbol and date)
        unique_upcoming = []
        seen = set()
        for event in all_upcoming:
            key = (event['symbol'], event['date'])
            if key not in seen:
                seen.add(key)
                unique_upcoming.append(event)
        
        # Sort by days until earnings
        unique_upcoming.sort(key=lambda x: x['days_until'])
        
        # Create upcoming earnings table
        upcoming_table = Table(title=f'🔔 EARNINGS SCHEDULE', show_header=True, header_style='bold cyan', box=None)
        upcoming_table.add_column('Days Until', style='magenta', width=10)
        upcoming_table.add_column('Date', style='cyan', width=12)
        upcoming_table.add_column('Symbol', style='bold yellow', width=8)
        upcoming_table.add_column('Time', style='white', width=8)
        upcoming_table.add_column('Quarter', style='green', width=10)
        upcoming_table.add_column('EPS Est.', style='green', width=10)
        upcoming_table.add_column('Revenue Est.', style='orange1', width=12)
        upcoming_table.add_column('Priority', style='bold', width=12)
        
        for event in unique_upcoming:
            days_until = event['days_until']
            
            # Priority based on days until
            if days_until <= 1:
                priority = '[bold red]🔥 CRITICAL[/bold red]'
            elif days_until <= 3:
                priority = '[bold orange1]⚠️ URGENT[/bold orange1]'
            elif days_until <= 7:
                priority = '[bold yellow]👀 SOON[/bold yellow]'
            else:
                priority = '[green]📅 PLAN[/green]'
            
            # Enhanced time formatting
            formatted_time = format_market_time(event['time'], market)
            formatted_date = format_date_readable(event['date'])
            
            upcoming_table.add_row(
                get_relative_date_text(event['date']),
                formatted_date,
                event['symbol'],
                formatted_time,
                event['quarter'],
                event['eps_estimate'],
                event['revenue_estimate'],
                priority
            )
        
        console.print(upcoming_table)
        
        # Summary
        this_week = len([e for e in unique_upcoming if e['days_until'] <= 7])
        today = len([e for e in unique_upcoming if e['days_until'] == 0])
        tomorrow = len([e for e in unique_upcoming if e['days_until'] == 1])
        
        console.print()
        console.print(f'📊 [bold]EARNINGS SUMMARY:[/bold]')
        console.print(f'• Today: [red]{today}[/red] stocks reporting')
        console.print(f'• Tomorrow: [orange1]{tomorrow}[/orange1] stocks reporting')
        console.print(f'• This Week: [yellow]{this_week}[/yellow] stocks reporting')
        console.print(f'• Total in {days_ahead} days: [cyan]{len(unique_upcoming)}[/cyan] stocks')
        
    else:
        console.print(f'[yellow]⚠️ No upcoming earnings found in the next {days_ahead} days[/yellow]')

def display_earnings_analysis(symbol, market='us', days_ahead=10):
    """Display only previous and upcoming earnings tables"""
    try:
        market = market.lower()
        if market not in MARKET_CONFIG:
            console.print(f'[red]❌ Unsupported market: {market}[/red]')
            return

        # Get company earnings history (last 5 quarters)
        earnings = finnhub_client.company_earnings(symbol, limit=5)
        
        if earnings:
            # Create previous earnings table
            table = Table(title=f'📈 {symbol.upper()} PREVIOUS EARNINGS (Last 5 Quarters)', show_header=True, header_style='bold cyan', box=None)
            table.add_column('Period', style='cyan', width=12)
            table.add_column('Quarter', style='white', width=8)
            table.add_column('Actual', style='bold green', width=10)
            table.add_column('Estimate', style='yellow', width=10)
            table.add_column('Surprise', style='magenta', width=12)
            table.add_column('Surprise %', style='bold red', width=10)
            table.add_column('Day Change', style='bold', width=12)
            table.add_column('Result', style='bold', width=8)
            
            for earning in earnings:
                actual = earning['actual']
                estimate = earning['estimate']
                surprise = earning['surprise']
                surprise_pct = earning['surprisePercent']
                period = earning['period']
                quarter = f"Q{earning['quarter']} {earning['year']}"
                
                # Get historical earnings reaction for this period
                reaction = get_historical_earnings_reaction(symbol, period)
                
                # Determine performance
                if surprise > 0:
                    result = '[bold green]✓ BEAT[/bold green]'
                    surprise_color = 'green'
                elif surprise < 0:
                    result = '[bold red]✗ MISS[/bold red]'
                    surprise_color = 'red'
                else:
                    result = '[yellow]= MEET[/yellow]'
                    surprise_color = 'yellow'
                
                # Format day change
                if reaction:
                    day_change = reaction['day_change']
                    volume_ratio = reaction['volume_ratio']
                    
                    # Color code based on performance
                    if day_change > 5:
                        change_color = 'bright_green'
                        change_emoji = '🚀'
                    elif day_change > 2:
                        change_color = 'green'
                        change_emoji = '📈'
                    elif day_change > 0:
                        change_color = 'yellow'
                        change_emoji = '↑'
                    elif day_change > -2:
                        change_color = 'red'
                        change_emoji = '↓'
                    else:
                        change_color = 'bold red'
                        change_emoji = '📉'
                    
                    # Add volume indicator
                    if volume_ratio > 3:
                        volume_emoji = '🔥'
                    elif volume_ratio > 2:
                        volume_emoji = '⚡'
                    else:
                        volume_emoji = ''
                    
                    day_change_text = f'[{change_color}]{change_emoji}{day_change:+.1f}%{volume_emoji}[/{change_color}]'
                else:
                    day_change_text = '[dim]🔒 Premium[/dim]'
                
                table.add_row(
                    format_date_readable(period),
                    quarter,
                    f'${actual:.2f}',
                    f'${estimate:.2f}',
                    f'[{surprise_color}]{surprise:+.2f}[/{surprise_color}]',
                    f'[{surprise_color}]{surprise_pct:+.2f}%[/{surprise_color}]',
                    day_change_text,
                    result
                )
            
            console.print(table)
            
        else:
            console.print(f'[yellow]⚠️ No previous earnings data available for {symbol.upper()}[/yellow]')
        
        # Get upcoming earnings calendar for this specific stock
        console.print()
        from_date, to_date = get_dynamic_date_range(days_ahead)
        calendar = finnhub_client.earnings_calendar(
            _from=from_date,
            to=to_date,
            symbol=symbol,
            international=MARKET_CONFIG[market]['international']
        )
        
        if calendar.get('earningsCalendar'):
            earnings_table = Table(title=f'🔔 {symbol.upper()} UPCOMING EARNINGS', show_header=True, header_style='bold cyan', box=None)
            earnings_table.add_column('Date', style='cyan', width=12)
            earnings_table.add_column('Time', style='white', width=8)
            earnings_table.add_column('Quarter', style='yellow', width=10)
            earnings_table.add_column('EPS Estimate', style='green', width=12)
            earnings_table.add_column('Revenue Estimate', style='blue', width=15)
            earnings_table.add_column('Days Until', style='magenta', width=10)
            earnings_table.add_column('Status', style='bold', width=12)
            
            for event in calendar['earningsCalendar']:
                date = event['date']
                time = event['hour'].upper() if event['hour'] else 'TBD'
                quarter = f"Q{event['quarter']} {event['year']}"
                eps_est = f"${event['epsEstimate']:.2f}" if event['epsEstimate'] else 'N/A'
                revenue_est = f"${event['revenueEstimate']/1000000000:.1f}B" if event['revenueEstimate'] else 'N/A'
                
                days_until = (datetime.strptime(date, '%Y-%m-%d') - datetime.now()).days
                if days_until < 0:
                    status = '[dim]📅 PAST[/dim]'
                elif days_until <= 1:
                    status = '[bold red]🔥 TOMORROW[/bold red]'
                elif days_until <= 3:
                    status = '[bold orange1]⚠️ THIS WEEK[/bold orange1]'
                elif days_until <= 7:
                    status = '[bold yellow]👀 NEXT WEEK[/bold yellow]'
                elif days_until <= 30:
                    status = '[green]📅 THIS MONTH[/green]'
                else:
                    status = '[cyan]📆 UPCOMING[/cyan]'
                
                # Enhanced time formatting
                formatted_time = format_market_time(time, market)
                formatted_date = format_date_readable(date)

                earnings_table.add_row(
                    formatted_date,
                    formatted_time,
                    quarter,
                    eps_est,
                    revenue_est,
                    get_relative_date_text(date),
                    status
                )
            
            console.print(earnings_table)
            
        else:
            console.print('[yellow]⚠️ No upcoming earnings data available[/yellow]')
        
    except Exception as e:
        console.print(f'[red]❌ Error fetching data: {str(e)}[/red]')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Finnhub earnings scanner')
    parser.add_argument(
        'command',
        nargs='?',
        default='calendar',
        help='Use "calendar" for market scan, or provide a ticker symbol for single-stock analysis'
    )
    parser.add_argument(
        'extra',
        nargs='*',
        help='Optional legacy args: calendar [stock_limit] [market], or <symbol> [market]'
    )
    parser.add_argument(
        '--market',
        choices=list(MARKET_CONFIG.keys()),
        default='us',
        help='Market to scan (default: us)'
    )
    parser.add_argument(
        '--days',
        type=int,
        default=10,
        help='Number of days ahead for upcoming earnings window (default: 10)'
    )
    parser.add_argument(
        '--all',
        action='store_true',
        help='Calendar mode: scan all available symbols for the selected market'
    )
    args = parser.parse_args()

    market = args.market.lower()
    days_ahead = max(1, args.days)

    if args.command.lower() == 'calendar':
        stock_limit = None
        if args.all:
            stock_limit = None
        if len(args.extra) > 0 and args.extra[0].isdigit():
            stock_limit = int(args.extra[0])
        if len(args.extra) > 0 and args.extra[0].lower() == 'all':
            stock_limit = None
        if len(args.extra) > 0 and args.extra[0].lower() in MARKET_CONFIG:
            market = args.extra[0].lower()
        if len(args.extra) > 1 and args.extra[1].lower() in MARKET_CONFIG:
            market = args.extra[1].lower()
        display_upcoming_earnings_calendar(days_ahead, stock_limit, market)
    else:
        symbol = args.command.upper()
        if len(args.extra) > 0 and args.extra[0].lower() in MARKET_CONFIG:
            market = args.extra[0].lower()
        display_earnings_analysis(symbol, market, days_ahead)
